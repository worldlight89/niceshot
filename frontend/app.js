/* ================================================================
   NICESHOT – 골프 스윙 AI 코치
   영상 4초 녹화 → Gemini 분석 → 스코어카드 → 슬로모션 교정 영상
   ================================================================ */

var BACKEND = (typeof window.NICESHOT_API_URL === 'string' && window.NICESHOT_API_URL)
  ? window.NICESHOT_API_URL
  : 'http://localhost:8002';

var CLUBS = [
  '드라이버', '페어웨이우드', '롱아이언',
  '미들아이언', '숏아이언', '웨지', '퍼터'
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

/* ── 자동 줌 ── */
var autoZoomScale = 1;
var autoZoomX = 50;
var autoZoomY = 50;
var zoomFrameCount = 0;

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

  /* 자동 줌 (세팅 + 녹화 모두) */
  if (hasBody) updateAutoZoom(lms);

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
      playCameraReadyBeep();
      speak('카메라 준비 완료. ' + getClubLabel() + ' 모드입니다.');
      setCamStatus(getClubLabel() + ' — 곧 시작합니다');
      setTimeout(kickoffFirstSwing, 4000);
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

/* ── 자동 줌 ── */
function updateAutoZoom(lms) {
  zoomFrameCount++;
  if (zoomFrameCount % 3 !== 0) return;

  var visibleLms = [];
  for (var i = 0; i < lms.length; i++) {
    if (lms[i] && (lms[i].visibility || 0) > 0.3) visibleLms.push(lms[i]);
  }
  if (visibleLms.length < 10) return;

  var minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (var j = 0; j < visibleLms.length; j++) {
    if (visibleLms[j].x < minX) minX = visibleLms[j].x;
    if (visibleLms[j].x > maxX) maxX = visibleLms[j].x;
    if (visibleLms[j].y < minY) minY = visibleLms[j].y;
    if (visibleLms[j].y > maxY) maxY = visibleLms[j].y;
  }

  var bodyW = maxX - minX;
  var bodyH = maxY - minY;
  if (bodyW < 0.05 || bodyH < 0.05) return;

  var targetFill = 0.75;
  var scaleX = targetFill / bodyW;
  var scaleY = targetFill / bodyH;
  var newScale = Math.min(scaleX, scaleY);
  newScale = Math.max(1.0, Math.min(2.5, newScale));

  var centerX = (minX + maxX) / 2 * 100;
  var centerY = (minY + maxY) / 2 * 100;

  var smooth = 0.3;
  autoZoomScale += (newScale - autoZoomScale) * smooth;
  autoZoomX += (centerX - autoZoomX) * smooth;
  autoZoomY += (centerY - autoZoomY) * smooth;

  var vid = getActiveVideo();
  if (vid) {
    vid.style.transformOrigin = autoZoomX.toFixed(1) + '% ' + autoZoomY.toFixed(1) + '%';
    vid.style.transform = 'scale(' + autoZoomScale.toFixed(3) + ')';
  }
}

function resetAutoZoom() {
  autoZoomScale = 1;
  autoZoomX = 50;
  autoZoomY = 50;
  zoomFrameCount = 0;
  var preview = document.getElementById('previewVideo');
  var record = document.getElementById('recordVideo');
  if (preview) { preview.style.transform = ''; preview.style.transformOrigin = ''; }
  if (record) { record.style.transform = ''; record.style.transformOrigin = ''; }
}

/* ================================================================
   녹화 흐름
   ================================================================ */
function kickoffFirstSwing() {
  goStep(7);
  var recVid = document.getElementById('recordVideo');
  if (recVid && mediaStream) {
    recVid.srcObject = mediaStream;
    recVid.play();
    recVid.style.transformOrigin = autoZoomX.toFixed(1) + '% ' + autoZoomY.toFixed(1) + '%';
    recVid.style.transform = 'scale(' + autoZoomScale.toFixed(3) + ')';
  }
  var lbl = document.getElementById('clubLabel');
  if (lbl) lbl.textContent = getClubLabel();
  startVoiceRecognition();
  startNextSwingCountdown();
}

var KO_COUNTS = ['다섯', '넷', '셋', '둘', '하나'];

var CLUB_DISPLAY_LABELS = {
  '드라이버': '드라이버 스윙',
  '페어웨이우드': '페어웨이우드 스윙',
  '롱아이언': '롱아이언 스윙',
  '미들아이언': '미들아이언 스윙',
  '숏아이언': '숏아이언 스윙',
  '웨지': '웨지 스윙',
  '퍼터': '퍼터 스트로크'
};

function getClubLabel() {
  if (!state.club) return '';
  return CLUB_DISPLAY_LABELS[state.club] || state.club + ' 스윙';
}

function startNextSwingCountdown() {
  var phase = document.getElementById('recordPhase');
  var countdown = document.getElementById('recordCountdown');
  if (phase) phase.textContent = '스윙 준비';
  if (countdown) countdown.textContent = '';

  speak('준비');
  playBeepOk();

  setTimeout(function () {
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
        speak('스윙');
        setTimeout(captureSwing, 600);
      }
    }, 1000);
  }, 1200);
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
    playRecordEndSound();
    if (phase) phase.textContent = '녹화 완료';
    setTimeout(function () {
      speak('스윙 완료. 분석을 시작합니다.');
      uploadAndAnalyze();
    }, 800);
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

  var nose = pt(0);
  var headHeight = Math.round((1 - nose.y) * 100);

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
    머리높이_pct: headHeight,
    손목_어깨위_여부: rWristHeight > shoulderHeight ? '손목이 어깨 위' : '손목이 어깨 아래'
  };
}

