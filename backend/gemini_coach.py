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
            "generationConfig": {"thinkingConfig": {"thinkingBudget": 0}},
        }

        r = req.post(url, headers=headers, json=body, timeout=60)

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
    # 핵심 수치만 추려서 전달 (프롬프트 길이 최소화)
    key_metrics = {}
    important_keys = ['척추기울기_deg', '어깨기울기_deg', '힙기울기_deg', '왼팔각도_deg', '오른팔각도_deg',
                      '왼무릎굴곡_deg', '오른무릎굴곡_deg', '오른손목_높이_pct', '어깨_힙_회전차_deg']
    for phase in ["address", "takeaway", "backswing", "downswing", "impact", "followthrough", "finish"]:
        m = metrics.get(phase, {})
        if m:
            slim = {k: v for k, v in m.items() if k in important_keys}
            if slim:
                key_metrics[phase] = slim

    metrics_txt = json.dumps(key_metrics, ensure_ascii=False)

    # 엔진이 감지한 문제 (최대 5개만)
    faults = rule_result.get("faults", [])[:5]
    faults_txt = ""
    for f in faults:
        faults_txt += f"  [{f['phase']}] {f.get('friendly_ko', f['label_ko'])} (감점{f['deduction']})\n"
    faults_txt = faults_txt or "  없음\n"

    concern = f"\n고민: {notes}" if notes else ""

    return f"""PGA 프로 골프 코치입니다. 아래 데이터로 스윙을 분석해주세요.

클럽: {club or '미지정'}{concern}

[엔진 감지 문제]
{faults_txt}
[단계별 측정값(각도°, 높이%)]
{metrics_txt}

[관절인덱스] 0=머리,11=왼어깨,12=오른어깨,13=왼팔꿈치,14=오른팔꿈치,15=왼손목,16=오른손목,23=왼엉덩이,24=오른엉덩이,25=왼무릎,26=오른무릎

지시: 각 단계별 점수(0-100)와 문제점(최대2개), 전체점수, 드릴1개를 JSON으로만 출력.
점수기준: 문제없음=85-100, 문제1개=55-75, 문제2개=35-55

⚠️JSON만 출력. 다른 텍스트 금지.
{{"score":75,"phases":{{"address":{{"score":80,"status":"good","problems":[]}},"takeaway":{{"score":55,"status":"warning","problems":[{{"description":"설명.교정법","joints":[13]}}]}},"backswing":{{"score":40,"status":"bad","problems":[{{"description":"설명","joints":[11]}}]}},"downswing":{{"score":85,"status":"good","problems":[]}},"impact":{{"score":90,"status":"good","problems":[]}},"followthrough":{{"score":75,"status":"good","problems":[]}},"finish":{{"score":70,"status":"good","problems":[]}}}},"drill":{{"name":"드릴명","method":"방법(2문장)","reps":"횟수"}}}}"""


def _fallback_error(rule_result: dict | None = None) -> CoachingResult:
    """Gemini 실패 시 규칙 엔진 faults로 최소한의 코칭 제공."""
    phases = ["address", "takeaway", "backswing", "downswing",
               "impact", "followthrough", "finish"]
    phase_coaching: dict[str, dict] = {p: {"status": "good", "problems": []} for p in phases}

    if rule_result:
        fault_by_phase: dict[str, list] = {}
        for f in rule_result.get("faults", []):
            fault_by_phase.setdefault(f["phase"], []).append(f)

        for p in phases:
            p_faults = sorted(fault_by_phase.get(p, []),
                               key=lambda x: x["deduction"], reverse=True)[:3]
            if p_faults:
                status = "bad" if len(p_faults) >= 2 else "warning"
                score = 35 if status == "bad" else 60
                phase_coaching[p] = {
                    "score": score,
                    "status": status,
                    "problems": [
                        {
                            "description": f.get("friendly_ko", f["label_ko"]),
                            "joints": [f["joint_idx"]],
                        }
                        for f in p_faults
                    ],
                }
            else:
                phase_coaching[p] = {"score": 85, "status": "good", "problems": []}

    engine_score = rule_result.get("score") if rule_result else None
    return CoachingResult(
        phase_coaching=phase_coaching,
        overall_drill=rule_result.get("drill", {}) if rule_result else {},
        score=engine_score,
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
        log.warning("Gemini returned no text, using engine fallback")
        return _fallback_error(rule_result)

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
        return _fallback_error(rule_result)
