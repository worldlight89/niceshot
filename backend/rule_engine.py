"""
Deterministic rule-based golf swing analysis engine.

Compares MediaPipe metrics against pro reference data and produces
consistent, repeatable scores, fault lists, and correction data.
Same input always produces the same output — no LLM involved.
"""

from __future__ import annotations

from typing import Any

from pro_reference import (
    ANGLE_JOINT_MAP,
    DEDUCTION_RULES,
    DRILL_MAP,
    PRO_ANGLES,
    get_club_category,
    get_pro_angles,
)


def analyze_swing(metrics: dict[str, Any], club: str = "") -> dict[str, Any]:
    """
    Main entry point.

    Args:
        metrics: dict with keys ``address``, ``takeaway``, ``backswing``,
                 ``downswing``, ``impact``, ``followthrough``, ``finish``
                 (all optional), ``swing_indicators``.
        club: club name string (e.g. "드라이버", "7I", "SW").

    Returns:
        dict with ``is_swing``, ``score``, ``faults``, ``problems``,
        ``corrections``, ``drill``, ``phase_grades``, ``club_category``.
    """
    club_cat = get_club_category(club)
    indicators = metrics.get("swing_indicators", {})

    if not _is_valid_swing(indicators):
        return {
            "is_swing": False,
            "score": -1,
            "reason": "골프 스윙이 감지되지 않았습니다.",
            "faults": [],
            "problems": [],
            "corrections": {},
            "drill": {},
            "phase_grades": {},
            "club_category": club_cat,
        }

    angles = get_pro_angles(club_cat)
    faults = _check_all_rules(metrics, club_cat, angles)

    raw_deduction = sum(f["deduction"] for f in faults)
    # Diminishing returns: first 40 pts count fully, next 40 at 50%, rest at 25%
    if raw_deduction <= 40:
        total_deduction = raw_deduction
    elif raw_deduction <= 80:
        total_deduction = 40 + (raw_deduction - 40) * 0.5
    else:
        total_deduction = 60 + (raw_deduction - 80) * 0.25
    score = max(0, round(100 - total_deduction))

    return {
        "is_swing": True,
        "score": score,
        "faults": faults,
        "problems": _build_problems(faults),
        "corrections": _build_corrections(faults, metrics),
        "drill": _pick_drill(faults),
        "phase_grades": _grade_phases(faults),
        "club_category": club_cat,
    }


# ── swing validation ─────────────────────────────────────────────────

def _is_valid_swing(indicators: dict) -> bool:
    if not indicators.get("valid", False):
        return False
    if not indicators.get("has_swing_motion", False):
        return False
    if indicators.get("wrist_height_range_pct", 0) < 12:
        return False
    if indicators.get("shoulder_rotation_deg", 0) < 5:
        return False
    return True


# ── rule checking ────────────────────────────────────────────────────

def _check_all_rules(
    metrics: dict, club_cat: str, angles: dict,
) -> list[dict]:
    faults: list[dict] = []
    for rule in DEDUCTION_RULES:
        fault = _check_rule(rule, metrics, club_cat, angles)
        if fault:
            faults.append(fault)
    return faults


def _get_tiers(rule: dict, club_cat: str) -> list[dict]:
    """Return club-specific tiers if available, else default tiers."""
    club_tiers = rule.get("club_tiers", {})
    return club_tiers.get(club_cat, rule.get("tiers", []))


def _get_range(rule: dict, club_cat: str) -> tuple:
    """Return club-specific range if available, else default range."""
    club_range = rule.get("club_range", {})
    return club_range.get(club_cat, rule.get("range", (0, 360)))


def _get_deduction(rule: dict, club_cat: str) -> int:
    """Return club-specific deduction if available, else default."""
    club_ded = rule.get("club_deduction", {})
    return club_ded.get(club_cat, rule.get("deduction", 5))


def _check_rule(
    rule: dict, metrics: dict, club_cat: str, angles: dict,
) -> dict | None:
    rtype = rule["type"]
    if rtype == "cross_phase":
        return _check_cross_phase(rule, metrics, angles)
    if rtype == "below_threshold":
        return _check_below_threshold(rule, metrics, club_cat, angles)
    if rtype == "above_threshold":
        return _check_above_threshold(rule, metrics, club_cat, angles)
    if rtype == "equals":
        return _check_equals(rule, metrics, club_cat)
    if rtype == "out_of_range":
        return _check_out_of_range(rule, metrics, club_cat, angles)
    if rtype == "min_cross_phase":
        return _check_min_cross_phase(rule, metrics, club_cat)
    return None


