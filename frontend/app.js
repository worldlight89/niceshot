/* ================================================================
   NICESHOT – 골프 스윙 AI 코치
   전체 흐름: 클럽선택 → 횟수 → 고민입력 → 카메라세팅 → 녹화 → AI분석
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

/* ── State ── */
var state = {
  club: null,
  swingCount: null,
  concern: '',
  clips: []
};

var mediaStream = null;
var currentSwingIndex = 0;

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
      document.querySelectorAll('.club-btn').forEach(function (b) {
        b.classList.remove('selected');
      });
      btn.classList.add('selected');
      state.club = club;
      var next = document.getElementById('btnClubNext');
      if (next) next.disabled = false;
    };
    grid.appendChild(btn);
  });
}

/* ================================================================
   Step 3 – 스윙 횟수 선택
   ================================================================ */
function selectCount(n, btn) {
  document.querySelectorAll('.chip').forEach(function (b) {
    b.classList.remove('selected');
  });
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

  // Step 5 요약 업데이트
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
   Step 6 – 카메라 세팅 + Pose 감지
   ================================================================ */
var poseDetector = null;
var poseRunning = false;
var okFrames = 0;
var poseDone = false;

function startPractice() {
  state.clips = [];
  currentSwingIndex = 0;
  poseRunning = false;
  okFrames = 0;
  poseDone = false;
  goStep(6);
  openCamera();
}

function openCamera() {
  var status = document.getElementById('cameraStatus');
  if (status) status.textContent = '카메라 켜는 중...';

  navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false
  }).then(function (stream) {
    mediaStream = stream;
    var vid = document.getElementById('previewVideo');
    if (vid) { vid.srcObject = stream; vid.play(); }
    if (status) status.textContent = '전신이 프레임 안에 들어오게 서주세요';
    setTimeout(initPose, 800);
  }).catch(function (err) {
    if (status) status.textContent = '카메라 오류: ' + err.message + ' — 브라우저에서 카메라 권한을 허용해주세요.';
  });
}

function initPose() {
  if (typeof Pose === 'undefined') {
    // MediaPipe 없으면 바로 3초 후 녹화 시작
    var pill = document.getElementById('framePill');
    if (pill) pill.textContent = '3초 후 녹화를 시작합니다';
    setTimeout(function () { runSwingLoop(); }, 3000);
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
  poseDone = false;
  requestAnimationFrame(poseLoop);
}

function poseLoop() {
  if (!poseRunning) return;
  var vid = document.getElementById('previewVideo');
  if (vid && vid.readyState >= 2) {
    poseDetector.send({ image: vid }).catch(function () {});
  }
  setTimeout(function () { requestAnimationFrame(poseLoop); }, 120);
}

function onPoseResult(results) {
  if (poseDone) return;

  var pill = document.getElementById('framePill');
  var lms = results.poseLandmarks;

  if (!lms || lms.length === 0) {
    okFrames = 0;
    if (pill) pill.textContent = '전신이 프레임 안에 들어오게 서주세요';
    return;
  }

  var xs = lms.map(function (l) { return l.x; });
  var ys = lms.map(function (l) { return l.y; });
  var minX = Math.min.apply(null, xs);
  var maxX = Math.max.apply(null, xs);
  var minY = Math.min.apply(null, ys);
  var maxY = Math.max.apply(null, ys);

  var inFrame = minX > 0.04 && maxX < 0.96 && minY > 0.02 && maxY < 0.97;

  if (inFrame) {
    okFrames++;
    if (pill) pill.textContent = '좋아요! 자세 유지... (' + okFrames + '/8)';
    if (okFrames >= 8) {
      poseDone = true;
      poseRunning = false;
      if (pill) pill.textContent = '✅ 세팅 완벽!';
      playBeepOk();
      speak('세팅 완벽합니다. 5초 후 스윙 연습을 시작합니다.');
      var status = document.getElementById('cameraStatus');
      if (status) status.textContent = '5초 후 스윙 연습을 시작합니다';
      setTimeout(function () { runSwingLoop(); }, 5000);
    }
  } else {
    okFrames = 0;
    if (pill) pill.textContent = '전신이 프레임 안에 들어오게 서주세요';
  }
}

/* ================================================================
   Step 7 – 녹화 루프
   ================================================================ */
function runSwingLoop() {
  if (currentSwingIndex >= state.swingCount) {
    finishRecording();
    return;
  }
  goStep(7);

  var recVid = document.getElementById('recordVideo');
  if (recVid && mediaStream) {
    recVid.srcObject = mediaStream;
    recVid.play();
  }

  recordOneSwing(currentSwingIndex).then(function (blob) {
    state.clips.push(blob);
    currentSwingIndex++;
    if (currentSwingIndex < state.swingCount) {
      speak((currentSwingIndex + 1) + '번째 스윙을 준비하세요');
      setTimeout(function () { runSwingLoop(); }, 2500);
    } else {
      finishRecording();
    }
  });
}

function recordOneSwing(index) {
  return new Promise(function (resolve) {
    var phase = document.getElementById('recordPhase');
    var countdown = document.getElementById('recordCountdown');

    if (phase) phase.textContent = (index + 1) + '번째 스윙 준비';
    if (countdown) countdown.textContent = '';

    // 5초 카운트다운
    var count = 5;
    var timer = setInterval(function () {
      playBeep();
      if (countdown) countdown.textContent = count;
      count--;
      if (count < 0) {
        clearInterval(timer);
        if (countdown) countdown.textContent = '';
        startCapture();
      }
    }, 1000);

    function startCapture() {
      if (phase) phase.textContent = '🏌️ 스윙!';
      playBeepLong();

      var chunks = [];
      var mimeType = pickMimeType();
      var recorder;
      try {
        recorder = new MediaRecorder(mediaStream, mimeType ? { mimeType: mimeType } : {});
      } catch (e) {
        recorder = new MediaRecorder(mediaStream);
      }

      recorder.ondataavailable = function (e) {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.start(200);

      setTimeout(function () {
        recorder.stop();
      }, 8000);

      recorder.onstop = function () {
        var blob = new Blob(chunks, { type: mimeType || 'video/webm' });
        if (phase) phase.textContent = '✅ 완료!';
        resolve(blob);
      };
    }
  });
}

function pickMimeType() {
  var types = ['video/mp4;codecs=h264', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  for (var i = 0; i < types.length; i++) {
    try { if (MediaRecorder.isTypeSupported(types[i])) return types[i]; } catch (e) {}
  }
  return '';
}

/* ================================================================
   Step 8 – 녹화 완료
   ================================================================ */
function finishRecording() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(function (t) { t.stop(); });
  }
  goStep(8);
  var cc = document.getElementById('clipCount');
  if (cc) cc.textContent = state.clips.length;
}

/* ================================================================
   Step 9 – AI 분석
   ================================================================ */
function uploadAndAnalyze() {
  goStep(9);
  var wrap = document.getElementById('resultsWrap');
  if (wrap) {
    wrap.innerHTML = '<div class="loading"><div class="spinner"></div><p>AI가 스윙을 분석 중입니다...<br>잠시만 기다려주세요</p></div>';
  }

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
      if (!res.ok) throw new Error('서버 응답 오류 (' + res.status + ')');
      return res.json();
    })
    .then(function (data) {
      showResults(data);
    })
    .catch(function (err) {
      if (wrap) {
        wrap.innerHTML =
          '<div class="result-card">' +
          '<h3>⚠️ 오류 발생</h3>' +
          '<p>' + err.message + '</p>' +
          '<p style="margin-top:10px;color:#aaa;font-size:.8rem">' +
          '백엔드 서버가 실행 중인지 확인해주세요.<br>' +
          '서버 주소: ' + BACKEND + '</p>' +
          '</div>';
      }
    });
}

