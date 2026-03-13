/* ================================================================
   NICESHOT – 골프 스윙 AI 코치
   분석 방식:
   ① 녹화 중 3장 프레임 자동 캡처 (어드레스·백스윙탑·임팩트)
   ② 캡처 후 MediaPipe로 관절 각도·수치 추출
   ③ 이미지 3장 + 상세 수치 → Gemini 멀티모달 → 프로 코칭
   혼자 사용: 포즈 자동감지 + 스윙 사이 자동트리거 + 음성("시작"/"다시")
   ================================================================ */

var BACKEND = (typeof window.NICESHOT_API_URL === 'string' && window.NICESHOT_API_URL)
  ? window.NICESHOT_API_URL
  : 'http://localhost:8002';

var CLUBS = [
  '드라이버', '3W', '5W',
  '4I', '5I', '6I',
  '7I', '8I', '9I',
  'PW', 'SW', 'PT'
];

var state = {
  club: null,
  swingCount: null,
  concern: '',
  clips: [],
  swingFrames: []   // 스윙별 3장 프레임+수치 [{address,top,impact}]
};

var mediaStream = null;
var currentSwingIndex = 0;

/* ── 포즈 ── */
var poseDetector = null;
var poseRunning = false;
var okFrames = 0;
var setupDone = false;

/* ── 스윙 사이 상태 ── */
var betweenState = 'idle'; // idle | wait_exit | wait_enter | countdown
var noPersonFrames = 0;

/* ================================================================
   단계 전환
   ================================================================ */
function goStep(n) {
  document.querySelectorAll('.step').forEach(function (el) { el.classList.remove('active'); });
  var el = document.getElementById('step' + n);
  if (el) el.classList.add('active');
}

/* ================================================================
   Step 2 – 클럽 선택
   ================================================================ */
function buildClubGrid() {
  var grid = document.getElementById('clubGrid');
  if (!grid) return;
  grid.innerHTML = '';
  CLUBS.forEach(function (club) {
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'club-btn'; btn.textContent = club;
    btn.onclick = function () {
      document.querySelectorAll('.club-btn').forEach(function (b) { b.classList.remove('selected'); });
      btn.classList.add('selected');
      state.club = club;
      var nxt = document.getElementById('btnClubNext');
      if (nxt) nxt.disabled = false;
    };
    grid.appendChild(btn);
  });
}

/* ================================================================
   Step 3 – 스윙 횟수
   ================================================================ */
function selectCount(n, btn) {
  document.querySelectorAll('.chip').forEach(function (b) { b.classList.remove('selected'); });
  btn.classList.add('selected');
  state.swingCount = n;
  var nxt = document.getElementById('btnCountNext');
  if (nxt) nxt.disabled = false;
}

/* ================================================================
   Step 4 – 고민 입력
   ================================================================ */
function skipConcern() {
  var inp = document.getElementById('concernInput');
  if (inp) inp.value = '';
  state.concern = '';
  _updateSummary();
  goStep(5);
}

function confirmConcern() {
  var inp = document.getElementById('concernInput');
  state.concern = inp ? inp.value.trim() : '';
  _updateSummary();
  goStep(5);
}

function _updateSummary() {
  var sc = document.getElementById('summaryClub');
  var sp = document.getElementById('summaryConern');
  var cr = document.getElementById('concernRow');
  if (sc) sc.textContent = state.club || '-';
  if (sp) sp.textContent = state.concern;
  if (cr) cr.style.display = state.concern ? '' : 'none';
}

/* ================================================================
   Step 6 – 카메라 + 포즈 자동 감지
   ================================================================ */
function startPractice() {
  state.clips = []; state.swingFrames = [];
  currentSwingIndex = 0; poseRunning = false; okFrames = 0;
  setupDone = false; betweenState = 'idle';
  goStep(6);
  setCamStatus('카메라 켜는 중...');
  openCamera();
  startVoiceRecognition();
}

