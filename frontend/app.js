/* ================================================================
   NICESHOT – 골프 스윙 AI 코치
   영상 4초 녹화 → Gemini 분석 → 스코어카드 → 슬로모션 교정 영상
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
  concern: '',
  videoBlob: null,
  poseFrames: [],
  recordStartTime: 0,
  isRecording: false,
  analysisResult: null
};

var mediaStream = null;

/* ── 포즈 ── */
var poseDetector = null;
var poseRunning = false;
var okFrames = 0;
var setupDone = false;

/* ── 스윙 사이 상태 ── */
var betweenState = 'idle';
var noPersonFrames = 0;

/* ── 슬로모션 ── */
var slowmoAnimId = null;

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
  state.videoBlob = null; state.poseFrames = [];
  state.analysisResult = null;
  poseRunning = false; okFrames = 0;
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

  /* 녹화 중: 랜드마크 저장 */
  if (state.isRecording && hasBody) {
    state.poseFrames.push({
      time: (Date.now() - state.recordStartTime) / 1000,
      landmarks: lms.map(function (lm) {
        return { x: lm.x, y: lm.y, visibility: lm.visibility || 0 };
      })
    });
    return;
  }

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
      setCamStatus('5초 후 스윙 연습을 시작합니다');
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

/* ── 4초 영상 녹화 + 실시간 포즈 프레임 수집 ── */
function captureSwing() {
  var phase = document.getElementById('recordPhase');
  if (phase) phase.textContent = '🏌️ 스윙!';
  playBeepLong(); setRecordGuide('');

  var chunks = [];
  var mimeType = pickMimeType();
  var recorder;
  try { recorder = new MediaRecorder(mediaStream, mimeType ? { mimeType: mimeType } : {}); }
  catch (e) { recorder = new MediaRecorder(mediaStream); }

  state.poseFrames = [];
  state.recordStartTime = Date.now();
  state.isRecording = true;
  poseRunning = true;
  requestAnimationFrame(poseLoop);

  recorder.ondataavailable = function (e) { if (e.data && e.data.size > 0) chunks.push(e.data); };
  recorder.start(200);

  setTimeout(function () {
    state.isRecording = false;
    poseRunning = false;
    recorder.stop();
  }, 4000);

  recorder.onstop = function () {
    state.videoBlob = new Blob(chunks, { type: mimeType || 'video/webm' });
    speak('스윙 완료. 분석을 시작합니다.');
    uploadAndAnalyze();
  };
}

/* 한 번 더 연습 */
function practiceAgain() {
  goStep(7);
  betweenState = 'idle';
  poseRunning = false;
  setRecordGuide('');
  setTimeout(startNextSwingCountdown, 800);
}

function pickMimeType() {
  var types = ['video/mp4;codecs=h264', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  for (var i = 0; i < types.length; i++) {
    try { if (MediaRecorder.isTypeSupported(types[i])) return types[i]; } catch (e) {}
  }
  return '';
}

/* ================================================================
   상세 포즈 수치 추출
   ================================================================ */
function extractDetailedMetrics(lms) {
  if (!lms || lms.length < 29) return {};
  var L = lms;

  function pt(i) { return L[i]; }
  function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
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

  var lSho = pt(11), rSho = pt(12);
  var lElb = pt(13), rElb = pt(14);
  var lWri = pt(15), rWri = pt(16);
  var lHip = pt(23), rHip = pt(24);
  var lKne = pt(25), rKne = pt(26);
  var lAnk = pt(27), rAnk = pt(28);

  var shoMid = midpoint(lSho, rSho);
  var hipMid = midpoint(lHip, rHip);
  var spineAngle = Math.round(Math.atan2(shoMid.x - hipMid.x, hipMid.y - shoMid.y) * 180 / Math.PI);
  var rWristHeight = Math.round((1 - rWri.y) * 100);
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
    어깨_높이_pct: shoulderHeight,
    손목_어깨위_여부: rWristHeight > shoulderHeight ? '손목이 어깨 위' : '손목이 어깨 아래'
  };
}

