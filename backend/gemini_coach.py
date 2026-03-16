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

# 클럽별 핵심 체크포인트 — Gemini가 집중할 단계를 클럽마다 다르게 지정
_CLUB_FOCUS: dict[str, str] = {
    "드라이버":     "어드레스(와이드스탠스·공위치), 백스윙(최대회전), 임팩트(헤드스피드)",
    "페어웨이우드": "어드레스(공위치중앙), 테이크어웨이(낮고넓게), 임팩트(다운블로우)",
    "롱아이언":     "어드레스(좁은스탠스), 다운스윙(레이트히트), 임팩트(컴프레션)",
    "미들아이언":   "어드레스(균형), 백스윙(템포), 임팩트(다이버트히트·디봇)",
    "숏아이언":     "어드레스(오픈스탠스), 백스윙(3/4스윙), 임팩트(스핀·컨트롤)",
    "웨지":         "어드레스(오픈페이스), 백스윙(짧게), 임팩트(클린컨택·스핀)",
    "퍼터":         "어드레스(눈이볼위), 백스윙(스트로크균등), 임팩트(페이스스퀘어)",
}

# 심각도 판단 기준 — 문제 개수가 아닌 감점 합계 기반
_SCORE_GUIDE = """점수 산정 기준 (문제 개수가 아닌 심각도 기반):
- 90-100: 프로 수준, 문제 없음
- 75-89 : 양호, 경미한 개선 여지
- 55-74 : 주의 필요, 비거리·정확도에 영향
- 35-54 : 심각, 즉시 교정 필요
- 0-34  : 매우 심각, 부상 위험 가능성"""


@dataclass
class CoachingResult:
    phase_coaching: dict[str, dict] = field(default_factory=dict)
    overall_drill: dict[str, str] = field(default_factory=dict)
    feel_coaching: dict[str, Any] = field(default_factory=dict)
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
    key_metrics: dict[str, dict] = {}
    important_keys = [
        '척추기울기_deg', '어깨기울기_deg', '힙기울기_deg',
        '왼팔각도_deg', '오른팔각도_deg',
        '왼무릎굴곡_deg', '오른무릎굴곡_deg',
        '오른손목_높이_pct', '어깨_힙_회전차_deg',
    ]
    for phase in ["address", "takeaway", "backswing", "downswing",
                  "impact", "followthrough", "finish"]:
        m = metrics.get(phase, {})
        if m:
            slim = {k: v for k, v in m.items() if k in important_keys}
            if slim:
                key_metrics[phase] = slim

    metrics_txt = json.dumps(key_metrics, ensure_ascii=False)

    # 엔진이 감지한 문제 — 감점 큰 순서대로 최대 6개 (심각도 판단에 활용)
    faults = sorted(
        rule_result.get("faults", []),
        key=lambda x: x.get("deduction", 0),
        reverse=True,
    )[:6]
    faults_txt = ""
    for f in faults:
        faults_txt += (
            f"  [{f['phase']}] {f.get('friendly_ko', f['label_ko'])}"
            f" (감점{f['deduction']})\n"
        )
    faults_txt = faults_txt or "  없음\n"

    # 클럽별 집중 포인트
    club_focus = _CLUB_FOCUS.get(club, "전체 균형·템포·임팩트")
    club_line = f"클럽: {club or '미지정'} → 집중 체크: {club_focus}"

    # 사용자 고민 — 해당 단계 코칭에 반드시 반영 지시
    concern_block = ""
    if notes:
        concern_block = (
            f"\n[사용자 고민] {notes}\n"
            "→ 위 고민과 직접 관련된 단계의 problems description에 고민 해결 방향을 반드시 포함할 것.\n"
        )

    return f"""당신은 PGA 공인 티칭 프로입니다. 아래 데이터를 분석해 골퍼에게 실질적인 코칭을 제공하세요.

{club_line}{concern_block}
[규칙 엔진 감지 문제 — 감점 높은 순]
{faults_txt}
[단계별 MediaPipe 측정값 (각도°, 높이%)]
{metrics_txt}

[관절 인덱스]
0=머리, 11=왼어깨, 12=오른어깨, 13=왼팔꿈치, 14=오른팔꿈치,
15=왼손목, 16=오른손목, 23=왼엉덩이, 24=오른엉덩이, 25=왼무릎, 26=오른무릎

{_SCORE_GUIDE}

[코칭 작성 규칙]
1. problems description: "문제점. 교정 방법." 형식으로 2문장 이내, 한국어, 구체적 수치 포함
2. 드릴: 연습장에서 바로 실행 가능한 1가지, 3문장 이내
3. 전체 score: 모든 단계 score의 가중평균 (임팩트·다운스윙 가중치 높게)
4. 사용자 고민이 있으면 관련 단계 코칭에 반드시 언급
5. feel_coaching: 수치가 아닌 "느낌" 중심의 코칭. 실제 레슨 프로가 옆에서 말해주듯 자연스럽게.
   - overall_feel: 스윙 전체 흐름/리듬/템포에 대한 총평 (1문장)
   - points: 2~3개, 무게중심·긴장감·흐름·타이밍 등 체감 중심 조언 (각 1문장, 반말 코칭 톤)

⚠️ JSON만 출력. 마크다운·설명 텍스트 절대 금지.
{{"score":75,"phases":{{"address":{{"score":80,"status":"good","problems":[]}},"takeaway":{{"score":55,"status":"warning","problems":[{{"description":"테이크어웨이 시 클럽이 인사이드로 당겨짐. 오른 팔꿈치를 몸에 붙이고 낮고 넓게 뒤로 밀어내세요.","joints":[13,14]}}]}},"backswing":{{"score":40,"status":"bad","problems":[{{"description":"백스윙 탑에서 왼팔이 굽혀짐. 왼팔을 곧게 펴 어깨 회전을 최대화하세요.","joints":[11,13]}}]}},"downswing":{{"score":85,"status":"good","problems":[]}},"impact":{{"score":90,"status":"good","problems":[]}},"followthrough":{{"score":75,"status":"good","problems":[]}},"finish":{{"score":70,"status":"good","problems":[]}}}},"drill":{{"name":"드릴명","method":"방법을 2~3문장으로.","reps":"10회 3세트"}},"feel_coaching":{{"overall_feel":"스윙이 전체적으로 급하고 상체 위주로 치는 느낌이에요.","points":["어드레스에서 어깨 힘을 빼고, 팔이 자연스럽게 늘어진 상태로 시작해보세요.","다운스윙 시작할 때 하체가 먼저 리드하는 느낌으로, 왼쪽 엉덩이를 타겟 쪽으로 밀어주세요.","피니시에서 왼발에 체중 90%가 실린 채로 3초간 균형을 잡아보세요."]}}}}"""


