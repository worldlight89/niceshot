"""규칙 엔진 핵심 로직 테스트."""
from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from rule_engine import analyze_swing
from pro_reference import DEDUCTION_RULES, DRILL_MAP, get_pro_angles

GOOD_SWING = {
    "address": {"척추기울기_deg": 35, "어깨기울기_deg": 2, "힙기울기_deg": 0, "어깨_힙_회전차_deg": 2, "왼팔각도_deg": 175, "오른팔각도_deg": 175, "왼무릎굴곡_deg": 160, "오른무릎굴곡_deg": 160, "오른손목_높이_pct": 42, "어깨_높이_pct": 55, "머리높이_pct": 70, "손목_어깨위_여부": "손목이 어깨 아래"},
    "takeaway": {"척추기울기_deg": 35, "어깨기울기_deg": 6, "힙기울기_deg": 1, "어깨_힙_회전차_deg": 5, "왼팔각도_deg": 172, "오른팔각도_deg": 165, "왼무릎굴곡_deg": 160, "오른무릎굴곡_deg": 160, "오른손목_높이_pct": 48, "어깨_높이_pct": 55, "머리높이_pct": 70, "손목_어깨위_여부": "손목이 어깨 아래"},
    "backswing": {"척추기울기_deg": 36, "어깨기울기_deg": 28, "힙기울기_deg": 6, "어깨_힙_회전차_deg": 45, "왼팔각도_deg": 172, "오른팔각도_deg": 90, "왼무릎굴곡_deg": 158, "오른무릎굴곡_deg": 162, "오른손목_높이_pct": 72, "어깨_높이_pct": 55, "머리높이_pct": 69, "손목_어깨위_여부": "손목이 어깨 위"},
    "downswing": {"척추기울기_deg": 35, "어깨기울기_deg": 18, "힙기울기_deg": 14, "어깨_힙_회전차_deg": 4, "왼팔각도_deg": 172, "오른팔각도_deg": 85, "왼무릎굴곡_deg": 162, "오른무릎굴곡_deg": 158, "오른손목_높이_pct": 55, "어깨_높이_pct": 55, "머리높이_pct": 69, "손목_어깨위_여부": "손목이 어깨 아래"},
    "impact": {"척추기울기_deg": 34, "어깨기울기_deg": 4, "힙기울기_deg": -15, "어깨_힙_회전차_deg": 19, "왼팔각도_deg": 175, "오른팔각도_deg": 155, "왼무릎굴곡_deg": 168, "오른무릎굴곡_deg": 155, "오른손목_높이_pct": 38, "어깨_높이_pct": 55, "머리높이_pct": 69, "손목_어깨위_여부": "손목이 어깨 아래"},
    "followthrough": {"척추기울기_deg": 25, "어깨기울기_deg": -12, "힙기울기_deg": -22, "어깨_힙_회전차_deg": 10, "왼팔각도_deg": 160, "오른팔각도_deg": 165, "왼무릎굴곡_deg": 172, "오른무릎굴곡_deg": 150, "오른손목_높이_pct": 65, "어깨_높이_pct": 55, "머리높이_pct": 70, "손목_어깨위_여부": "손목이 어깨 위"},
    "finish": {"척추기울기_deg": 18, "어깨기울기_deg": -15, "힙기울기_deg": -25, "어깨_힙_회전차_deg": 10, "왼팔각도_deg": 150, "오른팔각도_deg": 130, "왼무릎굴곡_deg": 172, "오른무릎굴곡_deg": 160, "오른손목_높이_pct": 55, "어깨_높이_pct": 55, "머리높이_pct": 70, "손목_어깨위_여부": "손목이 어깨 아래"},
    "swing_indicators": {"valid": True, "has_swing_motion": True, "wrist_height_range_pct": 34, "shoulder_rotation_deg": 26, "hip_rotation_deg": 20},
}

