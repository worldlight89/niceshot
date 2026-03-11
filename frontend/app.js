const BACKEND_BASE = (typeof window !== "undefined" && window.NICESHOT_API_URL) || "http://localhost:8002";

const $ = (id) => document.getElementById(id);

const steps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
let currentStep = 0;
window._currentStep = 0;
let state = {
  club: null,
  swingCount: null,
  concern: "",
  clips: [],
  metricsByClip: {},
};
window._state = state;

let stream = null;
let pose = null;
let poseLoopRunning = false;
let lastPoseSentAt = 0;
let okStreak = 0;
let setupPerfectPlayed = false;

const CLUBS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "PW", "드라이버"];

const preview = $("preview");
const overlay = $("overlay");
const framingPill = $("framingPill");
const step6Status = $("step6Status");

function showStep(n) {
  steps.forEach((s) => {
    const el = document.getElementById(`step${s}`);
    if (el) el.hidden = s !== n;
  });
  currentStep = n;
  window._currentStep = n;
}
// 인라인 goStep과 동기화
window.goStep = showStep;

function speak(text, lang = "ko-KR") {
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.start(t);
    osc.stop(t + 0.3);
    osc.onended = () => ctx.close();
  } catch (_) {}
}

function beepSetupPerfect() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 523;
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.2, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.start(t);
    osc.stop(t + 0.45);
    osc.onended = () => ctx.close();
  } catch (_) {}
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- Step 0: NICESHOT ----------
function goToStep1() {
  showStep(1);
}
window.niceshotGoNext = goToStep1;

// ---------- 한 곳에서 모든 버튼 처리 ----------
function handleButtonAction(btn) {
  var next = btn.getAttribute("data-next");
  if (next !== null) {
    var n = parseInt(next, 10);
    if (btn.id === "btnStep4Next") {
      state.concern = ($("concernInput") && $("concernInput").value ? $("concernInput").value.trim() : "");
      if ($("summaryClub")) $("summaryClub").textContent = state.club || "-";
      if ($("summaryCount")) $("summaryCount").textContent = state.swingCount ?? "-";
    }
    if (btn.id === "btnStartPractice") {
      showStep(6);
      var s6s = document.getElementById("step6Status");
      if (s6s) s6s.textContent = "카메라를 켜는 중...";
      setupPerfectPlayed = false;
      okStreak = 0;
      startCamera().then(function () {
        var s6s2 = document.getElementById("step6Status");
        if (s6s2) s6s2.textContent = "위치를 맞추면 알림이 울립니다";
      });
      return;
    }
    showStep(n);
    return;
  }

  if (btn.id === "btnSkipConcern") {
    if ($("concernInput")) $("concernInput").value = "";
    state.concern = "";
    return;
  }
  if (btn.id === "btnAnalyze") {
    uploadAndShowResults();
    return;
  }
  if (btn.id === "btnAgain") {
    resetFlow();
    return;
  }

  if (btn.classList.contains("clubBtn")) {
    var wrap = $("clubWrap");
    if (wrap) {
      wrap.querySelectorAll(".clubBtn").forEach(function (b) { b.classList.remove("selected"); });
      btn.classList.add("selected");
      state.club = btn.textContent;
      var n2 = $("btnStep2Next");
      if (n2) n2.disabled = false;
    }
    return;
  }
  if (btn.classList.contains("chip") && btn.closest("#step3")) {
    document.querySelectorAll("#step3 .chip").forEach(function (b) { b.classList.remove("selected"); });
    btn.classList.add("selected");
    state.swingCount = parseInt(btn.getAttribute("data-value"), 10);
    var n3 = $("btnStep3Next");
    if (n3) n3.disabled = false;
    return;
  }
}

var _lastTouchTarget = null;
document.querySelector(".app").addEventListener("touchend", function (e) {
  var btn = e.target.closest("button");
  if (!btn) return;
  e.preventDefault(); // ghost click 방지
  _lastTouchTarget = btn;
  handleButtonAction(btn);
}, { passive: false });

document.querySelector(".app").addEventListener("click", function (e) {
  var btn = e.target.closest("button");
  if (!btn) return;
  if (btn === _lastTouchTarget) { _lastTouchTarget = null; return; } // 터치 후 중복 click 무시
  handleButtonAction(btn);
});

function initClubStep() {
  var wrap = $("clubWrap");
  if (!wrap) return;
  wrap.innerHTML = "";
  CLUBS.forEach(function (c) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "clubBtn";
    btn.textContent = c;
    wrap.appendChild(btn);
  });
}

