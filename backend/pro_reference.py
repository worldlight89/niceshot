"""
Professional golfer swing reference data.

Sources:
- GolfTEC SwingTRU motion study (10,000+ PGA Tour swings)
- Spine-Hip Kinematic Relationship in Professional Golfers
  (BioMedical Engineering OnLine, 2015, PMC4430877)
- Golf Swing Biomechanics: A Systematic Review (MDPI Sports, 2022)
- Angular Velocity Study (Ann Rehabil Med, 2018)
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Pro reference angles per phase.
# Keys match the Korean metric names from the frontend's extractDetailedMetrics.
# Each entry: {"ideal": value, "good": (lo, hi), "warn": (lo, hi)}
#   good  = acceptable range  →  no deduction
#   warn  = marginal           →  minor deduction
#   outside warn               →  fault deduction
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Club name → category mapping
# ---------------------------------------------------------------------------

CLUB_CATEGORY_MAP: dict[str, str] = {
    "드라이버": "driver", "1W": "driver", "Driver": "driver",
    "페어웨이우드": "fairway", "3W": "fairway", "5W": "fairway",
    "유틸리티": "fairway", "하이브리드": "fairway", "UT": "fairway",
    "롱아이언": "long_iron", "3I": "long_iron", "4I": "long_iron", "5I": "long_iron",
    "미들아이언": "mid_iron", "6I": "mid_iron", "7I": "mid_iron", "8I": "mid_iron",
    "숏아이언": "short_iron", "9I": "short_iron", "PW": "short_iron",
    "웨지": "wedge", "SW": "wedge", "LW": "wedge", "AW": "wedge",
    "52": "wedge", "56": "wedge", "58": "wedge", "60": "wedge",
    "퍼터": "putter", "PT": "putter",
}

DEFAULT_CLUB_CATEGORY = "mid_iron"


def get_club_category(club_name: str) -> str:
    if not club_name:
        return DEFAULT_CLUB_CATEGORY
    name = club_name.strip()
    if name in CLUB_CATEGORY_MAP:
        return CLUB_CATEGORY_MAP[name]
    for key, cat in CLUB_CATEGORY_MAP.items():
        if key in name:
            return cat
    return DEFAULT_CLUB_CATEGORY


# ---------------------------------------------------------------------------
# Club-specific PRO_ANGLES
# ---------------------------------------------------------------------------

_ANGLES_DRIVER: dict[str, dict[str, dict]] = {
    "address": {
        "척추기울기_deg":      {"ideal": 33,  "good": (28, 38),  "warn": (24, 42)},
        "어깨기울기_deg":      {"ideal": -3,  "good": (-8, 2),   "warn": (-12, 8)},
        "왼무릎굴곡_deg":     {"ideal": 158, "good": (150, 168), "warn": (142, 172)},
        "오른무릎굴곡_deg":    {"ideal": 158, "good": (150, 168), "warn": (142, 172)},
        "어깨_힙_회전차_deg":  {"ideal": 0,   "good": (-5, 5),   "warn": (-10, 10)},
    },
    "backswing": {
        "왼팔각도_deg":        {"ideal": 178, "good": (160, 180), "warn": (145, 160)},
        "오른팔각도_deg":      {"ideal": 90,  "good": (80, 100),  "warn": (65, 115)},
        "어깨_힙_회전차_deg":  {"ideal": 55,  "good": (48, 62),   "warn": (38, 48)},
        "척추기울기_deg":      {"ideal": 33,  "good": (26, 40),   "warn": (22, 45)},
    },
    "impact": {
        "왼무릎굴곡_deg":     {"ideal": 168, "good": (158, 178), "warn": (148, 180)},
        "척추기울기_deg":      {"ideal": 33,  "good": (26, 40),   "warn": (22, 45)},
        "오른팔각도_deg":      {"ideal": 150, "good": (130, 165), "warn": (110, 175)},
        "왼팔각도_deg":        {"ideal": 172, "good": (162, 180), "warn": (152, 180)},
    },
    "followthrough": {
        "왼팔각도_deg":        {"ideal": 172, "good": (155, 180), "warn": (135, 155)},
        "척추기울기_deg":      {"ideal": 30,  "good": (18, 45),   "warn": (8, 55)},
        "오른무릎굴곡_deg":    {"ideal": 135, "good": (115, 155), "warn": (95, 168)},
        "오른팔각도_deg":      {"ideal": 168, "good": (155, 180), "warn": (140, 180)},
    },
}

_ANGLES_FAIRWAY: dict[str, dict[str, dict]] = {
    "address": {
        "척추기울기_deg":      {"ideal": 35,  "good": (30, 40),  "warn": (26, 45)},
        "어깨기울기_deg":      {"ideal": -1,  "good": (-6, 4),   "warn": (-10, 10)},
        "왼무릎굴곡_deg":     {"ideal": 160, "good": (153, 170), "warn": (145, 175)},
        "오른무릎굴곡_deg":    {"ideal": 160, "good": (153, 170), "warn": (145, 175)},
        "어깨_힙_회전차_deg":  {"ideal": 0,   "good": (-5, 5),   "warn": (-10, 10)},
    },
    "backswing": {
        "왼팔각도_deg":        {"ideal": 176, "good": (158, 180), "warn": (142, 158)},
        "오른팔각도_deg":      {"ideal": 90,  "good": (80, 100),  "warn": (65, 115)},
        "어깨_힙_회전차_deg":  {"ideal": 52,  "good": (46, 58),   "warn": (35, 46)},
        "척추기울기_deg":      {"ideal": 35,  "good": (28, 42),   "warn": (24, 48)},
    },
    "impact": {
        "왼무릎굴곡_deg":     {"ideal": 170, "good": (160, 180), "warn": (150, 180)},
        "척추기울기_deg":      {"ideal": 35,  "good": (28, 42),   "warn": (24, 48)},
        "오른팔각도_deg":      {"ideal": 150, "good": (130, 165), "warn": (110, 175)},
        "왼팔각도_deg":        {"ideal": 170, "good": (160, 180), "warn": (150, 180)},
    },
    "followthrough": {
        "왼팔각도_deg":        {"ideal": 170, "good": (152, 180), "warn": (132, 152)},
        "척추기울기_deg":      {"ideal": 32,  "good": (18, 48),   "warn": (8, 58)},
        "오른무릎굴곡_deg":    {"ideal": 138, "good": (118, 158), "warn": (98, 170)},
        "오른팔각도_deg":      {"ideal": 166, "good": (152, 180), "warn": (138, 180)},
    },
}

_ANGLES_LONG_IRON = _ANGLES_FAIRWAY

_ANGLES_MID_IRON: dict[str, dict[str, dict]] = {
    "address": {
        "척추기울기_deg":      {"ideal": 38,  "good": (33, 43),  "warn": (28, 48)},
        "어깨기울기_deg":      {"ideal": 0,   "good": (-5, 5),   "warn": (-10, 10)},
        "왼무릎굴곡_deg":     {"ideal": 162, "good": (155, 170), "warn": (145, 175)},
        "오른무릎굴곡_deg":    {"ideal": 162, "good": (155, 170), "warn": (145, 175)},
        "어깨_힙_회전차_deg":  {"ideal": 0,   "good": (-5, 5),   "warn": (-10, 10)},
    },
    "backswing": {
        "왼팔각도_deg":        {"ideal": 175, "good": (155, 180), "warn": (140, 155)},
        "오른팔각도_deg":      {"ideal": 90,  "good": (80, 100),  "warn": (65, 115)},
        "어깨_힙_회전차_deg":  {"ideal": 50,  "good": (45, 56),   "warn": (30, 45)},
        "척추기울기_deg":      {"ideal": 38,  "good": (30, 46),   "warn": (25, 50)},
    },
    "impact": {
        "왼무릎굴곡_deg":     {"ideal": 170, "good": (160, 180), "warn": (150, 180)},
        "척추기울기_deg":      {"ideal": 38,  "good": (30, 46),   "warn": (25, 50)},
        "오른팔각도_deg":      {"ideal": 150, "good": (130, 165), "warn": (110, 175)},
        "왼팔각도_deg":        {"ideal": 170, "good": (160, 180), "warn": (150, 180)},
    },
    "followthrough": {
        "왼팔각도_deg":        {"ideal": 170, "good": (150, 180), "warn": (130, 150)},
        "척추기울기_deg":      {"ideal": 35,  "good": (20, 50),   "warn": (10, 60)},
        "오른무릎굴곡_deg":    {"ideal": 140, "good": (120, 158), "warn": (100, 170)},
        "오른팔각도_deg":      {"ideal": 165, "good": (150, 180), "warn": (135, 180)},
    },
}

_ANGLES_SHORT_IRON: dict[str, dict[str, dict]] = {
    "address": {
        "척추기울기_deg":      {"ideal": 40,  "good": (35, 46),  "warn": (30, 50)},
        "어깨기울기_deg":      {"ideal": 0,   "good": (-5, 5),   "warn": (-10, 10)},
        "왼무릎굴곡_deg":     {"ideal": 164, "good": (156, 172), "warn": (148, 176)},
        "오른무릎굴곡_deg":    {"ideal": 164, "good": (156, 172), "warn": (148, 176)},
        "어깨_힙_회전차_deg":  {"ideal": 0,   "good": (-5, 5),   "warn": (-10, 10)},
    },
    "backswing": {
        "왼팔각도_deg":        {"ideal": 174, "good": (152, 180), "warn": (138, 152)},
        "오른팔각도_deg":      {"ideal": 90,  "good": (80, 100),  "warn": (65, 115)},
        "어깨_힙_회전차_deg":  {"ideal": 45,  "good": (38, 52),   "warn": (25, 38)},
        "척추기울기_deg":      {"ideal": 40,  "good": (32, 48),   "warn": (28, 52)},
    },
    "impact": {
        "왼무릎굴곡_deg":     {"ideal": 170, "good": (160, 180), "warn": (150, 180)},
        "척추기울기_deg":      {"ideal": 40,  "good": (32, 48),   "warn": (28, 52)},
        "오른팔각도_deg":      {"ideal": 148, "good": (128, 162), "warn": (108, 172)},
        "왼팔각도_deg":        {"ideal": 170, "good": (160, 180), "warn": (150, 180)},
    },
    "followthrough": {
        "왼팔각도_deg":        {"ideal": 168, "good": (148, 180), "warn": (128, 148)},
        "척추기울기_deg":      {"ideal": 38,  "good": (22, 52),   "warn": (12, 62)},
        "오른무릎굴곡_deg":    {"ideal": 142, "good": (122, 160), "warn": (102, 172)},
        "오른팔각도_deg":      {"ideal": 162, "good": (148, 180), "warn": (132, 180)},
    },
}

_ANGLES_WEDGE: dict[str, dict[str, dict]] = {
    "address": {
        "척추기울기_deg":      {"ideal": 42,  "good": (37, 48),  "warn": (32, 52)},
        "어깨기울기_deg":      {"ideal": 0,   "good": (-5, 5),   "warn": (-10, 10)},
        "왼무릎굴곡_deg":     {"ideal": 165, "good": (158, 174), "warn": (150, 178)},
        "오른무릎굴곡_deg":    {"ideal": 165, "good": (158, 174), "warn": (150, 178)},
        "어깨_힙_회전차_deg":  {"ideal": 0,   "good": (-5, 5),   "warn": (-10, 10)},
    },
    "backswing": {
        "왼팔각도_deg":        {"ideal": 172, "good": (148, 180), "warn": (135, 148)},
        "오른팔각도_deg":      {"ideal": 92,  "good": (80, 105),  "warn": (65, 118)},
        "어깨_힙_회전차_deg":  {"ideal": 40,  "good": (32, 48),   "warn": (22, 32)},
        "척추기울기_deg":      {"ideal": 42,  "good": (34, 50),   "warn": (30, 54)},
    },
    "impact": {
        "왼무릎굴곡_deg":     {"ideal": 170, "good": (160, 180), "warn": (150, 180)},
        "척추기울기_deg":      {"ideal": 42,  "good": (34, 50),   "warn": (30, 54)},
        "오른팔각도_deg":      {"ideal": 145, "good": (125, 160), "warn": (105, 170)},
        "왼팔각도_deg":        {"ideal": 168, "good": (158, 180), "warn": (148, 180)},
    },
    "followthrough": {
        "왼팔각도_deg":        {"ideal": 165, "good": (145, 180), "warn": (125, 145)},
        "척추기울기_deg":      {"ideal": 40,  "good": (25, 54),   "warn": (15, 64)},
        "오른무릎굴곡_deg":    {"ideal": 148, "good": (128, 164), "warn": (108, 175)},
        "오른팔각도_deg":      {"ideal": 160, "good": (145, 180), "warn": (130, 180)},
    },
}

_ANGLES_PUTTER: dict[str, dict[str, dict]] = {
    "address": {
        "척추기울기_deg":      {"ideal": 45,  "good": (40, 52),  "warn": (35, 56)},
        "어깨기울기_deg":      {"ideal": 0,   "good": (-5, 5),   "warn": (-10, 10)},
        "왼무릎굴곡_deg":     {"ideal": 168, "good": (160, 176), "warn": (152, 180)},
        "오른무릎굴곡_deg":    {"ideal": 168, "good": (160, 176), "warn": (152, 180)},
        "어깨_힙_회전차_deg":  {"ideal": 0,   "good": (-3, 3),   "warn": (-6, 6)},
    },
    "backswing": {
        "왼팔각도_deg":        {"ideal": 170, "good": (155, 180), "warn": (140, 155)},
        "오른팔각도_deg":      {"ideal": 165, "good": (150, 180), "warn": (130, 150)},
        "어깨_힙_회전차_deg":  {"ideal": 8,   "good": (3, 15),    "warn": (0, 20)},
        "척추기울기_deg":      {"ideal": 45,  "good": (40, 52),   "warn": (35, 56)},
    },
    "impact": {
        "왼무릎굴곡_deg":     {"ideal": 168, "good": (160, 176), "warn": (152, 180)},
        "척추기울기_deg":      {"ideal": 45,  "good": (40, 52),   "warn": (35, 56)},
        "오른팔각도_deg":      {"ideal": 165, "good": (150, 180), "warn": (130, 180)},
        "왼팔각도_deg":        {"ideal": 170, "good": (160, 180), "warn": (150, 180)},
    },
    "followthrough": {
        "왼팔각도_deg":        {"ideal": 170, "good": (155, 180), "warn": (140, 155)},
        "척추기울기_deg":      {"ideal": 45,  "good": (40, 52),   "warn": (35, 56)},
        "오른무릎굴곡_deg":    {"ideal": 168, "good": (160, 176), "warn": (152, 180)},
        "오른팔각도_deg":      {"ideal": 165, "good": (150, 180), "warn": (130, 180)},
    },
}

CLUB_PRO_ANGLES: dict[str, dict[str, dict[str, dict]]] = {
    "driver":     _ANGLES_DRIVER,
    "fairway":    _ANGLES_FAIRWAY,
    "long_iron":  _ANGLES_LONG_IRON,
    "mid_iron":   _ANGLES_MID_IRON,
    "short_iron": _ANGLES_SHORT_IRON,
    "wedge":      _ANGLES_WEDGE,
    "putter":     _ANGLES_PUTTER,
}

PRO_ANGLES = _ANGLES_MID_IRON


def get_pro_angles(club_category: str) -> dict[str, dict[str, dict]]:
    return CLUB_PRO_ANGLES.get(club_category, _ANGLES_MID_IRON)

# ---------------------------------------------------------------------------
# Maps metric name → MediaPipe landmark triplet for angle-based corrections.
# vertex: the joint where the angle is measured
# anchor / endpoint: the two limbs forming the angle
# endpoint is the joint the frontend rotates to show the corrected position.
# ---------------------------------------------------------------------------

ANGLE_JOINT_MAP: dict[str, dict[str, int]] = {
    "왼팔각도_deg":    {"vertex": 13, "anchor": 11, "endpoint": 15},
    "오른팔각도_deg":   {"vertex": 14, "anchor": 12, "endpoint": 16},
    "왼무릎굴곡_deg":  {"vertex": 25, "anchor": 23, "endpoint": 27},
    "오른무릎굴곡_deg": {"vertex": 26, "anchor": 24, "endpoint": 28},
}

# ---------------------------------------------------------------------------
# Deduction rules – checked in order, all matching rules accumulate.
# Types:
#   cross_phase      – compares same metric across two phases (abs diff ≥ threshold)
#   min_cross_phase  – compares same metric across two phases (abs diff < threshold)
#   below_threshold  – triggers when metric < threshold
#   above_threshold  – triggers when metric > threshold
#   equals           – triggers when metric string == fault_value
#   out_of_range     – triggers when metric outside (lo, hi)
# ---------------------------------------------------------------------------

DEDUCTION_RULES: list[dict] = [
    # === Cross-phase ===
    {
        "id": "early_extension",
        "type": "cross_phase",
        "metric": "척추기울기_deg",
        "phase_a": "address",
        "phase_b": "impact",
        "tiers": [
            {"min_diff": 10, "deduction": 15, "severity": "fault"},
            {"min_diff": 6,  "deduction": 8,  "severity": "warning"},
        ],
        "label_ko": "얼리 익스텐션 (척추각 유지 실패)",
        "friendly_ko": "임팩트 때 상체가 너무 일어났어요. 셋업 때의 허리 각도를 끝까지 유지해 보세요.",
        "report_phase": "impact",
        "joint": "left_hip",
        "joint_idx": 23,
    },
    {
        "id": "sway",
        "type": "cross_phase",
        "metric": "오른무릎굴곡_deg",
        "phase_a": "address",
        "phase_b": "backswing",
        "tiers": [
            {"min_diff": 15, "deduction": 8, "severity": "fault"},
            {"min_diff": 10, "deduction": 4, "severity": "warning"},
        ],
        "label_ko": "스웨이 (하체 흔들림)",
        "friendly_ko": "백스윙할 때 하체가 흔들렸어요. 오른쪽 무릎을 고정하고 상체만 돌려보세요.",
        "report_phase": "backswing",
        "joint": "right_knee",
        "joint_idx": 26,
    },
    # === Single-phase: top ===
    {
        "id": "lead_arm_collapse",
        "type": "below_threshold",
        "metric": "왼팔각도_deg",
        "phase": "backswing",
        "tiers": [
            {"below": 140, "deduction": 12, "severity": "fault"},
            {"below": 155, "deduction": 5,  "severity": "warning"},
        ],
        "label_ko": "리드암(왼팔) 접힘",
        "friendly_ko": "백스윙 탑에서 왼팔이 구부러졌어요. 왼팔을 쭉 편 채로 올려보세요.",
        "joint": "left_elbow",
        "joint_idx": 13,
    },
    {
        "id": "x_factor_low",
        "type": "below_threshold",
        "metric": "어깨_힙_회전차_deg",
        "phase": "backswing",
        "tiers": [
            {"below": 30, "deduction": 12, "severity": "fault"},
            {"below": 45, "deduction": 5,  "severity": "warning"},
        ],
        "club_tiers": {
            "driver":     [{"below": 38, "deduction": 12, "severity": "fault"},
                           {"below": 48, "deduction": 5,  "severity": "warning"}],
            "fairway":    [{"below": 35, "deduction": 12, "severity": "fault"},
                           {"below": 46, "deduction": 5,  "severity": "warning"}],
            "short_iron": [{"below": 25, "deduction": 10, "severity": "fault"},
                           {"below": 38, "deduction": 4,  "severity": "warning"}],
            "wedge":      [{"below": 22, "deduction": 8,  "severity": "fault"},
                           {"below": 32, "deduction": 3,  "severity": "warning"}],
            "putter":     [{"below": 0,  "deduction": 0,  "severity": "warning"}],
        },
        "label_ko": "X-Factor 부족 (상하체 분리 부족)",
        "friendly_ko": "어깨 회전이 부족해요. 하체는 고정하고 어깨를 더 크게 돌려보세요.",
        "joint": "left_shoulder",
        "joint_idx": 11,
    },
    {
        "id": "low_backswing",
        "type": "equals",
        "metric": "손목_어깨위_여부",
        "phase": "backswing",
        "fault_value": "손목이 어깨 아래",
        "deduction": 8,
        "severity": "fault",
        "club_deduction": {
            "wedge": 3, "short_iron": 5, "putter": 0,
        },
        "label_ko": "백스윙 높이 부족",
        "friendly_ko": "백스윙이 너무 낮아요. 손이 어깨 위로 올라가도록 더 높이 올려보세요.",
        "joint": "right_wrist",
        "joint_idx": 16,
    },
    # === Single-phase: followthrough ===
    {
        "id": "chicken_wing",
        "type": "below_threshold",
        "metric": "왼팔각도_deg",
        "phase": "followthrough",
        "tiers": [
            {"below": 130, "deduction": 8, "severity": "fault"},
            {"below": 150, "deduction": 4, "severity": "warning"},
        ],
        "label_ko": "치킨윙 (팔로스루 팔 접힘)",
        "friendly_ko": "공을 친 후 왼팔이 접혔어요. 팔로스루에서 양팔을 쭉 뻗어보세요.",
        "joint": "left_elbow",
        "joint_idx": 13,
    },
    # === Single-phase: address setup ===
    {
        "id": "address_spine",
        "type": "out_of_range",
        "metric": "척추기울기_deg",
        "phase": "address",
        "range": (28, 48),
        "club_range": {
            "driver":     (24, 42),
            "fairway":    (26, 45),
            "short_iron": (30, 50),
            "wedge":      (32, 52),
            "putter":     (35, 56),
        },
        "deduction": 5,
        "severity": "warning",
        "label_ko": "어드레스 척추각 이상",
        "friendly_ko": "준비 자세에서 상체 숙임이 부자연스러워요. 클럽에 맞는 자연스러운 각도로 숙여보세요.",
        "joint": "left_hip",
        "joint_idx": 23,
    },
    {
        "id": "address_knee",
        "type": "out_of_range",
        "metric": "왼무릎굴곡_deg",
        "phase": "address",
        "range": (145, 175),
        "deduction": 3,
        "severity": "warning",
        "label_ko": "어드레스 무릎 굴곡 이상",
        "friendly_ko": "준비 자세에서 무릎이 너무 구부러지거나 펴져 있어요. 살짝만 구부려 주세요.",
        "joint": "left_knee",
        "joint_idx": 25,
    },

    # ===================================================================
    # Extended rules (10 additional)
    # ===================================================================

    # --- cross_phase: spine loss at top ---
    {
        "id": "spine_loss_top",
        "type": "cross_phase",
        "metric": "척추기울기_deg",
        "phase_a": "address",
        "phase_b": "backswing",
        "tiers": [
            {"min_diff": 12, "deduction": 12, "severity": "fault"},
            {"min_diff": 7,  "deduction": 5,  "severity": "warning"},
        ],
        "label_ko": "백스윙 자세 붕괴 (척추각 변화)",
        "friendly_ko": "백스윙하면서 상체 자세가 무너졌어요. 척추 각도를 유지하면서 회전해 보세요.",
        "report_phase": "backswing",
        "joint": "left_shoulder",
        "joint_idx": 11,
    },
    # --- cross_phase: head vertical movement ---
    {
        "id": "head_movement",
        "type": "cross_phase",
        "metric": "머리높이_pct",
        "phase_a": "address",
        "phase_b": "impact",
        "tiers": [
            {"min_diff": 8, "deduction": 10, "severity": "fault"},
            {"min_diff": 5, "deduction": 4,  "severity": "warning"},
        ],
        "label_ko": "헤드 무빙 (머리 상하 움직임)",
        "friendly_ko": "스윙 중 머리가 위아래로 많이 움직였어요. 머리 높이를 고정하고 몸통만 회전해 보세요.",
        "report_phase": "impact",
        "joint": "nose",
        "joint_idx": 0,
    },
    # --- above_threshold: over-rotation at top ---
    {
        "id": "over_rotation",
        "type": "above_threshold",
        "metric": "어깨_힙_회전차_deg",
        "phase": "backswing",
        "tiers": [
            {"above": 65, "deduction": 10, "severity": "fault"},
            {"above": 58, "deduction": 4,  "severity": "warning"},
        ],
        "club_tiers": {
            "driver":     [{"above": 70, "deduction": 10, "severity": "fault"},
                           {"above": 62, "deduction": 4,  "severity": "warning"}],
            "short_iron": [{"above": 58, "deduction": 10, "severity": "fault"},
                           {"above": 52, "deduction": 4,  "severity": "warning"}],
            "wedge":      [{"above": 52, "deduction": 10, "severity": "fault"},
                           {"above": 45, "deduction": 4,  "severity": "warning"}],
            "putter":     [{"above": 20, "deduction": 8,  "severity": "fault"},
                           {"above": 15, "deduction": 3,  "severity": "warning"}],
        },
        "label_ko": "과도한 상체 회전",
        "friendly_ko": "상체가 너무 많이 돌아갔어요. 유연성 범위 안에서 자연스럽게 회전하세요.",
        "joint": "left_shoulder",
        "joint_idx": 11,
    },
    # --- above_threshold: flying elbow ---
    {
        "id": "flying_elbow",
        "type": "above_threshold",
        "metric": "오른팔각도_deg",
        "phase": "backswing",
        "tiers": [
            {"above": 120, "deduction": 10, "severity": "fault"},
            {"above": 105, "deduction": 4,  "severity": "warning"},
        ],
        "label_ko": "플라잉 엘보 (팔꿈치 들림)",
        "friendly_ko": "백스윙 탑에서 오른 팔꿈치가 들렸어요. 팔꿈치를 몸 가까이 유지해 보세요.",
        "joint": "right_elbow",
        "joint_idx": 14,
    },
    # --- above_threshold: knee lock at impact ---
    {
        "id": "knee_lock_impact",
        "type": "above_threshold",
        "metric": "왼무릎굴곡_deg",
        "phase": "impact",
        "tiers": [
            {"above": 178, "deduction": 8, "severity": "fault"},
            {"above": 175, "deduction": 3, "severity": "warning"},
        ],
        "label_ko": "임팩트 무릎 과신전",
        "friendly_ko": "임팩트에서 왼쪽 무릎이 완전히 펴졌어요. 무릎에 부담이 갈 수 있으니 살짝 구부린 상태를 유지하세요.",
        "joint": "left_knee",
        "joint_idx": 25,
    },
    # --- above_threshold: stiff right knee at top ---
    {
        "id": "stiff_right_knee",
        "type": "above_threshold",
        "metric": "오른무릎굴곡_deg",
        "phase": "backswing",
        "tiers": [
            {"above": 175, "deduction": 8, "severity": "fault"},
            {"above": 170, "deduction": 3, "severity": "warning"},
        ],
        "label_ko": "백스윙 오른무릎 경직",
        "friendly_ko": "백스윙 탑에서 오른쪽 무릎이 너무 펴져 있어요. 무릎을 약간 구부려서 하체 안정감을 유지하세요.",
        "joint": "right_knee",
        "joint_idx": 26,
    },
    # --- out_of_range: followthrough posture ---
    {
        "id": "finish_posture",
        "type": "out_of_range",
        "metric": "척추기울기_deg",
        "phase": "followthrough",
        "range": (10, 55),
        "club_range": {
            "driver": (8, 55),
            "wedge":  (15, 64),
            "putter": (35, 56),
        },
        "deduction": 6,
        "severity": "warning",
        "label_ko": "팔로스루 자세 붕괴",
        "friendly_ko": "팔로스루에서 상체가 너무 숙여지거나 일어났어요. 균형 잡힌 피니시 자세를 만들어 보세요.",
        "joint": "left_hip",
        "joint_idx": 23,
    },
    # --- out_of_range: right arm at impact ---
    {
        "id": "impact_right_arm",
        "type": "out_of_range",
        "metric": "오른팔각도_deg",
        "phase": "impact",
        "range": (110, 170),
        "deduction": 6,
        "severity": "warning",
        "label_ko": "임팩트 오른팔 각도 이상",
        "friendly_ko": "임팩트에서 오른팔 각도가 이상해요. 자연스럽게 팔을 풀면서 공을 맞히세요.",
        "joint": "right_elbow",
        "joint_idx": 14,
    },
    # --- min_cross_phase: hip rotation lack ---
    {
        "id": "hip_rotation_lack",
        "type": "min_cross_phase",
        "metric": "힙기울기_deg",
        "phase_a": "address",
        "phase_b": "impact",
        "tiers": [
            {"max_diff": 3,  "deduction": 10, "severity": "fault"},
            {"max_diff": 6,  "deduction": 4,  "severity": "warning"},
        ],
        "label_ko": "골반 회전 부족",
        "friendly_ko": "골반 회전이 부족해요. 임팩트에서 골반을 타겟 쪽으로 더 열어보세요.",
        "report_phase": "impact",
        "joint": "left_hip",
        "joint_idx": 23,
    },
    # --- out_of_range: left arm at impact (bent = power loss) ---
    {
        "id": "impact_left_arm",
        "type": "out_of_range",
        "metric": "왼팔각도_deg",
        "phase": "impact",
        "range": (155, 180),
        "deduction": 7,
        "severity": "warning",
        "label_ko": "임팩트 왼팔 굽힘",
        "friendly_ko": "임팩트에서 왼팔이 구부러졌어요. 왼팔을 쭉 편 상태로 공을 맞혀야 힘이 전달돼요.",
        "joint": "left_elbow",
        "joint_idx": 13,
    },

    # ===================================================================
    # Extended rules – batch 2 (5 additional)
    # ===================================================================

    # --- cross_phase: head bob during backswing ---
    {
        "id": "head_movement_top",
        "type": "cross_phase",
        "metric": "머리높이_pct",
        "phase_a": "address",
        "phase_b": "backswing",
        "tiers": [
            {"min_diff": 7, "deduction": 8, "severity": "fault"},
            {"min_diff": 4, "deduction": 3, "severity": "warning"},
        ],
        "label_ko": "백스윙 중 머리 움직임",
        "friendly_ko": "백스윙하면서 머리가 위아래로 움직였어요. 시선을 공에 고정하고 머리 높이를 유지하세요.",
        "report_phase": "backswing",
        "joint": "nose",
        "joint_idx": 0,
    },
    # --- above_threshold: weight hanging back at followthrough ---
    {
        "id": "weight_hang_back",
        "type": "above_threshold",
        "metric": "오른무릎굴곡_deg",
        "phase": "followthrough",
        "tiers": [
            {"above": 165, "deduction": 10, "severity": "fault"},
            {"above": 155, "deduction": 4,  "severity": "warning"},
        ],
        "club_tiers": {
            "wedge":  [{"above": 172, "deduction": 6, "severity": "fault"},
                       {"above": 165, "deduction": 2, "severity": "warning"}],
            "putter": [{"above": 180, "deduction": 0, "severity": "warning"}],
        },
        "label_ko": "체중 이동 부족 (뒷발 잔류)",
        "friendly_ko": "피니시에서 체중이 뒷발에 남아 있어요. 스윙 후 오른발 뒤꿈치가 들릴 정도로 체중을 앞으로 옮기세요.",
        "joint": "right_knee",
        "joint_idx": 26,
    },
    # --- below_threshold: right arm not extending at followthrough ---
    {
        "id": "right_arm_followthrough",
        "type": "below_threshold",
        "metric": "오른팔각도_deg",
        "phase": "followthrough",
        "tiers": [
            {"below": 135, "deduction": 7, "severity": "fault"},
            {"below": 150, "deduction": 3, "severity": "warning"},
        ],
        "label_ko": "팔로스루 오른팔 미신전",
        "friendly_ko": "팔로스루에서 오른팔이 충분히 펴지지 않았어요. 공을 친 후 양팔을 타겟 방향으로 쭉 뻗어보세요.",
        "joint": "right_elbow",
        "joint_idx": 14,
    },
    # --- min_cross_phase: left knee didn't flex at top ---
    {
        "id": "left_knee_stiff_top",
        "type": "min_cross_phase",
        "metric": "왼무릎굴곡_deg",
        "phase_a": "address",
        "phase_b": "backswing",
        "tiers": [
            {"max_diff": 2,  "deduction": 7, "severity": "fault"},
            {"max_diff": 5,  "deduction": 3, "severity": "warning"},
        ],
        "label_ko": "백스윙 왼무릎 경직",
        "friendly_ko": "백스윙할 때 왼쪽 무릎이 거의 안 움직였어요. 왼무릎이 공 쪽으로 살짝 들어오도록 허용하면 회전이 더 쉬워져요.",
        "report_phase": "backswing",
        "joint": "left_knee",
        "joint_idx": 25,
    },
    # --- out_of_range: address shoulder tilt ---
    {
        "id": "address_shoulder_tilt",
        "type": "out_of_range",
        "metric": "어깨기울기_deg",
        "phase": "address",
        "range": (-12, 12),
        "deduction": 4,
        "severity": "warning",
        "label_ko": "어드레스 어깨 기울어짐",
        "friendly_ko": "준비 자세에서 어깨가 한쪽으로 기울어져 있어요. 양쪽 어깨를 수평에 가깝게 맞춰주세요.",
        "joint": "left_shoulder",
        "joint_idx": 11,
    },
    # --- takeaway: left arm should stay straight ---
    {
        "id": "takeaway_left_arm",
        "type": "below_threshold",
        "metric": "왼팔각도_deg",
        "phase": "takeaway",
        "tiers": [
            {"below": 140, "deduction": 8, "severity": "fault"},
            {"below": 155, "deduction": 4, "severity": "warning"},
        ],
        "label_ko": "테이크어웨이 왼팔 구부러짐",
        "friendly_ko": "테이크어웨이에서 왼팔이 일찍 구부러져요. 왼팔을 쭉 편 채로 클럽을 뒤로 가져가 보세요.",
        "joint": "left_elbow",
        "joint_idx": 13,
    },
    # --- takeaway: excessive wrist cock ---
    {
        "id": "takeaway_spine_change",
        "type": "cross_phase",
        "metric": "척추기울기_deg",
        "phase_a": "address",
        "phase_b": "takeaway",
        "tiers": [
            {"min_diff": 15, "deduction": 7, "severity": "fault"},
            {"min_diff": 10, "deduction": 3, "severity": "warning"},
        ],
        "label_ko": "테이크어웨이 척추각 변화",
        "friendly_ko": "테이크어웨이에서 몸이 들리거나 숙여져요. 어드레스에서 잡은 척추각을 그대로 유지하세요.",
        "report_phase": "takeaway",
        "joint": "left_hip",
        "joint_idx": 23,
    },
    # --- transition: hip leads before shoulders ---
    {
        "id": "transition_hip_lead",
        "type": "min_cross_phase",
        "metric": "힙기울기_deg",
        "phase_a": "backswing",
        "phase_b": "downswing",
        "tiers": [
            {"max_diff": 2, "deduction": 8, "severity": "fault"},
            {"max_diff": 4, "deduction": 4, "severity": "warning"},
        ],
        "label_ko": "다운스윙 골반 리드 부족",
        "friendly_ko": "다운스윙 시작할 때 골반이 먼저 움직여야 해요. 골반을 타겟 방향으로 살짝 밀어주면서 다운스윙을 시작하세요.",
        "report_phase": "downswing",
        "joint": "left_hip",
        "joint_idx": 23,
    },
    # --- transition: early shoulder unwind ---
    {
        "id": "transition_casting",
        "type": "cross_phase",
        "metric": "오른팔각도_deg",
        "phase_a": "backswing",
        "phase_b": "downswing",
        "tiers": [
            {"min_diff": 30, "deduction": 8, "severity": "fault"},
            {"min_diff": 20, "deduction": 4, "severity": "warning"},
        ],
        "label_ko": "캐스팅 (오른팔 조기 풀림)",
        "friendly_ko": "다운스윙에서 팔이 너무 일찍 펴져요. 오른팔 각도를 유지하며 하체부터 회전하세요.",
        "report_phase": "downswing",
        "joint": "right_elbow",
        "joint_idx": 14,
    },
    # --- finish: balance / weight transfer ---
    {
        "id": "finish_spine",
        "type": "out_of_range",
        "metric": "척추기울기_deg",
        "phase": "finish",
        "range": (-15, 30),
        "club_range": {
            "driver": (-15, 25),
            "putter": (20, 50),
        },
        "deduction": 5,
        "severity": "warning",
        "label_ko": "피니시 자세 불안정",
        "friendly_ko": "피니시에서 몸이 너무 숙여지거나 뒤로 젖혀져요. 균형 잡힌 피니시 자세를 유지하세요.",
        "joint": "left_hip",
        "joint_idx": 23,
    },
    # --- finish: right knee should be close to left ---
    {
        "id": "finish_weight_transfer",
        "type": "below_threshold",
        "metric": "왼무릎굴곡_deg",
        "phase": "finish",
        "tiers": [
            {"below": 150, "deduction": 6, "severity": "fault"},
            {"below": 165, "deduction": 3, "severity": "warning"},
        ],
        "label_ko": "피니시 체중 이동 부족",
        "friendly_ko": "피니시에서 왼다리가 충분히 펴지지 않았어요. 체중을 왼발로 완전히 이동시키고 왼다리로 지탱하세요.",
        "joint": "left_knee",
        "joint_idx": 25,
    },
]

# ---------------------------------------------------------------------------
# Recommended drill per fault id
# ---------------------------------------------------------------------------

DRILL_MAP: dict[str, dict[str, str]] = {
    "early_extension": {
        "name": "벽 드릴",
        "method": "엉덩이를 벽에 대고 어드레스 자세를 잡습니다. "
                  "스윙하면서 임팩트까지 엉덩이가 벽에서 떨어지지 않도록 연습하세요.",
        "reps": "10회 3세트",
    },
    "sway": {
        "name": "무릎 고정 드릴",
        "method": "오른발 바깥에 공을 놓고 백스윙 시 "
                  "오른무릎이 공을 건드리지 않도록 연습합니다.",
        "reps": "10회 3세트",
    },
    "lead_arm_collapse": {
        "name": "왼팔 직선 드릴",
        "method": "왼팔에 얼라인먼트 스틱을 대고 백스윙 탑까지 "
                  "팔이 곧게 유지되는 느낌을 체화합니다.",
        "reps": "20회 2세트",
    },
    "x_factor_low": {
        "name": "분리 회전 드릴",
        "method": "클럽을 어깨에 걸치고 하체를 고정한 채 "
                  "상체만 최대한 회전합니다. 하체-상체 분리감을 느끼세요.",
        "reps": "각 방향 15회",
    },
    "low_backswing": {
        "name": "하이 피니시 드릴",
        "method": "백스윙 탑에서 오른손이 오른쪽 귀 높이에 "
                  "오도록 의식적으로 높이 올리며 스윙합니다.",
        "reps": "15회 2세트",
    },
    "chicken_wing": {
        "name": "양팔 연장 드릴",
        "method": "팔로스루에서 양팔이 완전히 뻗어지도록 의식하며 "
                  "천천히 스윙합니다. 팔 사이에 헤드커버를 끼고 연습하면 효과적입니다.",
        "reps": "15회 2세트",
    },
    "address_spine": {
        "name": "거울 셋업 드릴",
        "method": "거울 앞에서 어드레스 자세를 잡고 "
                  "상체 기울기를 35~45° 범위로 맞추는 연습을 합니다.",
        "reps": "매 연습 시작 전 5회",
    },
    "address_knee": {
        "name": "체중 분배 드릴",
        "method": "무릎을 약간 구부린 상태에서 양발에 균등하게 체중을 싣는 "
                  "연습을 합니다. 너무 구부리거나 펴지 않도록 주의하세요.",
        "reps": "매 연습 시작 전 5회",
    },
    "spine_loss_top": {
        "name": "척추각 유지 드릴",
        "method": "클럽을 등에 대고 어드레스 자세를 잡습니다. "
                  "백스윙 탑까지 등의 각도가 변하지 않도록 거울을 보며 천천히 회전합니다.",
        "reps": "10회 3세트",
    },
    "head_movement": {
        "name": "머리 고정 드릴",
        "method": "벽에 이마를 가볍게 대고 스윙 동작을 합니다. "
                  "이마가 벽에서 떨어지지 않도록 머리를 고정하며 몸통만 회전합니다.",
        "reps": "15회 2세트",
    },
    "over_rotation": {
        "name": "90도 회전 제한 드릴",
        "method": "백스윙 탑에서 왼쪽 어깨가 턱 아래까지만 오도록 제한합니다. "
                  "과도한 회전은 오히려 정확성을 떨어뜨려요.",
        "reps": "10회 3세트",
    },
    "flying_elbow": {
        "name": "수건 끼우기 드릴",
        "method": "오른쪽 겨드랑이에 수건을 끼우고 백스윙합니다. "
                  "수건이 떨어지지 않으면 팔꿈치가 몸에 잘 붙어 있는 겁니다.",
        "reps": "15회 2세트",
    },
    "knee_lock_impact": {
        "name": "무릎 유연성 드릴",
        "method": "임팩트 자세에서 왼쪽 무릎을 약간 구부린 상태를 유지합니다. "
                  "슬로우 스윙으로 무릎이 과도하게 펴지지 않는 감각을 익히세요.",
        "reps": "슬로우 스윙 10회 3세트",
    },
    "stiff_right_knee": {
        "name": "오른무릎 유연 드릴",
        "method": "어드레스에서 오른무릎을 약간 안쪽으로 향하게 합니다. "
                  "백스윙 탑까지 이 느낌을 유지하면서 체중을 오른발 안쪽에 실어보세요.",
        "reps": "10회 3세트",
    },
    "finish_posture": {
        "name": "균형 피니시 드릴",
        "method": "스윙 후 3초간 피니시 자세를 유지합니다. "
                  "벨트 버클이 타겟을 향하고 균형이 잡힌 상태를 만드세요.",
        "reps": "매 스윙 후 3초 유지",
    },
    "impact_right_arm": {
        "name": "오른팔 릴리스 드릴",
        "method": "오른손만으로 가볍게 스윙하면서 임팩트에서 자연스럽게 "
                  "팔이 펴지는 타이밍을 연습합니다.",
        "reps": "한손 스윙 15회",
    },
    "hip_rotation_lack": {
        "name": "골반 회전 드릴",
        "method": "어드레스 자세에서 클럽 없이 골반만 타겟 방향으로 회전합니다. "
                  "임팩트에서 벨트 버클이 타겟 약간 왼쪽을 향하도록 연습하세요.",
        "reps": "20회 2세트",
    },
    "impact_left_arm": {
        "name": "왼팔 직선 임팩트 드릴",
        "method": "왼손만으로 클럽을 잡고 천천히 스윙합니다. "
                  "임팩트 순간 왼팔이 쭉 펴진 상태를 유지하는 감각을 익히세요.",
        "reps": "한손 스윙 10회 3세트",
    },
    "head_movement_top": {
        "name": "백스윙 머리 고정 드릴",
        "method": "친구에게 머리 위에 손을 올려달라고 하거나, "
                  "모자 챙이 움직이지 않는지 거울로 확인하며 백스윙합니다.",
        "reps": "슬로우 스윙 15회",
    },
    "weight_hang_back": {
        "name": "체중 이동 스텝 드릴",
        "method": "스윙 후 오른발을 왼발 옆으로 한 발짝 딛는 연습을 합니다. "
                  "피니시에서 오른발 뒤꿈치가 완전히 들려야 정상입니다.",
        "reps": "10회 3세트",
    },
    "right_arm_followthrough": {
        "name": "오른팔 릴리스 스윙 드릴",
        "method": "오른손만으로 9시→3시 스윙을 하며 "
                  "팔로스루에서 팔이 자연스럽게 뻗어지는 느낌을 익힙니다.",
        "reps": "한손 하프 스윙 15회",
    },
    "left_knee_stiff_top": {
        "name": "왼무릎 유연 회전 드릴",
        "method": "어드레스에서 백스윙 시 왼무릎이 공 방향으로 "
                  "살짝 움직이도록 허용합니다. 하체가 너무 경직되면 상체 회전도 제한돼요.",
        "reps": "슬로우 백스윙 15회",
    },
    "address_shoulder_tilt": {
        "name": "어깨 수평 셋업 드릴",
        "method": "거울 앞에서 클럽을 양쪽 어깨에 걸치고 "
                  "수평인지 확인합니다. 오른손이 아래에 있으므로 약간의 기울기는 허용되지만 과하면 안 됩니다.",
        "reps": "매 연습 시작 전 확인",
    },
    "takeaway_left_arm": {
        "name": "원피스 테이크어웨이 드릴",
        "method": "어깨, 팔, 클럽이 하나의 삼각형을 유지한 채 "
                  "천천히 테이크어웨이합니다. 왼팔이 구부러지지 않도록 주의하세요.",
        "reps": "슬로우 테이크어웨이 15회",
    },
    "takeaway_spine_change": {
        "name": "척추각 유지 테이크어웨이 드릴",
        "method": "거울 옆에서 어드레스 자세를 잡고 테이크어웨이할 때 "
                  "머리 높이와 등의 각도가 변하지 않는지 확인하세요.",
        "reps": "슬로우 테이크어웨이 10회",
    },
    "transition_hip_lead": {
        "name": "골반 리드 전환 드릴",
        "method": "백스윙 탑에서 멈춘 뒤, 왼쪽 골반을 타겟 방향으로 "
                  "살짝 밀면서 다운스윙을 시작합니다. 상체는 아직 뒤에 남겨두세요.",
        "reps": "정지 후 전환 10회 3세트",
    },
    "transition_casting": {
        "name": "래그 유지 드릴",
        "method": "다운스윙 시 오른팔 각도를 유지하며 "
                  "허벅지 높이까지 내려온 후에야 손목을 풀어줍니다.",
        "reps": "슬로우 다운스윙 15회",
    },
    "finish_spine": {
        "name": "I자 피니시 드릴",
        "method": "스윙 후 몸이 I자 형태가 되도록 "
                  "가슴이 타겟을 향하고 등이 곧은 피니시를 만드세요.",
        "reps": "매 스윙 후 3초 유지",
    },
    "finish_weight_transfer": {
        "name": "왼발 밸런스 드릴",
        "method": "피니시에서 오른발을 완전히 들어올려 "
                  "왼발만으로 3초간 균형을 유지하세요.",
        "reps": "10회 3세트",
    },
}