/* ── 실제 포즈 데이터에서 스윙 구간 자동 감지 ── */
var detectedPhases = null;

function detectSwingPhases() {
  if (state.poseFrames.length < 10) return null;

  var club = state.club || '';
  var isShort = (club === '웨지' || club === '퍼터' || club === '숏아이언');
  var isPutter = (club === '퍼터');
  var riseThresh = isPutter ? 0.02 : isShort ? 0.04 : 0.06;

  var frames = [];
  for (var i = 0; i < state.poseFrames.length; i++) {
    var lms = state.poseFrames[i].landmarks;
    if (!lms || lms.length < 29) continue;
    var lSho = lms[11], rSho = lms[12];
    var lWri = lms[15], rWri = lms[16];
    var lHip = lms[23], rHip = lms[24];
    var lElb = lms[13], rElb = lms[14];
    var lWH = 1 - lWri.y, rWH = 1 - rWri.y;
    frames.push({
      time: state.poseFrames[i].time,
      wristH: Math.max(lWH, rWH),
      shoTilt: Math.atan2(rSho.y - lSho.y, rSho.x - lSho.x) * 180 / Math.PI,
      hipTilt: Math.atan2(rHip.y - lHip.y, rHip.x - lHip.x) * 180 / Math.PI,
      xFactor: Math.abs(Math.atan2(rSho.y - lSho.y, rSho.x - lSho.x) - Math.atan2(rHip.y - lHip.y, rHip.x - lHip.x)) * 180 / Math.PI,
      rArm: _angleDeg3(rSho, rElb, rWri),
      hipX: (lHip.x + rHip.x) / 2
    });
  }
  if (frames.length < 10) return null;

  function smoothN(arr, key, n) {
    var half = Math.floor(n / 2), out = [];
    for (var i = 0; i < arr.length; i++) {
      var s = Math.max(0, i - half), e = Math.min(arr.length - 1, i + half);
      var sum = 0, cnt = 0;
      for (var j = s; j <= e; j++) { sum += arr[j][key]; cnt++; }
      out.push(sum / cnt);
    }
    return out;
  }
  var sWrist = smoothN(frames, 'wristH', 7);
  var sHipX  = smoothN(frames, 'hipX', 5);
  var sRArm  = smoothN(frames, 'rArm', 5);
  var N = frames.length;
  var totalTime = frames[N - 1].time;
  var baseH = sWrist[0];

  /*
   * Golf swing wrist-height curve:
   *   LOW(address) → rises(takeaway/backswing) → PEAK#1(backswing top)
   *   → drops fast(downswing) → LOW(impact) → rises(follow-through)
   *   → PEAK#2(follow-through top) → drops(finish)
   *
   * KEY FIX: Find peaks/valleys via velocity zero-crossings,
   * not global max/min which confuses backswing with follow-through.
   */

  /* velocity of wrist height (smoothed) */
  var vel = [0];
  for (var i = 1; i < N; i++) vel.push(sWrist[i] - sWrist[i - 1]);
  /* smooth velocity to reduce noise */
  var sVel = [];
  for (var i = 0; i < N; i++) {
    var vs = Math.max(0, i - 2), ve = Math.min(N - 1, i + 2);
    var vsum = 0, vcnt = 0;
    for (var j = vs; j <= ve; j++) { vsum += vel[j]; vcnt++; }
    sVel.push(vsum / vcnt);
  }

  /* find peaks (velocity + → −) and valleys (velocity − → +) */
  var peaks = [], valleys = [];
  for (var i = 2; i < N - 2; i++) {
    if (sVel[i - 1] > 0.001 && sVel[i + 1] < -0.001 && sWrist[i] > baseH + riseThresh) {
      peaks.push(i);
    }
    if (sVel[i - 1] < -0.001 && sVel[i + 1] > 0.001) {
      valleys.push(i);
    }
  }

  /*
   * BACKSWING TOP = first significant peak
   * If no peaks found via velocity, fallback to max in first 65% of frames
   */
  var bsTopIdx;
  if (peaks.length > 0) {
    bsTopIdx = peaks[0];
  } else {
    var searchLim = Math.round(N * 0.65);
    bsTopIdx = 0;
    for (var i = 1; i < searchLim; i++) {
      if (sWrist[i] > sWrist[bsTopIdx]) bsTopIdx = i;
    }
  }

  /* extra guard: if bsTopIdx is past 75% of frames, it's likely follow-through */
  if (bsTopIdx > N * 0.75) {
    var earlyMax = 0;
    for (var i = 1; i < Math.round(N * 0.6); i++) {
      if (sWrist[i] > sWrist[earlyMax]) earlyMax = i;
    }
    if (sWrist[earlyMax] > baseH + riseThresh * 0.5) bsTopIdx = earlyMax;
  }
  var bsTopTime = frames[bsTopIdx].time;

  /*
   * IMPACT = first significant valley AFTER backswing top
   * Search only in a limited window (not to the end of the video!)
   * Typical downswing takes 0.2−0.5s → search up to 30% of total frames
   */
  var impactIdx = -1;
  for (var i = 0; i < valleys.length; i++) {
    if (valleys[i] > bsTopIdx) { impactIdx = valleys[i]; break; }
  }
  if (impactIdx < 0) {
    var impSearchEnd = Math.min(bsTopIdx + Math.round(N * 0.3), N);
    impactIdx = bsTopIdx;
    for (var i = bsTopIdx + 1; i < impSearchEnd; i++) {
      if (sWrist[i] < sWrist[impactIdx]) impactIdx = i;
    }
  }
  if (impactIdx <= bsTopIdx) {
    impactIdx = Math.min(bsTopIdx + Math.round(N * 0.15), N - 1);
  }
  var impactTime = frames[impactIdx].time;

  /*
   * FOLLOW-THROUGH PEAK = next peak after impact
   */
  var followPeakIdx = impactIdx;
  for (var i = 0; i < peaks.length; i++) {
    if (peaks[i] > impactIdx) { followPeakIdx = peaks[i]; break; }
  }
  if (followPeakIdx <= impactIdx) {
    for (var i = impactIdx + 1; i < N; i++) {
      if (sWrist[i] > sWrist[followPeakIdx]) followPeakIdx = i;
    }
  }
  var followPeakTime = frames[followPeakIdx].time;
  if (followPeakTime <= impactTime + 0.05) {
    followPeakTime = impactTime + (totalTime - impactTime) * 0.45;
  }

  /* ADDRESS END: wrist starts rising above baseline */
  var addressEndIdx = 0;
  for (var i = 1; i < bsTopIdx; i++) {
    if (sWrist[i] > baseH + riseThresh) {
      addressEndIdx = Math.max(0, i - 1);
      break;
    }
  }
  var addressTime = frames[0].time;

  /* TAKEAWAY END: wrist reaches 30-40% of the way to backswing top */
  var wristRange = sWrist[bsTopIdx] - baseH;
  var takeRatio = isPutter ? 0.3 : isShort ? 0.35 : 0.4;
  var takeThresh = baseH + wristRange * takeRatio;
  var takeEndIdx = addressEndIdx;
  for (var i = addressEndIdx; i < bsTopIdx; i++) {
    if (sWrist[i] >= takeThresh) { takeEndIdx = i; break; }
  }
  if (takeEndIdx <= addressEndIdx) {
    takeEndIdx = addressEndIdx + Math.round((bsTopIdx - addressEndIdx) * 0.4);
  }
  takeEndIdx = Math.min(takeEndIdx, Math.max(0, bsTopIdx - 1));
  var takeawayStartTime = frames[Math.max(0, addressEndIdx)].time;
  var takeEndTime = frames[takeEndIdx].time;

  /* DOWNSWING START: right after backswing top, hip leads or arm unfolds */
  var downStartIdx = bsTopIdx + 1;
  if (bsTopIdx + 2 < impactIdx) {
    var bsHipX = sHipX[bsTopIdx];
    for (var i = bsTopIdx + 1; i < impactIdx; i++) {
      var hipShift = Math.abs(sHipX[i] - bsHipX);
      var armChange = sRArm[bsTopIdx] - sRArm[i];
      if (hipShift > 0.01 || armChange > 8) { downStartIdx = i; break; }
    }
  }
  downStartIdx = Math.min(downStartIdx, N - 1);
  var downStartTime = frames[downStartIdx].time;

  /* FINISH START: after follow-through peak, wrist drops */
  var finishIdx = followPeakIdx;
  for (var i = followPeakIdx + 1; i < N; i++) {
    if (sWrist[i] < sWrist[followPeakIdx] - 0.02) { finishIdx = i; break; }
  }
  finishIdx = Math.min(finishIdx, N - 1);
  var finishTime = frames[finishIdx].time;
  if (finishTime <= followPeakTime) finishTime = followPeakTime + 0.1;
  finishTime = Math.min(finishTime, totalTime);

  /* Build pause times for each of the 7 phases */
  var pauseAt = [
    addressTime + 0.05,
    takeawayStartTime + (takeEndTime - takeawayStartTime) * 0.5,
    bsTopTime,
    downStartTime + (impactTime - downStartTime) * 0.4,
    impactTime,
    impactTime + (followPeakTime - impactTime) * 0.55,
    finishTime + (totalTime - finishTime) * 0.35
  ];

  /* Ensure strictly increasing with minimum 0.08s gap */
  var MIN_GAP = 0.08;
  for (var p = 0; p < pauseAt.length; p++) {
    pauseAt[p] = Math.max(0.03, Math.min(pauseAt[p], totalTime - 0.03));
  }
  for (var p = 1; p < pauseAt.length; p++) {
    if (pauseAt[p] <= pauseAt[p - 1] + MIN_GAP) {
      pauseAt[p] = pauseAt[p - 1] + MIN_GAP;
    }
  }
  if (pauseAt[pauseAt.length - 1] > totalTime - 0.03) {
    pauseAt[pauseAt.length - 1] = totalTime - 0.03;
  }

  /* Build boundary times (also strictly increasing) */
  var bTake = Math.max(takeawayStartTime, addressTime + MIN_GAP);
  var bTakeEnd = Math.max(takeEndTime, bTake + MIN_GAP);
  var bDown = Math.max(downStartTime, bTakeEnd + MIN_GAP);
  var bImpS = Math.max(impactTime - 0.03, bDown + MIN_GAP);
  var bImpE = bImpS + 0.06;
  var bFinish = Math.max(finishTime, bImpE + MIN_GAP);

  var result = {
    ranges: [
      { key: 'address',       label: '어드레스',    start: 0,       end: bTake },
      { key: 'takeaway',      label: '테이크어웨이', start: bTake,   end: bTakeEnd },
      { key: 'backswing',     label: '백스윙',      start: bTakeEnd, end: bDown },
      { key: 'downswing',     label: '다운스윙',    start: bDown,    end: bImpS },
      { key: 'impact',        label: '임팩트',      start: bImpS,    end: bImpE },
      { key: 'followthrough', label: '팔로우스루',  start: bImpE,    end: bFinish },
      { key: 'finish',        label: '피니시',      start: bFinish,  end: totalTime }
    ],
    keyTimes: {
      address: pauseAt[0], takeaway: pauseAt[1], backswing: bsTopTime,
      downswing: pauseAt[3], impact: impactTime,
      followthrough: pauseAt[5], finish: pauseAt[6]
    },
    pauseAt: pauseAt
  };

  console.log('[Phase Detection] club:', club,
    'peaks:', peaks.length, 'valleys:', valleys.length,
    'bsTopIdx:', bsTopIdx, '(' + (bsTopIdx / N * 100).toFixed(0) + '%)',
    'impactIdx:', impactIdx, '(' + (impactIdx / N * 100).toFixed(0) + '%)',
    'followIdx:', followPeakIdx, '(' + (followPeakIdx / N * 100).toFixed(0) + '%)');
  console.log('[Phase Times]',
    'addr:', addressTime.toFixed(2), 'take:', bTake.toFixed(2),
    'bsTop:', bsTopTime.toFixed(2), 'down:', bDown.toFixed(2),
    'impact:', impactTime.toFixed(2), 'follow:', followPeakTime.toFixed(2),
    'finish:', finishTime.toFixed(2), 'total:', totalTime.toFixed(2));
  console.log('[PauseAt]', pauseAt.map(function(t){return t.toFixed(2)}).join(', '));

  return result;
}

