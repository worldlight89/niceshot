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
    'phase_coaching keys:', coaching && coaching.phase_coaching ? Object.keys(coaching.phase_coaching) : []);

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

  var phaseCoaching = coaching.phase_coaching || {};
  var phaseOrder = ['address', 'takeaway', 'backswing', 'downswing', 'impact', 'followthrough', 'finish'];

  // 단계별 점수 수집
  var phaseScores = [];
  for (var i = 0; i < phaseOrder.length; i++) {
    var key = phaseOrder[i];
    var pc = phaseCoaching[key] || {};
    var ps = typeof pc.score === 'number' ? pc.score : null;
    // score 없으면 status로 추정
    if (ps === null) {
      if (pc.status === 'good') ps = 85;
      else if (pc.status === 'warning') ps = 60;
      else if (pc.status === 'bad') ps = 35;
      else ps = 70;
    }
    phaseScores.push(ps);
  }

  // 평균 점수
  var avgScore = coaching.score;
  if (typeof avgScore !== 'number' || avgScore < 0) {
    var sum = 0;
    for (var i = 0; i < phaseScores.length; i++) sum += phaseScores[i];
    avgScore = Math.round(sum / phaseScores.length);
  }

  var avgColor = avgScore >= 80 ? '#2d6a4f' : avgScore >= 60 ? '#f39c12' : '#e74c3c';

  var html = '';

  // 평균 점수 헤더
  html += '<div class="avg-score-header" style="text-align:center;padding:16px 0 8px">';
  html += '<div style="font-size:clamp(11px,3.5vw,13px);color:#888;margin-bottom:4px">종합 점수</div>';
  html += '<div style="font-size:clamp(36px,12vw,52px);font-weight:900;color:' + avgColor + ';line-height:1">' + avgScore + '</div>';
  html += '<div style="font-size:clamp(12px,3.5vw,14px);color:#888;margin-top:2px">점 / 100점</div>';
  html += '</div>';

  // 7단계 점수 리스트
  html += '<div class="phase-score-list" style="margin:12px 0">';
  for (var i = 0; i < phaseOrder.length; i++) {
    var key = phaseOrder[i];
    var label = PHASE_LABELS[key] || key;
    var ps = phaseScores[i];
    var barColor = ps >= 80 ? '#2d6a4f' : ps >= 60 ? '#f39c12' : '#e74c3c';
    var barW = ps + '%';

    html += '<div class="phase-score-row" style="margin-bottom:10px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">';
    html += '<span style="font-size:13px;font-weight:600;color:#333">' + label + '</span>';
    html += '<span style="font-size:14px;font-weight:700;color:' + barColor + '">' + ps + '점</span>';
    html += '</div>';
    html += '<div style="background:#eee;border-radius:4px;height:8px;overflow:hidden">';
    html += '<div style="width:' + barW + ';background:' + barColor + ';height:100%;border-radius:4px;transition:width 0.8s ease-out"></div>';
    html += '</div>';
    html += '</div>';
  }
  html += '</div>';

  // 코치의 한마디 (feel_coaching)
  var feel = coaching.feel_coaching;
  if (feel && (feel.overall_feel || (feel.points && feel.points.length > 0))) {
    html += '<div class="feel-card">';
    html += '<div class="feel-title">🗣 코치의 한마디</div>';
    if (feel.overall_feel) {
      html += '<div class="feel-overall">' + escapeHtml(feel.overall_feel) + '</div>';
    }
    if (feel.points && feel.points.length > 0) {
      html += '<div class="feel-points">';
      for (var fi = 0; fi < feel.points.length; fi++) {
        html += '<div class="feel-point">';
        html += '<span class="feel-bullet">💬</span>';
        html += '<span>' + escapeHtml(feel.points[fi]) + '</span>';
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
  }

  if (coaching.drill && (coaching.drill.name || coaching.drill.method)) {
    var d = coaching.drill;
    html += '<div class="drill-card">';
    html += '<div class="drill-title">📋 ' + escapeHtml(d.name || '추천 드릴') + '</div>';
    html += '<div class="drill-method">' + escapeHtml(d.method || '') + '</div>';
    if (d.reps) html += '<div class="drill-reps">⏱ ' + escapeHtml(d.reps) + '</div>';
    html += '</div>';
  }

  html += '<button class="btn btn-outline" onclick="showSlowmoPlayer()" style="margin-top:12px;width:100%">🎬 교정 영상 보기</button>';

  wrap.innerHTML = html;
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

  console.log('[buildPhaseStops] gemini:', hasGemini,
    'phases:', Object.keys(phaseCoaching),
    'faults_fallback:', faults.length);

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
  // 매칭 범위 확대: 0.5초 이내면 사용 (어드레스/테이크어웨이 초반 프레임 대응)
  return (closest && minDist < 0.5) ? closest : null;
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
        // 정지 시 배지를 stopInfo의 phaseLabel로 강제 설정 (동기화)
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

/* ── 키워드 → 시각화 매핑 ── */
var VIS_KEYWORDS = {
  spine:    ['척추', '기울기', 'spine', '상체', '축'],
  knee:     ['무릎', 'knee', '굴곡'],
  shoulder: ['어깨', 'shoulder', '회전차', '숄더턴'],
  hip:      ['엉덩이', '힙', 'hip', '골반', '하체'],
  leftArm:  ['왼팔', '왼쪽 팔', '리드암', 'lead arm'],
  rightArm: ['오른팔', '오른쪽 팔', '트레일암', 'trail arm'],
  head:     ['머리', '헤드업', '시선', '고개']
};

function detectVisKeywords(text) {
  var found = {};
  for (var key in VIS_KEYWORDS) {
    var words = VIS_KEYWORDS[key];
    for (var wi = 0; wi < words.length; wi++) {
      if (text.indexOf(words[wi]) >= 0) { found[key] = true; break; }
    }
  }
  return found;
}

/* ── 보조 그리기 함수들 ── */

function drawAngleArc(ctx, ax, ay, bx, by, cx, cy, color, label, w, h) {
  var ba = { x: ax - bx, y: ay - by };
  var bc = { x: cx - bx, y: cy - by };
  var angA = Math.atan2(ba.y, ba.x);
  var angC = Math.atan2(bc.y, bc.x);
  var R = Math.max(20, w * 0.04);

  ctx.beginPath();
  ctx.arc(bx, by, R, angC, angA, angC > angA);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // 각도 라벨
  var midAng = (angA + angC) / 2;
  var lx = bx + Math.cos(midAng) * (R + 14);
  var ly = by + Math.sin(midAng) * (R + 14);
  var fontSize = Math.max(11, Math.round(w * 0.025));
  ctx.font = 'bold ' + fontSize + 'px sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, lx, ly);
}

function drawSpineLine(ctx, lms, w, h, color) {
  var lSho = lms[11], rSho = lms[12], lHip = lms[23], rHip = lms[24];
  if (!lSho || !rSho || !lHip || !rHip) return;
  if (lSho.visibility < 0.3 || rSho.visibility < 0.3) return;

  var shoMx = (lSho.x + rSho.x) / 2 * w;
  var shoMy = (lSho.y + rSho.y) / 2 * h;
  var hipMx = (lHip.x + rHip.x) / 2 * w;
  var hipMy = (lHip.y + rHip.y) / 2 * h;

  // 척추선 (점선)
  ctx.beginPath();
  ctx.setLineDash([6, 4]);
  ctx.moveTo(hipMx, hipMy);
  ctx.lineTo(shoMx, shoMy);
  ctx.strokeStyle = color || '#00BFFF';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.setLineDash([]);

  // 수직선 (기준)
  ctx.beginPath();
  ctx.setLineDash([3, 5]);
  ctx.moveTo(hipMx, hipMy);
  ctx.lineTo(hipMx, hipMy - (hipMy - shoMy) * 1.15);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);

  // 각도 계산 및 표시
  var spineAng = Math.round(Math.atan2(shoMx - hipMx, hipMy - shoMy) * 180 / Math.PI);
  var fontSize = Math.max(12, Math.round(w * 0.028));
  var labelX = (shoMx + hipMx) / 2 + 16;
  var labelY = (shoMy + hipMy) / 2;
  ctx.font = 'bold ' + fontSize + 'px sans-serif';
  ctx.fillStyle = color || '#00BFFF';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(spineAng + '°', labelX, labelY);
}

function drawShoulderHipLines(ctx, lms, w, h, color) {
  var lSho = lms[11], rSho = lms[12], lHip = lms[23], rHip = lms[24];
  if (!lSho || !rSho || !lHip || !rHip) return;

  // 어깨 라인
  ctx.beginPath();
  ctx.moveTo(lSho.x * w, lSho.y * h);
  ctx.lineTo(rSho.x * w, rSho.y * h);
  ctx.strokeStyle = color || '#FFD700';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // 힙 라인
  ctx.beginPath();
  ctx.moveTo(lHip.x * w, lHip.y * h);
  ctx.lineTo(rHip.x * w, rHip.y * h);
  ctx.strokeStyle = '#FF8C00';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // 회전차 라벨
  var shoTilt = Math.round(Math.atan2(rSho.y - lSho.y, rSho.x - lSho.x) * 180 / Math.PI);
  var hipTilt = Math.round(Math.atan2(rHip.y - lHip.y, rHip.x - lHip.x) * 180 / Math.PI);
  var diff = shoTilt - hipTilt;
  var fontSize = Math.max(11, Math.round(w * 0.025));
  ctx.font = 'bold ' + fontSize + 'px sans-serif';
  ctx.fillStyle = '#FFD700';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  var tx = Math.max(lSho.x, rSho.x) * w + 10;
  var ty = (lSho.y + rSho.y) / 2 * h;
  ctx.fillText('어깨 ' + shoTilt + '°', tx, ty);
  ctx.fillStyle = '#FF8C00';
  var ty2 = (lHip.y + rHip.y) / 2 * h;
  ctx.fillText('힙 ' + hipTilt + '°', tx, ty2);
}

function drawHeadIndicator(ctx, lms, w, h, color) {
  var nose = lms[0];
  if (!nose || nose.visibility < 0.3) return;
  var nx = nose.x * w, ny = nose.y * h;
  var R = Math.max(14, w * 0.03);

  ctx.beginPath();
  ctx.setLineDash([4, 3]);
  ctx.moveTo(nx, ny + R);
  ctx.lineTo(nx, ny + R + h * 0.08);
  ctx.strokeStyle = color || '#00BFFF';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(nx, ny, R, 0, Math.PI * 2);
  ctx.strokeStyle = color || '#00BFFF';
  ctx.lineWidth = 2;
  ctx.stroke();
}

/* ── 컨텍스트 시각화: 코칭 키워드 기반 ── */

function drawContextVisuals(ctx, lms, w, h, issues) {
  if (!issues || issues.length === 0) return;

  // 모든 이슈 설명에서 키워드 추출
  var allText = '';
  for (var i = 0; i < issues.length; i++) {
    allText += issues[i].description + ' ';
  }
  var visTypes = detectVisKeywords(allText);

  var mainColor = issues[0].color || '#00BFFF';

  if (visTypes.spine) {
    drawSpineLine(ctx, lms, w, h, mainColor);
  }
  if (visTypes.shoulder || visTypes.hip) {
    drawShoulderHipLines(ctx, lms, w, h, mainColor);
  }
  if (visTypes.knee) {
    // 왼무릎 각도 아크
    if (lms[23] && lms[25] && lms[27] &&
        lms[23].visibility > 0.3 && lms[25].visibility > 0.3 && lms[27].visibility > 0.3) {
      var angle = _angleDeg3(lms[23], lms[25], lms[27]);
      drawAngleArc(ctx, lms[23].x*w, lms[23].y*h, lms[25].x*w, lms[25].y*h,
                   lms[27].x*w, lms[27].y*h, '#FFD700', angle+'°', w, h);
    }
    // 오른무릎 각도 아크
    if (lms[24] && lms[26] && lms[28] &&
        lms[24].visibility > 0.3 && lms[26].visibility > 0.3 && lms[28].visibility > 0.3) {
      var angle2 = _angleDeg3(lms[24], lms[26], lms[28]);
      drawAngleArc(ctx, lms[24].x*w, lms[24].y*h, lms[26].x*w, lms[26].y*h,
                   lms[28].x*w, lms[28].y*h, '#FFD700', angle2+'°', w, h);
    }
  }
  if (visTypes.leftArm) {
    if (lms[11] && lms[13] && lms[15] &&
        lms[11].visibility > 0.3 && lms[13].visibility > 0.3 && lms[15].visibility > 0.3) {
      var ang = _angleDeg3(lms[11], lms[13], lms[15]);
      drawAngleArc(ctx, lms[11].x*w, lms[11].y*h, lms[13].x*w, lms[13].y*h,
                   lms[15].x*w, lms[15].y*h, mainColor, ang+'°', w, h);
    }
  }
  if (visTypes.rightArm) {
    if (lms[12] && lms[14] && lms[16] &&
        lms[12].visibility > 0.3 && lms[14].visibility > 0.3 && lms[16].visibility > 0.3) {
      var ang = _angleDeg3(lms[12], lms[14], lms[16]);
      drawAngleArc(ctx, lms[12].x*w, lms[12].y*h, lms[14].x*w, lms[14].y*h,
                   lms[16].x*w, lms[16].y*h, mainColor, ang+'°', w, h);
    }
  }
  if (visTypes.head) {
    drawHeadIndicator(ctx, lms, w, h, mainColor);
  }
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

  // 항상 전체 스켈레톤 표시 (stopInfo 여부와 관계없이)
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

  for (var li = 0; li < lms.length; li++) {
    var lm = lms[li];
    if (!lm || lm.visibility < 0.25) continue;
    var jColor = jointColorMap[li];
    ctx.beginPath();
    ctx.arc(lm.x * w, lm.y * h, jColor ? DOT_R * 1.6 : DOT_R, 0, Math.PI * 2);
    ctx.fillStyle = jColor || 'rgba(255,255,255,0.6)';
    ctx.fill();
  }

  // 하이라이트 원 표시 (문제 관절)
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

  // 정지 시: 코칭 키워드에 맞는 시각화 표시
  if (stopInfo && issues.length > 0) {
    drawContextVisuals(ctx, lms, w, h, issues);
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
    // 문제 없는 구간에도 기본 시각화 표시 (척추선 + 어깨/힙 라인)
    drawSpineLine(ctx, lms, w, h, '#27ae60');

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
