from __future__ import annotations

import json
import os
from typing import Any

# .env 파일 자동 로드
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Railway: GOOGLE_APPLICATION_CREDENTIALS_JSON → 임시 파일로 저장
import tempfile
_sa_json = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON", "").strip()
if _sa_json:
    try:
        _fd, _tmppath = tempfile.mkstemp(suffix=".json")
        with os.fdopen(_fd, "w", encoding="utf-8") as _f:
            _f.write(_sa_json)
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = _tmppath
        print(f"[SA] Credentials written to {_tmppath} ({len(_sa_json)} chars)")
    except Exception as _e:
        print(f"[SA] Failed to write credentials: {_e}")

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from gemini_coach import generate_phase_comments
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
    """Gemini 연결 테스트 - REST API 직접 호출"""
    import requests as req

    creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
    project = os.environ.get("VERTEX_PROJECT_ID", "").strip()
    location = os.environ.get("VERTEX_LOCATION", "us-central1").strip()
    model_name = os.environ.get("VERTEX_MODEL", "gemini-2.5-flash").strip()

    info: dict[str, Any] = {
        "project": project,
        "location": location,
        "model": model_name,
        "creds_path": creds_path,
        "creds_exists": os.path.exists(creds_path),
    }

    # 1) 서비스 계정 정보 읽기
    try:
        with open(creds_path, "r") as f:
            sa_data = json.load(f)
        info["sa_email"] = sa_data.get("client_email", "???")
        info["sa_project"] = sa_data.get("project_id", "???")
    except Exception as e:
        info["sa_read_error"] = str(e)
        return info

    # 2) 액세스 토큰 발급
    try:
        import google.auth
        import google.auth.transport.requests as gauth_req
        creds, auto_project = google.auth.default(
            scopes=[
                "https://www.googleapis.com/auth/cloud-platform",
                "https://www.googleapis.com/auth/generative-language",
                "https://www.googleapis.com/auth/generative-language.retriever",
            ]
        )
        creds.refresh(gauth_req.Request())
        info["token_ok"] = True
        info["token_project"] = auto_project
    except Exception as e:
        info["token_ok"] = False
        info["token_error"] = f"{type(e).__name__}: {e}"
        return info

    # 3) 여러 모델/엔드포인트 조합 테스트
    headers = {
        "Authorization": f"Bearer {creds.token}",
        "Content-Type": "application/json",
    }
    body = {
        "contents": [{"role": "user", "parts": [{"text": "say hi"}]}]
    }

    tests = [
        ("vertex-v1", f"https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/gemini-2.5-flash:generateContent"),
        ("genai-v1beta", f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"),
    ]

    results_list = []
    for label, url in tests:
        try:
            r = req.post(url, headers=headers, json=body, timeout=15)
            entry = {"test": label, "http": r.status_code}
            if r.status_code == 200:
                rj = r.json()
                entry["text"] = rj.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")[:100]
            else:
                entry["err"] = r.text[:300]
            results_list.append(entry)
        except Exception as e:
            results_list.append({"test": label, "err": str(e)[:200]})

    info["tests"] = results_list
    info["status"] = "SUCCESS" if any(t.get("http") == 200 for t in results_list) else "ALL_FAILED"
    return info


@app.post("/api/analyze")
async def analyze(
    clips: list[UploadFile] = File(default=[]),
    metrics_json: str = Form(default="{}"),
    notes: str = Form(default=""),
    club: str = Form(default=""),
) -> dict[str, Any]:
    """영상 + MediaPipe 메트릭 → 규칙엔진(점수/교정) + Gemini(코멘트)."""
    if not clips:
        return {"error": "No video provided", "coaching": "", "summary": ""}

    video_bytes = await clips[0].read()
    video_mime = clips[0].content_type or "video/mp4"
    for c in clips[1:]:
        await c.read()

    try:
        metrics = json.loads(metrics_json) if metrics_json else {}
    except Exception:
        metrics = {}

    # 1) Rule engine — deterministic score, faults, corrections (club-specific)
    rule_result = analyze_swing(metrics, club=club)

    # 2) Non-swing → return immediately (skip Gemini)
    if not rule_result["is_swing"]:
        coaching = json.dumps(
            {
                "score": -1,
                "problems": [],
                "phase_comments": {},
                "drill": {},
                "corrections": {},
                "reason": rule_result.get(
                    "reason", "골프 스윙이 감지되지 않았습니다."
                ),
            },
            ensure_ascii=False,
        )
        return {"summary": "스윙 미감지", "coaching": coaching}

    # 3) Gemini — natural language phase comments only
    gemini = generate_phase_comments(
        video_bytes=video_bytes,
        video_mime=video_mime,
        notes=notes,
        club=club,
        metrics=metrics,
        rule_result=rule_result,
    )

    # 4) Merge rule engine + Gemini results
    coaching = json.dumps(
        {
            "score": rule_result["score"],
            "problems": rule_result["problems"],
            "faults": rule_result["faults"],
            "phase_grades": rule_result["phase_grades"],
            "phase_comments": gemini.phase_comments,
            "drill": rule_result["drill"],
            "corrections": rule_result["corrections"],
        },
        ensure_ascii=False,
    )

    return {
        "summary": f"스윙 점수: {rule_result['score']}/100",
        "coaching": coaching,
    }
