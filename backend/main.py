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

from gemini_coach import coach_with_gemini

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
    model_name = os.environ.get("VERTEX_MODEL", "gemini-2.0-flash-001").strip()

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
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        creds.refresh(gauth_req.Request())
        info["token_ok"] = True
        info["token_project"] = auto_project
    except Exception as e:
        info["token_ok"] = False
        info["token_error"] = f"{type(e).__name__}: {e}"
        return info

    # 3) REST API 직접 호출
    url = (
        f"https://{location}-aiplatform.googleapis.com/v1/"
        f"projects/{project}/locations/{location}/"
        f"publishers/google/models/{model_name}:generateContent"
    )
    headers = {
        "Authorization": f"Bearer {creds.token}",
        "Content-Type": "application/json",
    }
    body = {
        "contents": [{"role": "user", "parts": [{"text": "안녕. 한 문장으로 답해."}]}]
    }

    try:
        r = req.post(url, headers=headers, json=body, timeout=30)
        info["http_status"] = r.status_code
        if r.status_code == 200:
            resp_json = r.json()
            text = resp_json.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
            info["response"] = text
            info["status"] = "SUCCESS"
        else:
            info["status"] = "FAILED"
            info["error_body"] = r.text[:500]
    except Exception as e:
        info["status"] = "FAILED"
        info["request_error"] = f"{type(e).__name__}: {e}"

    return info


@app.post("/api/analyze")
async def analyze(
    clips: list[UploadFile] = File(default=[]),
    # 스윙별 프레임 이미지(base64) + 포즈 수치
    # 형식: [{"swing":1, "address":{"base64":..., "metrics":{...}}, "top":..., "impact":...}, ...]
    frames_json: str = Form(default="[]"),
    notes: str = Form(default=""),
    club: str = Form(default=""),
) -> dict[str, Any]:
    """
    프론트엔드에서 전송한 3장 캡처 이미지 + MediaPipe 수치를 받아
    Gemini 멀티모달로 프로 골프 코칭을 반환합니다.

    frames_json 형식:
    [
      {
        "swing": 1,
        "address": {"base64": "data:image/jpeg;base64,...", "metrics": {...}},
        "top":     {"base64": "...", "metrics": {...}},
        "impact":  {"base64": "...", "metrics": {...}}
      },
      ...
    ]
    """
    # 영상 파일은 받기만 하고 분석에는 사용하지 않음 (대역폭 확인용)
    for clip in clips:
        await clip.read()

    # frames_json 파싱
    try:
        frames_list = json.loads(frames_json) if frames_json else []
        if not isinstance(frames_list, list):
            frames_list = []
    except Exception:
        frames_list = []

    # 스윙 수가 0이면 clips 수만큼 빈 프레임으로 채움
    if not frames_list:
        frames_list = [{"swing": i + 1} for i in range(max(len(clips), 1))]

    results: list[dict[str, Any]] = []
    for i, frame_set in enumerate(frames_list, start=1):
        if not isinstance(frame_set, dict):
            frame_set = {}

        frames = {
            "address":       frame_set.get("address", {}),
            "takeaway":      frame_set.get("takeaway", {}),
            "top":           frame_set.get("top", {}),
            "transition":    frame_set.get("transition", {}),
            "impact":        frame_set.get("impact", {}),
            "followthrough": frame_set.get("followthrough", {}),
            "finish":        frame_set.get("finish", {}),
        }

        coaching = coach_with_gemini(
            clip_idx=i,
            frames=frames,
            notes=notes,
            club=club,
        )

        results.append({
            "swing": i,
            "summary": coaching.summary,
            "coaching": coaching.coaching,
        })

    return {"count": len(results), "results": results}