/* ── 저장된 포즈 프레임에서 핵심 구간 메트릭 추출 ── */
function extractMetricsFromPoseFrames() {
  var keyTimes = { address: 0.3, top: 1.3, impact: 2.3, followthrough: 2.8 };
  var metrics = {};
  var keys = Object.keys(keyTimes);
  for (var k = 0; k < keys.length; k++) {
    var phase = keys[k];
    var targetTime = keyTimes[phase];
    var closest = null;
    var minDist = Infinity;
    for (var i = 0; i < state.poseFrames.length; i++) {
      var dist = Math.abs(state.poseFrames[i].time - targetTime);
      if (dist < minDist) { minDist = dist; closest = state.poseFrames[i]; }
    }
    if (closest && closest.landmarks && closest.landmarks.length >= 29) {
      metrics[phase] = extractDetailedMetrics(closest.landmarks);
    }
  }
  return metrics;
}

/* ── 스윙 동작 감지 지표 추출 (MediaPipe 기반) ── */
function extractSwingIndicators() {
  if (state.poseFrames.length < 5) {
    return { valid: false, has_swing_motion: false, reason: '포즈 감지 프레임 부족' };
  }

  var wristHeights = [];
  var shoulderTilts = [];
  var hipTilts = [];

  for (var i = 0; i < state.poseFrames.length; i++) {
    var lms = state.poseFrames[i].landmarks;
    if (!lms || lms.length < 29) continue;

    wristHeights.push(1 - lms[16].y);

    var shoTilt = Math.atan2(lms[12].y - lms[11].y, lms[12].x - lms[11].x) * 180 / Math.PI;
    shoulderTilts.push(Math.round(shoTilt));

    var hipTilt = Math.atan2(lms[24].y - lms[23].y, lms[24].x - lms[23].x) * 180 / Math.PI;
    hipTilts.push(Math.round(hipTilt));
  }

  if (wristHeights.length < 5) {
    return { valid: false, has_swing_motion: false, reason: '유효한 랜드마크 부족' };
  }

  var maxWrist = Math.max.apply(null, wristHeights);
  var minWrist = Math.min.apply(null, wristHeights);
  var wristRange = maxWrist - minWrist;

  var maxShoTilt = Math.max.apply(null, shoulderTilts);
  var minShoTilt = Math.min.apply(null, shoulderTilts);
  var shoulderRotation = maxShoTilt - minShoTilt;

  var maxHipTilt = Math.max.apply(null, hipTilts);
  var minHipTilt = Math.min.apply(null, hipTilts);
  var hipRotation = maxHipTilt - minHipTilt;

  var firstFrame = state.poseFrames[0].landmarks;
  var shoulderH = 1 - ((firstFrame[11].y + firstFrame[12].y) / 2);
  var wristAboveShoulder = maxWrist > shoulderH;

  var hasSwing = wristRange > 0.12 && (shoulderRotation > 5 || hipRotation > 3);

  return {
    valid: true,
    frame_count: state.poseFrames.length,
    wrist_height_range_pct: Math.round(wristRange * 100),
    wrist_peak_pct: Math.round(maxWrist * 100),
    wrist_above_shoulder: wristAboveShoulder,
    shoulder_rotation_deg: Math.round(shoulderRotation),
    hip_rotation_deg: Math.round(hipRotation),
    has_swing_motion: hasSwing
  };
}

/* ================================================================
   AI 분석 업로드 (영상 + 메트릭)
   ================================================================ */
function isPostSwingActive() { return false; }

function uploadAndAnalyze() {
  stopVoiceRecognition();
  goStep(9);
  var wrap = document.getElementById('scoreCardWrap');
  if (wrap) wrap.innerHTML = '<div class="loading"><div class="spinner"></div><p>AI 코치가 스윙을 분석 중입니다...<br>잠시만 기다려주세요</p></div>';

  var form = new FormData();

  if (state.videoBlob) {
    var ext = state.videoBlob.type.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
    form.append('clips', state.videoBlob, 'swing.' + ext);
  }

  var metrics = extractMetricsFromPoseFrames();
  metrics.swing_indicators = extractSwingIndicators();
  form.append('metrics_json', JSON.stringify(metrics));
  form.append('club', state.club || '');
  form.append('notes', state.concern || '');

  fetch(BACKEND + '/api/analyze', { method: 'POST', body: form })
    .then(function (res) {
      if (!res.ok) throw new Error('서버 오류 (' + res.status + ')');
      return res.json();
    })
    .then(showScoreCard)
    .catch(function (err) {
      if (wrap) wrap.innerHTML =
        '<div class="result-card"><h3>⚠️ 백엔드 연결 오류</h3>' +
        '<p>' + err.message + '</p>' +
        '<p style="margin-top:10px;color:#aaa;font-size:.8rem">서버 주소: ' + BACKEND + '</p></div>';
    });
}

