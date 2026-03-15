# NICESHOT 골프 스윙 코칭 앱 — 프로젝트 컨텍스트

## 프로젝트 개요
- 모바일 웹앱: 스마트폰 카메라로 골프 스윙 4초 녹화 → AI 코칭
- 프론트엔드: Netlify 배포 (`frontend/` 폴더, 바닐라 JS, MediaPipe)
- 백엔드: Railway 배포 (`backend/` 폴더, FastAPI + Python)
- GitHub: https://github.com/worldlight89/niceshot

---

## 핵심 아키텍처

```
카메라 (MediaPipe Pose)
  ↓ 실시간 포즈 감지 + 자동 줌
녹화 4초 완료
  ↓
프론트엔드: 7단계 구간 감지 + 메트릭 추출 (analysis.js)
  ↓ POST /api/analyze (영상 + metrics_json)
백엔드:
  1. 규칙 엔진 (rule_engine.py): 프로 기준과 비교 → faults 추출
  2. Gemini 2.5 Flash (thinking OFF): 엔진 결과 + 메트릭 → AI 코칭
  ↓
Step 9: 7단계별 점수 + 평균 점수 표시
Step 10: 슬로모션 영상 + 단계별 Gemini 코칭 오버레이
```

---

## 백엔드 파일 구조

```
backend/
├── main.py              # FastAPI 엔트리포인트
├── gemini_coach.py      # Gemini API 호출 + 프롬프트
├── rule_engine.py       # 규칙 기반 분석 엔진 (29개 규칙)
├── pro_reference.py     # 프로 골퍼 기준 데이터
├── requirements.txt
└── tests/
    └── test_rule_engine.py  # pytest 16개 테스트
```

### main.py 핵심 흐름
```python
POST /api/analyze
  → metrics = JSON.parse(metrics_json)
  → rule_result = analyze_swing(metrics, club)  # 규칙 엔진
  → 스윙 감지: swing_indicators.has_swing_motion + wrist_height_range_pct >= 8
  → gemini = generate_coaching(metrics, rule_result)  # Gemini 호출
  → 응답: {score, problems, phase_coaching, drill}
```

### gemini_coach.py 핵심
- Gemini 2.5 Flash, **thinkingBudget: 0** (thinking OFF — 속도 개선 핵심)
- timeout: 60초
- 프롬프트: 핵심 수치만 전달 (간소화 완료)
- 반환: `{score, phases: {address/takeaway/backswing/downswing/impact/followthrough/finish: {score, status, problems: [{description, joints}]}}, drill}`
- 실패 시 fallback: 규칙 엔진 faults로 대체

---

## 프론트엔드 파일 구조

```
frontend/
├── index.html
├── state.js      # 전역 상태 및 상수
├── utils.js      # 유틸, 오디오, 음성인식
├── camera.js     # 카메라, MediaPipe, 자동줌, 녹화
├── analysis.js   # 메트릭 추출, 구간 감지, API 업로드
├── results.js    # Step9 스코어카드, Step10 슬로모션 플레이어
└── app.js        # 앱 초기화, 스텝 네비게이션
```

### 주요 상수 (state.js)
```js
PHASE_LABELS = {address:'어드레스', takeaway:'테이크어웨이', backswing:'백스윙',
                downswing:'다운스윙', impact:'임팩트', followthrough:'팔로우스루', finish:'피니시'}
ISSUE_COLORS = ['#FF4444', '#FFD700', '#2ECC71']  // 빨강/노랑/초록
CLUBS = ['드라이버','페어웨이우드','롱아이언','미들아이언','숏아이언','웨지','퍼터']
```

### 앱 플로우 (10단계)
1. 언어 선택
2. 클럽 선택
3. 고민 입력
4. 요약 확인
5. 카메라 준비
6. 카운트다운 (5초, 한국어 음성)
7. 녹화 (4초)
8. 분석 중 (로딩)
9. **스코어카드**: 7단계별 점수 + 평균 점수 + 드릴 + "교정 영상 보기" 버튼
10. **슬로모션**: 0.25배속 + 7구간 자동 정지 + Gemini 코칭 오버레이 (빨/노/초 색상)

---

## 현재 알려진 이슈 및 상태

### 해결된 것
- ✅ Gemini timeout (30초) → thinking OFF + timeout 60초로 해결
- ✅ 규칙 엔진 점수 충돌 → Gemini가 점수 직접 평가
- ✅ Step 10 텍스트 잘림 제거
- ✅ Step 9 원형 점수 → 7단계 바 차트로 개편
- ✅ Gemini 실패 시 fallback (엔진 데이터로 대체)
- ✅ 스윙 감지 기준을 엔진 대신 MediaPipe 지표로

### 확인 필요
- ⚠️ thinking OFF 후 실제 응답 속도/품질 테스트 필요
- ⚠️ Step 9 점수가 아직 50점 고정으로 나오면 Railway 로그 확인
  - Railway → 프로젝트 → Logs 탭 → "Gemini" 검색

---

## 환경변수 (Railway 백엔드)

```
GOOGLE_APPLICATION_CREDENTIALS_JSON  # GCP 서비스 계정 JSON 전체
VERTEX_MODEL=gemini-2.5-flash
```

## 환경변수 (Netlify 프론트엔드)
```
NICESHOT_API_URL=https://[railway-domain]/
```

---

## 최근 커밋 히스토리 (주요)

```
76cf5c3  Gemini 2.5 Flash thinking 비활성화 — 응답 30초→3~5초
0d40541  Gemini timeout 60초로 증가, 프롬프트 간소화
9d938a3  Step9 7단계 점수+평균으로 개편, Step10 텍스트 잘림 제거
d3988fe  Gemini 실패 시 엔진 데이터로 fallback
16f4938  스윙 감지를 엔진 대신 MediaPipe 지표로 판단
a5982a7  엔진 복구 — 프로 기준 비교 결과를 Gemini에 전달
```

---

## 다음에 할 수 있는 작업들 (미완료)

- [ ] thinking OFF 후 코칭 품질 평가
- [ ] Gemini 응답에서 단계별 score가 제대로 파싱되는지 확인
- [ ] Step 10 구간 감지 정확도 개선 (현재 wrist velocity 기반)
- [ ] 모바일 UX 개선 (폰트, 레이아웃)
