/* ================================================================
   NICESHOT – 스윙 분석 (구간 감지, 메트릭 추출, 업로드)
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

function _angleDeg3(a, b, c) {
  var ab = { x: a.x - b.x, y: a.y - b.y };
  var cb = { x: c.x - b.x, y: c.y - b.y };
  var dot = ab.x * cb.x + ab.y * cb.y;
  var mag = Math.sqrt(ab.x * ab.x + ab.y * ab.y) * Math.sqrt(cb.x * cb.x + cb.y * cb.y);
  if (mag === 0) return 0;
  return Math.round(Math.acos(Math.min(1, Math.max(-1, dot / mag))) * 180 / Math.PI);
}

/* ── 스윙 구간 자동 감지 (velocity 기반 peak/valley) ── */

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

  var vel = [0];
  for (var i = 1; i < N; i++) vel.push(sWrist[i] - sWrist[i - 1]);
  var sVel = [];
  for (var i = 0; i < N; i++) {
    var vs = Math.max(0, i - 2), ve = Math.min(N - 1, i + 2);
    var vsum = 0, vcnt = 0;
    for (var j = vs; j <= ve; j++) { vsum += vel[j]; vcnt++; }
    sVel.push(vsum / vcnt);
  }

  var peaks = [], valleys = [];
  for (var i = 2; i < N - 2; i++) {
    if (sVel[i - 1] > 0.001 && sVel[i + 1] < -0.001 && sWrist[i] > baseH + riseThresh) {
      peaks.push(i);
    }
    if (sVel[i - 1] < -0.001 && sVel[i + 1] > 0.001) {
      valleys.push(i);
    }
  }

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

  if (bsTopIdx > N * 0.75) {
    var earlyMax = 0;
    for (var i = 1; i < Math.round(N * 0.6); i++) {
      if (sWrist[i] > sWrist[earlyMax]) earlyMax = i;
    }
    if (sWrist[earlyMax] > baseH + riseThresh * 0.5) bsTopIdx = earlyMax;
  }
  var bsTopTime = frames[bsTopIdx].time;

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

  var addressEndIdx = 0;
  for (var i = 1; i < bsTopIdx; i++) {
    if (sWrist[i] > baseH + riseThresh) {
      addressEndIdx = Math.max(0, i - 1); break;
    }
  }
  var addressTime = frames[0].time;

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

  var finishIdx = followPeakIdx;
  for (var i = followPeakIdx + 1; i < N; i++) {
    if (sWrist[i] < sWrist[followPeakIdx] - 0.02) { finishIdx = i; break; }
  }
  finishIdx = Math.min(finishIdx, N - 1);
  var finishTime = frames[finishIdx].time;
  if (finishTime <= followPeakTime) finishTime = followPeakTime + 0.1;
  finishTime = Math.min(finishTime, totalTime);

  var pauseAt = [
    addressTime + 0.05,
    takeawayStartTime + (takeEndTime - takeawayStartTime) * 0.5,
    bsTopTime,
    downStartTime + (impactTime - downStartTime) * 0.4,
    impactTime,
    impactTime + (followPeakTime - impactTime) * 0.55,
    finishTime + (totalTime - finishTime) * 0.35
  ];

  var MIN_GAP = 0.08;
  for (var p = 0; p < pauseAt.length; p++) {
    pauseAt[p] = Math.max(0.03, Math.min(pauseAt[p], totalTime - 0.03));
  }
  for (var p = 1; p < pauseAt.length; p++) {
    if (pauseAt[p] <= pauseAt[p - 1] + MIN_GAP) pauseAt[p] = pauseAt[p - 1] + MIN_GAP;
  }
  if (pauseAt[pauseAt.length - 1] > totalTime - 0.03) {
    pauseAt[pauseAt.length - 1] = totalTime - 0.03;
  }

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

function extractSwingIndicators() {
  if (state.poseFrames.length < 5) {
    return { valid: false, has_swing_motion: false, reason: '포즈 감지 프레임 부족' };
  }

  var wristHeights = [], shoulderTilts = [], hipTilts = [];

  for (var i = 0; i < state.poseFrames.length; i++) {
    var lms = state.poseFrames[i].landmarks;
    if (!lms || lms.length < 29) continue;
    wristHeights.push(1 - lms[16].y);
    shoulderTilts.push(Math.round(Math.atan2(lms[12].y - lms[11].y, lms[12].x - lms[11].x) * 180 / Math.PI));
    hipTilts.push(Math.round(Math.atan2(lms[24].y - lms[23].y, lms[24].x - lms[23].x) * 180 / Math.PI));
  }

  if (wristHeights.length < 5) {
    return { valid: false, has_swing_motion: false, reason: '유효한 랜드마크 부족' };
  }

  var maxWrist = Math.max.apply(null, wristHeights);
  var minWrist = Math.min.apply(null, wristHeights);
  var wristRange = maxWrist - minWrist;
  var shoulderRotation = Math.max.apply(null, shoulderTilts) - Math.min.apply(null, shoulderTilts);
  var hipRotation = Math.max.apply(null, hipTilts) - Math.min.apply(null, hipTilts);

  var firstFrame = state.poseFrames[0].landmarks;
  var shoulderH = 1 - ((firstFrame[11].y + firstFrame[12].y) / 2);

  return {
    valid: true,
    frame_count: state.poseFrames.length,
    wrist_height_range_pct: Math.round(wristRange * 100),
    wrist_peak_pct: Math.round(maxWrist * 100),
    wrist_above_shoulder: maxWrist > shoulderH,
    shoulder_rotation_deg: Math.round(shoulderRotation),
    hip_rotation_deg: Math.round(hipRotation),
    has_swing_motion: wristRange > 0.12 && (shoulderRotation > 5 || hipRotation > 3)
  };
}

/* ── AI 분석 업로드 ── */

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

  var retries = 0;
  var maxRetries = 2;

  function doFetch() {
    fetch(BACKEND + '/api/analyze', { method: 'POST', body: form })
      .then(function (res) {
        if (!res.ok) throw new Error('서버 오류 (' + res.status + ')');
        return res.json();
      })
      .then(showScoreCard)
      .catch(function (err) {
        retries++;
        if (retries <= maxRetries) {
          console.log('[Upload] Retry ' + retries + '/' + maxRetries);
          if (wrap) wrap.innerHTML = '<div class="loading"><div class="spinner"></div><p>연결 재시도 중... (' + retries + '/' + maxRetries + ')</p></div>';
          setTimeout(doFetch, 2000 * retries);
        } else {
          if (wrap) wrap.innerHTML =
            '<div class="result-card"><h3>⚠️ 분석 오류</h3>' +
            '<p>' + err.message + '</p>' +
            '<p style="margin-top:10px;color:#aaa;font-size:.8rem">서버: ' + BACKEND + '</p>' +
            '<button class="btn btn-outline" onclick="uploadAndAnalyze()" style="margin-top:12px">다시 시도</button></div>';
        }
      });
  }
  doFetch();
}

function isPostSwingActive() { return false; }