def _fallback_error(rule_result: dict | None = None) -> CoachingResult:
    """Gemini 실패 시 규칙 엔진 faults로 최소한의 코칭 제공."""
    phases = ["address", "takeaway", "backswing", "downswing",
               "impact", "followthrough", "finish"]
    phase_coaching: dict[str, dict] = {
        p: {"status": "good", "problems": []} for p in phases
    }

    if rule_result:
        fault_by_phase: dict[str, list] = {}
        for f in rule_result.get("faults", []):
            fault_by_phase.setdefault(f["phase"], []).append(f)

        for p in phases:
            p_faults = sorted(
                fault_by_phase.get(p, []),
                key=lambda x: x["deduction"],
                reverse=True,
            )[:3]
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
                prob["joints"] = [
                    int(j) for j in prob["joints"]
                    if str(j).lstrip("-").isdigit()
                ]

        # feel_coaching 파싱
        feel_coaching = data.get("feel_coaching", {})
        if not isinstance(feel_coaching, dict):
            feel_coaching = {}
        if "points" in feel_coaching and not isinstance(feel_coaching["points"], list):
            feel_coaching["points"] = []

        log.info(
            "Gemini OK: score=%s phases_with_problems=%d feel=%s",
            gemini_score,
            sum(1 for v in phase_coaching.values() if v.get("problems")),
            bool(feel_coaching.get("overall_feel")),
        )
        return CoachingResult(
            phase_coaching=phase_coaching,
            overall_drill=drill,
            feel_coaching=feel_coaching,
            score=gemini_score,
            success=True,
        )

    except Exception as e:
        log.warning("Gemini JSON parse failed: %s — raw: %s", e, text[:200])
        return _fallback_error(rule_result)
