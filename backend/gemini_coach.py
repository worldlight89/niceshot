"""
Gemini AI 코치 — 스윙 데이터 기반 문제점 분석 + 코칭.

엔진(rule_engine.py)이 MediaPipe 데이터에서 추출한 메트릭과 점수를 받아서,
Gemini가 프로 코치처럼 문제점 진단, 교정 방법, 드릴을 제공합니다.
영상은 보내지 않고 메트릭(숫자)만 전송하여 2~5초 안에 응답합니다.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger("niceshot.gemini")

JOINT_NAMES = {
    0: "코(머리)", 11: "왼어깨", 12: "오른어깨",
    13: "왼팔꿈치", 14: "오른팔꿈치", 15: "왼손목", 16: "오른손목",
    23: "왼엉덩이", 24: "오른엉덩이", 25: "왼무릎", 26: "오른무릎",
    27: "왼발목", 28: "오른발목",
}


@dataclass
class CoachingResult:
    phase_coaching: dict[str, dict] = field(default_factory=dict)
    overall_drill: dict[str, str] = field(default_factory=dict)
    success: bool = True


def _call_gemini(prompt_text: str) -> str | None:
    """Gemini API 호출 — 텍스트만 전송 (영상 없음)."""
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


def _build_coaching_prompt(
    club: str,
    notes: str,
    metrics: dict,
    rule_result: dict,
) -> str:
    score = rule_result.get("score", "?")

    faults_txt = ""
    for f in rule_result.get("faults", []):
        faults_txt += (
            f"  - [{f['phase']}] {f.get('friendly_ko', f['label_ko'])} "
            f"(감점 {f['deduction']}점, 관절: {JOINT_NAMES.get(f['joint_idx'], f['joint'])})\n"
        )
    if not faults_txt:
        faults_txt = "  - 감지된 문제 없음 (우수한 스윙)\n"

    metrics_txt = ""
    for phase in ["address", "takeaway", "backswing", "downswing",
                   "impact", "followthrough", "finish"]:
        m = metrics.get(phase, {})
        if m:
            metrics_txt += f"  {phase}: {json.dumps(m, ensure_ascii=False)}\n"

    concern = f"\n골퍼의 고민: {notes}" if notes else ""

    return f"""당신은 PGA 투어 경력 20년의 프로 골프 코치입니다.
아래 MediaPipe 센서 데이터와 규칙 엔진 분석 결과를 기반으로
골프 스윙을 코칭해주세요.

클럽: {club or '미지정'}{concern}
점수: {score}/100

[규칙 엔진이 감지한 문제점]
{faults_txt}
[7단계별 MediaPipe 측정 데이터]
{metrics_txt}
[사용 가능한 관절 인덱스]
0=머리, 11=왼어깨, 12=오른어깨, 13=왼팔꿈치, 14=오른팔꿈치,
15=왼손목, 16=오른손목, 23=왼엉덩이, 24=오른엉덩이,
25=왼무릎, 26=오른무릎, 27=왼발목, 28=오른발목

[지시사항]
1. 각 단계별로 문제점을 분석하고 최대 3개까지 지적해주세요
2. 각 문제에 대해 해당하는 관절 인덱스(joints)를 반드시 포함하세요
3. 문제 설명은 한국어로, 초보자도 이해하기 쉽게 작성하세요
4. 문제가 없는 단계는 problems를 빈 배열로 하세요
5. 전체적으로 가장 중요한 교정 드릴 1개를 추천하세요
6. 측정 수치를 근거로 활용하세요 (예: "척추각 48°로 프로 기준 35°보다 과도합니다")

⚠️ 반드시 아래 JSON 형식만 출력하세요. JSON 외 텍스트 절대 금지.

{{
  "phases": {{
    "address": {{
      "status": "good" 또는 "warning" 또는 "bad",
      "problems": [
        {{
          "description": "문제 설명 (교정 방법 포함, 2문장 이내)",
          "joints": [관절인덱스1, 관절인덱스2]
        }}
      ]
    }},
    "takeaway": {{ ... }},
    "backswing": {{ ... }},
    "downswing": {{ ... }},
    "impact": {{ ... }},
    "followthrough": {{ ... }},
    "finish": {{ ... }}
  }},
  "drill": {{
    "name": "드릴 이름",
    "method": "드릴 방법 설명 (2~3문장)",
    "reps": "횟수/시간"
  }}
}}"""


def _fallback(rule_result: dict | None) -> CoachingResult:
    """Gemini 실패 시 규칙 엔진 데이터로 대체."""
    phases = [
        "address", "takeaway", "backswing", "downswing",
        "impact", "followthrough", "finish",
    ]
    phase_coaching: dict[str, dict] = {}

    if not rule_result:
        for p in phases:
            phase_coaching[p] = {"status": "good", "problems": []}
        return CoachingResult(phase_coaching=phase_coaching, success=False)

    fault_by_phase: dict[str, list] = {}
    for f in rule_result.get("faults", []):
        fault_by_phase.setdefault(f["phase"], []).append(f)

    for p in phases:
        p_faults = fault_by_phase.get(p, [])
        if not p_faults:
            phase_coaching[p] = {"status": "good", "problems": []}
        else:
            problems = []
            for f in sorted(p_faults, key=lambda x: x["deduction"], reverse=True)[:3]:
                problems.append({
                    "description": f.get("friendly_ko", f["label_ko"]),
                    "joints": [f["joint_idx"]],
                })
            phase_coaching[p] = {
                "status": "bad" if len(p_faults) >= 2 else "warning",
                "problems": problems,
            }

    drill = rule_result.get("drill", {})
    return CoachingResult(
        phase_coaching=phase_coaching,
        overall_drill=drill,
        success=False,
    )


def generate_coaching(
    *,
    notes: str = "",
    club: str = "",
    metrics: dict[str, Any] | None = None,
    rule_result: dict[str, Any] | None = None,
) -> CoachingResult:
    """Gemini에게 메트릭 데이터를 보내 AI 코칭을 받습니다."""

    prompt = _build_coaching_prompt(club, notes, metrics or {}, rule_result or {})
    text = _call_gemini(prompt)

    if not text:
        log.warning("Gemini returned no text, using fallback")
        return _fallback(rule_result)

    text = re.sub(r"```json\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"```\s*", "", text)
    text = text.strip()

    try:
        data = json.loads(text)
        if isinstance(data, dict) and "phases" in data:
            phase_coaching = data["phases"]
            drill = data.get("drill", {})
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
                    prob["joints"] = [int(j) for j in prob["joints"] if str(j).isdigit()]

            log.info("Gemini coaching parsed OK: %d phases with problems",
                     sum(1 for v in phase_coaching.values() if v.get("problems")))
            return CoachingResult(
                phase_coaching=phase_coaching,
                overall_drill=drill,
                success=True,
            )
    except Exception as e:
        log.warning("Gemini JSON parse failed: %s", e)

    return _fallback(rule_result)
