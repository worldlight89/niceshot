from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass, field
from typing import Any


@dataclass
class CoachingResult:
    coaching: str          # 전체 코칭 텍스트 (마크다운)
    summary: str = ""      # 한 줄 요약


# ─── 플레이스홀더 (Vertex/Gemini 미설정 시) ──────────────────────────
def _placeholder(clip_idx: int) -> CoachingResult:
    return CoachingResult(
        summary=f"[클립 {clip_idx}] 데모 피드백",
        coaching=f"""## 전체 스윙 총평
리듬이 안정적이고, 피니시까지 마무리하려는 의도가 좋습니다. 몇 가지 교정 포인트를 짚어드릴게요.

## 어드레스 분석
- **좋은 점:** 그립과 스탠스 너비가 안정적으로 보입니다.
- **교정 포인트:** 왼쪽 어깨가 목표 방향으로 조금 열려 있습니다. 양 발 너비를 어깨 너비로 맞추고, 볼 위치를 왼쪽 귀 아래에 세팅하세요.
- **코치의 팁:** 셋업 시 클럽 헤드를 먼저 타깃 라인에 맞추고, 그 다음에 몸을 맞추는 루틴을 만들어보세요.

## 백스윙 탑 분석
- **좋은 점:** 백스윙 방향이 타깃 라인과 대체로 평행합니다.
- **교정 포인트:** 다운스윙에서 상체가 먼저 열리는 경향이 있습니다. 하체(왼쪽 무릎)가 먼저 타깃 쪽으로 이동하며 리드하는 느낌을 연습해보세요.
- **코치의 팁:** "왼 무릎이 먼저 목표 쪽으로" 라고 스스로 말하며 스윙하면 도움이 됩니다.

## 임팩트 분석
- **좋은 점:** 임팩트 시 머리가 볼 뒤에 잘 유지되고 있습니다.
- **교정 포인트:** 임팩트 직전 손목(캐스팅)이 일찍 풀리고 있습니다. 임팩트 존에서 손목 각도를 최대한 늦게 릴리즈하세요.
- **코치의 팁:** 9-3 하프스윙으로 임팩트 위치에서 멈추는 연습을 하면 손목 캐스팅 교정에 효과적입니다.

## 오늘의 핵심 과제
**하체 리드 느낌 만들기** — 백스윙 후 왼 무릎이 먼저 목표 방향으로 이동하는 느낌을 몸에 익히세요.

## 추천 드릴
- **이름:** 9-3 하프스윙 + 멈춤
- **방법:** 백스윙 9시 → 다운스윙 → 임팩트에서 1초 멈추고 손목 위치 확인 → 폴로스루 3시까지
- **횟수:** 10회 연속, 하루 3세트
- **기대 효과:** 임팩트 포지션 각인, 손목 캐스팅 교정

⚙️ *현재 Gemini API가 설정되지 않아 데모 피드백이 표시됩니다. 백엔드에 GEMINI_API_KEY 또는 VERTEX_PROJECT_ID를 설정하면 실제 분석이 제공됩니다.*
""",
    )


# ─── Gemini 클라이언트 초기화 ────────────────────────────────────────
_client_error: str = ""   # 전역 에러 메시지 저장

def _build_client():
    global _client_error
    try:
        from google import genai  # type: ignore
    except Exception as e:
        _client_error = f"google-genai 패키지 임포트 실패: {e}"
        return None, None

    vertex_project = os.environ.get("VERTEX_PROJECT_ID", "").strip()
    if vertex_project:
        location = os.environ.get("VERTEX_LOCATION", "us-central1").strip() or "us-central1"
        model = os.environ.get("VERTEX_MODEL", "gemini-2.0-flash").strip() or "gemini-2.0-flash"
        try:
            client = genai.Client(vertexai=True, project=vertex_project, location=location)
            return client, model
        except Exception as e:
            _client_error = f"Vertex AI 클라이언트 초기화 실패: {type(e).__name__}: {e}"
            return None, None

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if api_key:
        model = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash").strip() or "gemini-2.0-flash"
        try:
            client = genai.Client(api_key=api_key)
            return client, model
        except Exception as e:
            _client_error = f"Gemini API Key 클라이언트 실패: {type(e).__name__}: {e}"
            return None, None

    _client_error = "VERTEX_PROJECT_ID 또는 GEMINI_API_KEY 환경변수 없음"
    return None, None