def _check_cross_phase(rule: dict, metrics: dict, angles: dict) -> dict | None:
    val_a = metrics.get(rule["phase_a"], {}).get(rule["metric"])
    val_b = metrics.get(rule["phase_b"], {}).get(rule["metric"])
    if val_a is None or val_b is None:
        return None

    diff = abs(val_b - val_a)

    for tier in rule["tiers"]:
        if diff >= tier["min_diff"]:
            phase_key = rule.get("report_phase", rule["phase_b"])
            return {
                "id": rule["id"],
                "phase": phase_key,
                "joint": rule["joint"],
                "joint_idx": rule["joint_idx"],
                "metric": rule["metric"],
                "current": val_b,
                "reference": val_a,
                "diff": round(diff, 1),
                "deduction": tier["deduction"],
                "severity": tier["severity"],
                "label_ko": rule["label_ko"],
                "friendly_ko": rule.get("friendly_ko", rule["label_ko"]),
                "description": (
                    f"{rule['metric']} 어드레스 {val_a}° → "
                    f"{rule['phase_b']} {val_b}° (차이 {round(diff)}°)"
                ),
            }
    return None


def _check_below_threshold(
    rule: dict, metrics: dict, club_cat: str, angles: dict,
) -> dict | None:
    val = metrics.get(rule["phase"], {}).get(rule["metric"])
    if val is None:
        return None

    tiers = _get_tiers(rule, club_cat)
    for tier in tiers:
        if tier.get("deduction", 0) == 0:
            continue
        if val < tier["below"]:
            ref = angles.get(rule["phase"], {}).get(rule["metric"], {})
            ideal = ref.get("ideal", tier["below"])
            return {
                "id": rule["id"],
                "phase": rule["phase"],
                "joint": rule["joint"],
                "joint_idx": rule["joint_idx"],
                "metric": rule["metric"],
                "current": val,
                "target": ideal,
                "deduction": tier["deduction"],
                "severity": tier["severity"],
                "label_ko": rule["label_ko"],
                "friendly_ko": rule.get("friendly_ko", rule["label_ko"]),
                "description": f"{rule['metric']} {val}° (기준 {ideal}°)",
            }
    return None


def _check_above_threshold(
    rule: dict, metrics: dict, club_cat: str, angles: dict,
) -> dict | None:
    val = metrics.get(rule["phase"], {}).get(rule["metric"])
    if val is None:
        return None

    tiers = _get_tiers(rule, club_cat)
    for tier in tiers:
        if tier.get("deduction", 0) == 0:
            continue
        if val > tier["above"]:
            ref = angles.get(rule["phase"], {}).get(rule["metric"], {})
            ideal = ref.get("ideal", tier["above"])
            return {
                "id": rule["id"],
                "phase": rule["phase"],
                "joint": rule["joint"],
                "joint_idx": rule["joint_idx"],
                "metric": rule["metric"],
                "current": val,
                "target": ideal,
                "deduction": tier["deduction"],
                "severity": tier["severity"],
                "label_ko": rule["label_ko"],
                "friendly_ko": rule.get("friendly_ko", rule["label_ko"]),
                "description": f"{rule['metric']} {val}° (기준 {ideal}°)",
            }
    return None


def _check_min_cross_phase(
    rule: dict, metrics: dict, club_cat: str,
) -> dict | None:
    """Triggers when cross-phase difference is TOO SMALL (lack of movement)."""
    val_a = metrics.get(rule["phase_a"], {}).get(rule["metric"])
    val_b = metrics.get(rule["phase_b"], {}).get(rule["metric"])
    if val_a is None or val_b is None:
        return None

    diff = abs(val_b - val_a)
    tiers = _get_tiers(rule, club_cat)

    for tier in tiers:
        if tier.get("deduction", 0) == 0:
            continue
        if diff < tier["max_diff"]:
            phase_key = rule.get("report_phase", rule["phase_b"])
            return {
                "id": rule["id"],
                "phase": phase_key,
                "joint": rule["joint"],
                "joint_idx": rule["joint_idx"],
                "metric": rule["metric"],
                "current": val_b,
                "reference": val_a,
                "diff": round(diff, 1),
                "deduction": tier["deduction"],
                "severity": tier["severity"],
                "label_ko": rule["label_ko"],
                "friendly_ko": rule.get("friendly_ko", rule["label_ko"]),
                "description": (
                    f"{rule['metric']} 변화 {round(diff)}° "
                    f"(최소 {tier['max_diff']}° 이상 필요)"
                ),
            }
    return None


