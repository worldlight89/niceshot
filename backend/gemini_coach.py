"""
Gemini AI 코치 — MediaPipe 메트릭만 받아서 모든 코칭을 Gemini가 직접 판단.

규칙 엔진 없음. 점수, 문제점, 드릴 전부 Gemini 평가.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger("niceshot.gemini")


@dataclass
class CoachingResult:
    phase_coaching: dict[str, dict] = field(default_factory=dict)
    overall_drill: dict[str, str] = field(default_factory=dict)
    score: int | None = None
    success: bool = True


def _call_gemini(prompt_text: str) -> str | None:
    """Gemini API 호출 — 텍스트만 전송."""
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

        model = (
            os.environ.get("VERTEX_MODEL", "gemini-2.5-flash").strip()
            or "gemini-2.5-flash"
        )
        if model.startswith("gemini-2.0"):
            model = "gemini-2.5-flash"

        url = (
            "https://generativelanguage.googleapis.com"
            f"/v1beta/models/{model}:generateContent"
        )
        headers = {
            "Authorization": f"Bearer {creds.token}",
            "Content-Type": "application/json",
        }
        body = {
            "contents": [{"role": "user", "parts": [{"text": prompt_text}]}],
        }

        r = req.post(url, headers=headers, json=body, timeout=30)

        if r.status_code == 200:
            rj = r.json()
            return (
                rj.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "")
            )
        log.warning("Gemini HTTP %d: %s", r.status_code, r.text[:300])
        return None
    except Exception as e:
        log.error("Gemini error: %s: %s", type(e).__name__, e)
        return None


def _build_prompt(club: str, notes: str, metrics: dict) -> str:
    metrics_txt = ""
    for phase in ["address", "takeaway", "backswing", "downswing",
                   "impact", "followthrough", "finish"]:
        m = metrics.get(phase, {})
        if m:
            metrics_txt += f"  {phase}: {json.dumps(m, ensure_ascii=False)}\n"

    swing_ind = metrics.get("swing_indicators", {})
    swing_txt = json.dumps(swing_ind, ensure_ascii=False) if swing_ind else "없음"

    concern = f"\n골퍼의 고민: {notes}" if notes else ""

    return f"""당신은 PGA 투어 경력 20년의 프로 골프 코치입니다.
아래 MediaPipe 센서 데이터를 보고 골프 스윙을 코칭해주세요.

클럽: {club or '미지정'}{concern}

[스윙 전체 지표]
{swing_txt}

[7단계별 MediaPipe 측정 데이터]
(단위: 각도=°, 높이=화면비율 0~100%)
{metrics_txt}
[관절 인덱스 참고]
0=머리, 11=왼어깨, 12=오른어깨, 13=왼팔꿈치, 14=오른팔꿈치,
15=왼손목, 16=오른손목, 23=왼엉덩이, 24=오른엉덩이,
25=왼무릎, 26=오른무릎, 27=왼발목, 28=오른발목

[지시사항]
1. 먼저 스윙 지표를 보고 실제 골프 스윙인지 판단하세요.
   - has_swing_motion이 false이거나 wrist_height_range_pct가 5 미만이면 스윙 아님
2. 스윙이 맞다면 각 단계별 문제점을 최대 3개 분석하세요
3. 각 문제에 해당하는 관절 인덱스(joints)를 포함하세요
4. 문제 설명은 한국어, 초보자도 이해하기 쉽게 (2문장 이내)
5. 문제가 없는 단계는 problems를 빈 배열로
6. 전체 스윙을 종합 평가한 점수(0~100)를 직접 매기세요
7. 가장 중요한 교정 드릴 1개를 추천하세요
8. 측정 수치를 근거로 사용하세요 (예: "왼무릎 굴곡 152°로 과도하게 펴졌습니다")

⚠️ 반드시 아래 JSON 형식만 출력. JSON 외 텍스트 절대 금지.

스윙이 아닌 경우:
{{"is_swing": false, "reason": "이유"}}

스윙인 경우:
{{
  "is_swing": true,
  "score": 75,
  "phases": {{
    "address": {{
      "status": "good",
      "problems": []
    }},
    "takeaway": {{
      "status": "warning",
      "problems": [
        {{
          "description": "문제 설명. 교정 방법.",
          "joints": [13, 15]
        }}
      ]
    }},
    "backswing": {{"status": "bad", "problems": [{{"description": "...", "joints": [11]}}]}},
    "downswing": {{"status": "good", "problems": []}},
    "impact": {{"status": "good", "problems": []}},
    "followthrough": {{"status": "good", "problems": []}},
    "finish": {{"status": "good", "problems": []}}
  }},
  "drill": {{
    "name": "드릴 이름",
    "method": "드릴 방법 (2~3문장)",
    "reps": "횟수/시간"
  }}
}}"""


def _fallback_no_swing() -> CoachingResult:
    phases = ["address", "takeaway", "backswing", "downswing",
               "impact", "followthrough", "finish"]
    return CoachingResult(
        phase_coaching={p: {"status": "good", "problems": []} for p in phases},
        score=-1,
        success=False,
    )


def _fallback_error() -> CoachingResult:
    phases = ["address", "takeaway", "backswing", "downswing",
               "impact", "followthrough", "finish"]
    return CoachingResult(
        phase_coaching={p: {"status": "good", "problems": []} for p in phases},
        score=None,
        success=False,
    )


def generate_coaching(
    *,
    notes: str = "",
    club: str = "",
    metrics: dict[str, Any] | None = None,
) -> CoachingResult:
    """MediaPipe 메트릭을 Gemini에 보내 AI 코칭을 받습니다."""

    prompt = _build_prompt(club, notes, metrics or {})
    text = _call_gemini(prompt)

    if not text:
        log.warning("Gemini returned no text")
        return _fallback_error()

    text = re.sub(r"```json\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"```\s*", "", text)
    text = text.strip()

    try:
        data = json.loads(text)

        if not data.get("is_swing", True):
            log.info("Gemini: not a golf swing — %s", data.get("reason", ""))
            return CoachingResult(
                phase_coaching={},
                score=-1,
                success=True,
            )

        phase_coaching = data.get("phases", {})
        drill = data.get("drill", {})
        gemini_score = data.get("score")
        if isinstance(gemini_score, (int, float)):
            gemini_score = max(0, min(100, int(gemini_score)))
        else:
            gemini_score = None

        for p in ["address", "takeaway", "backswing", "downswing",
                   "impact", "followthrough", "finish"]:
            if p not in phase_coaching:
                phase_coaching[p] = {"status": "good", "problems": []}
            pc = phase_coaching[p]
            if "problems" not in pc:
                pc["problems"] = []
            if "status" not in pc:
                pc["status"] = "bad" if pc["problems"] else "good"
            for prob in pc["problems"]:
                if "joints" not in prob:
                    prob["joints"] = []
                prob["joints"] = [int(j) for j in prob["joints"]
                                   if str(j).lstrip("-").isdigit()]

        log.info("Gemini OK: score=%s phases_with_problems=%d",
                 gemini_score,
                 sum(1 for v in phase_coaching.values() if v.get("problems")))
        return CoachingResult(
            phase_coaching=phase_coaching,
            overall_drill=drill,
            score=gemini_score,
            success=True,
        )

    except Exception as e:
        log.warning("Gemini JSON parse failed: %s — raw: %s", e, text[:200])
        return _fallback_error()
