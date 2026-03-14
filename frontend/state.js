/* ================================================================
   NICESHOT – 전역 상태 및 상수
   ================================================================ */

var BACKEND = (typeof window.NICESHOT_API_URL === 'string' && window.NICESHOT_API_URL)
  ? window.NICESHOT_API_URL
  : 'http://localhost:8002';

var CLUBS = [
  '드라이버', '페어웨이우드', '롱아이언',
  '미들아이언', '숏아이언', '웨지', '퍼터'
];

var CLUB_DISPLAY_LABELS = {
  '드라이버': '드라이버 스윙',
  '페어웨이우드': '페어웨이우드 스윙',
  '롱아이언': '롱아이언 스윙',
  '미들아이언': '미들아이언 스윙',
  '숏아이언': '숏아이언 스윙',
  '웨지': '웨지 스윙',
  '퍼터': '퍼터 스트로크'
};

var PHASE_LABELS = {
  address: '어드레스', takeaway: '테이크어웨이', backswing: '백스윙',
  downswing: '다운스윙', impact: '임팩트', followthrough: '팔로우스루', finish: '피니시'
};

var ISSUE_COLORS = ['#FF4444', '#FFD700', '#2ECC71'];

var JOINT_NAMES = [
  'nose','left_eye_inner','left_eye','left_eye_outer',
  'right_eye_inner','right_eye','right_eye_outer',
  'left_ear','right_ear','mouth_left','mouth_right',
  'left_shoulder','right_shoulder','left_elbow','right_elbow',
  'left_wrist','right_wrist','left_pinky','right_pinky',
  'left_index','right_index','left_thumb','right_thumb',
  'left_hip','right_hip','left_knee','right_knee',
  'left_ankle','right_ankle','left_heel','right_heel',
  'left_foot_index','right_foot_index'
];

var POSE_CONNECTIONS = [
  [11,12],[11,13],[13,15],[12,14],[14,16],
  [15,17],[15,19],[16,18],[16,20],
  [11,23],[12,24],[23,24],
  [23,25],[25,27],[24,26],[26,28],
  [27,29],[29,31],[28,30],[30,32]
];

var KO_COUNTS = ['다섯', '넷', '셋', '둘', '하나'];

var state = {
  club: null,
  concern: '',
  videoBlob: null,
  poseFrames: [],
  recordStartTime: 0,
  isRecording: false,
  analysisResult: null
};

var mediaStream = null;
var poseDetector = null;
var poseRunning = false;
var okFrames = 0;
var setupDone = false;
var betweenState = 'idle';
var noPersonFrames = 0;
var autoZoomScale = 1;
var autoZoomX = 50;
var autoZoomY = 50;
var zoomFrameCount = 0;
var slowmoAnimId = null;
var detectedPhases = null;
var slowmoPhaseIdx = 0;
var slowmoPaused = false;
var slowmoTapBound = false;
var slowmoPhaseStops = [];
var voiceRecognition = null;
var voiceActive = false;

var DEFAULT_PHASE_RANGES = [
  { key: 'address',       label: '어드레스',    start: 0,    end: 0.5 },
  { key: 'takeaway',      label: '테이크어웨이', start: 0.5,  end: 1.0 },
  { key: 'backswing',     label: '백스윙',      start: 1.0,  end: 1.5 },
  { key: 'downswing',     label: '다운스윙',    start: 1.5,  end: 2.0 },
  { key: 'impact',        label: '임팩트',      start: 2.0,  end: 2.5 },
  { key: 'followthrough', label: '팔로우스루',  start: 2.5,  end: 3.2 },
  { key: 'finish',        label: '피니시',      start: 3.2,  end: 4.0 }
];