function clearStep2() {
  state.club = null;
  state.swingCount = null;
  var wrap = $("clubWrap");
  if (wrap) wrap.querySelectorAll(".clubBtn").forEach(function (b) { b.classList.remove("selected"); });
  var n2 = $("btnStep2Next");
  if (n2) n2.disabled = true;
  document.querySelectorAll("#step3 .chip").forEach(function (b) { b.classList.remove("selected"); });
  var n3 = $("btnStep3Next");
  if (n3) n3.disabled = true;
}

async function startCamera() {
  if (stream) return stream;
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  preview.srcObject = stream;
  await preview.play();
  startPoseGuideIfPossible();
  return stream;
}

function stopCamera() {
  if (!stream) return;
  stream.getTracks().forEach((t) => t.stop());
  stream = null;
  preview.srcObject = null;
  stopPoseGuide();
}

function ensureOverlaySize() {
  if (!preview || !overlay) return;
  const w = preview.videoWidth || 1280;
  const h = preview.videoHeight || 720;
  if (overlay.width !== w) overlay.width = w;
  if (overlay.height !== h) overlay.height = h;
}

function drawGuide(bbox, ok) {
  if (!overlay) return;
  ensureOverlaySize();
  const ctx = overlay.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const padX = overlay.width * 0.08;
  const padY = overlay.height * 0.07;
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 10]);
  ctx.strokeRect(padX, padY, overlay.width - padX * 2, overlay.height - padY * 2);
  ctx.setLineDash([]);
  if (bbox) {
    ctx.strokeStyle = ok ? "rgba(167,243,208,0.9)" : "rgba(251,113,133,0.9)";
    ctx.lineWidth = 4;
    ctx.strokeRect(bbox.x, bbox.y, bbox.w, bbox.h);
  }
}

function stopPoseGuide() {
  poseLoopRunning = false;
  okStreak = 0;
  setupPerfectPlayed = false;
  drawGuide(null, false);
}

async function startPoseGuideIfPossible() {
  if (poseLoopRunning || typeof Pose === "undefined") return;
  if (!pose) {
    pose = new Pose({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
    });
    pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
    pose.onResults(onPoseResults);
  }
  okStreak = 0;
  poseLoopRunning = true;
  requestAnimationFrame(poseLoop);
}

function poseLoop(ts) {
  if (!poseLoopRunning || !pose || !preview || preview.readyState < 2) return;
  if (ts - lastPoseSentAt > 66) {
    lastPoseSentAt = ts;
    pose.send({ image: preview }).catch(() => {});
  }
  requestAnimationFrame(poseLoop);
}

function onPoseResults(results) {
  const lms = results.poseLandmarks;
  if (!lms || lms.length === 0) {
    okStreak = 0;
    if (framingPill) framingPill.textContent = "프레임에 전신이 들어오게 서주세요";
    if (step6Status) step6Status.textContent = "위치를 맞춰주세요";
    drawGuide(null, false);
    return;
  }
  const pts = lms.filter((p) => (p.visibility ?? 0) > 0.55);
  if (pts.length < 10) {
    okStreak = 0;
    drawGuide(null, false);
    return;
  }
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  pts.forEach((p) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  });
  const h = maxY - minY;
  const cx = (minX + maxX) / 2;
  const okSize = h >= 0.6 && h <= 0.92;
  const okCenter = Math.abs(cx - 0.5) <= 0.22;
  const ok = okSize && okCenter;
  const bbox = {
    x: minX * overlay.width,
    y: minY * overlay.height,
    w: (maxX - minX) * overlay.width,
    h: (maxY - minY) * overlay.height,
  };
  drawGuide(bbox, ok);
  if (ok) {
    okStreak++;
    if (framingPill) framingPill.textContent = "세팅 좋아요! 유지하세요";
    if (step6Status) step6Status.textContent = "잠시 후 연습이 시작됩니다";
    if (okStreak >= 15 && !setupPerfectPlayed) {
      setupPerfectPlayed = true;
      beepSetupPerfect();
      speak("세팅 완벽");
      setTimeout(() => {
        if (currentStep !== 6) return;
        if (step6Status) step6Status.textContent = "5초 후 스윙 연습을 시작합니다";
        setTimeout(() => {
          if (currentStep !== 6) return;
          speak("스윙 연습을 시작합니다. 준비하세요.");
          if (step6Status) step6Status.textContent = "준비하세요.";
          setTimeout(() => startRecordingPhase(), 2000);
        }, 5000);
      }, 800);
    }
  } else {
    okStreak = 0;
  }
}

