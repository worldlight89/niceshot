/* ================================================================
   NICESHOT – 카메라, 포즈 감지, 자동 줌, 녹화
   ================================================================ */

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
    poseDetector.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      minDetectionConfidence: 0.55,
      minTrackingConfidence: 0.55
    });
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

function onPoseResult(results) {
  var lms = results.poseLandmarks;
  var hasBody = lms && lms.length > 0;

  if (hasBody) updateAutoZoom(lms);

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

  if (betweenState === 'wait_exit') {
    if (!hasBody) noPersonFrames++;
    else noPersonFrames = 0;
    if (noPersonFrames >= 8) {
      noPersonFrames = 0; betweenState = 'wait_enter';
      setRecordGuide('준비되면 프레임 안으로 들어오세요 🏌️');
    }
    return;
  }

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
  autoZoomScale = 1; autoZoomX = 50; autoZoomY = 50; zoomFrameCount = 0;
  var preview = document.getElementById('previewVideo');
  var record = document.getElementById('recordVideo');
  if (preview) { preview.style.transform = ''; preview.style.transformOrigin = ''; }
  if (record) { record.style.transform = ''; record.style.transformOrigin = ''; }
}

/* ── 녹화 흐름 ── */

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

function startNextSwingCountdown() {
  var phase = document.getElementById('recordPhase');
  var countdown = document.getElementById('recordCountdown');
  if (phase) phase.textContent = '스윙 준비';
  if (countdown) countdown.textContent = '';

  speak('준비'); playBeepOk();

  setTimeout(function () {
    var n = 0;
    var t = setInterval(function () {
      if (n < KO_COUNTS.length) {
        speak(KO_COUNTS[n]); playBeep();
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

  recorder.ondataavailable = function (e) {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
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

function pickMimeType() {
  var types = ['video/mp4;codecs=h264', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  for (var i = 0; i < types.length; i++) {
    try { if (MediaRecorder.isTypeSupported(types[i])) return types[i]; } catch (e) {}
  }
  return '';
}
