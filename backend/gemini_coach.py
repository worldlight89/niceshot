from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any


@dataclass
class CoachingResult:
    summary: str
    positives: list[str]
    fixes: list[str]
    drill: str


def _placeholder(clip_idx: int) -> CoachingResult:
    return CoachingResult(
        summary=f"[클립 {clip_idx}] 업로드가 완료됐어요. 지금은 Gemini/Vertex 설정이 없어서 데모 피드백을 보여줘요.",
        positives=[
            "리듬을 일정하게 유지하려는 시도가 좋아요.",
            "피니시까지 마무리하려는 의도가 보입니다.",
        ],
        fixes=[
            "다운스윙에서 상체가 먼저 열리지 않게, 하체 리드 느낌을 더 주세요.",
            "임팩트 직전 손목 각(캐스팅)을 늦게 풀리도록 의식해보세요.",
        ],
        drill="드릴: 9-3 스윙(하프스윙) 10회 → 같은 템포로 3회 풀스윙.",
    )


def _build_client():
    """
    Priority:
    1) Vertex AI (recommended for production)
       - env: VERTEX_PROJECT_ID, VERTEX_LOCATION (optional), VERTEX_MODEL (optional)
       - auth: GOOGLE_APPLICATION_CREDENTIALS pointing to a service account json (recommended)
    2) Gemini API key
       - env: GEMINI_API_KEY
    """
    try:
        from google import genai  # type: ignore
    except Exception:
        return None, None

    vertex_project = os.environ.get("VERTEX_PROJECT_ID", "").strip()
    if vertex_project:
        # Default us-central1 + gemini-2.0-flash: Seoul(asia-northeast3) often lacks some models (404).
        location = os.environ.get("VERTEX_LOCATION", "us-central1").strip() or "us-central1"
        model = os.environ.get("VERTEX_MODEL", "gemini-2.0-flash").strip() or "gemini-2.0-flash"
        client = genai.Client(vertexai=True, project=vertex_project, location=location)
        return client, model

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if api_key:
        model = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash").strip() or "gemini-2.0-flash"
        client = genai.Client(api_key=api_key)
        return client, model

    return None, None


def coach_with_gemini(*, clip_idx: int, metrics: dict[str, Any], notes: str = "") -> CoachingResult:
    """
    Returns a CoachingResult. If Vertex/Gemini config is missing or the SDK is unavailable,
    returns a placeholder response.
    """
    client, model = _build_client()
    if not client or not model:
        return _placeholder(clip_idx)

    prompt = f"""
당신은 프로 골프 코치입니다. 아래는 한 명의 아마추어 골퍼의 스윙 클립(번호 {clip_idx})에서 추출한 지표입니다.
지표는 대략적인 참고값이며, 확신이 낮은 부분은 가정/조건부로 말하세요.

요구 출력 형식(한국어):
1) 한 줄 요약(20~40자)
2) 좋은 점 2개(각 1문장)
3) 개선점 2개(각 1문장, 원인+교정 포인트 포함)
4) 오늘의 1개 핵심 과제(짧게)
5) 추천 드릴 1개(구체적 반복 횟수 포함)

추출 지표(JSON):
{metrics}

추가 메모(있으면 참고):
{notes}
""".strip()

    try:
        resp = client.models.generate_content(
            model=model,
            contents=prompt,
        )
        text = (resp.text or "").strip()
        if not text:
            return _placeholder(clip_idx)
    except Exception as e:
        # Common: 403 PERMISSION_DENIED from Vertex when IAM roles / API enablement missing.
        ph = _placeholder(clip_idx)
        ph.summary = f"[클립 {clip_idx}] Vertex 호출 실패(권한/설정). 데모 피드백을 표시합니다."
        ph.fixes = [
            f"서버 설정: 서비스계정에 Vertex 권한이 필요해요. (에러: {type(e).__name__})",
            "GCP 콘솔에서 Vertex AI API 활성화 + 서비스계정에 역할 부여 후 다시 시도하세요.",
        ]
        return ph

    # Minimal parsing: keep text as summary, plus generic fields.
    # Later we can implement a structured JSON response.
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    summary = lines[0] if lines else f"[클립 {clip_idx}] 코칭 결과"

    positives: list[str] = []
    fixes: list[str] = []
    drill = ""

    for ln in lines[1:]:
        if ("좋은" in ln or "장점" in ln) and len(positives) < 2:
            positives.append(ln)
        elif ("개선" in ln or "수정" in ln or "보완" in ln) and len(fixes) < 2:
            fixes.append(ln)
        elif ("드릴" in ln or "연습" in ln) and not drill:
            drill = ln

    if len(positives) < 2:
        positives = positives + ["좋은 점: 템포를 유지하려는 시도가 좋아요."] * (2 - len(positives))
    if len(fixes) < 2:
        fixes = fixes + ["개선점: 다운스윙에서 하체 리드 느낌을 더 주세요."] * (2 - len(fixes))
    if not drill:
        drill = "드릴: 9-3 하프스윙 10회 → 동일 템포로 3회 풀스윙."

    return CoachingResult(
        summary=summary,
        positives=positives[:2],
        fixes=fixes[:2],
        drill=drill,
    )

