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


def _build_prompt(club: str, notes: str, metrics: dict, rule_result: dict) -> str:
    metrics_txt = ""
    for phase in ["address", "takeaway", "backswing", "downswing",
                   "impact", "followthrough", "finish"]:
        m = metrics.get(phase, {})
        if m:
            metrics_txt += f"  {phase}: {json.dumps(m, ensure_ascii=False)}\n"

    swing_ind = metrics.get("swing_indicators", {})
    swing_txt = json.dumps(swing_ind, ensure_ascii=False) if swing_ind else "없음"

    # 엔진이 프로 기준과 비교해서 발견한 문제들
    faults = rule_result.get("faults", [])
    faults_txt = ""
    for f in faults:
        faults_txt += (
            f"  - [{f['phase']}] {f.get('friendly_ko', f['label_ko'])} "
            f"(감점 {f['deduction']}점)\n"
        )
    faults_txt = faults_txt or "  - 엔진 감지 문제 없음\n"

    concern = f"\n골퍼의 고민: {notes}" if notes else ""

    return f"""당신은 PGA 투어 경력 20년의 프로 골프 코치입니다.
아래 MediaPipe 센서 데이터와 규칙 엔진 분석 결과를 보고 골프 스윙을 코칭해주세요.

클럽: {club or '미지정'}{concern}

[스윙 전체 지표 (MediaPipe)]
{swing_txt}

[규칙 엔진 — 프로 기준과 비교한 문제점]
(엔진이 29개 규칙으로 측정값을 프로 기준각과 비교한 결과입니다)
{faults_txt}
[7단계별 MediaPipe 원시 측정값]
(단위: 각도=°, 높이=화면비율 0~100%)
{metrics_txt}
[관절 인덱스 참고]
0=머리, 11=왼어깨, 12=오른어깨, 13=왼팔꿈치, 14=오른팔꿈치,
15=왼손목, 16=오른손목, 23=왼엉덩이, 24=오른엉덩이,
25=왼무릎, 26=오른무릎, 27=왼발목, 28=오른발목

[지시사항]
1. 엔진이 감지한 문제점을 참고하되, 당신의 코치 판단으로 최종 평가하세요
2. 각 단계별 문제점을 최대 3개 분석하세요
3. 각 문제에 해당하는 관절 인덱스(joints)를 포함하세요
4. 문제 설명은 한국어, 초보자도 이해하기 쉽게 (2문장 이내)
5. 문제가 없는 단계는 problems를 빈 배열로
6. 전체 스윙을 종합 평가한 점수(0~100)를 직접 매기세요
7. 가장 중요한 교정 드릴 1개를 추천하세요
8. 측정 수치를 근거로 사용하세요

⚠️ 반드시 아래 JSON 형식만 출력. JSON 외 텍스트 절대 금지.

{{
  "score": 75,
  "phases": {{
    "address": {{"status": "good", "problems": []}},
    "takeaway": {{
      "status": "warning",
      "problems": [{{"description": "문제 설명. 교정 방법.", "joints": [13, 15]}}]
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
    rule_result: dict[str, Any] | None = None,
) -> CoachingResult:
    """엔진 분석 결과 + MediaPipe 메트릭을 Gemini에 보내 AI 코칭을 받습니다."""

    prompt = _build_prompt(club, notes, metrics or {}, rule_result or {})
    text = _call_gemini(prompt)

    if not text:
        log.warning("Gemini returned no text")
        return _fallback_error()

    text = re.sub(r"```json\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"```\s*", "", text)
    text = text.strip()

    try:
        data = json.loads(text)

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