function startRecordingPhase() {
  showStep(7);
  stopPoseGuide();
  const previewRecord = $("previewRecord");
  if (stream && previewRecord) {
    previewRecord.srcObject = stream;
    previewRecord.play().catch(() => {});
  }
  runRecordingLoop();
}

const RECORD_SECONDS = 8;
const COUNTDOWN_SECONDS = 5;

async function runRecordingLoop() {
  const phaseText = $("recordPhaseText");
  const countEl = $("recordCountdown");
  const count = state.swingCount || 1;
  state.clips = [];

  for (let i = 1; i <= count; i++) {
    phaseText.textContent = i === 1 ? "첫 번째 스윙" : `${i}번째 스윙`;
    countEl.textContent = "";
    beep();
    speak(i === 1 ? "첫 번째 스윙" : `${i}번째 스윙`);
    for (let s = COUNTDOWN_SECONDS; s >= 1; s--) {
      countEl.textContent = s;
      await sleep(1000);
    }
    countEl.textContent = "녹화 중";
    const clip = await recordOneClip(i, RECORD_SECONDS);
    state.clips.push(clip);
    if (i < count) await sleep(500);
  }

  phaseText.textContent = "녹화 완료";
  countEl.textContent = "";
  showStep(8);
  $("clipCount").textContent = state.clips.length;
}

async function recordOneClip(idx, seconds) {
  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : "video/webm";
  const chunks = [];
  const rec = new MediaRecorder(stream, { mimeType: mime });
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.start(200);
  await sleep(seconds * 1000);
  rec.stop();
  const blob = await new Promise((res) => {
    rec.onstop = () => res(new Blob(chunks, { type: rec.mimeType || "video/webm" }));
  });
  return { idx, blob, mimeType: blob.type || "video/webm" };
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function uploadAndShowResults() {
  const btn = $("btnAnalyze");
  btn.disabled = true;
  const resultsEl = $("results");
  resultsEl.innerHTML = "<p class=\"screenSub\">분석 중...</p>";
  showStep(9);

  const fd = new FormData();
  state.clips.forEach((c) => {
    fd.append("clips", c.blob, `clip-${c.idx}.webm`);
  });
  fd.append("metrics_json", JSON.stringify(state.metricsByClip || {}));
  fd.append("notes", [state.club ? `${state.club}번 클럽`, state.concern].filter(Boolean).join(" · "));

  try {
    const r = await fetch(`${BACKEND_BASE}/api/analyze`, { method: "POST", body: fd });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    const list = data.results || [];
    resultsEl.innerHTML = "";

    if (list.length === 0) {
      resultsEl.innerHTML = `
        <div class="resultCard resultCard--empty">
          <p class="resultEmptyTitle">분석 결과가 없습니다</p>
          <p class="resultEmptyText">저장된 클립이 없거나 서버에서 결과를 받지 못했을 수 있어요.<br>백엔드(포트 8002)가 켜져 있는지 확인하고, 다시 녹화 후 시도해 주세요.</p>
        </div>
      `;
    } else {
      list.forEach((res) => {
        const div = document.createElement("div");
        div.className = "resultCard";
        const pos = (res.positives || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("");
        const fix = (res.fixes || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("");
        div.innerHTML = `
          <h3>클립 ${res.clipIndex}</h3>
          <div class="k"><strong>요약</strong></div>
          <div class="v">${escapeHtml(res.summary || "")}</div>
          <div class="k"><strong>좋은 점</strong></div>
          <div class="v"><ul>${pos}</ul></div>
          <div class="k"><strong>개선점</strong></div>
          <div class="v"><ul>${fix}</ul></div>
          <div class="k"><strong>드릴</strong></div>
          <div class="v">${escapeHtml(res.drill || "")}</div>
        `;
        resultsEl.appendChild(div);
      });
    }
  } catch (e) {
    resultsEl.innerHTML = `
      <div class="resultCard resultCard--error">
        <p class="resultEmptyTitle">분석 실패</p>
        <p class="resultEmptyText">${escapeHtml(e.message)}</p>
        <p class="resultEmptyText">백엔드가 실행 중인지 확인해 주세요. (주소: ${escapeHtml(BACKEND_BASE)})</p>
      </div>
    `;
  }
  btn.disabled = false;
}

function resetFlow() {
  stopCamera();
  state = { club: null, swingCount: null, concern: "", clips: [], metricsByClip: {} };
  setupPerfectPlayed = false;
  showStep(0);
  clearStep2();
}

$("btnAnalyze")?.addEventListener("click", uploadAndShowResults);
$("btnAgain")?.addEventListener("click", resetFlow);

// ---------- Init ----------
showStep(0);
initClubStep();