/* ================================================================
   MediaPipe 관절 / 스켈레톤 데이터
   ================================================================ */
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

/* ================================================================
   결과 화면 1: 스코어카드 (step 9)
   ================================================================ */
var PHASE_LABELS = {
  address: '어드레스', takeaway: '테이크어웨이', top: '백스윙 탑',
  transition: '트랜지션', impact: '임팩트', followthrough: '팔로스루', finish: '피니시'
};

function showScoreCard(data) {
  var wrap = document.getElementById('scoreCardWrap');
  if (!wrap) return;

  var coaching = null;
  try {
    var raw = data.coaching || '';
    raw = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    coaching = JSON.parse(raw);
  } catch (e) {}

  state.analysisResult = coaching;

  if (!coaching) {
    wrap.innerHTML = '<div class="result-card"><h3>분석 오류</h3><p>' +
      escapeHtml(data.coaching || '다시 시도해주세요.') + '</p></div>';
    return;
  }

  /* 골프 스윙이 아닌 경우 */
  if (coaching.score === -1) {
    wrap.innerHTML =
      '<div class="score-invalid">' +
      '<div class="invalid-icon">⚠️</div>' +
      '<h3>골프 스윙이 감지되지 않았습니다</h3>' +
      '<p>' + escapeHtml(coaching.reason || '영상에서 골프 스윙 동작을 찾을 수 없습니다.') + '</p>' +
      '<p class="invalid-hint">전신이 보이도록 카메라를 세우고<br>실제 스윙 동작을 해주세요.</p>' +
      '</div>';
    return;
  }

  var score = coaching.score || 0;
  var circumference = 2 * Math.PI * 54;
  var offset = circumference * (1 - score / 100);
  var scoreColor = score >= 80 ? '#2d6a4f' : score >= 60 ? '#f39c12' : '#e74c3c';

  var html = '';

  /* 점수 원형 게이지 */
  html += '<div class="score-circle-wrap">';
  html += '<svg viewBox="0 0 120 120" class="score-svg">';
  html += '<circle cx="60" cy="60" r="54" fill="none" stroke="#e8e8e8" stroke-width="8"/>';
  html += '<circle cx="60" cy="60" r="54" fill="none" stroke="' + scoreColor + '" stroke-width="8" ';
  html += 'stroke-linecap="round" stroke-dasharray="' + circumference.toFixed(1) + '" ';
  html += 'stroke-dashoffset="' + circumference.toFixed(1) + '" ';
  html += 'transform="rotate(-90 60 60)" class="score-ring"/>';
  html += '</svg>';
  html += '<div class="score-number">' + score + '</div>';
  html += '<div class="score-unit">점</div>';
  html += '</div>';

  /* 문제점 (최대 3개) */
  var problems = coaching.problems || [];
  if (problems.length > 0) {
    html += '<div class="problems-section">';
    html += '<h3 class="problems-title">주요 교정 포인트</h3>';
    for (var i = 0; i < problems.length; i++) {
      var p = problems[i];
      html += '<div class="problem-card">';
      html += '<span class="problem-num">' + (i + 1) + '</span>';
      html += '<div class="problem-body">';
      html += '<span class="problem-phase">' + (PHASE_LABELS[p.phase] || p.phase) + '</span>';
      html += '<p class="problem-desc">' + escapeHtml(p.description || '') + '</p>';
      html += '</div>';
      html += '</div>';
    }
    html += '</div>';
  } else {
    html += '<div class="problems-section"><p class="no-problems">교정 포인트 없음 — 훌륭한 스윙입니다!</p></div>';
  }

  /* 추천 드릴 */
  if (coaching.drill) {
    var d = coaching.drill;
    html += '<div class="drill-card">';
    html += '<div class="drill-title">📋 ' + escapeHtml(d.name || '추천 드릴') + '</div>';
    html += '<div class="drill-method">' + escapeHtml(d.method || '') + '</div>';
    if (d.reps) html += '<div class="drill-reps">⏱ ' + escapeHtml(d.reps) + '</div>';
    html += '</div>';
  }

  /* 교정 영상 보기 버튼 */
  html += '<button class="btn btn-outline" onclick="showSlowmoPlayer()" style="margin-top:12px;width:100%">🎬 교정 영상 보기</button>';

  wrap.innerHTML = html;

  /* 링 애니메이션 */
  setTimeout(function () {
    var ring = wrap.querySelector('.score-ring');
    if (ring) {
      ring.style.transition = 'stroke-dashoffset 1.2s ease-out';
      ring.style.strokeDashoffset = offset.toFixed(1);
    }
  }, 100);
}

