/* ================================================================
   NICESHOT – 결과 화면 (핵심 카드 + 상세 + 슬로모션)
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

  if (!coaching) {
    wrap.innerHTML = '<div class="result-card"><h3>분석 오류</h3><p>' +
      escapeHtml(data.coaching || '다시 시도해주세요.') + '</p></div>';
    return;
  }

  if (coaching.score === -1) {
    wrap.innerHTML =
      '<div class="score-invalid">' +
      '<div class="invalid-icon">⚠️</div>' +
      '<h3>스윙이 감지되지 않았습니다</h3>' +
      '<p>' + escapeHtml(coaching.reason || '영상에서 골프 스윙 동작을 찾을 수 없습니다.') + '</p>' +
      '<p class="invalid-hint">전신이 보이도록 카메라를 세우고<br>실제 스윙 동작을 해주세요.</p>' +
      '</div>';
    return;
  }

  var phaseCoaching = coaching.phase_coaching || {};
  var phaseOrder = ['address', 'takeaway', 'backswing', 'downswing', 'impact', 'followthrough', 'finish'];

  // 단계별 점수 수집
  var phaseScores = [];
  for (var i = 0; i < phaseOrder.length; i++) {
    var key = phaseOrder[i];
    var pc = phaseCoaching[key] || {};
    var ps = typeof pc.score === 'number' ? pc.score : null;
    if (ps === null) {
      if (pc.status === 'good') ps = 85;
      else if (pc.status === 'warning') ps = 60;
      else if (pc.status === 'bad') ps = 35;
      else ps = 70;
    }
    phaseScores.push(ps);
  }

  var avgScore = coaching.score;
  if (typeof avgScore !== 'number' || avgScore < 0) {
    var sum = 0;
    for (var i = 0; i < phaseScores.length; i++) sum += phaseScores[i];
    avgScore = Math.round(sum / phaseScores.length);
  }

  // 가장 심각한 문제 1~2개 추출
  var topProblems = [];
  for (var i = 0; i < phaseOrder.length; i++) {
    var key = phaseOrder[i];
    var pc = phaseCoaching[key] || {};
    if (pc.problems && pc.problems.length > 0) {
      for (var pi = 0; pi < pc.problems.length; pi++) {
        topProblems.push({
          phase: key,
          phaseLabel: PHASE_LABELS[key] || key,
          score: phaseScores[i],
          description: pc.problems[pi].description || ''
        });
      }
    }
  }
  topProblems.sort(function(a, b) { return a.score - b.score; });
  topProblems = topProblems.slice(0, 2);

  var avgColor = avgScore >= 80 ? '#2d6a4f' : avgScore >= 60 ? '#f39c12' : '#e74c3c';

  var html = '';

  // ═══ 핵심 카드 ═══
  html += '<div class="summary-card">';

  // 점수
  html += '<div class="summary-score" style="color:' + avgColor + '">' + avgScore + '<span class="summary-score-unit">점</span></div>';

  // 핵심 문제
  if (topProblems.length > 0) {
    html += '<div class="summary-problems">';
    for (var i = 0; i < topProblems.length; i++) {
      var tp = topProblems[i];
      var probColor = tp.score < 50 ? '#e74c3c' : '#f39c12';
      html += '<div class="summary-problem">';
      html += '<div class="summary-problem-phase" style="color:' + probColor + '">' + tp.phaseLabel + '</div>';
      html += '<div class="summary-problem-desc">' + escapeHtml(tp.description) + '</div>';
      html += '</div>';
    }
    html += '</div>';
  } else {
    html += '<div class="summary-good">전체적으로 좋은 스윙입니다!</div>';
  }

  // 코치의 한마디 (feel_coaching) — 핵심 카드에 포함
  var feel = coaching.feel_coaching;
  if (feel && feel.overall_feel) {
    html += '<div class="summary-feel">' + escapeHtml(feel.overall_feel) + '</div>';
  }

  // 교정 영상 버튼
  html += '<button class="btn-slowmo" onclick="showSlowmoPlayer()">교정 영상 보기</button>';

  html += '</div>'; // .summary-card

  // ═══ 상세 보기 토글 ═══
  html += '<button class="detail-toggle" onclick="toggleDetail()" id="detailToggleBtn">상세 분석 보기 ▼</button>';

  html += '<div class="detail-section" id="detailSection" style="display:none">';

  // 7단계 점수 리스트
  html += '<div class="phase-score-list">';
  for (var i = 0; i < phaseOrder.length; i++) {
    var key = phaseOrder[i];
    var label = PHASE_LABELS[key] || key;
    var ps = phaseScores[i];
    var barColor = ps >= 80 ? '#2d6a4f' : ps >= 60 ? '#f39c12' : '#e74c3c';

    html += '<div class="phase-score-row">';
    html += '<div class="phase-score-header">';
    html += '<span class="phase-label">' + label + '</span>';
    html += '<span class="phase-score-val" style="color:' + barColor + '">' + ps + '</span>';
    html += '</div>';
    html += '<div class="phase-bar-bg"><div class="phase-bar-fill" style="width:' + ps + '%;background:' + barColor + '"></div></div>';
    html += '</div>';
  }
  html += '</div>';

  // feel coaching 상세 포인트
  if (feel && feel.points && feel.points.length > 0) {
    html += '<div class="feel-card">';
    html += '<div class="feel-title">코치 조언</div>';
    html += '<div class="feel-points">';
    for (var fi = 0; fi < feel.points.length; fi++) {
      html += '<div class="feel-point">';
      html += '<span class="feel-bullet">💬</span>';
      html += '<span>' + escapeHtml(feel.points[fi]) + '</span>';
      html += '</div>';
    }
    html += '</div>';
    html += '</div>';
  }

  // 드릴
  if (coaching.drill && (coaching.drill.name || coaching.drill.method)) {
    var d = coaching.drill;
    html += '<div class="drill-card">';
    html += '<div class="drill-title">📋 ' + escapeHtml(d.name || '추천 드릴') + '</div>';
    html += '<div class="drill-method">' + escapeHtml(d.method || '') + '</div>';
    if (d.reps) html += '<div class="drill-reps">⏱ ' + escapeHtml(d.reps) + '</div>';
    html += '</div>';
  }

  html += '</div>'; // .detail-section

  wrap.innerHTML = html;
}

function toggleDetail() {
  var section = document.getElementById('detailSection');
  var btn = document.getElementById('detailToggleBtn');
  if (!section) return;
  if (section.style.display === 'none') {
    section.style.display = 'block';
    if (btn) btn.textContent = '상세 분석 닫기 ▲';
  } else {
    section.style.display = 'none';
    if (btn) btn.textContent = '상세 분석 보기 ▼';
  }
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

  var phaseCoaching = (state.analysisResult && state.analysisResult.phase_coaching) || {};
  var faults = (state.analysisResult && state.analysisResult.faults) || [];
  var hasGemini = Object.keys(phaseCoaching).length > 0;

  for (var r = 0; r < ranges.length; r++) {
    var range = ranges[r];
    var phaseKey = range.key;
    var pauseTime = pauseTimes ? pauseTimes[r] : (range.start + range.end) / 2;
    var issues = [];

    var coaching = phaseCoaching[phaseKey];
    if (hasGemini && coaching && coaching.problems && coaching.problems.length > 0) {
      var probs = coaching.problems.slice(0, 3);
      for (var pi = 0; pi < probs.length; pi++) {
        var prob = probs[pi];
        var joints = {};
        var mainJoint = 0;
        if (prob.joints && prob.joints.length > 0) {
          mainJoint = prob.joints[0];
          for (var ji = 0; ji < prob.joints.length; ji++) {
            joints[prob.joints[ji]] = true;
          }
        }
        issues.push({
          color: ISSUE_COLORS[pi],
          description: prob.description || '',
          joints: joints,
          jointIdx: mainJoint
        });
      }
    } else {
      var phaseFaults = [];
      for (var fi = 0; fi < faults.length; fi++) {
        if (faults[fi].phase === phaseKey) phaseFaults.push(faults[fi]);
      }
      phaseFaults.sort(function (a, b) { return b.deduction - a.deduction; });
      phaseFaults = phaseFaults.slice(0, 3);
      for (var fi = 0; fi < phaseFaults.length; fi++) {
        var fault = phaseFaults[fi];
        var fJoints = {};
        fJoints[fault.joint_idx] = true;
        issues.push({
          color: ISSUE_COLORS[fi],
          description: fault.friendly_ko || fault.label_ko || '',
          joints: fJoints,
          jointIdx: fault.joint_idx
        });
      }
    }

    var grade = (coaching && coaching.status) || 'good';

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
  return (closest && minDist < 0.5) ? closest : null;
}

function showAnnotation(num, phaseLabel, desc, type) {
  var el = document.getElementById('slowmoAnnotation');
  if (!el) return;
  if (type === 'done') {
    el.innerHTML = '<div class="annotation-ok">분석 완료</div>';
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
        if (badge) badge.textContent = stop.phaseLabel;
        if (indicator) indicator.textContent = stop.idx + ' / ' + slowmoPhaseStops.length;
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

/* ── 교정 방향 화살표 ── */

