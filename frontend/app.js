/* ================================================================
   NICESHOT – 골프 스윙 AI 코치
   혼자 사용 최적화:
   ① 포즈 자동감지 → 자동 카운트다운 → 녹화
   ② 스윙 사이: 프레임 이탈 후 재진입 시 자동 시작
   ③ 음성 명령: "시작" "다시"
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
  clips: []
};

var mediaStream = null;
var currentSwingIndex = 0;

/* ── 포즈 관련 ── */
var poseDetector = null;
var poseRunning = false;
var okFrames = 0;
var setupDone = false;

/* ── 스윙 사이 상태 ── */
// 'idle' | 'wait_exit' | 'wait_enter' | 'countdown'
var betweenState = 'idle';
var noPersonFrames = 0;
var betweenCountTimer = null;

/* ================================================================
   단계 전환
   ================================================================ */
function goStep(n) {
  document.querySelectorAll('.step').forEach(function (el) {
    el.classList.remove('active');
  });
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
    btn.type = 'button';
    btn.className = 'club-btn';
    btn.textContent = club;
    btn.onclick = function () {
      document.querySelectorAll('.club-btn').forEach(function (b) { b.classList.remove('selected'); });
      btn.classList.add('selected');
      state.club = club;
      var next = document.getElementById('btnClubNext');
      if (next) next.disabled = false;
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
  var next = document.getElementById('btnCountNext');
  if (next) next.disabled = false;
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
  state.clips = [];
  currentSwingIndex = 0;
  poseRunning = false;
  okFrames = 0;
  setupDone = false;
  betweenState = 'idle';
  goStep(6);
  updateCamMsg('tip', '📱 폰을 1.5~2m 앞에 세우고, 전신이 화면에 들어오게 서주세요');
  openCamera();
  startVoiceRecognition();
}

function openCamera() {
  setCamStatus('카메라 켜는 중...');
  navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false
  }).then(function (stream) {
    mediaStream = stream;
    var vid = document.getElementById('previewVideo');
    if (vid) { vid.srcObject = stream; vid.play(); }
    setCamStatus('🧍 전신이 프레임 안에 들어오면 자동으로 시작됩니다');
    setTimeout(initPose, 800);
  }).catch(function (err) {
    setCamStatus('카메라 오류: ' + err.message);
  });
}

/* ── 포즈 초기화 ── */
function initPose() {
  if (typeof Pose === 'undefined') {
    setCamStatus('⚠️ MediaPipe 로딩 실패 — 10초 후 자동 시작');
    setTimeout(function () { kickoffFirstSwing(); }, 10000);
    return;
  }
  if (!poseDetector) {
    poseDetector = new Pose({
      locateFile: function (f) {
        return 'https://cdn.jsdelivr.net/npm/@mediapipe/pose/' + f;
      }
    });
    poseDetector.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      minDetectionConfidence: 0.55,
      minTrackingConfidence: 0.55
    });
    poseDetector.onResults(onPoseResult);
  }
  poseRunning = true;
  okFrames = 0;
  setupDone = false;
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

  /* ── 세팅 단계 (step6) ── */
  if (!setupDone) {
    var pill = document.getElementById('framePill');
    if (!inFrame) {
      okFrames = 0;
      if (pill) pill.textContent = '전신이 프레임 안에 들어오게 서주세요';
      return;
    }
    okFrames++;
    if (pill) pill.textContent = '✅ 좋아요! 자세 유지... (' + okFrames + '/8)';
    if (okFrames >= 8) {
      setupDone = true;
      poseRunning = false;
      if (pill) pill.textContent = '👍 세팅 완벽!';
      playBeepOk();
      speak('세팅이 완벽합니다. 5초 후 스윙 연습을 시작합니다.');
      setCamStatus('5초 후 첫 번째 스윙 연습을 시작합니다');
      setTimeout(kickoffFirstSwing, 5000);
    }
    return;
  }

  /* ── 스윙 사이 대기 단계 ── */
  if (betweenState === 'wait_exit') {
    if (!hasBody) {
      noPersonFrames++;
    } else {
      noPersonFrames = 0;
    }
    if (noPersonFrames >= 8) { // ~1초간 프레임 이탈 감지
      noPersonFrames = 0;
      betweenState = 'wait_enter';
      setRecordGuide('준비되면 프레임 안으로 들어오세요 🏌️');
    }
    return;
  }

  if (betweenState === 'wait_enter') {
    if (inFrame) {
      betweenState = 'countdown';
      setRecordGuide('');
      startNextSwingCountdown();
    }
    return;
  }
}

function isFullBodyInFrame(lms) {
  var xs = lms.map(function (l) { return l.x; });
  var ys = lms.map(function (l) { return l.y; });
  return Math.min.apply(null, xs) > 0.04 &&
    Math.max.apply(null, xs) < 0.96 &&
    Math.min.apply(null, ys) > 0.02 &&
    Math.max.apply(null, ys) < 0.97;
}

