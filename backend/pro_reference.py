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
        "오른팔각도_deg":      {"ideal": 150, "good": (130, 165), "warn": (110, 175)},
        "왼팔각도_deg":        {"ideal": 170, "good": (160, 180), "warn": (150, 180)},
    },
    "followthrough": {
        "왼팔각도_deg":        {"ideal": 170, "good": (150, 180), "warn": (130, 150)},
        "척추기울기_deg":      {"ideal": 35,  "good": (20, 50),   "warn": (10, 60)},
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

    # ===================================================================
    # Extended rules (10 additional)
    # ===================================================================

    # --- cross_phase: spine loss at top ---
    {
        "id": "spine_loss_top",
        "type": "cross_phase",
        "metric": "척추기울기_deg",
        "phase_a": "address",
        "phase_b": "top",
        "tiers": [
            {"min_diff": 12, "deduction": 12, "severity": "fault"},
            {"min_diff": 7,  "deduction": 5,  "severity": "warning"},
        ],
        "label_ko": "백스윙 자세 붕괴 (척추각 변화)",
        "friendly_ko": "백스윙하면서 상체 자세가 무너졌어요. 척추 각도를 유지하면서 회전해 보세요.",
        "report_phase": "top",
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
        "phase": "top",
        "tiers": [
            {"above": 65, "deduction": 10, "severity": "fault"},
            {"above": 58, "deduction": 4,  "severity": "warning"},
        ],
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
        "phase": "top",
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
        "phase": "top",
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
}