function openCamera() {
  navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false
  }).then(function (stream) {
    mediaStream = stream;
    var vid = document.getElementById('previewVideo');
    if (vid) { vid.srcObject = stream; vid.play(); }
    setCamStatus('🧍 전신이 프레임에 들어오면 자동으로 시작됩니다');
    playCameraReadyBeep();
    setTimeout(initPose, 800);
  }).catch(function (err) {
    setCamStatus('카메라 오류: ' + err.message);
  });
}

/* ── 포즈 초기화 ── */
function initPose() {
  if (typeof Pose === 'undefined') {
    setCamStatus('⚠️ 자동 감지 불가 — 10초 후 시작');
    setTimeout(kickoffFirstSwing, 10000);
    return;
  }
  if (!poseDetector) {
    poseDetector = new Pose({
      locateFile: function (f) { return 'https://cdn.jsdelivr.net/npm/@mediapipe/pose/' + f; }
    });
    poseDetector.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.55, minTrackingConfidence: 0.55 });
    poseDetector.onResults(onPoseResult);
  }
  poseRunning = true; okFrames = 0; setupDone = false;
  requestAnimationFrame(poseLoop);
}

function poseLoop() {
  if (!poseRunning) return;
  var vid = getActiveVideo();
  if (vid && vid.readyState >= 2) {
    poseDetector.send({ image: vid }).catch(function () {});
  }
  setTimeout(function () { requestAnimationFrame(poseLoop); }, 120);
}

function getActiveVideo() {
  var s7 = document.getElementById('step7');
  if (s7 && s7.classList.contains('active')) return document.getElementById('recordVideo');
  return document.getElementById('previewVideo');
}

/* ── 포즈 결과 처리 ── */
function onPoseResult(results) {
  var lms = results.poseLandmarks;
  var hasBody = lms && lms.length > 0;
  var inFrame = hasBody && isFullBodyInFrame(lms);

  /* 세팅 단계 */
  if (!setupDone) {
    var pill = document.getElementById('framePill');
    if (!inFrame) { okFrames = 0; if (pill) pill.textContent = '전신이 프레임 안에 들어오게 서주세요'; return; }
    okFrames++;
    if (pill) pill.textContent = '✅ 자세 유지... (' + okFrames + '/8)';
    if (okFrames >= 8) {
      setupDone = true; poseRunning = false;
      if (pill) pill.textContent = '👍 세팅 완벽!';
      playBeepOk();
      speak('세팅이 완벽합니다. 5초 후 스윙 연습을 시작합니다.');
      setCamStatus('5초 후 첫 번째 스윙 연습을 시작합니다');
      setTimeout(kickoffFirstSwing, 5000);
    }
    return;
  }

  /* 스윙 사이: 프레임 이탈 감지 */
  if (betweenState === 'wait_exit') {
    if (!hasBody) noPersonFrames++;
    else noPersonFrames = 0;
    if (noPersonFrames >= 8) {
      noPersonFrames = 0; betweenState = 'wait_enter';
      setRecordGuide('준비되면 프레임 안으로 들어오세요 🏌️');
    }
    return;
  }

  /* 스윙 사이: 재진입 감지 */
  if (betweenState === 'wait_enter') {
    if (inFrame) { betweenState = 'countdown'; setRecordGuide(''); startNextSwingCountdown(); }
    return;
  }
}

function isFullBodyInFrame(lms) {
  var xs = lms.map(function (l) { return l.x; });
  var ys = lms.map(function (l) { return l.y; });
  return Math.min.apply(null, xs) > 0.04 && Math.max.apply(null, xs) < 0.96 &&
    Math.min.apply(null, ys) > 0.02 && Math.max.apply(null, ys) < 0.97;
}

/* ================================================================
   녹화 흐름
   ================================================================ */
function kickoffFirstSwing() {
  goStep(7);
  var recVid = document.getElementById('recordVideo');
  if (recVid && mediaStream) { recVid.srcObject = mediaStream; recVid.play(); }
  startVoiceRecognition();
  startNextSwingCountdown();
}

var KO_COUNTS = ['다섯', '넷', '셋', '둘', '하나'];