BAD_SWING = {
    "address": {"척추기울기_deg": 42, "어깨기울기_deg": 8, "힙기울기_deg": 0, "어깨_힙_회전차_deg": 8, "왼팔각도_deg": 170, "오른팔각도_deg": 170, "왼무릎굴곡_deg": 170, "오른무릎굴곡_deg": 165, "오른손목_높이_pct": 40, "어깨_높이_pct": 55, "머리높이_pct": 70, "손목_어깨위_여부": "손목이 어깨 아래"},
    "takeaway": {"척추기울기_deg": 44, "어깨기울기_deg": 12, "힙기울기_deg": 3, "어깨_힙_회전차_deg": 9, "왼팔각도_deg": 140, "오른팔각도_deg": 145, "왼무릎굴곡_deg": 170, "오른무릎굴곡_deg": 165, "오른손목_높이_pct": 45, "어깨_높이_pct": 55, "머리높이_pct": 70, "손목_어깨위_여부": "손목이 어깨 아래"},
    "backswing": {"척추기울기_deg": 50, "어깨기울기_deg": 32, "힙기울기_deg": 12, "어깨_힙_회전차_deg": 18, "왼팔각도_deg": 130, "오른팔각도_deg": 75, "왼무릎굴곡_deg": 155, "오른무릎굴곡_deg": 178, "오른손목_높이_pct": 68, "어깨_높이_pct": 55, "머리높이_pct": 60, "손목_어깨위_여부": "손목이 어깨 위"},
    "downswing": {"척추기울기_deg": 34, "어깨기울기_deg": 28, "힙기울기_deg": 10, "어깨_힙_회전차_deg": 10, "왼팔각도_deg": 168, "오른팔각도_deg": 50, "왼무릎굴곡_deg": 160, "오른무릎굴곡_deg": 155, "오른손목_높이_pct": 55, "어깨_높이_pct": 55, "머리높이_pct": 68, "손목_어깨위_여부": "손목이 어깨 아래"},
    "impact": {"척추기울기_deg": 30, "어깨기울기_deg": 10, "힙기울기_deg": -2, "어깨_힙_회전차_deg": 25, "왼팔각도_deg": 148, "오른팔각도_deg": 148, "왼무릎굴곡_deg": 180, "오른무릎굴곡_deg": 150, "오른손목_높이_pct": 35, "어깨_높이_pct": 55, "머리높이_pct": 62, "손목_어깨위_여부": "손목이 어깨 아래"},
    "followthrough": {"척추기울기_deg": 18, "어깨기울기_deg": -10, "힙기울기_deg": -20, "어깨_힙_회전차_deg": 10, "왼팔각도_deg": 120, "오른팔각도_deg": 130, "왼무릎굴곡_deg": 170, "오른무릎굴곡_deg": 170, "오른손목_높이_pct": 60, "어깨_높이_pct": 55, "머리높이_pct": 70, "손목_어깨위_여부": "손목이 어깨 위"},
    "finish": {"척추기울기_deg": -20, "어깨기울기_deg": -15, "힙기울기_deg": -25, "어깨_힙_회전차_deg": 10, "왼팔각도_deg": 140, "오른팔각도_deg": 120, "왼무릎굴곡_deg": 145, "오른무릎굴곡_deg": 160, "오른손목_높이_pct": 50, "어깨_높이_pct": 55, "머리높이_pct": 70, "손목_어깨위_여부": "손목이 어깨 아래"},
    "swing_indicators": {"valid": True, "has_swing_motion": True, "wrist_height_range_pct": 33, "shoulder_rotation_deg": 25, "hip_rotation_deg": 15},
}

NO_SWING = {
    "swing_indicators": {"valid": True, "has_swing_motion": False, "wrist_height_range_pct": 3, "shoulder_rotation_deg": 2, "hip_rotation_deg": 1},
}


