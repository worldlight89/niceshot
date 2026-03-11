from __future__ import annotations

import json
from typing import Any

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from gemini_coach import coach_with_gemini

app = FastAPI(title="Golf Swing Coach – NICESHOT")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


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
            "address": frame_set.get("address", {}),
            "top":     frame_set.get("top",     {}),
            "impact":  frame_set.get("impact",  {}),
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