/* ================================================================
   녹화 흐름
   ================================================================ */
function kickoffFirstSwing() {
  goStep(7);
  var recVid = document.getElementById('recordVideo');
  if (recVid && mediaStream) { recVid.srcObject = mediaStream; recVid.play(); }
  startVoiceRecognition(); // 녹화 중에도 유지
  startNextSwingCountdown();
}

function startNextSwingCountdown() {
  var phase = document.getElementById('recordPhase');
  var countdown = document.getElementById('recordCountdown');
  if (phase) phase.textContent = (currentSwingIndex + 1) + '번째 스윙 준비';
  if (countdown) countdown.textContent = '';

  var n = 5;
  var t = setInterval(function () {
    playBeep();
    if (countdown) countdown.textContent = n;
    n--;
    if (n < 0) {
      clearInterval(t);
      if (countdown) countdown.textContent = '';
      captureSwing();
    }
  }, 1000);
}

function captureSwing() {
  var phase = document.getElementById('recordPhase');
  if (phase) phase.textContent = '🏌️ 스윙!';
  playBeepLong();
  setRecordGuide('');

  var chunks = [];
  var mimeType = pickMimeType();
  var recorder;
  try { recorder = new MediaRecorder(mediaStream, mimeType ? { mimeType: mimeType } : {}); }
  catch (e) { recorder = new MediaRecorder(mediaStream); }

  recorder.ondataavailable = function (e) {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.start(200);

  setTimeout(function () { recorder.stop(); }, 8000);

  recorder.onstop = function () {
    var blob = new Blob(chunks, { type: mimeType || 'video/webm' });
    state.clips.push(blob);
    currentSwingIndex++;

    if (currentSwingIndex >= state.swingCount) {
      finishRecording();
    } else {
      // 다음 스윙: 프레임 이탈 후 재진입 트리거
      betweenState = 'wait_exit';
      noPersonFrames = 0;
      poseRunning = true;
      requestAnimationFrame(poseLoop);
      var ph2 = document.getElementById('recordPhase');
      if (ph2) ph2.textContent = '✅ ' + currentSwingIndex + '번째 완료!';
      setRecordGuide(
        '프레임에서 나갔다가 다시 들어오면 ' +
        (currentSwingIndex + 1) + '번째 스윙이 자동 시작됩니다\n' +
        '또는 "시작" 이라고 말하세요'
      );
      speak(currentSwingIndex + '번째 스윙 완료. 잠시 나갔다 다시 들어오시면 바로 시작합니다.');
    }
  };
}

/* ── 음성 "시작" 명령으로 즉시 시작 ── */
function voiceTriggerStart() {
  if (betweenState === 'wait_exit' || betweenState === 'wait_enter') {
    poseRunning = false;
    betweenState = 'countdown';
    setRecordGuide('');
    speak('시작합니다');
    startNextSwingCountdown();
  }
}

/* ── 음성 "다시" 명령으로 마지막 클립 재녹화 ── */
function voiceTriggerRedo() {
  if (currentSwingIndex === 0) return;
  currentSwingIndex--;
  state.clips.pop();
  betweenState = 'countdown';
  poseRunning = false;
  var ph = document.getElementById('recordPhase');
  if (ph) ph.textContent = (currentSwingIndex + 1) + '번째 스윙 다시 합니다';
  setRecordGuide('');
  speak('다시 시작합니다');
  setTimeout(startNextSwingCountdown, 1500);
}

function finishRecording() {
  poseRunning = false;
  betweenState = 'idle';
  if (mediaStream) mediaStream.getTracks().forEach(function (t) { t.stop(); });
  speak('모든 스윙 녹화가 완료됐습니다. 분석 버튼을 눌러주세요.');
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
   음성 인식 ("시작" / "다시")
   ================================================================ */
var voiceRecognition = null;
var voiceActive = false;

function startVoiceRecognition() {
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    setVoiceStatus('off'); // 지원 안 함
    return;
  }
  if (voiceActive) return;

  voiceRecognition = new SR();
  voiceRecognition.lang = 'ko-KR';
  voiceRecognition.continuous = true;
  voiceRecognition.interimResults = false;
  voiceRecognition.maxAlternatives = 1;

  voiceRecognition.onstart = function () {
    voiceActive = true;
    setVoiceStatus('on');
  };
  voiceRecognition.onend = function () {
    voiceActive = false;
    // 녹화 중이면 재시작 (iOS 짧은 중단 방지)
    var s7 = document.getElementById('step7');
    var s6 = document.getElementById('step6');
    var active = (s7 && s7.classList.contains('active')) ||
                 (s6 && s6.classList.contains('active'));
    if (active) setTimeout(startVoiceRecognition, 500);
    else setVoiceStatus('off');
  };
  voiceRecognition.onerror = function () {
    voiceActive = false;
    setVoiceStatus('off');
  };
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
   AI 분석 (Step 9)
   ================================================================ */
function uploadAndAnalyze() {
  stopVoiceRecognition();
  goStep(9);
  var wrap = document.getElementById('resultsWrap');
  if (wrap) wrap.innerHTML = '<div class="loading"><div class="spinner"></div><p>AI가 스윙을 분석 중입니다...<br>잠시만 기다려주세요</p></div>';

  var form = new FormData();
  state.clips.forEach(function (clip, i) {
    var ext = clip.type.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
    form.append('clips', clip, 'swing_' + (i + 1) + '.' + ext);
  });
  var metrics = state.clips.map(function (_, i) {
    return { index: i + 1, club: state.club };
  });
  form.append('metrics_json', JSON.stringify(metrics));
  form.append('notes', state.concern || '');
  form.append('club', state.club || '');

  fetch(BACKEND + '/api/analyze', { method: 'POST', body: form })
    .then(function (res) {
      if (!res.ok) throw new Error('서버 오류 (' + res.status + ')');
      return res.json();
    })
    .then(showResults)
    .catch(function (err) {
      if (wrap) wrap.innerHTML =
        '<div class="result-card"><h3>⚠️ 오류</h3><p>' + err.message +
        '</p><p style="margin-top:10px;color:#aaa;font-size:.8rem">백엔드 서버가 실행 중인지 확인해주세요.<br>주소: ' + BACKEND + '</p></div>';
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
    var coaching = item.coaching || item.message || item.feedback || JSON.stringify(item, null, 2);
    card.innerHTML = '<h3>스윙 ' + (i + 1) + ' — ' + (state.club || '') + '</h3><p>' + coaching + '</p>';
    wrap.appendChild(card);
  });
}

/* ================================================================
   리셋
   ================================================================ */
function resetAll() {
  stopVoiceRecognition();
  state.club = null; state.swingCount = null; state.concern = ''; state.clips = [];
  currentSwingIndex = 0; poseRunning = false; okFrames = 0; setupDone = false;
  betweenState = 'idle'; noPersonFrames = 0;
  if (mediaStream) { mediaStream.getTracks().forEach(function (t) { t.stop(); }); mediaStream = null; }
  document.querySelectorAll('.club-btn').forEach(function (b) { b.classList.remove('selected'); });
  document.querySelectorAll('.chip').forEach(function (b) { b.classList.remove('selected'); });
  var cn = document.getElementById('btnClubNext'); if (cn) cn.disabled = true;
  var nn = document.getElementById('btnCountNext'); if (nn) nn.disabled = true;
  var inp = document.getElementById('concernInput'); if (inp) inp.value = '';
  goStep(0);
}

/* ================================================================
   UI 헬퍼
   ================================================================ */
function setCamStatus(msg) {
  var el = document.getElementById('cameraStatus');
  if (el) el.textContent = msg;
}

function updateCamMsg(type, msg) {
  var el = document.getElementById('camTip');
  if (el) el.textContent = msg;
}

function setRecordGuide(msg) {
  var el = document.getElementById('betweenGuide');
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

function setVoiceStatus(state) {
  var ind = document.getElementById('voiceIndicator');
  var txt = document.getElementById('voiceStatusText');
  if (!ind) return;
  if (state === 'on') {
    ind.classList.add('listening');
    if (txt) txt.textContent = '음성 듣는 중 — "시작" / "다시"';
  } else {
    ind.classList.remove('listening');
    if (txt) txt.textContent = '음성 인식 꺼짐';
  }
}

function showVoiceHeard(text) {
  var el = document.getElementById('voiceHeard');
  if (!el) return;
  el.textContent = '"' + text + '"';
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(function () { el.style.opacity = '0'; }, 1800);
}

/* ================================================================
   오디오 / TTS
   ================================================================ */
function playBeep() {
  try {
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    var ctx = new C(), osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = 660;
    osc.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.3, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.start(); osc.stop(ctx.currentTime + 0.2);
    osc.onended = function () { ctx.close(); };
  } catch (e) {}
}

function playBeepOk() {
  try {
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    var ctx = new C();
    [523, 659, 784].forEach(function (f, i) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      o.connect(g); g.connect(ctx.destination);
      var t = ctx.currentTime + i * 0.14;
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.start(t); o.stop(t + 0.32);
    });
    setTimeout(function () { ctx.close(); }, 1200);
  } catch (e) {}
}

function playBeepLong() {
  try {
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    var ctx = new C(), osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = 880;
    osc.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.4, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(); osc.stop(ctx.currentTime + 0.55);
    osc.onended = function () { ctx.close(); };
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