# ─── 프로 골프 코치 프롬프트 (JSON 구조 응답) ────────────────────────
def _build_prompt(clip_idx: int, club: str, notes: str, metrics: dict) -> str:
    addr_m = json.dumps(metrics.get("address", {}), ensure_ascii=False)
    top_m  = json.dumps(metrics.get("top",     {}), ensure_ascii=False)
    imp_m  = json.dumps(metrics.get("impact",  {}), ensure_ascii=False)

    concern_line = f"\n[골퍼의 고민] {notes}" if notes else ""
    return f"""당신은 PGA 투어 출신의 20년 경력 골프 코치입니다.
아마추어 골퍼를 직접 레슨하듯이 따뜻하고 구체적으로 분석해주세요.

[클럽] {club or '미지정'}{concern_line}
[스윙 번호] {clip_idx}번째
[카메라 각도] 후방에서 타깃 방향으로 촬영

첨부된 3장 사진(어드레스 → 백스윙 탑 → 임팩트)을 직접 보고,
아래 MediaPipe 측정값을 참고하여 분석해주세요.
사진을 우선시하고, 수치는 보조 참고만 사용하세요.

[어드레스 측정값] {addr_m}
[백스윙 탑 측정값] {top_m}
[임팩트 측정값] {imp_m}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
반드시 아래 JSON 형식으로만 응답하세요. JSON 외 다른 텍스트는 절대 포함하지 마세요.

joint 이름은 반드시 다음 목록에서만 선택:
nose, left_shoulder, right_shoulder, left_elbow, right_elbow,
left_wrist, right_wrist, left_hip, right_hip,
left_knee, right_knee, left_ankle, right_ankle

direction(교정 방향)은 반드시 다음 중 하나:
up(위로), down(아래로), forward(앞으로), back(뒤로), left(왼쪽), right(오른쪽)

{{
  "address": {{
    "corrections": [
      {{"joint": "관절이름", "direction": "방향", "comment": "이 관절의 교정 이유 (한국어, 1문장)"}}
    ],
    "comment": "어드레스 전체 코멘트 (한국어, 1~2문장)"
  }},
  "top": {{
    "corrections": [
      {{"joint": "관절이름", "direction": "방향", "comment": "교정 이유"}}
    ],
    "comment": "백스윙 탑 전체 코멘트"
  }},
  "impact": {{
    "corrections": [
      {{"joint": "관절이름", "direction": "방향", "comment": "교정 이유"}}
    ],
    "comment": "임팩트 전체 코멘트"
  }},
  "today_focus": "오늘 딱 하나의 핵심 교정 과제 (짧고 명확하게, 레슨 현장 어조)",
  "drill": {{
    "name": "드릴 이름",
    "method": "단계별 구체적인 방법",
    "reps": "횟수 및 세트"
  }}
}}""".strip()


# ─── 메인 함수 ───────────────────────────────────────────────────────
def coach_with_gemini(
    *,
    clip_idx: int,
    frames: dict[str, Any],   # {"address": {"base64": ..., "metrics": ...}, "top": ..., "impact": ...}
    notes: str = "",
    club: str = "",
) -> CoachingResult:
    """
    프레임 이미지(base64) + 포즈 수치를 Gemini 멀티모달로 전달해 프로 코칭 반환.
    설정 없으면 플레이스홀더 반환.
    """
    client, model = _build_client()
    if not client or not model:
        ph = _placeholder(clip_idx)
        if _client_error:
            ph.coaching = f"## Gemini 연결 실패\n\n**원인:** {_client_error}\n\n---\n\n" + ph.coaching
        return ph

    try:
        from google.genai import types  # type: ignore
    except Exception:
        return _placeholder(clip_idx)

    # ── 멀티모달 파트 구성 ──
    parts = []
    frame_keys = [
        ("address", "어드레스"),
        ("top",     "백스윙 탑"),
        ("impact",  "임팩트"),
    ]
    metrics_by_phase: dict[str, dict] = {}

    for key, label in frame_keys:
        frame_data = frames.get(key, {})
        b64 = frame_data.get("base64", "") if isinstance(frame_data, dict) else ""
        metrics_by_phase[key] = frame_data.get("metrics", {}) if isinstance(frame_data, dict) else {}

        if b64:
            # data URL prefix 제거
            raw = b64.split(",")[-1] if "," in b64 else b64
            try:
                image_bytes = base64.b64decode(raw)
                parts.append(types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"))
                parts.append(types.Part.from_text(text=f"[{label} 프레임]"))
            except Exception:
                pass  # 이미지 디코딩 실패 시 텍스트만

    # 텍스트 프롬프트 추가
    prompt = _build_prompt(clip_idx, club, notes, metrics_by_phase)
    parts.append(types.Part.from_text(text=prompt))

    if not parts:
        return _placeholder(clip_idx)

    try:
        resp = client.models.generate_content(
            model=model,
            contents=types.Content(role="user", parts=parts),
        )
        text = (resp.text or "").strip()
        if not text:
            return _placeholder(clip_idx)

        # ```json ... ``` 마크다운 블록 제거
        import re as _re
        text = _re.sub(r"```json\s*", "", text, flags=_re.IGNORECASE)
        text = _re.sub(r"```\s*", "", text)
        text = text.strip()

        # JSON 파싱 검증 (프론트엔드에서도 파싱하지만 서버에서도 확인)
        try:
            parsed = json.loads(text)
            summary = parsed.get("today_focus", f"스윙 {clip_idx} 분석 완료")
        except Exception:
            summary = f"스윙 {clip_idx} 분석 완료"

        return CoachingResult(coaching=text, summary=summary)

    except Exception as e:
        err_type = type(e).__name__
        ph = _placeholder(clip_idx)
        ph.coaching = (
            f"## Gemini 호출 오류\n\n"
            f"**오류 유형:** {err_type}\n\n"
            f"**내용:** {str(e)}\n\n"
            "---\n\n" + ph.coaching
        )
        return ph