function _angleDeg3(a, b, c) {
  var ab = { x: a.x - b.x, y: a.y - b.y };
  var cb = { x: c.x - b.x, y: c.y - b.y };
  var dot = ab.x * cb.x + ab.y * cb.y;
  var mag = Math.sqrt(ab.x * ab.x + ab.y * ab.y) * Math.sqrt(cb.x * cb.x + cb.y * cb.y);
  if (mag === 0) return 0;
  return Math.round(Math.acos(Math.min(1, Math.max(-1, dot / mag))) * 180 / Math.PI);
}

/* ── 저장된 포즈 프레임에서 7개 구간 메트릭 추출 ── */
function extractMetricsFromPoseFrames() {
  detectedPhases = detectSwingPhases();
  var defaultTimes = {
    address: 0.2, takeaway: 0.6, backswing: 1.2,
    downswing: 1.6, impact: 2.0,
    followthrough: 2.6, finish: 3.2
  };
  var keyTimes = detectedPhases ? detectedPhases.keyTimes : defaultTimes;

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
  address: '어드레스', takeaway: '테이크어웨이', backswing: '백스윙',
  downswing: '다운스윙', impact: '임팩트', followthrough: '팔로우스루', finish: '피니시'
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

  console.log('[ScoreCard] coaching:', coaching ? 'OK' : 'null',
    'score:', coaching && coaching.score,
    'faults:', coaching && coaching.faults ? coaching.faults.length : 0,
    'problems:', coaching && coaching.problems ? coaching.problems.length : 0);

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
var DEFAULT_PHASE_RANGES = [
  { key: 'address',       label: '어드레스',    start: 0,    end: 0.5 },
  { key: 'takeaway',      label: '테이크어웨이', start: 0.5,  end: 1.0 },
  { key: 'backswing',     label: '백스윙',      start: 1.0,  end: 1.5 },
  { key: 'downswing',     label: '다운스윙',    start: 1.5,  end: 2.0 },
  { key: 'impact',        label: '임팩트',      start: 2.0,  end: 2.5 },
  { key: 'followthrough', label: '팔로우스루',  start: 2.5,  end: 3.2 },
  { key: 'finish',        label: '피니시',      start: 3.2,  end: 4.0 }
];

function getPhaseRanges() {
  return (detectedPhases && detectedPhases.ranges) ? detectedPhases.ranges : DEFAULT_PHASE_RANGES;
}

var slowmoPhaseIdx = 0;
var slowmoPaused = false;
var slowmoTapBound = false;
var slowmoPhaseStops = [];

var ISSUE_COLORS = ['#FF4444', '#FFD700', '#2ECC71'];

function buildPhaseStops() {
  var stops = [];
  var ranges = getPhaseRanges();
  var pauseTimes = detectedPhases ? detectedPhases.pauseAt : null;

  var phaseGrades = (state.analysisResult && state.analysisResult.phase_grades) || {};
  var corrections = (state.analysisResult && state.analysisResult.corrections) || {};
  var faults = (state.analysisResult && state.analysisResult.faults) || [];

  console.log('[buildPhaseStops] faults:', faults.length, 'phaseGrades:', Object.keys(phaseGrades));

  /* group ALL faults by phase, sorted by deduction within each phase */
  var phaseFaultMap = {};
  for (var i = 0; i < faults.length; i++) {
    var f = faults[i];
    var pk = f.phase;
    if (!phaseFaultMap[pk]) phaseFaultMap[pk] = [];
    phaseFaultMap[pk].push(f);
  }
  for (var pk in phaseFaultMap) {
    phaseFaultMap[pk].sort(function (a, b) { return b.deduction - a.deduction; });
  }

  for (var r = 0; r < ranges.length; r++) {
    var range = ranges[r];
    var phaseKey = range.key;
    var pauseTime = pauseTimes ? pauseTimes[r] : (range.start + range.end) / 2;

    var grade = phaseGrades[phaseKey] || 'good';
    var phaseFaults = (phaseFaultMap[phaseKey] || []).slice(0, 3);

    var issues = [];
    var pc = corrections[phaseKey] || [];

    for (var fi = 0; fi < phaseFaults.length; fi++) {
      var fault = phaseFaults[fi];
      var jointIdx = fault.joint_idx;
      var joints = {};
      joints[jointIdx] = true;
      for (var ci = 0; ci < pc.length; ci++) {
        if (pc[ci].joint_idx === jointIdx) {
          if (pc[ci].vertex_idx !== undefined) joints[pc[ci].vertex_idx] = true;
          if (pc[ci].anchor_idx !== undefined) joints[pc[ci].anchor_idx] = true;
          if (pc[ci].endpoint_idx !== undefined) joints[pc[ci].endpoint_idx] = true;
        }
      }
      issues.push({
        color: ISSUE_COLORS[fi],
        description: fault.friendly_ko || fault.label_ko || '',
        joints: joints,
        jointIdx: jointIdx
      });
    }

    stops.push({
      idx: r + 1,
      time: pauseTime,
      phaseKey: phaseKey,
      phaseLabel: range.label,
      grade: grade,
      issues: issues,
      hasProblems: issues.length > 0
    });
  }

  return stops;
}

function showSlowmoPlayer() {
  goStep(10);
  var video = document.getElementById('slowmoVideo');
  var canvas = document.getElementById('slowmoCanvas');
  if (!video || !canvas || !state.videoBlob) return;

  if (!detectedPhases) detectedPhases = detectSwingPhases();

  video.src = URL.createObjectURL(state.videoBlob);
  video.playbackRate = 0.25;
  video.muted = true;

  slowmoPhaseStops = buildPhaseStops();
  slowmoPhaseIdx = 0;
  slowmoPaused = false;

  buildPhaseDots();

  video.onloadedmetadata = function () {
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 360;
    video.play();
    startSlowmoOverlay();
  };
  video.onplay = function () {
    setTapHint(false);
    startSlowmoOverlay();
  };
  video.onended = function () {
    if (slowmoAnimId) { cancelAnimationFrame(slowmoAnimId); slowmoAnimId = null; }
    showAnnotation('', '', '', 'done');
    setTapHint(false);
    var badge = document.getElementById('phaseBadge');
    if (badge) badge.textContent = '';
  };

  if (!slowmoTapBound) {
    slowmoTapBound = true;
    var tapArea = document.getElementById('slowmoTapArea');
    if (tapArea) {
      tapArea.addEventListener('click', handleSlowmoTap);
      tapArea.addEventListener('touchend', function (e) {
        e.preventDefault();
        handleSlowmoTap();
      });
    }
  }
}

function handleSlowmoTap() {
  var video = document.getElementById('slowmoVideo');
  if (!video) return;

  if (video.ended) {
    video.currentTime = 0;
    slowmoPhaseIdx = 0;
    slowmoPaused = false;
    clearAnnotation();
    video.play();
    return;
  }

  if (slowmoPaused) {
    slowmoPaused = false;
    slowmoPhaseIdx++;
    clearAnnotation();
    video.play();
  } else if (!video.paused) {
    video.pause();
    setTapHint(false);
  } else {
    video.play();
  }
}

function buildPhaseDots() {
  var dotsEl = document.getElementById('phaseDots');
  if (!dotsEl) return;
  dotsEl.innerHTML = '';
  var ranges = getPhaseRanges();
  var totalTime = ranges[ranges.length - 1].end || 4.0;

  for (var i = 0; i < slowmoPhaseStops.length; i++) {
    var stop = slowmoPhaseStops[i];
    var dot = document.createElement('div');
    var cls = 'phase-dot';
    if (stop.hasProblems) cls += ' has-problem';
    dot.className = cls;
    dot.style.left = (stop.time / totalTime * 100) + '%';
    dot.setAttribute('data-idx', i);
    dot.setAttribute('title', stop.phaseLabel);
    dotsEl.appendChild(dot);
  }
}

function updatePhaseDots(currentIdx) {
  var dots = document.querySelectorAll('.phase-dot');
  for (var i = 0; i < dots.length; i++) {
    var idx = parseInt(dots[i].getAttribute('data-idx'));
    var base = 'phase-dot';
    if (slowmoPhaseStops[idx] && slowmoPhaseStops[idx].hasProblems) base += ' has-problem';
    dots[i].className = base + (idx === currentIdx ? ' active' : idx < currentIdx ? ' done' : '');
  }
}

function setTapHint(show) {
  var el = document.getElementById('tapHint');
  if (el) el.className = show ? 'tap-hint visible' : 'tap-hint';
}

function updateTimelineUI(video) {
  if (!video || !video.duration) return;
  var pct = (video.currentTime / video.duration * 100);
  var progress = document.getElementById('timelineProgress');
  if (progress) progress.style.width = pct + '%';
}

function getCurrentPhase(time) {
  var ranges = getPhaseRanges();
  for (var i = 0; i < ranges.length; i++) {
    if (time >= ranges[i].start && time < ranges[i].end) return { idx: i, data: ranges[i] };
  }
  return { idx: ranges.length - 1, data: ranges[ranges.length - 1] };
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

function showAnnotation(num, phaseLabel, desc, type) {
  var el = document.getElementById('slowmoAnnotation');
  if (!el) return;
  if (type === 'done') {
    el.innerHTML = '<div class="annotation-ok">✅ 분석 완료</div>';
  } else {
    el.innerHTML = '';
  }
}
function clearAnnotation() {
  var el = document.getElementById('slowmoAnnotation');
  if (el) el.innerHTML = '';
}

function startSlowmoOverlay() {
  var video = document.getElementById('slowmoVideo');
  var canvas = document.getElementById('slowmoCanvas');
  if (!video || !canvas) return;
  var ctx = canvas.getContext('2d');

  function drawFrame() {
    if (video.paused || video.ended) { slowmoAnimId = null; return; }

    var t = video.currentTime;
    var phaseInfo = getCurrentPhase(t);
    var phaseData = phaseInfo.data;
    var poseFrame = findClosestPoseFrame(t);

    updateTimelineUI(video);

    var badge = document.getElementById('phaseBadge');
    if (badge) badge.textContent = phaseData.label;
    var indicator = document.getElementById('phaseIndicator');
    if (indicator) {
      indicator.textContent = (slowmoPhaseIdx + 1) + ' / ' + slowmoPhaseStops.length;
    }

    if (slowmoPhaseIdx < slowmoPhaseStops.length && !slowmoPaused) {
      var stop = slowmoPhaseStops[slowmoPhaseIdx];
      if (t >= stop.time) {
        slowmoPaused = true;
        video.pause();

        updatePhaseDots(slowmoPhaseIdx);
        clearAnnotation();
        drawOverlayFrame(ctx, canvas, video, poseFrame, phaseData, stop);

        setTapHint(true);
        slowmoAnimId = null;
        return;
      }
    }

    drawOverlayFrame(ctx, canvas, video, poseFrame, phaseData, null);
    slowmoAnimId = requestAnimationFrame(drawFrame);
  }

  if (slowmoAnimId) cancelAnimationFrame(slowmoAnimId);
  slowmoAnimId = requestAnimationFrame(drawFrame);
}

function drawOverlayFrame(ctx, canvas, video, poseFrame, phase, stopInfo) {
  var w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  updateTimelineUI(video);

  if (!poseFrame || !poseFrame.landmarks) return;
  var lms = poseFrame.landmarks;
  var DOT_R = Math.max(4, w * 0.01);

  /* build joint→color map from issues */
  var jointColorMap = {};
  var issues = (stopInfo && stopInfo.issues) || [];
  for (var ii = 0; ii < issues.length; ii++) {
    var iss = issues[ii];
    for (var jk in iss.joints) {
      if (!jointColorMap[jk]) jointColorMap[jk] = iss.color;
    }
  }
  var hasHL = false;
  for (var k in jointColorMap) { hasHL = true; break; }

  /* skeleton lines */
  for (var ci = 0; ci < POSE_CONNECTIONS.length; ci++) {
    var conn = POSE_CONNECTIONS[ci];
    var a = lms[conn[0]], b = lms[conn[1]];
    if (!a || !b || a.visibility < 0.3 || b.visibility < 0.3) continue;

    var lineColor = null;
    if (hasHL) {
      if (jointColorMap[conn[0]]) lineColor = jointColorMap[conn[0]];
      else if (jointColorMap[conn[1]]) lineColor = jointColorMap[conn[1]];
    }
    ctx.beginPath();
    ctx.moveTo(a.x * w, a.y * h);
    ctx.lineTo(b.x * w, b.y * h);
    ctx.lineWidth = lineColor ? Math.max(4, w * 0.008) : Math.max(2, w * 0.005);
    ctx.strokeStyle = lineColor ? lineColor + 'D9' : 'rgba(255,255,255,0.35)';
    ctx.stroke();
  }

  /* joint dots */
  for (var li = 0; li < lms.length; li++) {
    var lm = lms[li];
    if (!lm || lm.visibility < 0.25) continue;
    var jColor = jointColorMap[li];
    ctx.beginPath();
    ctx.arc(lm.x * w, lm.y * h, jColor ? DOT_R * 1.6 : DOT_R, 0, Math.PI * 2);
    ctx.fillStyle = jColor || 'rgba(255,255,255,0.5)';
    ctx.fill();
  }

  /* highlight rings on problem joints with their color */
  if (hasHL) {
    for (var ii = 0; ii < issues.length; ii++) {
      var iss = issues[ii];
      var mainIdx = iss.jointIdx;
      if (mainIdx === undefined || !lms[mainIdx] || lms[mainIdx].visibility < 0.2) continue;
      var hj = lms[mainIdx];
      var cx = hj.x * w, cy = hj.y * h;
      var R = Math.max(18, w * 0.045);

      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = iss.color;
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = iss.color + '20';
      ctx.fill();
    }
  }

  /* draw phase info ON the canvas when paused */
  if (!stopInfo) return;

  var fontSize = Math.max(12, Math.round(w * 0.028));
  var padding = Math.round(fontSize * 0.5);
  var lineH = fontSize * 1.3;
  var numR = Math.round(fontSize * 0.75);
  var isGood = !stopInfo.hasProblems;
  var accentColor = isGood ? '#27ae60' : '#e74c3c';

  var bx = w * 0.03;
  var by = h * 0.04;

  /* phase number + label */
  var numCx = bx + numR;
  var numCy = by + numR;
  ctx.beginPath();
  ctx.arc(numCx, numCy, numR, 0, Math.PI * 2);
  ctx.fillStyle = accentColor;
  ctx.fill();
  ctx.font = 'bold ' + Math.round(fontSize * 0.85) + 'px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('' + stopInfo.idx, numCx, numCy);

  var plFont = Math.round(fontSize * 0.75);
  ctx.font = 'bold ' + plFont + 'px sans-serif';
  var labelText = stopInfo.phaseLabel;
  var plW = ctx.measureText(labelText).width + plFont;
  var plH = plFont * 1.6;
  var plX = numCx + numR + 6;
  var plY = numCy - plH / 2;
  ctx.fillStyle = accentColor + '40';
  roundRect(ctx, plX, plY, plW, plH, plH / 2);
  ctx.fill();
  ctx.fillStyle = accentColor;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelText, plX + plFont * 0.4, numCy);

  /* issues list or "good" */
  var listY = numCy + numR + 6;

  if (isGood) {
    ctx.font = 'bold ' + fontSize + 'px sans-serif';
    var goodText = '✓ 좋습니다';
    var gw = ctx.measureText(goodText).width + padding * 2;
    var gh = lineH + padding;
    ctx.fillStyle = 'rgba(39,174,96,0.25)';
    roundRect(ctx, bx, listY, gw, gh, fontSize * 0.35);
    ctx.fill();
    ctx.fillStyle = '#27ae60';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(goodText, bx + padding, listY + padding * 0.35);
    return;
  }

  /* draw each issue as a colored card */
  var maxTextW = w * 0.52;
  ctx.font = fontSize + 'px sans-serif';
  var cardY = listY;

  for (var ii = 0; ii < issues.length; ii++) {
    var iss = issues[ii];
    var color = iss.color;
    var text = iss.description;

    ctx.font = fontSize + 'px sans-serif';
    var lines = wrapText(ctx, text, maxTextW - padding * 2 - fontSize);
    if (lines.length > 2) lines = lines.slice(0, 2);
    var cardH = lines.length * lineH + padding;

    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    roundRect(ctx, bx, cardY, maxTextW, cardH, fontSize * 0.3);
    ctx.fill();

    ctx.fillStyle = color;
    roundRect(ctx, bx, cardY, 4, cardH, 2);
    ctx.fill();

    var dotR = fontSize * 0.35;
    var dotCx = bx + padding + dotR;
    var dotCy = cardY + cardH / 2;
    if (lines.length > 1) dotCy = cardY + lineH * 0.5 + padding * 0.3;
    ctx.beginPath();
    ctx.arc(dotCx, dotCy, dotR, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (var li = 0; li < lines.length; li++) {
      ctx.fillText(lines[li], dotCx + dotR + 6, cardY + padding * 0.3 + li * lineH);
    }

    cardY += cardH + 4;
  }
}

function wrapText(ctx, text, maxW) {
  var words = text.split('');
  var lines = [];
  var line = '';
  for (var i = 0; i < words.length; i++) {
    var test = line + words[i];
    if (ctx.measureText(test).width > maxW && line.length > 0) {
      lines.push(line);
      line = words[i];
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/* ================================================================
   리셋
   ================================================================ */
function resetAll() {
  stopVoiceRecognition();
  resetAutoZoom();
  state.club = null; state.concern = '';
  state.videoBlob = null; state.poseFrames = [];
  state.analysisResult = null;
  state.isRecording = false;
  detectedPhases = null;
  poseRunning = false; okFrames = 0;
  setupDone = false; betweenState = 'idle'; noPersonFrames = 0;
  if (slowmoAnimId) { cancelAnimationFrame(slowmoAnimId); slowmoAnimId = null; }
  slowmoPaused = false; slowmoPhaseIdx = 0; slowmoPhaseStops = [];
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
function playRecordEndSound() {
  try {
    var C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    var ctx = new C();
    [880, 660, 440].forEach(function (f, i) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      var t = ctx.currentTime + i * 0.15;
      g.gain.setValueAtTime(0.35, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.start(t); o.stop(t + 0.28);
    });
    setTimeout(function () { ctx.close(); }, 1000);
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
