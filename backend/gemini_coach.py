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


def _placeholder(clip_idx: int) -> CoachingResult:
    return CoachingResult(
        summary=f"[클립 {clip_idx}] 데모 피드백",
        coaching='{"address":{"corrections":[],"comment":"데모 모드"},"takeaway":{"corrections":[],"comment":"데모"},"top":{"corrections":[],"comment":"데모"},"transition":{"corrections":[],"comment":"데모"},"impact":{"corrections":[],"comment":"데모"},"followthrough":{"corrections":[],"comment":"데모"},"finish":{"corrections":[],"comment":"데모"},"today_focus":"Gemini 연결 후 실제 분석 제공","drill":{"name":"셋업","method":"데모","reps":"10회"}}',
    )


# ─── Gemini 호출 (Generative Language API + 서비스 계정) ─────────────
def _call_gemini(content_parts: list) -> str | None:
    """서비스 계정으로 Generative Language API 호출"""
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

        model = os.environ.get("VERTEX_MODEL", "gemini-2.0-flash").strip() or "gemini-2.0-flash"
        # 버전 번호 제거 (gemini-2.0-flash-001 → gemini-2.0-flash)
        if model.endswith("-001") or model.endswith("-002"):
            model = model.rsplit("-", 1)[0]

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        headers = {
            "Authorization": f"Bearer {creds.token}",
            "Content-Type": "application/json",
        }

        parts_json = []
        for p in content_parts:
            if p.get("type") == "image":
                parts_json.append({
                    "inline_data": {
                        "mime_type": "image/jpeg",
                        "data": base64.b64encode(p["bytes"]).decode("utf-8")
                    }
                })
            elif p.get("type") == "text":
                parts_json.append({"text": p["text"]})

        body = {"contents": [{"role": "user", "parts": parts_json}]}
        r = req.post(url, headers=headers, json=body, timeout=60)

        if r.status_code == 200:
            rj = r.json()
            text = rj.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
            return text
        else:
            print(f"[Gemini] HTTP {r.status_code}: {r.text[:300]}")
            return None
    except Exception as e:
        print(f"[Gemini] Error: {type(e).__name__}: {e}")
        return None


# ─── 프로 골프 코치 프롬프트 (7구간 JSON 응답) ───────────────────────
def _build_prompt(clip_idx: int, club: str, notes: str, metrics: dict) -> str:
    addr_m = json.dumps(metrics.get("address", {}), ensure_ascii=False)
    top_m  = json.dumps(metrics.get("top",     {}), ensure_ascii=False)
    imp_m  = json.dumps(metrics.get("impact",  {}), ensure_ascii=False)

    concern_line = f"\n[골퍼의 고민] {notes}" if notes else ""
    return f"""당신은 PGA 투어 출신의 20년 경력 골프 코치입니다.

[클럽] {club or '미지정'}{concern_line}
[카메라] 후방에서 타깃 방향 촬영

첨부된 7장 사진(어드레스→테이크어웨이→백스윙탑→트랜지션→임팩트→팔로스루→피니시)을 분석하세요.
사진 우선, 아래 측정값은 참고용:
[어드레스] {addr_m}  [백스윙탑] {top_m}  [임팩트] {imp_m}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ 반드시 아래 JSON 형식으로만 응답. JSON 외 텍스트 절대 금지.

규칙:
- corrections: 실제 문제 있는 관절만 포함 (문제없으면 빈 배열)
- comment: 핵심 1문장만 (짧고 명확하게)
- joint: left_shoulder/right_shoulder/left_elbow/right_elbow/left_wrist/right_wrist/left_hip/right_hip/left_knee/right_knee/left_ankle/right_ankle 중 선택
- direction: up/down/forward/back/left/right 중 선택

{{
  "address":       {{"corrections": [{{"joint":"관절","direction":"방향","comment":"1문장"}}], "comment":"1문장"}},
  "takeaway":      {{"corrections": [], "comment":"1문장"}},
  "top":           {{"corrections": [], "comment":"1문장"}},
  "transition":    {{"corrections": [], "comment":"1문장"}},
  "impact":        {{"corrections": [], "comment":"1문장"}},
  "followthrough": {{"corrections": [], "comment":"1문장"}},
  "finish":        {{"corrections": [], "comment":"1문장"}},
  "today_focus": "오늘 딱 하나의 핵심 교정 (15자 이내)",
  "drill": {{"name":"드릴명","method":"방법 2~3문장","reps":"횟수"}}
}}""".strip()


# ─── 메인 함수 ───────────────────────────────────────────────────────
FRAME_KEYS = [
    ("address",       "어드레스"),
    ("takeaway",      "테이크어웨이"),
    ("top",           "백스윙 탑"),
    ("transition",    "트랜지션"),
    ("impact",        "임팩트"),
    ("followthrough", "팔로스루"),
    ("finish",        "피니시"),
]

def coach_with_gemini(
    *,
    clip_idx: int,
    frames: dict[str, Any],
    notes: str = "",
    club: str = "",
) -> CoachingResult:
    metrics_by_phase: dict[str, dict] = {}
    content_parts: list[dict] = []

    for key, label in FRAME_KEYS:
        frame_data = frames.get(key, {})
        b64 = frame_data.get("base64", "") if isinstance(frame_data, dict) else ""
        metrics_by_phase[key] = frame_data.get("metrics", {}) if isinstance(frame_data, dict) else {}

        if b64:
            raw = b64.split(",")[-1] if "," in b64 else b64
            try:
                image_bytes = base64.b64decode(raw)
                content_parts.append({"type": "image", "bytes": image_bytes})
                content_parts.append({"type": "text", "text": f"[{label} 프레임]"})
            except Exception:
                pass

    prompt = _build_prompt(clip_idx, club, notes, metrics_by_phase)
    content_parts.append({"type": "text", "text": prompt})

    text = _call_gemini(content_parts)

    if not text:
        return _placeholder(clip_idx)

    text = re.sub(r"```json\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"```\s*", "", text)
    text = text.strip()

    try:
        parsed = json.loads(text)
        summary = parsed.get("today_focus", f"스윙 {clip_idx} 분석 완료")
    except Exception:
        summary = f"스윙 {clip_idx} 분석 완료"

    return CoachingResult(coaching=text, summary=summary)