def _check_equals(rule: dict, metrics: dict, club_cat: str) -> dict | None:
    val = metrics.get(rule["phase"], {}).get(rule["metric"])
    if val is None:
        return None

    deduction = _get_deduction(rule, club_cat)
    if deduction == 0:
        return None

    if str(val) == str(rule["fault_value"]):
        return {
            "id": rule["id"],
            "phase": rule["phase"],
            "joint": rule["joint"],
            "joint_idx": rule["joint_idx"],
            "metric": rule["metric"],
            "current": val,
            "deduction": deduction,
            "severity": rule["severity"],
            "label_ko": rule["label_ko"],
            "friendly_ko": rule.get("friendly_ko", rule["label_ko"]),
            "description": rule["label_ko"],
        }
    return None


def _check_out_of_range(
    rule: dict, metrics: dict, club_cat: str, angles: dict,
) -> dict | None:
    val = metrics.get(rule["phase"], {}).get(rule["metric"])
    if val is None:
        return None

    lo, hi = _get_range(rule, club_cat)
    if val < lo or val > hi:
        ref = angles.get(rule["phase"], {}).get(rule["metric"], {})
        ideal = ref.get("ideal", (lo + hi) / 2)
        return {
            "id": rule["id"],
            "phase": rule["phase"],
            "joint": rule["joint"],
            "joint_idx": rule["joint_idx"],
            "metric": rule["metric"],
            "current": val,
            "target": ideal,
            "deduction": rule["deduction"],
            "severity": rule["severity"],
            "label_ko": rule["label_ko"],
            "friendly_ko": rule.get("friendly_ko", rule["label_ko"]),
            "description": f"{rule['metric']} {val}° (정상범위 {lo}~{hi}°)",
        }
    return None


# ── results assembly ─────────────────────────────────────────────────

def _build_problems(faults: list[dict]) -> list[dict]:
    """Top 3 faults sorted by deduction, formatted for the frontend."""
    ranked = sorted(faults, key=lambda f: f["deduction"], reverse=True)
    problems = []
    for f in ranked[:3]:
        problems.append({
            "phase": f["phase"],
            "joint": f["joint"],
            "description": f.get("friendly_ko", f["label_ko"]),
            "detail": f["description"],
        })
    return problems


def _build_corrections(
    faults: list[dict],
    metrics: dict,  # noqa: ARG001 – reserved for future use
) -> dict[str, list]:
    """
    Build phase-keyed correction data for the frontend green skeleton.

    Two correction types:
      "angle"     – includes vertex/anchor/endpoint indices + target angle
                    so the frontend can compute the corrected position
      "highlight" – just marks the joint red (no green target)
    """
    corrections: dict[str, list] = {}

    for fault in faults:
        phase = fault["phase"]
        metric = fault.get("metric", "")
        joint_map = ANGLE_JOINT_MAP.get(metric)

        entry: dict[str, Any] = {
            "joint_idx": fault["joint_idx"],
            "joint": fault["joint"],
            "severity": fault["severity"],
            "label": fault.get("friendly_ko", fault["label_ko"]),
        }

        if joint_map and "target" in fault:
            entry["type"] = "angle"
            entry["vertex_idx"] = joint_map["vertex"]
            entry["anchor_idx"] = joint_map["anchor"]
            entry["endpoint_idx"] = joint_map["endpoint"]
            entry["current_deg"] = fault["current"]
            entry["target_deg"] = fault["target"]
        else:
            entry["type"] = "highlight"

        corrections.setdefault(phase, []).append(entry)

    return corrections


def _pick_drill(faults: list[dict]) -> dict:
    if not faults:
        return {}
    worst = max(faults, key=lambda f: f["deduction"])
    return DRILL_MAP.get(worst["id"], {})


def _grade_phases(faults: list[dict]) -> dict[str, str]:
    phases = [
        "address", "takeaway", "backswing", "downswing",
        "impact", "followthrough", "finish",
    ]
    grades: dict[str, str] = {p: "good" for p in phases}

    for f in faults:
        phase = f["phase"]
        if phase in grades:
            if f["severity"] == "fault":
                grades[phase] = "fault"
            elif f["severity"] == "warning" and grades[phase] != "fault":
                grades[phase] = "warning"

    return grades
