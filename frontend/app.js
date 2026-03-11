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
}

function confirmConcern() {
  var inp = document.getElementById('concernInput');
  state.concern = inp ? inp.value.trim() : '';
  var sc = document.getElementById('summaryClub');
  var sn = document.getElementById('summaryCount');
  var sp = document.getElementById('summaryConern');
  var cr = document.getElementById('concernRow');
  if (sc) sc.textContent = state.club || '-';
  if (sn) sn.textContent = state.swingCount || '-';
  if (sp) sp.textContent = state.concern;
  if (cr) cr.style.display = state.concern ? '' : 'none';
  goStep(5);
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

function startNextSwingCountdown() {
  var phase = document.getElementById('recordPhase');
  var countdown = document.getElementById('recordCountdown');
  if (phase) phase.textContent = (currentSwingIndex + 1) + '번째 스윙 준비';
  if (countdown) countdown.textContent = '';
  var n = 5;
  var t = setInterval(function () {
    playBeep(); if (countdown) countdown.textContent = n; n--;
    if (n < 0) { clearInterval(t); if (countdown) countdown.textContent = ''; captureSwing(); }
  }, 1000);
}

function captureSwing() {
  var phase = document.getElementById('recordPhase');
  if (phase) phase.textContent = '🏌️ 스윙!';
  playBeepLong(); setRecordGuide('');

  var chunks = [];
  var mimeType = pickMimeType();
  var recorder;
  try { recorder = new MediaRecorder(mediaStream, mimeType ? { mimeType: mimeType } : {}); }
  catch (e) { recorder = new MediaRecorder(mediaStream); }

  /* ── 3장 프레임 캡처: 어드레스(0.6s), 백스윙탑(2.2s), 임팩트(4.0s) ── */
  var rawFrames = [null, null, null];
  var SNAP_TIMES = [600, 2200, 4000];
  var SNAP_LABELS = ['어드레스', '백스윙 탑', '임팩트'];

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
  setTimeout(function () { recorder.stop(); }, 8000);

  recorder.onstop = function () {
    var blob = new Blob(chunks, { type: mimeType || 'video/webm' });
    state.clips.push(blob);
    currentSwingIndex++;

    /* 캡처된 프레임에 포즈 분석 적용 후 저장 */
    analyzeFramesWithPose(rawFrames, function (analyzed) {
      state.swingFrames.push(analyzed);

      if (currentSwingIndex >= state.swingCount) {
        finishRecording();
      } else {
        betweenState = 'wait_exit'; noPersonFrames = 0;
        poseRunning = true; requestAnimationFrame(poseLoop);
        if (phase) phase.textContent = '✅ ' + currentSwingIndex + '번째 완료!';
        setRecordGuide(
          '프레임에서 나갔다가 다시 들어오면\n' +
          (currentSwingIndex + 1) + '번째 스윙이 자동 시작됩니다\n🎤 "시작" 이라고 말해도 됩니다'
        );
        speak(currentSwingIndex + '번째 완료. 나갔다 다시 들어오시면 바로 시작합니다.');
      }
    });
  };
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
      results[item.idx] = { label: item.frame.label, base64: item.frame.base64, metrics: metrics };
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

/* ================================================================
   녹화 완료
   ================================================================ */
function finishRecording() {
  poseRunning = false; betweenState = 'idle';
  if (mediaStream) mediaStream.getTracks().forEach(function (t) { t.stop(); });
  speak('모든 스윙 녹화가 완료됐습니다. AI 코칭 받기 버튼을 눌러주세요.');
  goStep(8);
  var cc = document.getElementById('clipCount');
  if (cc) cc.textContent = state.clips.length;
}

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

function showResults(data) {
  var wrap = document.getElementById('resultsWrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  var items = Array.isArray(data.results) ? data.results : Array.isArray(data) ? data : [data];
  if (!items.length) {
    wrap.innerHTML = '<div class="result-card"><h3>결과 없음</h3><p>분석 결과가 없습니다.</p></div>';
    return;
  }
  items.forEach(function (item, i) {
    var card = document.createElement('div');
    card.className = 'result-card';
    var coaching = item.coaching || item.summary || item.message || '';
    var html = '<h3>스윙 ' + (i + 1) + ' — ' + (state.club || '') + ' 코칭</h3>';
    // 마크다운 ## 섹션을 카드 내 소제목으로 렌더링
    html += '<div class="coaching-body">' + formatCoaching(coaching) + '</div>';
    card.innerHTML = html;
    wrap.appendChild(card);
  });
}

function formatCoaching(text) {
  if (!text) return '';
  return text
    .replace(/## (.+)/g, '<h4>$1</h4>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>');
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
    var s7 = document.getElementById('step7'), s6 = document.getElementById('step6');
    var active = (s7 && s7.classList.contains('active')) || (s6 && s6.classList.contains('active'));
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
