/* ================================================================
   NICESHOT – 결과 화면 (스코어카드 + 슬로모션 교정 영상)
   ================================================================ */

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

  if (coaching.drill) {
    var d = coaching.drill;
    html += '<div class="drill-card">';
    html += '<div class="drill-title">📋 ' + escapeHtml(d.name || '추천 드릴') + '</div>';
    html += '<div class="drill-method">' + escapeHtml(d.method || '') + '</div>';
    if (d.reps) html += '<div class="drill-reps">⏱ ' + escapeHtml(d.reps) + '</div>';
    html += '</div>';
  }

  html += '<button class="btn btn-outline" onclick="showSlowmoPlayer()" style="margin-top:12px;width:100%">🎬 교정 영상 보기</button>';

  wrap.innerHTML = html;

  setTimeout(function () {
    var ring = wrap.querySelector('.score-ring');
    if (ring) {
      ring.style.transition = 'stroke-dashoffset 1.2s ease-out';
      ring.style.strokeDashoffset = offset.toFixed(1);
    }
  }, 100);
}

/* ================================================================
   슬로모션 교정 영상 (step 10)
   ================================================================ */

function getPhaseRanges() {
  return (detectedPhases && detectedPhases.ranges) ? detectedPhases.ranges : DEFAULT_PHASE_RANGES;
}

function buildPhaseStops() {
  var stops = [];
  var ranges = getPhaseRanges();
  var pauseTimes = detectedPhases ? detectedPhases.pauseAt : null;

  var phaseGrades = (state.analysisResult && state.analysisResult.phase_grades) || {};
  var corrections = (state.analysisResult && state.analysisResult.corrections) || {};
  var faults = (state.analysisResult && state.analysisResult.faults) || [];

  console.log('[buildPhaseStops] faults:', faults.length, 'phaseGrades:', Object.keys(phaseGrades));

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

/* ── 슬로모션 오버레이 렌더링 ── */

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

  for (var li = 0; li < lms.length; li++) {
    var lm = lms[li];
    if (!lm || lm.visibility < 0.25) continue;
    var jColor = jointColorMap[li];
    ctx.beginPath();
    ctx.arc(lm.x * w, lm.y * h, jColor ? DOT_R * 1.6 : DOT_R, 0, Math.PI * 2);
    ctx.fillStyle = jColor || 'rgba(255,255,255,0.5)';
    ctx.fill();
  }

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

  if (!stopInfo) return;

  var fontSize = Math.max(16, Math.round(w * 0.042));
  var padding = Math.round(fontSize * 0.55);
  var lineH = fontSize * 1.35;
  var numR = Math.round(fontSize * 0.8);
  var isGood = !stopInfo.hasProblems;
  var accentColor = isGood ? '#27ae60' : '#e74c3c';

  var bx = w * 0.03;
  var by = h * 0.04;

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

  var maxTextW = w * 0.62;
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