function escapeHtml(text) {
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ================================================================
   결과 화면 2: 슬로모션 교정 영상 (step 10)
   ================================================================ */
var PHASE_RANGES = [
  { key: 'address',       label: '어드레스',    start: 0,    end: 0.5 },
  { key: 'takeaway',      label: '테이크어웨이', start: 0.5,  end: 1.0 },
  { key: 'top',           label: '백스윙 탑',   start: 1.0,  end: 1.5 },
  { key: 'transition',    label: '트랜지션',    start: 1.5,  end: 2.0 },
  { key: 'impact',        label: '임팩트',      start: 2.0,  end: 2.5 },
  { key: 'followthrough', label: '팔로스루',    start: 2.5,  end: 3.2 },
  { key: 'finish',        label: '피니시',      start: 3.2,  end: 4.0 }
];

var slowmoPauseTime = -1;
var slowmoPaused = false;
var slowmoPauseDone = false;

function showSlowmoPlayer() {
  goStep(10);
  var video = document.getElementById('slowmoVideo');
  if (!video || !state.videoBlob) return;

  video.src = URL.createObjectURL(state.videoBlob);
  video.playbackRate = 0.25;
  video.muted = true;

  slowmoPauseTime = findWorstPauseTime();
  slowmoPaused = false;
  slowmoPauseDone = false;

  var marker = document.getElementById('timelineMarker');
  if (marker && slowmoPauseTime > 0) {
    marker.style.display = 'block';
  }

  video.onloadedmetadata = function () {
    var cU = document.getElementById('canvasUser');
    var cP = document.getElementById('canvasPro');
    var h = 720; var w = 400;
    if (cU) { cU.width = w; cU.height = h; }
    if (cP) { cP.width = w; cP.height = h; }
    video.play();
    startSlowmoOverlay();
  };
  video.onplay = function () {
    var btn = document.getElementById('slowmoPlayBtn');
    if (btn) btn.textContent = '⏸';
    var badge = document.getElementById('pauseBadge');
    if (badge) badge.style.display = 'none';
    startSlowmoOverlay();
  };
  video.onpause = function () {
    var btn = document.getElementById('slowmoPlayBtn');
    if (btn) btn.textContent = '▶';
  };
  video.onended = function () {
    var btn = document.getElementById('slowmoPlayBtn');
    if (btn) btn.textContent = '↻';
    if (slowmoAnimId) { cancelAnimationFrame(slowmoAnimId); slowmoAnimId = null; }
  };
}

function toggleSlowmo() {
  var video = document.getElementById('slowmoVideo');
  if (!video) return;
  if (video.paused || video.ended) {
    if (video.ended) {
      video.currentTime = 0;
      slowmoPauseDone = false;
      slowmoPaused = false;
    }
    if (slowmoPaused) {
      slowmoPaused = false;
      slowmoPauseDone = true;
    }
    video.play();
  } else {
    video.pause();
  }
}

function getCurrentPhase(time) {
  for (var i = 0; i < PHASE_RANGES.length; i++) {
    if (time >= PHASE_RANGES[i].start && time < PHASE_RANGES[i].end) return PHASE_RANGES[i];
  }
  return PHASE_RANGES[PHASE_RANGES.length - 1];
}

function findClosestPoseFrame(time) {
  var closest = null;
  var minDist = Infinity;
  for (var i = 0; i < state.poseFrames.length; i++) {
    var dist = Math.abs(state.poseFrames[i].time - time);
    if (dist < minDist) { minDist = dist; closest = state.poseFrames[i]; }
  }
  return (closest && minDist < 0.3) ? closest : null;
}

/* ── 각도 기반 교정 위치 계산 ── */
function computeAngleCorrection(lms, corr, w, h) {
  var vertex = lms[corr.vertex_idx];
  var anchor = lms[corr.anchor_idx];
  var endpoint = lms[corr.endpoint_idx];
  if (!vertex || !anchor || !endpoint) return null;
  if (vertex.visibility < 0.25 || endpoint.visibility < 0.25) return null;

  var diffDeg = corr.target_deg - corr.current_deg;
  var vex = endpoint.x - vertex.x;
  var vey = endpoint.y - vertex.y;
  var vax = anchor.x - vertex.x;
  var vay = anchor.y - vertex.y;

  var cross = vax * vey - vay * vex;
  var sign = cross >= 0 ? 1 : -1;
  var rad = diffDeg * sign * Math.PI / 180;
  var cosR = Math.cos(rad);
  var sinR = Math.sin(rad);

  return {
    x: (vertex.x + vex * cosR - vey * sinR) * w,
    y: (vertex.y + vex * sinR + vey * cosR) * h
  };
}

function findWorstPauseTime() {
  if (!state.analysisResult || !state.analysisResult.corrections) return -1;
  var corr = state.analysisResult.corrections;
  var worstPhase = null;
  var worstScore = 0;
  for (var i = 0; i < PHASE_RANGES.length; i++) {
    var pk = PHASE_RANGES[i].key;
    var pc = corr[pk];
    if (!pc || pc.length === 0) continue;
    var score = 0;
    for (var j = 0; j < pc.length; j++) {
      score += (pc[j].severity === 'fault') ? 3 : 1;
    }
    if (score > worstScore) { worstScore = score; worstPhase = PHASE_RANGES[i]; }
  }
  if (!worstPhase) return -1;
  return (worstPhase.start + worstPhase.end) / 2;
}

function buildCorrectedLandmarks(lms, phaseCorr) {
  var corrected = [];
  for (var i = 0; i < lms.length; i++) {
    corrected.push({ x: lms[i].x, y: lms[i].y, visibility: lms[i].visibility });
  }
  for (var ci = 0; ci < phaseCorr.length; ci++) {
    var corr = phaseCorr[ci];
    if (corr.type !== 'angle' || corr.vertex_idx === undefined) continue;
    var vertex = lms[corr.vertex_idx];
    var endpoint = lms[corr.endpoint_idx];
    if (!vertex || !endpoint) continue;
    if (vertex.visibility < 0.25 || endpoint.visibility < 0.25) continue;

    var diffDeg = corr.target_deg - corr.current_deg;
    var vex = endpoint.x - vertex.x;
    var vey = endpoint.y - vertex.y;
    var anchor = lms[corr.anchor_idx];
    if (!anchor) continue;
    var vax = anchor.x - vertex.x;
    var vay = anchor.y - vertex.y;
    var cross = vax * vey - vay * vex;
    var sign = cross >= 0 ? 1 : -1;
    var rad = diffDeg * sign * Math.PI / 180;
    var cosR = Math.cos(rad);
    var sinR = Math.sin(rad);

    corrected[corr.endpoint_idx] = {
      x: vertex.x + vex * cosR - vey * sinR,
      y: vertex.y + vex * sinR + vey * cosR,
      visibility: endpoint.visibility
    };
  }
  return corrected;
}

function drawSkeleton(ctx, lms, w, h, opts) {
  var dotColor = opts.dotColor || 'rgba(255,255,255,0.7)';
  var lineColor = opts.lineColor || 'rgba(255,255,255,0.5)';
  var highlightJoints = opts.highlightJoints || {};
  var highlightColor = opts.highlightColor || '#FF4444';

  ctx.lineWidth = Math.max(2, w * 0.008);
  for (var ci = 0; ci < POSE_CONNECTIONS.length; ci++) {
    var conn = POSE_CONNECTIONS[ci];
    var a = lms[conn[0]], b = lms[conn[1]];
    if (!a || !b || a.visibility < 0.3 || b.visibility < 0.3) continue;
    ctx.beginPath();
    ctx.moveTo(a.x * w, a.y * h);
    ctx.lineTo(b.x * w, b.y * h);
    var isProblem = (conn[0] in highlightJoints) || (conn[1] in highlightJoints);
    ctx.strokeStyle = isProblem ? highlightColor : lineColor;
    ctx.stroke();
  }

  var DOT_R = Math.max(4, w * 0.015);
  for (var li = 0; li < lms.length; li++) {
    var lm = lms[li];
    if (!lm || lm.visibility < 0.25) continue;
    var jx = lm.x * w, jy = lm.y * h;
    var isHL = li in highlightJoints;
    ctx.beginPath();
    ctx.arc(jx, jy, isHL ? DOT_R * 1.4 : DOT_R, 0, Math.PI * 2);
    ctx.fillStyle = isHL ? highlightColor : dotColor;
    ctx.fill();
  }
}

function startSlowmoOverlay() {
  var video = document.getElementById('slowmoVideo');
  var canvasUser = document.getElementById('canvasUser');
  var canvasPro = document.getElementById('canvasPro');
  if (!video || !canvasUser || !canvasPro) return;
  var ctxU = canvasUser.getContext('2d');
  var ctxP = canvasPro.getContext('2d');

  function drawFrame() {
    if (video.paused || video.ended) { slowmoAnimId = null; return; }

    var t = video.currentTime;
    var phase = getCurrentPhase(t);
    var poseFrame = findClosestPoseFrame(t);

    /* auto-pause at worst phase */
    if (!slowmoPauseDone && slowmoPauseTime > 0 && t >= slowmoPauseTime && !slowmoPaused) {
      slowmoPaused = true;
      video.pause();
      var badge = document.getElementById('pauseBadge');
      var pauseText = document.getElementById('pauseText');
      if (badge) badge.style.display = 'flex';
      if (pauseText) {
        var phaseCorr2 = [];
        if (state.analysisResult && state.analysisResult.corrections) {
          phaseCorr2 = state.analysisResult.corrections[phase.key] || [];
        }
        var desc = phaseCorr2.length > 0 ? (phaseCorr2[0].label || '교정 포인트') : '교정 포인트';
        pauseText.textContent = desc + ' — 좌우를 비교해 보세요';
      }
      setTimeout(function () {
        slowmoPaused = false;
        slowmoPauseDone = true;
        if (badge) badge.style.display = 'none';
        video.play();
      }, 2500);
      drawBothCanvases(ctxU, ctxP, canvasUser, canvasPro, poseFrame, phase, t, video);
      slowmoAnimId = null;
      return;
    }

    drawBothCanvases(ctxU, ctxP, canvasUser, canvasPro, poseFrame, phase, t, video);
    slowmoAnimId = requestAnimationFrame(drawFrame);
  }

  if (slowmoAnimId) cancelAnimationFrame(slowmoAnimId);
  slowmoAnimId = requestAnimationFrame(drawFrame);
}

function drawBothCanvases(ctxU, ctxP, canvasUser, canvasPro, poseFrame, phase, t, video) {
  var wU = canvasUser.width, hU = canvasUser.height;
  var wP = canvasPro.width, hP = canvasPro.height;

  ctxU.fillStyle = '#0a0a0a';
  ctxU.fillRect(0, 0, wU, hU);
  ctxP.fillStyle = '#0a0a0a';
  ctxP.fillRect(0, 0, wP, hP);

  /* UI 업데이트 */
  var phaseLabel = document.getElementById('slowmoPhaseLabel');
  if (phaseLabel) phaseLabel.textContent = phase.label;

  var comment = '';
  if (state.analysisResult && state.analysisResult.phase_comments) {
    comment = state.analysisResult.phase_comments[phase.key] || '';
  }
  var commentEl = document.getElementById('slowmoComment');
  if (commentEl) commentEl.textContent = comment;

  var progress = document.getElementById('timelineProgress');
  if (progress && video.duration) {
    progress.style.width = (t / video.duration * 100) + '%';
  }

  var marker = document.getElementById('timelineMarker');
  if (marker && slowmoPauseTime > 0 && video.duration) {
    marker.style.left = (slowmoPauseTime / video.duration * 100) + '%';
  }

  if (!poseFrame || !poseFrame.landmarks) return;
  var lms = poseFrame.landmarks;

  var phaseCorr = [];
  if (state.analysisResult && state.analysisResult.corrections) {
    phaseCorr = state.analysisResult.corrections[phase.key] || [];
  }

  var corrJoints = {};
  for (var ci2 = 0; ci2 < phaseCorr.length; ci2++) {
    var c = phaseCorr[ci2];
    corrJoints[c.joint_idx] = c;
    if (c.vertex_idx !== undefined) corrJoints[c.vertex_idx] = c;
    if (c.endpoint_idx !== undefined) corrJoints[c.endpoint_idx] = c;
  }

  /* 왼쪽: 사용자 스켈레톤 */
  drawSkeleton(ctxU, lms, wU, hU, {
    dotColor: 'rgba(255,120,120,0.8)',
    lineColor: 'rgba(255,100,100,0.5)',
    highlightJoints: corrJoints,
    highlightColor: '#FF4444'
  });

  /* 오른쪽: 교정된 정석 스켈레톤 */
  var correctedLms = buildCorrectedLandmarks(lms, phaseCorr);
  drawSkeleton(ctxP, correctedLms, wP, hP, {
    dotColor: 'rgba(120,255,160,0.8)',
    lineColor: 'rgba(100,255,140,0.5)',
    highlightJoints: corrJoints,
    highlightColor: '#44FF88'
  });

  /* 문제 구간 배지 (사용자 캔버스) */
  if (phaseCorr.length > 0) {
    ctxU.fillStyle = 'rgba(255,68,68,0.85)';
    ctxU.font = 'bold ' + Math.max(12, wU * 0.035) + 'px sans-serif';
    ctxU.textAlign = 'left';
    ctxU.fillText('⚠ 교정 필요', 8, hU - 12);
  }
}

/* ================================================================
   리셋
   ================================================================ */
function resetAll() {
  stopVoiceRecognition();
  state.club = null; state.concern = '';
  state.videoBlob = null; state.poseFrames = [];
  state.analysisResult = null;
  state.isRecording = false;
  poseRunning = false; okFrames = 0;
  setupDone = false; betweenState = 'idle'; noPersonFrames = 0;
  if (slowmoAnimId) { cancelAnimationFrame(slowmoAnimId); slowmoAnimId = null; }
  slowmoPaused = false; slowmoPauseDone = false; slowmoPauseTime = -1;
  var slowVid = document.getElementById('slowmoVideo');
  if (slowVid) { slowVid.pause(); slowVid.removeAttribute('src'); slowVid.load(); }
  if (mediaStream) { mediaStream.getTracks().forEach(function (t) { t.stop(); }); mediaStream = null; }
  document.querySelectorAll('.club-btn').forEach(function (b) { b.classList.remove('selected'); });
  var cn = document.getElementById('btnClubNext'); if (cn) cn.disabled = true;
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
    var active = (s7 && s7.classList.contains('active')) ||
                 (s6 && s6.classList.contains('active'));
    if (active) setTimeout(startVoiceRecognition, 500);
    else setVoiceStatus('off');
  };
  voiceRecognition.onerror = function () { voiceActive = false; setVoiceStatus('off'); };
  voiceRecognition.onresult = function (e) {
    var last = e.results[e.results.length - 1];
    if (!last.isFinal) return;
    var text = last[0].transcript.trim();
    showVoiceHeard(text);
    if (text.indexOf('시작') >= 0) voiceTriggerStart();
    if (text.indexOf('다시') >= 0) voiceTriggerRedo();
  };
  try { voiceRecognition.start(); } catch (e) {}
}

function stopVoiceRecognition() {
  voiceActive = false;
  if (voiceRecognition) { try { voiceRecognition.stop(); } catch (e) {} }
  setVoiceStatus('off');
}

/* ── 음성 "시작" / "다시" 트리거 ── */
function voiceTriggerStart() {
  if (betweenState === 'wait_exit' || betweenState === 'wait_enter') {
    poseRunning = false; betweenState = 'countdown';
    setRecordGuide(''); speak('시작합니다');
    startNextSwingCountdown();
  }
}
function voiceTriggerRedo() {
  state.videoBlob = null; state.poseFrames = [];
  betweenState = 'countdown'; poseRunning = false;
  setRecordGuide(''); speak('다시 시작합니다');
  setTimeout(startNextSwingCountdown, 1500);
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
