from __future__ import annotations

import json
from typing import Any

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from gemini_coach import coach_with_gemini

app = FastAPI(title="Golf Swing Coach MVP")

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
    clips: list[UploadFile] = File(...),
    # Optional JSON string with per-clip metrics extracted on client (pose, timestamps, etc.)
    metrics_json: str = Form(default="{}"),
    notes: str = Form(default=""),
) -> dict[str, Any]:
    """
    Accepts 1~5 video clips and returns coaching per clip.
    This MVP does not run pose estimation on the server (keeps it light).
    """
    try:
        metrics_all = json.loads(metrics_json) if metrics_json else {}
        if not isinstance(metrics_all, dict):
            metrics_all = {}
    except Exception:
        metrics_all = {}

    results: list[dict[str, Any]] = []
    for i, clip in enumerate(clips, start=1):
        # Read once to ensure upload is valid; we don't store video in MVP.
        _ = await clip.read()

        per_metrics = metrics_all.get(str(i), {}) if isinstance(metrics_all, dict) else {}
        if not isinstance(per_metrics, dict):
            per_metrics = {}

        coaching = coach_with_gemini(clip_idx=i, metrics=per_metrics, notes=notes)
        results.append(
            {
                "clipIndex": i,
                "filename": clip.filename,
                "summary": coaching.summary,
                "positives": coaching.positives,
                "fixes": coaching.fixes,
                "drill": coaching.drill,
            }
        )

    return {"count": len(results), "results": results}

