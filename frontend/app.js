/* ================================================================
   NICESHOT – 앱 초기화 및 전체 오케스트레이션 (간소화 버전)
   ================================================================ */

/* ── Step 2: 클럽 선택 + 고민 (통합) ── */

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

/* ── 연습 시작 (클럽 선택 → 바로 카메라) ── */

function startPractice() {
  // 고민 입력 수집
  var inp = document.getElementById('concernInput');
  state.concern = inp ? inp.value.trim() : '';

  state.videoBlob = null; state.poseFrames = [];
  state.analysisResult = null;
  poseRunning = false; okFrames = 0;
  setupDone = false; betweenState = 'idle';
  goStep(6);
  setCamStatus('카메라 켜는 중...');
  openCamera();
  startVoiceRecognition();
}

/* ── 다시 촬영 (클럽 유지, 카메라로 바로) ── */

function practiceAgain() {
  state.videoBlob = null; state.poseFrames = [];
  state.analysisResult = null;
  detectedPhases = null;
  if (slowmoAnimId) { cancelAnimationFrame(slowmoAnimId); slowmoAnimId = null; }
  slowmoPaused = false; slowmoPhaseIdx = 0; slowmoPhaseStops = [];

  goStep(7);
  betweenState = 'idle';
  poseRunning = false;
  setRecordGuide('');
  setTimeout(startNextSwingCountdown, 800);
}

/* ── 전체 리셋 ── */

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

/* ── 초기화 ── */
buildClubGrid();
goStep(0);
