from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("niceshot")

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import tempfile
_sa_json = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON", "").strip()
if _sa_json:
    try:
        _fd, _tmppath = tempfile.mkstemp(suffix=".json")
        with os.fdopen(_fd, "w", encoding="utf-8") as _f:
            _f.write(_sa_json)
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = _tmppath
        log.info("SA credentials written to %s (%d chars)", _tmppath, len(_sa_json))
    except Exception as _e:
        log.error("Failed to write SA credentials: %s", _e)

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from gemini_coach import generate_coaching, CoachingResult, _fallback_error
from rule_engine import analyze_swing

app = FastAPI(title="Golf Swing Coach – NICESHOT")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=86400,
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/test-gemini")
def test_gemini() -> dict[str, Any]:
    """Gemini 연결 테스트"""
    import requests as req

    creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
    info: dict[str, Any] = {
        "creds_path": creds_path,
        "creds_exists": os.path.exists(creds_path),
    }

    try:
        with open(creds_path, "r") as f:
            sa_data = json.load(f)
        info["sa_email"] = sa_data.get("client_email", "???")
    except Exception as e:
        info["sa_read_error"] = str(e)
        return info

    try:
        import google.auth
        import google.auth.transport.requests as gauth_req
        creds, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        creds.refresh(gauth_req.Request())
        info["token_ok"] = True
    except Exception as e:
        info["token_ok"] = False
        info["token_error"] = f"{type(e).__name__}: {e}"
        return info

    headers = {
        "Authorization": f"Bearer {creds.token}",
        "Content-Type": "application/json",
    }
    body = {"contents": [{"role": "user", "parts": [{"text": "say hi"}]}]}
    try:
        r = req.post(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
            headers=headers, json=body, timeout=15,
        )
        info["http"] = r.status_code
        if r.status_code == 200:
            info["text"] = r.json().get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")[:100]
            info["status"] = "SUCCESS"
        else:
            info["err"] = r.text[:300]
            info["status"] = "FAILED"
    except Exception as e:
        info["err"] = str(e)[:200]
        info["status"] = "FAILED"

    return info


@app.post("/api/analyze")
async def analyze(
    clips: list[UploadFile] = File(default=[]),
    metrics_json: str = Form(default="{}"),
    notes: str = Form(default=""),
    club: str = Form(default=""),
) -> dict[str, Any]:
    """MediaPipe 메트릭 → 엔진 분석 → Gemini 코칭."""
    t0 = time.time()

    # 영상은 수신만 하고 버림 (전송하지 않음)
    for c in (clips or []):
        await c.read()

    try:
        metrics = json.loads(metrics_json) if metrics_json else {}
    except Exception:
        log.warning("Invalid metrics_json, using empty dict")
        metrics = {}

    log.info("Analyze: club=%s phases=%s",
             club, list(k for k in metrics if k != "swing_indicators"))

    # 1단계: 규칙 엔진 — 프로 기준 비교 데이터 생성 (스윙 미감지여도 계속 진행)
    rule_result = analyze_swing(metrics, club=club)
    log.info("Engine: is_swing=%s faults=%d",
             rule_result["is_swing"], len(rule_result.get("faults", [])))

    # 스윙 지표로 먼저 판단 — 엔진이 아니라 프론트 MediaPipe 판단 우선
    swing_ind = metrics.get("swing_indicators", {})
    has_motion = swing_ind.get("has_swing_motion", False)
    wrist_range = swing_ind.get("wrist_height_range_pct", 0)
    is_golf_swing = has_motion and wrist_range >= 8

    if not is_golf_swing:
        coaching = json.dumps(
            {
                "score": -1,
                "problems": [],
                "phase_coaching": {},
                "drill": {},
                "reason": "골프 스윙이 감지되지 않았습니다. 전신이 보이도록 카메라를 세우고 실제 스윙을 해주세요.",
            },
            ensure_ascii=False,
        )
        log.info("No swing detected: has_motion=%s wrist_range=%s", has_motion, wrist_range)
        return {"summary": "스윙 미감지", "coaching": coaching}

    # 2단계: Gemini — 엔진이 해석한 데이터 + 원시 메트릭을 보고 AI 코칭
    try:
        gemini = generate_coaching(notes=notes, club=club, metrics=metrics, rule_result=rule_result)
        log.info("Gemini: success=%s score=%s", gemini.success, gemini.score)
    except Exception as e:
        log.error("Gemini failed: %s", e)
        gemini = _fallback_error(rule_result)

    # 스윙 미감지
    if gemini.score == -1:
        coaching = json.dumps(
            {
                "score": -1,
                "problems": [],
                "phase_coaching": {},
                "drill": {},
                "reason": "골프 스윙이 감지되지 않았습니다.",
            },
            ensure_ascii=False,
        )
        return {"summary": "스윙 미감지", "coaching": coaching}

    # Gemini 실패 시 기본 점수 50
    final_score = gemini.score if (gemini.success and gemini.score is not None) else 50

    # Step 9용 problems: Gemini phase_coaching에서 추출
    problems = []
    for phase_key in ["address", "takeaway", "backswing", "downswing",
                       "impact", "followthrough", "finish"]:
        pc = gemini.phase_coaching.get(phase_key, {})
        for prob in (pc.get("problems") or []):
            problems.append({
                "phase": phase_key,
                "description": prob.get("description", ""),
            })
            if len(problems) >= 3:
                break
        if len(problems) >= 3:
            break

    coaching = json.dumps(
        {
            "score": final_score,
            "problems": problems,
            "phase_coaching": gemini.phase_coaching,
            "drill": gemini.overall_drill,
            "feel_coaching": gemini.feel_coaching,
        },
        ensure_ascii=False,
    )

    elapsed = time.time() - t0
    log.info("Done: score=%s elapsed=%.1fs", final_score, elapsed)

    return {
        "summary": f"스윙 점수: {final_score}/100",
        "coaching": coaching,
    }
