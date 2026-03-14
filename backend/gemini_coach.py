"""
Gemini integration — natural language coaching comments only.

The rule engine (rule_engine.py) handles scoring, fault detection,
and correction data.  Gemini's job is limited to producing
human-readable, 1-sentence comments per swing phase.
"""

from __future__ import annotations

import base64
import json
import os
import re
from dataclasses import dataclass, field
from typing import Any


@dataclass
class CommentsResult:
    phase_comments: dict[str, str] = field(default_factory=dict)
    success: bool = True


# ─── Gemini API call (unchanged) ─────────────────────────────────────

def _call_gemini(content_parts: list) -> str | None:
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

        parts_json = []
        for p in content_parts:
            if p.get("type") == "video":
                parts_json.append(
                    {
                        "inline_data": {
                            "mime_type": p.get("mime_type", "video/mp4"),
                            "data": base64.b64encode(p["bytes"]).decode("utf-8"),
                        }
                    }
                )
            elif p.get("type") == "text":
                parts_json.append({"text": p["text"]})

        body = {"contents": [{"role": "user", "parts": parts_json}]}
        r = req.post(url, headers=headers, json=body, timeout=90)

        if r.status_code == 200:
            rj = r.json()
            return (
                rj.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "")
            )
        print(f"[Gemini] HTTP {r.status_code}: {r.text[:500]}")
        return None
    except Exception as e:
        print(f"[Gemini] Error: {type(e).__name__}: {e}")
        return None


# ─── Simplified prompt ───────────────────────────────────────────────

def _build_prompt(
    club: str,
    notes: str,
    metrics: dict,
    rule_result: dict,
) -> str:
    score = rule_result.get("score", "?")

    problems_txt = ""
    for p in rule_result.get("problems", []):
        problems_txt += f"  - [{p['phase']}] {p['description']}\n"
    if not problems_txt:
        problems_txt = "  - 없음 (우수한 스윙)\n"

    addr_m = json.dumps(metrics.get("address", {}), ensure_ascii=False)
    take_m = json.dumps(metrics.get("takeaway", {}), ensure_ascii=False)
    bs_m = json.dumps(metrics.get("backswing", {}), ensure_ascii=False)
    ds_m = json.dumps(metrics.get("downswing", {}), ensure_ascii=False)
    imp_m = json.dumps(metrics.get("impact", {}), ensure_ascii=False)
    ft_m = json.dumps(metrics.get("followthrough", {}), ensure_ascii=False)
    fin_m = json.dumps(metrics.get("finish", {}), ensure_ascii=False)

    concern = f"\n골퍼의 고민: {notes}" if notes else ""

    return f"""당신은 PGA 투어 경력의 프로 골프 코치입니다.
첨부된 4초 스윙 영상과 아래 분석 데이터를 참고하여
7개 스윙 구간별로 1문장씩 코칭 코멘트를 작성해주세요.

클럽: {club or '미지정'}{concern}

[규칙 엔진 분석 결과]
점수: {score}/100
감지된 문제:
{problems_txt}
[MediaPipe 측정 수치]
어드레스: {addr_m}
테이크어웨이: {take_m}
백스윙: {bs_m}
다운스윙: {ds_m}
임팩트: {imp_m}
팔로우스루: {ft_m}
피니시: {fin_m}

[지시사항]
- 각 구간별 코멘트에 측정 수치 근거를 포함 (예: "척추각 38°로 양호")
- 문제가 있는 구간은 교정 포인트를 간단히 언급
- 문제가 없는 구간은 긍정적으로 평가
- 한국어, 1구간 1문장, 간결하게

⚠️ 반드시 아래 JSON만 출력. JSON 외 텍스트 절대 금지.

{{
  "address": "코멘트",
  "takeaway": "코멘트",
  "backswing": "코멘트",
  "downswing": "코멘트",
  "impact": "코멘트",
  "followthrough": "코멘트",
  "finish": "코멘트"
}}"""


# ─── Fallback when Gemini is unavailable ─────────────────────────────

def _fallback(rule_result: dict | None) -> CommentsResult:
    phases = [
        "address", "takeaway", "backswing", "downswing",
        "impact", "followthrough", "finish",
    ]
    comments: dict[str, str] = {}

    if not rule_result:
        for p in phases:
            comments[p] = "분석 데이터 없음"
        return CommentsResult(phase_comments=comments, success=False)

    grades = rule_result.get("phase_grades", {})
    fault_by_phase: dict[str, list[str]] = {}
    for f in rule_result.get("faults", []):
        fault_by_phase.setdefault(f["phase"], []).append(f["label_ko"])

    for p in phases:
        grade = grades.get(p, "good")
        if grade == "good":
            comments[p] = "양호"
        elif p in fault_by_phase:
            comments[p] = ", ".join(fault_by_phase[p])
        else:
            comments[p] = "확인 필요"

    return CommentsResult(phase_comments=comments, success=False)


# ─── Main entry point ────────────────────────────────────────────────

def generate_phase_comments(
    *,
    video_bytes: bytes,
    video_mime: str = "video/mp4",
    notes: str = "",
    club: str = "",
    metrics: dict[str, Any] | None = None,
    rule_result: dict[str, Any] | None = None,
) -> CommentsResult:
    """Ask Gemini to write 7 one-sentence coaching comments."""

    content_parts: list[dict] = [
        {"type": "video", "bytes": video_bytes, "mime_type": video_mime},
        {"type": "text", "text": "[골프 스윙 영상]"},
    ]

    prompt = _build_prompt(club, notes, metrics or {}, rule_result or {})
    content_parts.append({"type": "text", "text": prompt})

    text = _call_gemini(content_parts)
    if not text:
        return _fallback(rule_result)

    text = re.sub(r"```json\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"```\s*", "", text)
    text = text.strip()

    try:
        comments = json.loads(text)
        if isinstance(comments, dict):
            return CommentsResult(phase_comments=comments, success=True)
    except Exception:
        pass

    return _fallback(rule_result)
