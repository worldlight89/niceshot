# Golf Swing Coach MVP (Web)

브라우저에서 1~5회 스윙을 연속 촬영(녹화)하고, 각 클립을 서버로 업로드해 AI 코칭 피드백을 받는 MVP입니다.

## 구성

- `frontend/`: 순수 HTML/CSS/JS (설치 없이 브라우저에서 실행)
- `backend/`: FastAPI (업로드 수신 + Gemini 호출(옵션))

## 실행 방법

### 1) 백엔드 실행

```bash
cd golf-swing-coach-mvp/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

환경변수(선택):

- **Vertex AI 사용(추천)**:
  - `VERTEX_PROJECT_ID`: GCP Project ID
  - `VERTEX_LOCATION`: 예) `asia-northeast3` (기본값)
  - `VERTEX_MODEL`: 예) `gemini-2.0-pro` (기본값)
  - 인증: `GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json`
- **Gemini API Key 사용(대안)**:
  - `GEMINI_API_KEY`
  - (선택) `GEMINI_MODEL` 예) `gemini-2.0-flash`

위 환경변수들이 **미설정**이면 서버는 더미(placeholder) 피드백을 반환합니다.

### 2) 프론트 실행

가장 간단:

```bash
cd golf-swing-coach-mvp/frontend
python3 -m http.server 5173
```

그리고 브라우저에서 `http://localhost:5173` 접속.

## Netlify로 웹앱 배포 (업로드해서 확인)

1. **저장소 올리기**  
   이 프로젝트를 GitHub(또는 GitLab/Bitbucket) 저장소에 푸시합니다.

2. **Netlify 연결**  
   - [netlify.com](https://www.netlify.com) 로그인 후 **Add new site → Import an existing project**
   - 사용 중인 Git 제공자 선택 후, 방금 푸시한 저장소 선택
   - **Build settings** 는 이미 `netlify.toml` 에 있으므로 그대로 두고 Deploy

3. **백엔드 URL 설정 (분석 기능 사용 시)**  
   Netlify에 올린 웹앱이 **어디서 API를 부를지** 정해줘야 합니다.
   - 백엔드를 **Railway / Render / Google Cloud Run** 등에 따로 배포한 뒤, 그 주소를 복사합니다.
   - Netlify 대시보드 → **Site settings → Environment variables** 에서:
     - **Key**: `NICESHOT_API_URL`
     - **Value**: 백엔드 주소 (예: `https://your-backend.railway.app`)
   - 저장 후 **Deploys** 탭에서 **Trigger deploy → Deploy site** 로 다시 배포합니다.

4. **확인**  
   Netlify가 준 사이트 URL(예: `https://niceshot-xxx.netlify.app`)로 접속해 스윙 연습 → 녹화 → 분석까지 테스트합니다.

- `NICESHOT_API_URL` 을 비워두면, 분석 버튼을 눌렀을 때 “백엔드 연결 실패” 안내가 나옵니다.  
- 로컬에서만 쓸 때는 `frontend/config.js` 의 기본값(`http://localhost:8002`)이 그대로 사용됩니다.

## 사용 흐름

1. `스윙 연습 시작` 클릭
2. 1~5회 선택
3. `녹화 시작` → 자동으로 1~5개 클립을 순서대로 녹화
4. `업로드 & 분석` → 각 클립별 결과가 카드로 표시됨

## 다음 단계(확장)

- 촬영 중 실시간 오버레이(포즈 추정) 추가
- 스윙 구간 자동 분할(백스윙/탑/임팩트/피니시)
- 사용자별 히스토리 저장(로그인/DB)
- iOS/Android 앱: PWA → Capacitor/React Native로 포팅