function startNextSwingCountdown() {
  var phase = document.getElementById('recordPhase');
  var countdown = document.getElementById('recordCountdown');
  if (phase) phase.textContent = '스윙 준비';
  if (countdown) countdown.textContent = '';
  var n = 0;
  var t = setInterval(function () {
    if (n < KO_COUNTS.length) {
      speak(KO_COUNTS[n]);
      playBeep();
      if (countdown) countdown.textContent = 5 - n;
      n++;
    } else {
      clearInterval(t);
      if (countdown) countdown.textContent = '';
      captureSwing();
    }
  }, 1000);
}

/* 7구간 프레임 캡처 타이밍 (녹화 시작 후 ms) */
var SNAP_TIMES  = [300, 900, 1700, 2200, 2800, 3500, 4800];
var SNAP_LABELS = ['어드레스', '테이크어웨이', '백스윙 탑', '트랜지션', '임팩트', '팔로스루', '피니시'];

function captureSwing() {
  var phase = document.getElementById('recordPhase');
  if (phase) phase.textContent = '🏌️ 스윙!';
  playBeepLong(); setRecordGuide('');

  var chunks = [];
  var mimeType = pickMimeType();
  var recorder;
  try { recorder = new MediaRecorder(mediaStream, mimeType ? { mimeType: mimeType } : {}); }
  catch (e) { recorder = new MediaRecorder(mediaStream); }

  var rawFrames = new Array(SNAP_TIMES.length).fill(null);

  SNAP_TIMES.forEach(function (delay, i) {
    setTimeout(function () {
      var vid = document.getElementById('recordVideo');
      if (!vid || !vid.videoWidth) return;
      var c = document.createElement('canvas');
      c.width = 640; c.height = Math.round(vid.videoHeight * 640 / vid.videoWidth) || 360;
      c.getContext('2d').drawImage(vid, 0, 0, c.width, c.height);
      rawFrames[i] = { label: SNAP_LABELS[i], base64: c.toDataURL('image/jpeg', 0.75) };
    }, delay);
  });

  recorder.ondataavailable = function (e) { if (e.data && e.data.size > 0) chunks.push(e.data); };
  recorder.start(200);
  /* 6초 녹화 */
  setTimeout(function () { recorder.stop(); }, 6000);

  recorder.onstop = function () {
    var blob = new Blob(chunks, { type: mimeType || 'video/webm' });
    state.clips.push(blob);
    currentSwingIndex++;

    analyzeFramesWithPose(rawFrames, function (analyzed) {
      state.swingFrames.push(analyzed);
      showPostSwingScreen();
    });
  };
}

/* 스윙 완료 후 선택 화면 */
function showPostSwingScreen() {
  poseRunning = false;
  goStep(8);
  speak('스윙이 완료됐습니다. 바로 코칭 분석을 받으시겠습니까? 아니면 한 타 더 연습 후 코칭 받으시겠습니까?');
  startVoiceRecognition();
}

/* 한 번 더 연습 후 분석 */
function practiceAgain() {
  stopVoiceRecognition();
  goStep(7);
  betweenState = 'idle';
  poseRunning = false;
  setRecordGuide('');
  setTimeout(startNextSwingCountdown, 800);
}

/* ── 3장 프레임에 MediaPipe 포즈 분석 적용 ── */
function analyzeFramesWithPose(rawFrames, callback) {
  var validFrames = rawFrames.filter(function (f) { return f && f.base64; });
  if (!poseDetector || validFrames.length === 0) {
    callback(rawFrames.map(function (f) { return f ? { label: f.label, base64: f.base64, metrics: {} } : null; }));
    return;
  }

  var results = new Array(rawFrames.length).fill(null);
  var queue = [];
  rawFrames.forEach(function (f, i) { if (f) queue.push({ idx: i, frame: f }); });
  var qIdx = 0;
  var savedOnResults = null;

  function next() {
    if (qIdx >= queue.length) {
      /* 원래 콜백 복원 */
      if (savedOnResults) poseDetector.onResults(savedOnResults);
      callback(results);
      return;
    }
    var item = queue[qIdx++];
    var img = new Image();
    img.onload = function () {
      poseDetector.send({ image: img }).catch(function () {
        results[item.idx] = { label: item.frame.label, base64: item.frame.base64, metrics: {} };
        next();
      });
    };
    img.onerror = function () {
      results[item.idx] = { label: item.frame.label, base64: item.frame.base64, metrics: {} };
      next();
    };
    poseDetector.onResults(function (res) {
      var metrics = res.poseLandmarks ? extractDetailedMetrics(res.poseLandmarks) : {};
      var landmarks = res.poseLandmarks ? res.poseLandmarks.map(function (lm) {
        return { x: lm.x, y: lm.y, visibility: lm.visibility || 0 };
      }) : [];
      results[item.idx] = { label: item.frame.label, base64: item.frame.base64, metrics: metrics, landmarks: landmarks };
      next();
    });
    img.src = item.frame.base64;
  }

  /* 현재 onResults 저장 후 분석 시작 */
  savedOnResults = onPoseResult;
  next();
}