var ARROW_KEYWORDS = {
  up:    ['펴', '높이', '올려', '들어', '세워'],
  down:  ['낮춰', '내려', '구부려', '굽혀'],
  left:  ['왼쪽', '리드', '타겟'],
  right: ['오른쪽', '뒤로', '밀어'],
  rotate: ['회전', '돌려', '턴', '열려', '닫아']
};

function detectArrowDir(text) {
  for (var dir in ARROW_KEYWORDS) {
    var words = ARROW_KEYWORDS[dir];
    for (var i = 0; i < words.length; i++) {
      if (text.indexOf(words[i]) >= 0) return dir;
    }
  }
  return null;
}

function drawArrow(ctx, x, y, dir, color, size) {
  var len = size || 30;
  var headLen = len * 0.4;
  var dx = 0, dy = 0;

  if (dir === 'up')    { dx = 0; dy = -len; }
  else if (dir === 'down')  { dx = 0; dy = len; }
  else if (dir === 'left')  { dx = -len; dy = 0; }
  else if (dir === 'right') { dx = len; dy = 0; }
  else if (dir === 'rotate') {
    // 회전 화살표 (원호)
    ctx.beginPath();
    ctx.arc(x, y, len * 0.8, -Math.PI * 0.3, Math.PI * 0.8);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();
    // 화살촉
    var endX = x + Math.cos(Math.PI * 0.8) * len * 0.8;
    var endY = y + Math.sin(Math.PI * 0.8) * len * 0.8;
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX + 8, endY - 8);
    ctx.lineTo(endX - 4, endY - 2);
    ctx.fillStyle = color;
    ctx.fill();
    return;
  }

  var ex = x + dx, ey = y + dy;

  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(ex, ey);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();

  // 화살촉
  var angle = Math.atan2(dy, dx);
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - headLen * Math.cos(angle - 0.4), ey - headLen * Math.sin(angle - 0.4));
  ctx.lineTo(ex - headLen * Math.cos(angle + 0.4), ey - headLen * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/* ── 오버레이 프레임 그리기 ── */

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

  // 스켈레톤 라인
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
    ctx.strokeStyle = lineColor ? lineColor + 'D9' : 'rgba(255,255,255,0.45)';
    ctx.stroke();
  }

  // 관절 점
  for (var li = 0; li < lms.length; li++) {
    var lm = lms[li];
    if (!lm || lm.visibility < 0.25) continue;
    var jColor = jointColorMap[li];
    ctx.beginPath();
    ctx.arc(lm.x * w, lm.y * h, jColor ? DOT_R * 1.6 : DOT_R, 0, Math.PI * 2);
    ctx.fillStyle = jColor || 'rgba(255,255,255,0.6)';
    ctx.fill();
  }

  // 문제 관절 하이라이트 + 교정 방향 화살표
  if (hasHL) {
    for (var ii = 0; ii < issues.length; ii++) {
      var iss = issues[ii];
      var mainIdx = iss.jointIdx;
      if (mainIdx === undefined || !lms[mainIdx] || lms[mainIdx].visibility < 0.2) continue;
      var hj = lms[mainIdx];
      var cx = hj.x * w, cy = hj.y * h;
      var R = Math.max(18, w * 0.045);

      // 하이라이트 원
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = iss.color;
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = iss.color + '20';
      ctx.fill();

      // 교정 방향 화살표
      var arrowDir = detectArrowDir(iss.description);
      if (arrowDir) {
        var arrowSize = Math.max(25, w * 0.05);
        drawArrow(ctx, cx, cy - R - 5, arrowDir, iss.color, arrowSize);
      }
    }
  }

  if (!stopInfo) return;

  // 구간 번호 + 라벨
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
    var goodText = '✓ OK';
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

  // 문제 카드 (간결한 1줄 형태)
  var maxTextW = w * 0.62;
  ctx.font = fontSize + 'px sans-serif';
  var cardY = listY;

  for (var ii = 0; ii < issues.length; ii++) {
    var iss = issues[ii];
    var color = iss.color;
    var text = iss.description;

    ctx.font = fontSize + 'px sans-serif';
    var lines = wrapText(ctx, text, maxTextW - padding * 2 - fontSize);
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
