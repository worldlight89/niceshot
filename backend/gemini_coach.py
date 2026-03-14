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


# ─── Vertex AI 초기화 ────────────────────────────────────────────────
_init_done = False
_init_error = ""

def _ensure_vertexai():
    global _init_done, _init_error
    if _init_done:
        return _init_error == ""
    _init_done = True
    try:
        import vertexai
        project = os.environ.get("VERTEX_PROJECT_ID", "").strip()
        location = os.environ.get("VERTEX_LOCATION", "us-central1").strip() or "us-central1"
        if not project:
            _init_error = "VERTEX_PROJECT_ID 환경변수 없음"
            return False
        vertexai.init(project=project, location=location)
        print(f"[Vertex AI] Initialized: project={project}, location={location}")
        return True
    except Exception as e:
        _init_error = f"Vertex AI init 실패: {type(e).__name__}: {e}"
        print(f"[Vertex AI] {_init_error}")
        return False


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


# ─── Gemini API Key 방식 (Vertex AI 실패 시 폴백) ────────────────────
def _call_gemini_apikey(content_parts_data: list, prompt: str) -> str | None:
    """GEMINI_API_KEY 환경변수로 Gemini 호출"""
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        return None
    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash")
        parts = []
        for item in content_parts_data:
            if item["type"] == "image":
                parts.append({"mime_type": "image/jpeg", "data": item["bytes"]})
            else:
                parts.append(item["text"])
        parts.append(prompt)
        resp = model.generate_content(parts)
        return (resp.text or "").strip()
    except Exception as e:
        print(f"[Gemini API Key] Error: {type(e).__name__}: {e}")
        return None


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
    image_data: list[dict] = []

    for key, label in FRAME_KEYS:
        frame_data = frames.get(key, {})
        b64 = frame_data.get("base64", "") if isinstance(frame_data, dict) else ""
        metrics_by_phase[key] = frame_data.get("metrics", {}) if isinstance(frame_data, dict) else {}

        if b64:
            raw = b64.split(",")[-1] if "," in b64 else b64
            try:
                image_bytes = base64.b64decode(raw)
                image_data.append({"type": "image", "bytes": image_bytes, "label": label})
            except Exception:
                pass

    prompt = _build_prompt(clip_idx, club, notes, metrics_by_phase)
    text = None

    # 방법 1: Vertex AI SDK
    if _ensure_vertexai():
        try:
            from vertexai.generative_models import GenerativeModel, Part, Image
            model_name = os.environ.get("VERTEX_MODEL", "gemini-2.0-flash-001").strip() or "gemini-2.0-flash-001"
            content_parts = []
            for item in image_data:
                content_parts.append(Part.from_image(Image.from_bytes(item["bytes"])))
                content_parts.append(Part.from_text(f"[{item['label']} 프레임]"))
            content_parts.append(Part.from_text(prompt))
            model = GenerativeModel(model_name)
            resp = model.generate_content(content_parts)
            text = (resp.text or "").strip()
            print(f"[Vertex AI] Success for swing {clip_idx}")
        except Exception as e:
            print(f"[Vertex AI] Call failed: {type(e).__name__}: {e}")
            text = None

    # 방법 2: Gemini API Key 폴백
    if not text:
        print(f"[Gemini] Trying API Key fallback...")
        text = _call_gemini_apikey(image_data, prompt)

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