/* ── 상세 포즈 수치 추출 (다운더라인 카메라 기준) ── */
function extractDetailedMetrics(lms) {
  if (!lms || lms.length < 29) return {};
  var L = lms;

  function pt(i) { return L[i]; }
  function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2 }; }
  function angleDeg(a, b, c) {
    var ab = { x: a.x - b.x, y: a.y - b.y }, cb = { x: c.x - b.x, y: c.y - b.y };
    var dot = ab.x * cb.x + ab.y * cb.y;
    var mag = Math.sqrt(ab.x * ab.x + ab.y * ab.y) * Math.sqrt(cb.x * cb.x + cb.y * cb.y);
    if (mag === 0) return 0;
    return Math.round(Math.acos(Math.min(1, Math.max(-1, dot / mag))) * 180 / Math.PI);
  }
  function tiltDeg(a, b) {
    return Math.round(Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI);
  }

  var nose = pt(0);
  var lSho = pt(11), rSho = pt(12);
  var lElb = pt(13), rElb = pt(14);
  var lWri = pt(15), rWri = pt(16);
  var lHip = pt(23), rHip = pt(24);
  var lKne = pt(25), rKne = pt(26);
  var lAnk = pt(27), rAnk = pt(28);

  var shoMid = midpoint(lSho, rSho);
  var hipMid = midpoint(lHip, rHip);

  // 척추 기울기: 어깨 중점 → 힙 중점 vs 수직축
  var spineAngle = Math.round(Math.atan2(shoMid.x - hipMid.x, hipMid.y - shoMid.y) * 180 / Math.PI);

  // 오른손목 높이 (화면 좌표 반전: 위가 0)
  var rWristHeight = Math.round((1 - rWri.y) * 100);
  var lWristHeight = Math.round((1 - lWri.y) * 100);
  var shoulderHeight = Math.round((1 - shoMid.y) * 100);

  return {
    척추기울기_deg: spineAngle,
    어깨기울기_deg: tiltDeg(lSho, rSho),
    힙기울기_deg: tiltDeg(lHip, rHip),
    어깨_힙_회전차_deg: tiltDeg(lSho, rSho) - tiltDeg(lHip, rHip),
    왼팔각도_deg: angleDeg(lSho, lElb, lWri),
    오른팔각도_deg: angleDeg(rSho, rElb, rWri),
    왼무릎굴곡_deg: angleDeg(lHip, lKne, lAnk),
    오른무릎굴곡_deg: angleDeg(rHip, rKne, rAnk),
    오른손목_높이_pct: rWristHeight,
    왼손목_높이_pct: lWristHeight,
    어깨_높이_pct: shoulderHeight,
    손목_어깨위_여부: rWristHeight > shoulderHeight ? '손목이 어깨 위' : '손목이 어깨 아래'
  };
}

/* ── 음성 "시작" / "다시" 즉시 트리거 ── */
function voiceTriggerStart() {
  if (betweenState === 'wait_exit' || betweenState === 'wait_enter') {
    poseRunning = false; betweenState = 'countdown';
    setRecordGuide(''); speak('시작합니다');
    startNextSwingCountdown();
  }
}
function voiceTriggerRedo() {
  if (currentSwingIndex === 0) return;
  currentSwingIndex--; state.clips.pop(); state.swingFrames.pop();
  betweenState = 'countdown'; poseRunning = false;
  var ph = document.getElementById('recordPhase');
  if (ph) ph.textContent = (currentSwingIndex + 1) + '번째 스윙 다시 시작';
  setRecordGuide(''); speak('다시 시작합니다');
  setTimeout(startNextSwingCountdown, 1500);
}

