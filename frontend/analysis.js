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

/* ── 스윙 구간 자동 감지 (신호 + 비율 제약 하이브리드) ── */

function detectSwingPhases() {
  if (state.poseFrames.length < 10) return null;

  var club = state.club || '';
  var isPutter = (club === '퍼터');

  var frames = [];
  for (var i = 0; i < state.poseFrames.length; i++) {
    var lms = state.poseFrames[i].landmarks;
    if (!lms || lms.length < 29) continue;
    var lSho = lms[11], rSho = lms[12];
    var lWri = lms[15], rWri = lms[16];
    var lHip = lms[23], rHip = lms[24];
    var lWH = 1 - lWri.y, rWH = 1 - rWri.y;
    frames.push({
      time: state.poseFrames[i].time,
      wristH: Math.max(lWH, rWH),
      xFactor: Math.abs(Math.atan2(rSho.y - lSho.y, rSho.x - lSho.x) - Math.atan2(rHip.y - lHip.y, rHip.x - lHip.x)) * 180 / Math.PI,
      hipX: (lHip.x + rHip.x) / 2
    });
  }
  if (frames.length < 10) return null;

  var N = frames.length;
  var totalTime = frames[N - 1].time;
  if (totalTime <= 0) totalTime = 4.0;

  // 스무딩
  function smooth(arr, key, n) {
    var half = Math.floor(n / 2), out = [];
    for (var i = 0; i < arr.length; i++) {
      var s = Math.max(0, i - half), e = Math.min(arr.length - 1, i + half);
      var sum = 0, cnt = 0;
      for (var j = s; j <= e; j++) { sum += arr[j][key]; cnt++; }
      out.push(sum / cnt);
    }
    return out;
  }
  var sWrist = smooth(frames, 'wristH', 5);

  // ── 핵심 감지: 백스윙 탑 = wrist 최고점 (전체의 20~60% 구간에서) ──
  var searchStart = Math.round(N * 0.15);
  var searchEnd = Math.round(N * 0.60);
  var bsTopIdx = searchStart;
  for (var i = searchStart + 1; i < searchEnd; i++) {
    if (sWrist[i] > sWrist[bsTopIdx]) bsTopIdx = i;
  }

  // ── 임팩트 = 백스윙 탑 이후 wrist 최저점 (탑 이후 ~ 85% 구간) ──
  var impSearchEnd = Math.min(Math.round(N * 0.85), N);
  var impactIdx = bsTopIdx + 1;
  if (impactIdx >= N) impactIdx = N - 1;
  for (var i = bsTopIdx + 1; i < impSearchEnd; i++) {
    if (sWrist[i] < sWrist[impactIdx]) impactIdx = i;
  }
  // 임팩트가 백스윙 탑 바로 뒤면 비율로 보정
  if (impactIdx <= bsTopIdx + 1) {
    impactIdx = Math.round(bsTopIdx + (N - bsTopIdx) * 0.35);
    impactIdx = Math.min(impactIdx, N - 1);
  }

  // 시간 변환
  var bsTopTime = frames[bsTopIdx].time;
  var impactTime = frames[impactIdx].time;

  // ── 비율 기반 구간 배분 (핵심!) ──
  // 백스윙 탑과 임팩트를 기준점으로 나머지를 비율 배분
  var addressEnd = bsTopTime * 0.25;           // 어드레스: 0 ~ 탑의 25%
  var takeEnd = bsTopTime * 0.55;              // 테이크어웨이: ~ 탑의 55%
  var downStart = bsTopTime + (impactTime - bsTopTime) * 0.15; // 다운스윙 시작: 탑 직후
  var followEnd = impactTime + (totalTime - impactTime) * 0.55;
  var finishStart = impactTime + (totalTime - impactTime) * 0.65;

  // 최소 간격 보장
  var MIN = 0.10;
  if (addressEnd < MIN) addressEnd = MIN;
  if (takeEnd <= addressEnd + MIN) takeEnd = addressEnd + MIN;
  if (takeEnd >= bsTopTime - MIN) takeEnd = bsTopTime - MIN;
  if (downStart <= bsTopTime) downStart = bsTopTime + 0.01;
  if (downStart >= impactTime - MIN) downStart = impactTime - MIN;
  if (followEnd <= impactTime + MIN) followEnd = impactTime + MIN;
  if (finishStart <= followEnd) finishStart = followEnd + MIN;
  if (finishStart >= totalTime - MIN) finishStart = totalTime - MIN;

  var rangesList = [
    { key: 'address',       label: '어드레스',    start: 0,           end: addressEnd },
    { key: 'takeaway',      label: '테이크어웨이', start: addressEnd,  end: takeEnd },
    { key: 'backswing',     label: '백스윙',      start: takeEnd,      end: bsTopTime },
    { key: 'downswing',     label: '다운스윙',    start: bsTopTime,    end: impactTime },
    { key: 'impact',        label: '임팩트',      start: impactTime,   end: impactTime + MIN },
    { key: 'followthrough', label: '팔로우스루',  start: impactTime + MIN, end: finishStart },
    { key: 'finish',        label: '피니시',      start: finishStart,  end: totalTime }
  ];

  // pauseAt: 각 구간의 중간점 (backswing=탑, impact=임팩트 시점)
  var pauseAt = [
    addressEnd * 0.5,                          // 어드레스 중간
    (addressEnd + takeEnd) * 0.5,              // 테이크어웨이 중간
    bsTopTime,                                  // 백스윙 탑 (정확한 지점)
    (bsTopTime + impactTime) * 0.5,            // 다운스윙 중간
    impactTime,                                 // 임팩트 (정확한 지점)
    (impactTime + finishStart) * 0.5,          // 팔로우스루 중간
    (finishStart + totalTime) * 0.5            // 피니시 중간
  ];

  // 클램핑
  for (var p = 0; p < pauseAt.length; p++) {
    pauseAt[p] = Math.max(0.03, Math.min(pauseAt[p], totalTime - 0.03));
  }
  for (var p = 1; p < pauseAt.length; p++) {
    if (pauseAt[p] <= pauseAt[p - 1] + 0.05) pauseAt[p] = pauseAt[p - 1] + 0.05;
  }

  console.log('[Phase Detection] club:', club, 'frames:', N,
    'bsTop:', bsTopTime.toFixed(2) + 's (' + (bsTopIdx / N * 100).toFixed(0) + '%)',
    'impact:', impactTime.toFixed(2) + 's (' + (impactIdx / N * 100).toFixed(0) + '%)',
    'total:', totalTime.toFixed(2) + 's');
  console.log('[Ranges]', rangesList.map(function(r) {
    return r.key + ':' + r.start.toFixed(2) + '-' + r.end.toFixed(2);
  }).join(' | '));

  return {
    ranges: rangesList,
    keyTimes: {
      address: pauseAt[0], takeaway: pauseAt[1], backswing: pauseAt[2],
      downswing: pauseAt[3], impact: pauseAt[4],
      followthrough: pauseAt[5], finish: pauseAt[6]
    },
    pauseAt: pauseAt
  };
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
