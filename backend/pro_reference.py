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

PRO_ANGLES: dict[str, dict[str, dict]] = {
    "address": {
        "척추기울기_deg":      {"ideal": 38,  "good": (33, 43),  "warn": (28, 48)},
        "어깨기울기_deg":      {"ideal": 0,   "good": (-5, 5),   "warn": (-10, 10)},
        "왼무릎굴곡_deg":     {"ideal": 162, "good": (155, 170), "warn": (145, 175)},
        "오른무릎굴곡_deg":    {"ideal": 162, "good": (155, 170), "warn": (145, 175)},
        "어깨_힙_회전차_deg":  {"ideal": 0,   "good": (-5, 5),   "warn": (-10, 10)},
    },
    "top": {
        "왼팔각도_deg":        {"ideal": 175, "good": (155, 180), "warn": (140, 155)},
        "오른팔각도_deg":      {"ideal": 90,  "good": (80, 100),  "warn": (65, 115)},
        "어깨_힙_회전차_deg":  {"ideal": 50,  "good": (45, 56),   "warn": (30, 45)},
        "척추기울기_deg":      {"ideal": 38,  "good": (30, 46),   "warn": (25, 50)},
    },
    "impact": {
        "왼무릎굴곡_deg":     {"ideal": 170, "good": (160, 180), "warn": (150, 180)},
        "척추기울기_deg":      {"ideal": 38,  "good": (30, 46),   "warn": (25, 50)},
    },
    "followthrough": {
        "왼팔각도_deg":        {"ideal": 170, "good": (150, 180), "warn": (130, 150)},
    },
}

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
#   cross_phase    – compares same metric across two phases (abs diff)
#   below_threshold – triggers when metric < threshold
#   equals         – triggers when metric string == fault_value
#   out_of_range   – triggers when metric outside (lo, hi)
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
        "phase_b": "top",
        "tiers": [
            {"min_diff": 15, "deduction": 8, "severity": "fault"},
            {"min_diff": 10, "deduction": 4, "severity": "warning"},
        ],
        "label_ko": "스웨이 (하체 흔들림)",
        "friendly_ko": "백스윙할 때 하체가 흔들렸어요. 오른쪽 무릎을 고정하고 상체만 돌려보세요.",
        "report_phase": "top",
        "joint": "right_knee",
        "joint_idx": 26,
    },
    # === Single-phase: top ===
    {
        "id": "lead_arm_collapse",
        "type": "below_threshold",
        "metric": "왼팔각도_deg",
        "phase": "top",
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
        "phase": "top",
        "tiers": [
            {"below": 30, "deduction": 12, "severity": "fault"},
            {"below": 45, "deduction": 5,  "severity": "warning"},
        ],
        "label_ko": "X-Factor 부족 (상하체 분리 부족)",
        "friendly_ko": "어깨 회전이 부족해요. 하체는 고정하고 어깨를 더 크게 돌려보세요.",
        "joint": "left_shoulder",
        "joint_idx": 11,
    },
    {
        "id": "low_backswing",
        "type": "equals",
        "metric": "손목_어깨위_여부",
        "phase": "top",
        "fault_value": "손목이 어깨 아래",
        "deduction": 8,
        "severity": "fault",
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
        "deduction": 5,
        "severity": "warning",
        "label_ko": "어드레스 척추각 이상",
        "friendly_ko": "준비 자세에서 상체 숙임이 부자연스러워요. 편하게 35~45도로 숙여보세요.",
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
}