/* finishRecording 은 showPostSwingScreen 으로 대체됨 */

function pickMimeType() {
  var types = ['video/mp4;codecs=h264', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  for (var i = 0; i < types.length; i++) {
    try { if (MediaRecorder.isTypeSupported(types[i])) return types[i]; } catch (e) {}
  }
  return '';
}

/* ================================================================
   AI 분석 업로드 (이미지 + 수치 전송)
   ================================================================ */
function isPostSwingActive() {
  var s8 = document.getElementById('step8');
  return s8 && s8.classList.contains('active');
}

function uploadAndAnalyze() {
  stopVoiceRecognition();
  goStep(9);
  var wrap = document.getElementById('resultsWrap');
  if (wrap) wrap.innerHTML = '<div class="loading"><div class="spinner"></div><p>AI 코치가 스윙을 분석 중입니다...<br>잠시만 기다려주세요</p></div>';

  var form = new FormData();

  /* 영상 파일 (백업용) */
  state.clips.forEach(function (clip, i) {
    var ext = clip.type.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
    form.append('clips', clip, 'swing_' + (i + 1) + '.' + ext);
  });

  /* 프레임 이미지 + 수치 (스윙별) */
  var framesPayload = state.swingFrames.map(function (swingFrameSet, swingIdx) {
    var obj = { swing: swingIdx + 1 };
    if (swingFrameSet) {
      swingFrameSet.forEach(function (f) {
        if (!f) return;
        var key = f.label === '어드레스' ? 'address' : f.label === '백스윙 탑' ? 'top' : 'impact';
        obj[key] = { base64: f.base64, metrics: f.metrics || {} };
      });
    }
    return obj;
  });
  form.append('frames_json', JSON.stringify(framesPayload));
  form.append('club', state.club || '');
  form.append('notes', state.concern || '');

  fetch(BACKEND + '/api/analyze', { method: 'POST', body: form })
    .then(function (res) {
      if (!res.ok) throw new Error('서버 오류 (' + res.status + ')');
      return res.json();
    })
    .then(showResults)
    .catch(function (err) {
      if (wrap) wrap.innerHTML =
        '<div class="result-card"><h3>⚠️ 백엔드 연결 오류</h3>' +
        '<p>' + err.message + '</p>' +
        '<p style="margin-top:10px;color:#aaa;font-size:.8rem">백엔드 서버를 먼저 실행해주세요.<br>서버 주소: ' + BACKEND + '</p></div>';
    });
}

/* ── MediaPipe 관절 이름 (인덱스 0~32) ── */
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

/* ── 포즈 캔버스 그리기 ── */
function drawPoseCanvas(canvas, imageBase64, landmarks, corrections) {
  var ctx = canvas.getContext('2d');
  var img = new Image();
  img.onload = function () {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
    if (!landmarks || !landmarks.length) return;

    var w = canvas.width, h = canvas.height;

    /* 어느 관절이 교정 필요한지 + 방향 */
    var badMap = {};   // idx → direction string
    (corrections || []).forEach(function (c) {
      var idx = JOINT_NAMES.indexOf(c.joint);
      if (idx >= 0) badMap[idx] = c.direction || '';
    });

    /* 스켈레톤 선 */
    POSE_CONNECTIONS.forEach(function (conn) {
      var a = landmarks[conn[0]], b = landmarks[conn[1]];
      if (!a || !b || a.visibility < 0.3 || b.visibility < 0.3) return;
      ctx.beginPath();
      ctx.moveTo(a.x * w, a.y * h);
      ctx.lineTo(b.x * w, b.y * h);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = Math.max(1, w * 0.004);
      ctx.stroke();
    });

    /* 관절 점 */
    var DOT_R = Math.max(4, w * 0.012);
    landmarks.forEach(function (lm, i) {
      if (!lm || lm.visibility < 0.25) return;
      var cx = lm.x * w, cy = lm.y * h;
      var isBad = i in badMap;

      ctx.beginPath();
      ctx.arc(cx, cy, isBad ? DOT_R * 1.4 : DOT_R, 0, Math.PI * 2);
      ctx.fillStyle = isBad ? '#FF3B3B' : '#3BFF88';
      ctx.fill();

      if (isBad) {
        /* 빨간 강조 링 */
        ctx.beginPath();
        ctx.arc(cx, cy, DOT_R * 2.8, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,59,59,0.75)';
        ctx.lineWidth = Math.max(2, w * 0.004);
        ctx.stroke();

        /* 방향 화살표 → 초록 이상 위치 */
        var dir = badMap[i];
        var OFFSET = w * 0.08;
        var dx = 0, dy = 0;
        if (dir === 'up')      dy = -OFFSET;
        else if (dir === 'down')    dy =  OFFSET;
        else if (dir === 'left' || dir === 'back')  dx = -OFFSET;
        else if (dir === 'right' || dir === 'forward') dx =  OFFSET;

        if (dx !== 0 || dy !== 0) {
          /* 점선 화살표 */
          ctx.save();
          ctx.setLineDash([w * 0.012, w * 0.008]);
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + dx, cy + dy);
          ctx.strokeStyle = '#3BFF88';
          ctx.lineWidth = Math.max(2, w * 0.004);
          ctx.stroke();
          ctx.restore();

          /* 초록 목표 점 */
          ctx.beginPath();
          ctx.arc(cx + dx, cy + dy, DOT_R * 1.4, 0, Math.PI * 2);
          ctx.fillStyle = '#3BFF88';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(cx + dx, cy + dy, DOT_R * 2.5, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(59,255,136,0.6)';
          ctx.lineWidth = Math.max(2, w * 0.004);
          ctx.stroke();
        }
      }
    });
  };
  img.src = imageBase64;
}

/* ── 결과 화면 렌더링 ── */
function showResults(data) {
  var wrap = document.getElementById('resultsWrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  var items = Array.isArray(data.results) ? data.results : Array.isArray(data) ? data : [data];
  if (!items.length) {
    wrap.innerHTML = '<div class="result-card"><h3>결과 없음</h3><p>분석 결과가 없습니다.</p></div>';
    return;
  }

  items.forEach(function (item, swingIdx) {
    /* 스윙별 섹션 */
    var swingDiv = document.createElement('div');
    swingDiv.className = 'swing-section';
    swingDiv.innerHTML = '<h3 class="swing-title">스윙 ' + (swingIdx + 1) + ' — ' + (state.club || '') + '</h3>';

    /* Gemini JSON 파싱 */
    var coaching = null;
    try {
      var raw = item.coaching || '';
      /* ```json ... ``` 블록 제거 */
      raw = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      coaching = JSON.parse(raw);
    } catch (e) { coaching = null; }

    /* 3장 프레임 행 */
    var phases = [
      { key: 'address',       label: '어드레스',    frameLabel: '어드레스' },
      { key: 'takeaway',      label: '테이크어웨이', frameLabel: '테이크어웨이' },
      { key: 'top',           label: '백스윙 탑',   frameLabel: '백스윙 탑' },
      { key: 'transition',    label: '트랜지션',    frameLabel: '트랜지션' },
      { key: 'impact',        label: '임팩트',      frameLabel: '임팩트' },
      { key: 'followthrough', label: '팔로스루',    frameLabel: '팔로스루' },
      { key: 'finish',        label: '피니시',      frameLabel: '피니시' }
    ];

    var framesRow = document.createElement('div');
    framesRow.className = 'frames-row';

    var swingFrameSet = state.swingFrames[swingIdx] || [];

    phases.forEach(function (phase) {
      var frame = null;
      for (var fi = 0; fi < swingFrameSet.length; fi++) {
        if (swingFrameSet[fi] && swingFrameSet[fi].label === phase.frameLabel) {
          frame = swingFrameSet[fi]; break;
        }
      }

      var phaseDiv = document.createElement('div');
      phaseDiv.className = 'phase-card';

      var lbl = document.createElement('div');
      lbl.className = 'phase-label';
      lbl.textContent = phase.label;
      phaseDiv.appendChild(lbl);

      var canvas = document.createElement('canvas');
      canvas.className = 'pose-canvas';
      phaseDiv.appendChild(canvas);

      var phaseData = coaching && coaching[phase.key];
      var corrections = phaseData ? (phaseData.corrections || []) : [];
      var comment    = phaseData ? (phaseData.comment || '') : '';

      if (frame && frame.base64) {
        drawPoseCanvas(canvas, frame.base64, frame.landmarks || [], corrections);
      } else {
        canvas.width = 200; canvas.height = 150;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, 200, 150);
        ctx.fillStyle = '#666';
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('이미지 없음', 100, 75);
      }

      if (corrections.length > 0) {
        var badDiv = document.createElement('div');
        badDiv.className = 'correction-list';
        corrections.forEach(function (c) {
          var chip = document.createElement('span');
          chip.className = 'correction-chip';
          chip.textContent = '🔴 ' + (c.comment || c.joint);
          badDiv.appendChild(chip);
        });
        phaseDiv.appendChild(badDiv);
      }

      if (comment) {
        var commentEl = document.createElement('p');
        commentEl.className = 'phase-comment';
        commentEl.textContent = comment;
        phaseDiv.appendChild(commentEl);
      }

      framesRow.appendChild(phaseDiv);
    });

    swingDiv.appendChild(framesRow);

    /* 오늘의 핵심 과제 */
    if (coaching && coaching.today_focus) {
      var focusDiv = document.createElement('div');
      focusDiv.className = 'focus-card';
      focusDiv.innerHTML =
        '<div class="focus-icon">🎯</div>' +
        '<div class="focus-label">오늘의 핵심 과제</div>' +
        '<div class="focus-text">' + coaching.today_focus + '</div>';
      swingDiv.appendChild(focusDiv);
    }

    /* 추천 드릴 */
    if (coaching && coaching.drill) {
      var d = coaching.drill;
      var drillDiv = document.createElement('div');
      drillDiv.className = 'drill-card';
      drillDiv.innerHTML =
        '<div class="drill-title">📋 ' + (d.name || '추천 드릴') + '</div>' +
        '<div class="drill-method">' + (d.method || '') + '</div>' +
        (d.reps ? '<div class="drill-reps">⏱ ' + d.reps + '</div>' : '');
      swingDiv.appendChild(drillDiv);
    }

    /* JSON 파싱 실패 시 폴백 (원문 텍스트) */
    if (!coaching && item.coaching) {
      var fallback = document.createElement('div');
      fallback.className = 'result-card';
      fallback.innerHTML = '<div class="coaching-body">' + escapeHtml(item.coaching) + '</div>';
      swingDiv.appendChild(fallback);
    }

    wrap.appendChild(swingDiv);
  });
}

function escapeHtml(text) {
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ================================================================
   리셋
   ================================================================ */
function resetAll() {
  stopVoiceRecognition();
  state.club = null; state.swingCount = null; state.concern = '';
  state.clips = []; state.swingFrames = [];
  currentSwingIndex = 0; poseRunning = false; okFrames = 0;
  setupDone = false; betweenState = 'idle'; noPersonFrames = 0;
  if (mediaStream) { mediaStream.getTracks().forEach(function (t) { t.stop(); }); mediaStream = null; }
  document.querySelectorAll('.club-btn').forEach(function (b) { b.classList.remove('selected'); });
  document.querySelectorAll('.chip').forEach(function (b) { b.classList.remove('selected'); });
  var cn = document.getElementById('btnClubNext'); if (cn) cn.disabled = true;
  var nn = document.getElementById('btnCountNext'); if (nn) nn.disabled = true;
  var inp = document.getElementById('concernInput'); if (inp) inp.value = '';
  goStep(0);
}

/* ================================================================
   음성 인식
   ================================================================ */
var voiceRecognition = null;
var voiceActive = false;

function startVoiceRecognition() {
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || voiceActive) return;
  voiceRecognition = new SR();
  voiceRecognition.lang = 'ko-KR';
  voiceRecognition.continuous = true;
  voiceRecognition.interimResults = false;
  voiceRecognition.onstart = function () { voiceActive = true; setVoiceStatus('on'); };
  voiceRecognition.onend = function () {
    voiceActive = false;
    var s7 = document.getElementById('step7');
    var s6 = document.getElementById('step6');
    var s8 = document.getElementById('step8');
    var active = (s7 && s7.classList.contains('active')) ||
                 (s6 && s6.classList.contains('active')) ||
                 (s8 && s8.classList.contains('active'));
    if (active) setTimeout(startVoiceRecognition, 500);
    else setVoiceStatus('off');
  };
  voiceRecognition.onerror = function () { voiceActive = false; setVoiceStatus('off'); };
  voiceRecognition.onresult = function (e) {
    var last = e.results[e.results.length - 1];
    if (!last.isFinal) return;
    var text = last[0].transcript.trim();
    showVoiceHeard(text);
    /* 녹화 중 음성 */
    if (text.indexOf('시작') >= 0) voiceTriggerStart();
    if (text.indexOf('다시') >= 0 && !isPostSwingActive()) voiceTriggerRedo();
    /* 포스트스윙 선택 음성 */
    if (isPostSwingActive()) {
      if (text.indexOf('분석') >= 0) uploadAndAnalyze();
      else if (text.indexOf('더') >= 0 || text.indexOf('한번') >= 0 || text.indexOf('한 번') >= 0) practiceAgain();
    }
  };
  try { voiceRecognition.start(); } catch (e) {}
}

function stopVoiceRecognition() {
  voiceActive = false;
  if (voiceRecognition) { try { voiceRecognition.stop(); } catch (e) {} }
  setVoiceStatus('off');
}

/* ================================================================
   UI 헬퍼
   ================================================================ */
function setCamStatus(msg) { var el = document.getElementById('cameraStatus'); if (el) el.textContent = msg; }
function setRecordGuide(msg) {
  var el = document.getElementById('betweenGuide');
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}
function setVoiceStatus(s) {
  ['voiceIndicator', 'voiceIndicator2'].forEach(function (id) {
    var ind = document.getElementById(id);
    var txt = id === 'voiceIndicator' ? document.getElementById('voiceStatusText') : document.getElementById('voiceStatusText2');
    if (!ind) return;
    if (s === 'on') { ind.classList.add('listening'); if (txt) txt.textContent = '음성 듣는 중 — "시작" / "다시"'; }
    else { ind.classList.remove('listening'); if (txt) txt.textContent = '음성 인식 꺼짐'; }
  });
}
function showVoiceHeard(text) {
  ['voiceHeard', 'voiceHeard2'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = '"' + text + '"'; el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.style.opacity = '0'; }, 1800);
  });
}

