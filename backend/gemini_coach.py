from __future__ import annotations

import base64
import json
import os
import re
from dataclasses import dataclass
from typing import Any


@dataclass
class CoachingResult:
    coaching: str
    summary: str = ""


def _placeholder() -> CoachingResult:
    return CoachingResult(
        summary="데모 모드",
        coaching=json.dumps(
            {
                "score": 0,
                "problems": [
                    {
                        "phase": "address",
                        "joint": "left_shoulder",
                        "direction": "down",
                        "description": "Gemini 연결 후 실제 분석 제공",
                    }
                ],
                "phase_comments": {
                    "address": "데모",
                    "takeaway": "데모",
                    "top": "데모",
                    "transition": "데모",
                    "impact": "데모",
                    "followthrough": "데모",
                    "finish": "데모",
                },
                "drill": {"name": "셋업 드릴", "method": "데모 모드입니다", "reps": "-"},
            },
            ensure_ascii=False,
        ),
    )


# ─── Gemini 호출 (Generative Language API + 서비스 계정) ─────────────
def _call_gemini(content_parts: list) -> str | None:
    try:
        import google.auth
        import google.auth.transport.requests as gauth_req
        import requests as req

        creds, _ = google.auth.default(
            scopes=[
                "https://www.googleapis.com/auth/cloud-platform",
                "https://www.googleapis.com/auth/generative-language",
            ]
        )
        creds.refresh(gauth_req.Request())

        model = os.environ.get("VERTEX_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
        if model.startswith("gemini-2.0"):
            model = "gemini-2.5-flash"

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        headers = {
            "Authorization": f"Bearer {creds.token}",
            "Content-Type": "application/json",
        }

        parts_json = []
        for p in content_parts:
            if p.get("type") == "video":
                parts_json.append(
                    {
                        "inline_data": {
                            "mime_type": p.get("mime_type", "video/mp4"),
                            "data": base64.b64encode(p["bytes"]).decode("utf-8"),
                        }
                    }
                )
            elif p.get("type") == "text":
                parts_json.append({"text": p["text"]})

        body = {"contents": [{"role": "user", "parts": parts_json}]}
        r = req.post(url, headers=headers, json=body, timeout=90)

        if r.status_code == 200:
            rj = r.json()
            return (
                rj.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "")
            )
        else:
            print(f"[Gemini] HTTP {r.status_code}: {r.text[:500]}")
            return None
    except Exception as e:
        print(f"[Gemini] Error: {type(e).__name__}: {e}")
        return None


# ─── 프로 골프 코치 프롬프트 ──────────────────────────────────────────
def _build_prompt(club: str, notes: str, metrics: dict) -> str:
    addr_m = json.dumps(metrics.get("address", {}), ensure_ascii=False)
    top_m = json.dumps(metrics.get("top", {}), ensure_ascii=False)
    imp_m = json.dumps(metrics.get("impact", {}), ensure_ascii=False)

    swing_ind = metrics.get("swing_indicators", {})
    swing_data = json.dumps(swing_ind, ensure_ascii=False)

    concern = f"\n[골퍼의 고민] {notes}" if notes else ""
    return f"""당신은 PGA 투어 출신의 20년 경력 골프 코치입니다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 1단계: 골프 스윙 검증 (반드시 먼저 수행)

아래는 MediaPipe가 실시간 측정한 신체 동작 데이터입니다:
{swing_data}

검증 기준:
- has_swing_motion이 false → 골프 스윙 아님
- wrist_height_range_pct가 12 미만 → 팔 움직임 없음
- shoulder_rotation_deg가 5 미만 → 상체 회전 없음
- 영상에서 골프 스윙 자세/동작이 전혀 보이지 않음

위 조건 중 하나라도 해당되면 반드시 아래 JSON만 응답:
{{"score": -1, "problems": [], "phase_comments": {{}}, "drill": {{}}, "reason": "골프 스윙이 감지되지 않았습니다. 카메라 앞에서 실제 스윙을 해주세요."}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏌️ 2단계: 스윙 분석 (골프 스윙이 확인된 경우만)

[클럽] {club or '미지정'}{concern}
[카메라] 후방에서 타깃 방향 촬영

아래 MediaPipe 관절 데이터를 기반으로 분석하고, 영상으로 시각적 확인하세요:
[어드레스 관절 수치] {addr_m}
[백스윙탑 관절 수치] {top_m}
[임팩트 관절 수치] {imp_m}

분석 시 MediaPipe 수치를 근거로 사용:
- 척추기울기_deg: 어드레스 대비 임팩트에서 변화 → 얼리 익스텐션 판단
- 어깨_힙_회전차_deg: X-Factor 판단
- 왼팔각도_deg: 백스윙탑에서 리드암 펴짐 정도
- 오른손목_높이_pct: 백스윙 높이 판단
- 무릎굴곡: 하체 안정성 판단

⚠️ 반드시 아래 JSON만 응답. 다른 텍스트 금지.

규칙:
- score: 0~100 정수 (MediaPipe 수치 기반으로 산정)
- problems: 가장 심각한 문제 최대 3개 (없으면 빈 배열)
- phase_comments: 7구간별 한 줄 코멘트
- joint: left_shoulder/right_shoulder/left_elbow/right_elbow/left_wrist/right_wrist/left_hip/right_hip/left_knee/right_knee/left_ankle/right_ankle
- direction: up/down/forward/back/left/right
- description: MediaPipe 수치 근거 + 교정 방법 한 문장

{{
  "score": 78,
  "problems": [
    {{"phase":"구간키","joint":"관절","direction":"방향","description":"한 문장"}}
  ],
  "phase_comments": {{
    "address":"1문장","takeaway":"1문장","top":"1문장",
    "transition":"1문장","impact":"1문장","followthrough":"1문장","finish":"1문장"
  }},
  "drill": {{"name":"드릴명","method":"방법 2~3문장","reps":"횟수"}}
}}""".strip()


# ─── 메인 함수 ───────────────────────────────────────────────────────
def coach_with_video(
    *,
    video_bytes: bytes,
    video_mime: str = "video/mp4",
    notes: str = "",
    club: str = "",
    metrics: dict[str, Any] | None = None,
) -> CoachingResult:
    content_parts: list[dict] = [
        {"type": "video", "bytes": video_bytes, "mime_type": video_mime},
        {"type": "text", "text": "[골프 스윙 영상]"},
    ]

    prompt = _build_prompt(club, notes, metrics or {})
    content_parts.append({"type": "text", "text": prompt})

    text = _call_gemini(content_parts)
    if not text:
        return _placeholder()

    text = re.sub(r"```json\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"```\s*", "", text)
    text = text.strip()

    try:
        parsed = json.loads(text)
        score = parsed.get("score", "?")
        summary = f"스윙 점수: {score}/100"
    except Exception:
        summary = "스윙 분석 완료"

    return CoachingResult(coaching=text, summary=summary)