class TestAnalyzeSwing:
    def test_good_swing_high_score(self):
        result = analyze_swing(GOOD_SWING, "드라이버")
        assert result["is_swing"] is True
        assert result["score"] >= 80, f"Good swing should score >=80, got {result['score']}"
        assert len(result["faults"]) <= 5

    def test_bad_swing_low_score(self):
        result = analyze_swing(BAD_SWING, "드라이버")
        assert result["is_swing"] is True
        assert result["score"] < 70, f"Bad swing should score <70, got {result['score']}"
        assert len(result["faults"]) > 3

    def test_no_swing_detected(self):
        result = analyze_swing(NO_SWING, "드라이버")
        assert result["is_swing"] is False

    def test_score_never_negative(self):
        result = analyze_swing(BAD_SWING, "드라이버")
        assert result["score"] >= 0

    def test_problems_max_three(self):
        result = analyze_swing(BAD_SWING, "드라이버")
        assert len(result["problems"]) <= 3

    def test_faults_have_required_fields(self):
        result = analyze_swing(BAD_SWING, "드라이버")
        for fault in result["faults"]:
            assert "id" in fault
            assert "phase" in fault
            assert "joint_idx" in fault
            assert "deduction" in fault
            assert "friendly_ko" in fault

    def test_phase_grades_all_phases(self):
        result = analyze_swing(GOOD_SWING, "드라이버")
        phases = ["address", "takeaway", "backswing", "downswing", "impact", "followthrough", "finish"]
        for phase in phases:
            assert phase in result["phase_grades"], f"Missing phase_grades for {phase}"

    def test_drill_returned_for_bad_swing(self):
        result = analyze_swing(BAD_SWING, "드라이버")
        assert result["drill"] is not None
        assert "name" in result["drill"]

    def test_club_specific_scoring(self):
        """같은 스윙이라도 클럽에 따라 점수가 달라야 함."""
        driver = analyze_swing(GOOD_SWING, "드라이버")
        putter = analyze_swing(GOOD_SWING, "퍼터")
        assert driver["score"] != putter["score"] or driver["faults"] != putter["faults"]

    def test_corrections_structure(self):
        result = analyze_swing(BAD_SWING, "드라이버")
        assert "corrections" in result
        for phase, corrs in result["corrections"].items():
            assert isinstance(corrs, list)
            for c in corrs:
                assert "joint_idx" in c


class TestProReference:
    def test_all_rules_have_id(self):
        ids = set()
        for rule in DEDUCTION_RULES:
            assert "id" in rule, f"Rule missing id: {rule}"
            assert rule["id"] not in ids, f"Duplicate rule id: {rule['id']}"
            ids.add(rule["id"])

    def test_all_rules_have_friendly_ko(self):
        for rule in DEDUCTION_RULES:
            assert "friendly_ko" in rule, f"Rule {rule['id']} missing friendly_ko"

    def test_drill_map_covers_rules(self):
        rule_ids = {r["id"] for r in DEDUCTION_RULES}
        drill_ids = set(DRILL_MAP.keys())
        missing = rule_ids - drill_ids
        assert len(missing) == 0, f"Rules without drills: {missing}"

    def test_pro_angles_all_clubs(self):
        clubs = ["driver", "fairway", "long_iron", "mid_iron", "short_iron", "wedge", "putter"]
        for club in clubs:
            angles = get_pro_angles(club)
            assert len(angles) > 0, f"No angles for {club}"

    def test_pro_angles_have_phases(self):
        angles = get_pro_angles("driver")
        for phase in ["address", "backswing", "impact", "followthrough"]:
            assert phase in angles, f"Driver angles missing {phase}"

    def test_total_max_deduction_reasonable(self):
        """모든 규칙이 최대로 발동해도 점수가 음수가 되지 않도록 체감체계 확인."""
        total = 0
        for r in DEDUCTION_RULES:
            tiers = r.get("tiers", [])
            if tiers:
                total += max(t.get("deduction", 0) for t in tiers)
        assert total < 300, f"Total max deduction too high: {total}"