/* ================================================================
   오디오 / TTS
   ================================================================ */
function playBeep() {
  try {
    var C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    var ctx = new C(), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 660; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.3, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    o.start(); o.stop(ctx.currentTime + 0.2); o.onended = function () { ctx.close(); };
  } catch (e) {}
}
function playBeepOk() {
  try {
    var C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    var ctx = new C();
    [523, 659, 784].forEach(function (f, i) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      var t = ctx.currentTime + i * 0.14;
      g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.start(t); o.stop(t + 0.32);
    });
    setTimeout(function () { ctx.close(); }, 1200);
  } catch (e) {}
}
function playBeepLong() {
  try {
    var C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    var ctx = new C(), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.4, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    o.start(); o.stop(ctx.currentTime + 0.55); o.onended = function () { ctx.close(); };
  } catch (e) {}
}
/* 카메라 준비 완료 — 크고 명확한 3연타 비프 */
function playCameraReadyBeep() {
  try {
    var C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    var ctx = new C();
    [523, 659, 880].forEach(function (f, i) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      var t = ctx.currentTime + i * 0.22;
      g.gain.setValueAtTime(0.8, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.start(t); o.stop(t + 0.42);
    });
    setTimeout(function () { ctx.close(); }, 1500);
  } catch (e) {}
}
function speak(text) {
  if (!window.speechSynthesis) return;
  var u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR'; u.rate = 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

/* ================================================================
   초기화
   ================================================================ */
buildClubGrid();
goStep(0);