function showResults(data) {
  var wrap = document.getElementById('resultsWrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  var items = Array.isArray(data.results) ? data.results
    : Array.isArray(data) ? data
    : [data];

  if (items.length === 0) {
    wrap.innerHTML = '<div class="result-card"><h3>결과 없음</h3><p>분석 결과가 없습니다.</p></div>';
    return;
  }

  items.forEach(function (item, i) {
    var card = document.createElement('div');
    card.className = 'result-card';
    var coaching = item.coaching || item.message || item.feedback || JSON.stringify(item, null, 2);
    card.innerHTML =
      '<h3>스윙 ' + (i + 1) + ' — ' + (state.club || '') + ' 분석</h3>' +
      '<p>' + coaching + '</p>';
    wrap.appendChild(card);
  });
}

/* ================================================================
   리셋
   ================================================================ */
function resetAll() {
  state.club = null;
  state.swingCount = null;
  state.concern = '';
  state.clips = [];
  currentSwingIndex = 0;
  poseRunning = false;
  okFrames = 0;
  poseDone = false;

  if (mediaStream) {
    mediaStream.getTracks().forEach(function (t) { t.stop(); });
    mediaStream = null;
  }

  // UI 초기화
  document.querySelectorAll('.club-btn').forEach(function (b) { b.classList.remove('selected'); });
  document.querySelectorAll('.chip').forEach(function (b) { b.classList.remove('selected'); });
  var clubNext = document.getElementById('btnClubNext');
  if (clubNext) clubNext.disabled = true;
  var countNext = document.getElementById('btnCountNext');
  if (countNext) countNext.disabled = true;
  var inp = document.getElementById('concernInput');
  if (inp) inp.value = '';

  goStep(0);
}

/* ================================================================
   오디오 / TTS
   ================================================================ */
function playBeep() {
  try {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    var ctx = new Ctx();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 660;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.2);
    osc.onended = function () { ctx.close(); };
  } catch (e) {}
}

function playBeepOk() {
  // C - E - G 화음
  try {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    var ctx = new Ctx();
    [523, 659, 784].forEach(function (freq, i) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      var t = ctx.currentTime + i * 0.14;
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.start(t);
      osc.stop(t + 0.32);
    });
    setTimeout(function () { ctx.close(); }, 1200);
  } catch (e) {}
}

function playBeepLong() {
  try {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    var ctx = new Ctx();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.55);
    osc.onended = function () { ctx.close(); };
  } catch (e) {}
}

function speak(text) {
  if (!window.speechSynthesis) return;
  var u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  u.rate = 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

/* ================================================================
   초기화
   ================================================================ */
buildClubGrid();
goStep(0);
