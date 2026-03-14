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
    return f"""
═══════════════════════════════════════════════════
  NICESHOT AI 골프 코칭 시스템 — 분석 프로토콜
═══════════════════════════════════════════════════

[당신의 역할]
당신은 PGA 투어 20년 경력의 프로 골프 코치입니다.
첨부된 영상(4초)과 MediaPipe 관절 추적 데이터를 함께 분석하여
과학적 근거에 기반한 스윙 코칭을 제공합니다.

영상은 참고용 시각 자료이고, MediaPipe 수치 데이터가 분석의 핵심 근거입니다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[1단계] 골프 스윙 검증

MediaPipe 스윙 동작 감지 결과:
{swing_data}

판정 기준 (하나라도 해당되면 "스윙 아님"):
- has_swing_motion = false
- wrist_height_range_pct < 12 (손목 움직임 거의 없음)
- shoulder_rotation_deg < 5 (상체 회전 없음)
- 영상에서 사람이 골프 스윙 동작을 하지 않음

→ 스윙 아님 판정 시 아래 JSON만 출력하고 종료:
{{"score":-1,"problems":[],"phase_comments":{{}},"drill":{{}},"reason":"골프 스윙이 감지되지 않았습니다."}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[2단계] MediaPipe 데이터 사전 — 각 수치의 의미와 프로 기준값

당신이 받는 데이터는 MediaPipe Pose가 33개 관절을 추적하여 계산한 것입니다:

| 수치 | 의미 | 프로 기준값 |
|---|---|---|
| 척추기울기_deg | 어깨중심→힙중심 기울기 (전방 양수) | 어드레스 35~45° |
| 어깨기울기_deg | 좌→우 어깨 기울기 | 어드레스 약 0°, 탑 -10~-20° |
| 힙기울기_deg | 좌→우 힙 기울기 | 스윙 중 안정적 유지 |
| 어깨_힙_회전차_deg | X-Factor (어깨-힙 분리각) | 프로 45~56°, 아마 30~45° |
| 왼팔각도_deg | 리드암 팔꿈치 각도 (180°=완전직선) | 탑: 155°+ (곧게 펴야 함) |
| 오른팔각도_deg | 트레일암 팔꿈치 각도 | 탑: 80~100° (접혀야 함) |
| 왼무릎굴곡_deg | 왼무릎 굽힘 각도 | 어드레스 155~170° |
| 오른무릎굴곡_deg | 오른무릎 굽힘 각도 | 어드레스 155~170° |
| 오른손목_높이_pct | 화면 대비 오른손목 높이 | 탑: 어깨높이 이상 |
| 손목_어깨위_여부 | 백스윙 충분성 판단 | "손목이 어깨 위" 정상 |

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[3단계] 7구간 분석 체크리스트 — 구간별로 반드시 확인할 항목

1. 어드레스(address):
   - 척추기울기 35~45° 범위인가?
   - 무릎 적절히 굽혀졌는가? (155~170°)
   - 양 어깨-힙 수평 정렬인가?
   - 체중이 양발에 50:50 분배인가? (양발 높이 비교)

2. 테이크어웨이(takeaway):
   - 손목 콕 없이 원피스로 시작하는가?
   - 어깨-팔 삼각형이 유지되는가?
   - 클럽이 몸 뒤로 급격히 빠지지 않는가?

3. 백스윙 탑(top):
   - 왼팔(리드암) 155° 이상 곧게 펴져 있는가? (왼팔각도_deg)
   - X-Factor(어깨_힙_회전차) 45° 이상인가?
   - 오른무릎이 어드레스 각도 유지하는가? (스웨이 방지)
   - 손목이 어깨 위에 도달했는가?
   - 척추기울기가 어드레스 대비 ±5° 이내 유지인가?

4. 트랜지션(transition):
   - 하체(힙)가 먼저 타깃 방향으로 회전 시작하는가?
   - 어깨가 뒤에 남아 X-Factor가 유지/증가하는가?
   - 체중이 왼발(타깃)로 이동 중인가?

5. 임팩트(impact):
   - 척추기울기가 어드레스와 동일하게 유지되는가? (얼리 익스텐션 체크: 차이>10°면 심각)
   - 힙이 타깃 방향으로 열려 있는가?
   - 손목이 클럽보다 앞서 있는가? (핸드퍼스트)
   - 왼무릎이 펴지며 왼쪽 벽을 만드는가?

6. 팔로스루(followthrough):
   - 양팔이 길게 뻗어 있는가? (치킨윙 없음: 왼팔각도 140°+)
   - 에너지가 타깃 방향으로 전달되는가?
   - 머리가 공 위치에 남아 있는가? (헤드업 방지)

7. 피니시(finish):
   - 체중이 왼발에 90%+ 실려 있는가?
   - 균형을 잡고 3초 이상 서 있을 수 있는가?
   - 오른발 뒤꿈치가 들려 있는가?

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[4단계] 채점 기준 (100점 만점)

기본 100점에서 감점 방식:
- 척추기울기 어드레스↔임팩트 차이 > 10°: -15점 (얼리 익스텐션)
- 척추기울기 어드레스↔임팩트 차이 6~10°: -8점
- 리드암(왼팔) 탑에서 < 140°: -12점 (팔꿈치 접힘)
- 리드암(왼팔) 탑에서 140~155°: -5점
- X-Factor < 30°: -12점 (회전 부족)
- X-Factor 30~40°: -5점
- 무릎굴곡 변화 > 15° (어드레스↔탑): -8점 (스웨이/슬라이드)
- 손목이 어깨 아래 (탑): -8점 (백스윙 부족)
- 임팩트 시 힙/어깨 정렬 이상: -5점
- 피니시 밸런스 불안정: -5점
- 팔로스루 치킨윙: -8점
- 헤드업: -5점

점수 등급:
90~100: 투어 프로 수준, 거의 완벽
80~89: 싱글 핸디캡 수준, 세부 미세 조정 필요
70~79: 중급 골퍼, 1~2가지 구조적 교정 필요
60~69: 초중급, 기본기 보강 시급
60 미만: 기초부터 재정립 필요

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[5단계] 분석 대상 데이터

[클럽] {club or '미지정'}{concern}
[카메라] 후방에서 타깃 방향 촬영

[어드레스 MediaPipe 수치]
{addr_m}

[백스윙 탑 MediaPipe 수치]
{top_m}

[임팩트 MediaPipe 수치]
{imp_m}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[6단계] 출력 형식

⚠️ 반드시 아래 JSON만 출력. JSON 외 텍스트 절대 금지.

규칙:
- score: 4단계 채점 기준에 따라 감점 계산한 정수 (0~100)
- problems: 가장 감점이 큰 문제부터 최대 3개 (없으면 빈 배열)
- phase_comments: 7구간별 코멘트, 수치 근거 포함 (예: "척추각 38°로 양호" 또는 "X-Factor 28°로 회전 부족")
- joint: left_shoulder/right_shoulder/left_elbow/right_elbow/left_wrist/right_wrist/left_hip/right_hip/left_knee/right_knee/left_ankle/right_ankle
- direction: up/down/forward/back/left/right
- description: "수치 근거 + 문제 + 교정법" 한 문장 (예: "왼팔각도 125°로 팔꿈치가 접힘, 백스윙 시 왼팔을 곧게 유지하세요")
- drill: 가장 심각한 문제를 교정하는 실전 드릴

{{
  "score": 72,
  "problems": [
    {{"phase":"top","joint":"left_elbow","direction":"up","description":"왼팔각도 125°로 팔꿈치 접힘, 백스윙 시 리드암을 곧게 펴세요"}},
    {{"phase":"impact","joint":"left_hip","direction":"left","description":"척추각 어드레스 40°→임팩트 28°로 얼리익스텐션 발생, 힙을 뒤로 유지하세요"}}
  ],
  "phase_comments": {{
    "address":"척추각 40°, 무릎굴곡 양호한 셋업",
    "takeaway":"원피스 테이크백 양호",
    "top":"왼팔 125°로 접힘, X-Factor 35°로 회전 부족",
    "transition":"하체 선행 회전 부족",
    "impact":"척추각 12° 변화로 얼리익스텐션",
    "followthrough":"팔 연장 양호",
    "finish":"밸런스 안정적"
  }},
  "drill": {{"name":"벽 드릴","method":"엉덩이를 벽에 대고 스윙하며 임팩트까지 엉덩이가 벽에서 떨어지지 않도록 연습합니다. 이를 통해 척추각 유지와 얼리익스텐션 교정이 가능합니다.","reps":"10회 3세트"}}
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
