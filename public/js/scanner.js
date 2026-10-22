/* ============================================================
   Booking Kiosk – QR Scanner Controller
   ------------------------------------------------------------
   Modes:
     1. Native BarcodeDetector (Chrome/Edge/Android, modern desktops)
     2. html5-qrcode fallback (iOS Safari, Firefox, older browsers)
     3. Manual token entry (always available)
   ============================================================ */
'use strict';

/* ---------- Element refs ---------- */
const $ = (id) => document.getElementById(id);

const els = {
  video: $('video'),
  canvas: $('canvas'),
  stage: $('cameraStage'),
  overlayStart: $('overlayStart'),
  overlayError: $('overlayError'),
  overlayPaused: $('overlayPaused'),
  errorTitle: $('errorTitle'),
  errorHint: $('errorHint'),
  pausedText: $('pausedText'),
  statusPill: $('statusPill'),
  statusText: $('statusText'),
  startBtn: $('startBtn'),
  stopBtn: $('stopBtn'),
  manualInput: $('manualInput'),
  manualBtn: $('manualBtn'),
  result: $('result'),
  resumeWrap: $('resumeWrap'),
  resumeBtn: $('resumeBtn'),
  staffName: $('staffName'),
};

/* ---------- State ---------- */
const state = {
  stream: null,          // MediaStream
  detector: null,        // BarcodeDetector | null
  html5Scanner: null,    // Html5Qrcode | null (fallback)
  scanning: false,       // detect loop running
  paused: false,         // paused for processing / result shown
  lastScanAt: 0,         // timestamp of last successful decode (throttle)
  lastToken: null,       // last token processed (avoid duplicate handling)
  mode: null,            // 'native' | 'html5' | null
  inflightToken: null,   // token currently being looked up
  barcodeDetectorCtor: null,
};

const SCAN_THROTTLE_MS = 2200;   // ignore same QR re-scans within this window
const LOOKUP_TIMEOUT_MS = 12000; // hard timeout for lookup requests

/* ============================================================
   Utilities
   ============================================================ */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function setStatus(kind, text) {
  els.statusPill.classList.remove('live', 'paused', 'error');
  if (kind === 'live') els.statusPill.classList.add('live');
  else if (kind === 'paused') els.statusPill.classList.add('paused');
  else if (kind === 'error') els.statusPill.classList.add('error');
  els.statusText.textContent = text;
}

function showOverlay(name) {
  els.overlayStart.classList.toggle('d-none', name !== 'start');
  els.overlayError.classList.toggle('d-none', name !== 'error');
  els.overlayPaused.classList.toggle('d-none', name !== 'paused');
  if (!name) {
    els.overlayStart.classList.add('d-none');
    els.overlayError.classList.add('d-none');
    els.overlayPaused.classList.add('d-none');
  }
}

function setStageActive(active) {
  els.stage.classList.toggle('scanner-active', !!active);
}

function setStartStopButtons({ startEnabled, stopEnabled }) {
  els.startBtn.disabled = !startEnabled;
  els.stopBtn.disabled = !stopEnabled;
}

function setButtonSpinner(btn, on, label) {
  if (on) {
    btn.dataset._html = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status"></span>
                     <span class="btn-label">${escapeHtml(label || 'Working…')}</span>`;
  } else {
    btn.disabled = false;
    if (btn.dataset._html) {
      btn.innerHTML = btn.dataset._html;
      delete btn.dataset._html;
    }
  }
}

/* ============================================================
   Result rendering
   ============================================================ */
function clearResult() {
  els.result.innerHTML = '';
  els.resumeWrap.classList.add('d-none');
}

function showResume() {
  els.resumeWrap.classList.remove('d-none');
}

function renderResult(kind, { title, body, meta, actions = [] }) {
  const iconFor = {
    success: 'bi-check-circle-fill',
    warn: 'bi-exclamation-triangle-fill',
    danger: 'bi-x-octagon-fill',
    info: 'bi-info-circle-fill',
  };
  const el = document.createElement('div');
  el.className = `result ${kind}`;
  el.innerHTML = `
    <div class="ic"><i class="bi ${iconFor[kind] || 'bi-info-circle-fill'}"></i></div>
    <div class="flex-grow-1">
      <div class="title">${title}</div>
      ${body ? `<div class="body">${body}</div>` : ''}
      ${meta ? `<div class="meta">${meta}</div>` : ''}
      ${actions.length ? `<div class="result-actions">${actions.map(a => `
        <button class="btn btn-sm ${a.className || 'btn-light'}"
                data-action="${escapeHtml(a.action)}"
                ${a.disabled ? 'disabled' : ''}>
          ${a.label}
        </button>`).join('')}</div>` : ''}
    </div>`;

  els.result.innerHTML = '';
  els.result.appendChild(el);
  showResume();
  return el;
}

/* ============================================================
   Pause / resume scanning
   ============================================================ */
function pauseScanning(message) {
  state.paused = true;
  if (message) els.pausedText.textContent = message;
  setStageActive(false);
  showOverlay('paused');
  setStatus('paused', 'Paused');
}

function resumeScanning() {
  if (!state.scanning) return;
  state.paused = false;
  state.inflightToken = null;
  state.lastToken = null;
  clearResult();
  setStageActive(true);
  showOverlay(null);
  setStatus('live', 'Scanning');
  if (state.mode === 'native') {
    // kick the loop again in case it exited
    requestAnimationFrame(scanLoop);
  }
}

/* ============================================================
   Lookup (does not check in) + Check-in
   ============================================================ */
async function fetchWithTimeout(url, options = {}, timeoutMs = LOOKUP_TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function lookupToken(token) {
  if (state.inflightToken === token) return; // avoid double submit
  state.inflightToken = token;
  pauseScanning('Looking up…');

  try {
    const r = await fetchWithTimeout('/admin/scanner/api/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ qrToken: token }),
    });

    if (r.status === 401) {
      renderResult('danger', {
        title: 'Session expired',
        body: 'Please sign in again.',
      });
      setTimeout(() => { window.location.href = '/auth/login'; }, 1200);
      return;
    }

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      renderResult('danger', {
        title: 'Lookup failed',
        body: escapeHtml(data.error || 'Server error. Please try again.'),
      });
      return;
    }

    renderLookupResult(data, token);
  } catch (err) {
    if (err.name === 'AbortError') {
      renderResult('danger', {
        title: 'Request timed out',
        body: 'Check your network and try again.',
      });
    } else {
      renderResult('danger', {
        title: 'Network error',
        body: escapeHtml(err.message || 'Could not reach the server.'),
      });
    }
  } finally {
    state.inflightToken = null;
  }
}

function renderLookupResult(info, token) {
  // info shape:
  //   { valid: true, name, partySize }
  //   { valid: false, reason, name?, partySize?, checkedInAt?, staffName? }
  if (info.valid) {
    const el = renderResult('success', {
      title: `${escapeHtml(info.name)} <span class="party-badge">Party of ${info.partySize}</span>`,
      body: 'Confirm to check in the entire party.',
      actions: [{
        action: 'checkin',
        className: 'btn-success',
        label: '<i class="bi bi-check2-circle"></i> Check In Party',
      }],
    });
    el.querySelector('[data-action="checkin"]').addEventListener('click', (e) => {
      doCheckin(token, e.currentTarget);
    });
    return;
  }

  // Not valid — show reason
  const reason = info.reason || 'UNKNOWN';
  const nameLine = info.name ? escapeHtml(info.name) : '';
  const partyLine = info.partySize ? `Party of ${info.partySize}` : '';
  const titleParts = [nameLine, partyLine].filter(Boolean).join(' · ');

  switch (reason) {
    case 'ALREADY_CHECKED_IN': {
      const when = info.checkedInAt ? new Date(info.checkedInAt).toLocaleString() : 'unknown time';
      const by = info.staffName ? escapeHtml(info.staffName) : 'unknown staff';
      renderResult('warn', {
        title: `<i class="bi bi-exclamation-circle me-1"></i> Already checked in`,
        body: titleParts || 'This party has already been checked in.',
        meta: `At ${escapeHtml(when)} by ${by}`,
      });
      break;
    }
    case 'REVOKED':
      renderResult('danger', {
        title: 'QR code revoked',
        body: 'This code is no longer valid. Issue a new one from the admin panel.',
      });
      break;
    case 'DECLINED':
      renderResult('danger', {
        title: 'Party declined',
        body: titleParts || 'This invitation was declined.',
        meta: 'Guest cannot attend.',
      });
      break;
    case 'NOT_ACCEPTED':
      renderResult('danger', {
        title: 'Not confirmed',
        body: titleParts || 'Guest has not confirmed attendance.',
        meta: 'Ask them to complete their RSVP first.',
      });
      break;
    case 'INVALID':
    default:
      renderResult('danger', {
        title: 'Invalid QR code',
        body: 'This code was not issued by this system.',
      });
      break;
  }
}

async function doCheckin(token, btn) {
  setButtonSpinner(btn, true, 'Checking in…');
  // Disable other action buttons too
  els.result.querySelectorAll('button[data-action]').forEach(b => { b.disabled = true; });

  try {
    const r = await fetchWithTimeout('/admin/scanner/api/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ qrToken: token }),
    });

    if (r.status === 401) {
      setTimeout(() => { window.location.href = '/auth/login'; }, 800);
      return;
    }

    const data = await r.json().catch(() => ({}));

    if (data.ok) {
      const when = data.checkin?.checked_in_at
        ? new Date(data.checkin.checked_in_at).toLocaleString()
        : 'just now';
      renderResult('success', {
        title: `<i class="bi bi-check-circle-fill me-1"></i> Checked in: ${escapeHtml(data.invitation.name)}`,
        body: `Party of ${data.invitation.partySize} admitted.`,
        meta: `Recorded ${escapeHtml(when)}`,
      });
      return;
    }

    // Server said not ok — reuse reason messaging
    renderLookupResult({
      valid: false,
      reason: data.reason || 'INVALID',
      name: data.invitation?.name,
      partySize: data.invitation?.partySize,
      checkedInAt: data.existing?.checked_in_at,
      staffName: data.existing?.staff_name,
    }, token);
  } catch (err) {
    renderResult('danger', {
      title: 'Check-in failed',
      body: escapeHtml(err.message || 'Network error.'),
    });
  }
}

/* ============================================================
   Native BarcodeDetector path
   ============================================================ */
async function startNativeCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  state.stream = stream;
  els.video.srcObject = stream;
  await els.video.play();

  state.detector = new state.barcodeDetectorCtor({ formats: ['qr_code'] });
  state.mode = 'native';
  state.scanning = true;
  state.paused = false;

  setStartStopButtons({ startEnabled: false, stopEnabled: true });
  setStatus('live', 'Scanning');
  showOverlay(null);
  setStageActive(true);

  requestAnimationFrame(scanLoop);
}

async function scanLoop() {
  if (!state.scanning || state.paused) return;
  try {
    const now = Date.now();
    const video = els.video;
    if (video.readyState >= 2 && now - state.lastScanAt > 300) {
      const codes = await state.detector.detect(video);
      if (codes.length > 0) {
        const raw = codes[0].rawValue || '';
        const now2 = Date.now();
        if (raw && (raw !== state.lastToken || now2 - state.lastScanAt > SCAN_THROTTLE_MS)) {
          state.lastToken = raw;
          state.lastScanAt = now2;
          // Fire-and-forget — lookup pauses the loop
          lookupToken(raw);
          return; // loop will resume via resumeScanning()
        }
      }
    }
  } catch (err) {
    // BarcodeDetector can throw on transient frames — ignore.
    console.debug('[scanner] detect error', err?.message);
  }
  requestAnimationFrame(scanLoop);
}

/* ============================================================
   html5-qrcode fallback (loaded on demand)
   ============================================================ */
let html5QrcodeLoading = null;

function loadHtml5QrcodeLibrary() {
  if (window.Html5Qrcode) return Promise.resolve();
  if (html5QrcodeLoading) return html5QrcodeLoading;

  html5QrcodeLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load html5-qrcode'));
    document.head.appendChild(s);
  });
  return html5QrcodeLoading;
}

async function startHtml5Fallback() {
  await loadHtml5QrcodeLibrary();

  // html5-qrcode needs a container element. Use the video's parent stage
  // and hide the raw <video> while it manages its own preview.
  els.video.style.display = 'none';

  // Create a div for the fallback renderer
  let container = document.getElementById('html5-qrcode-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'html5-qrcode-container';
    container.style.cssText = 'position:absolute;inset:0;';
    els.stage.appendChild(container);
  } else {
    container.innerHTML = '';
    container.style.display = '';
  }

  const scanner = new window.Html5Qrcode('html5-qrcode-container', {
    verbose: false,
  });
  state.html5Scanner = scanner;
  state.mode = 'html5';

  await scanner.start(
    { facingMode: 'environment' },
    {
      fps: 10,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const min = Math.min(viewfinderWidth, viewfinderHeight);
        const size = Math.floor(min * 0.75);
        return { width: size, height: size };
      },
    },
    (decodedText) => {
      if (state.paused) return;
      const now = Date.now();
      if (!decodedText) return;
      if (decodedText === state.lastToken && now - state.lastScanAt < SCAN_THROTTLE_MS) return;
      state.lastToken = decodedText;
      state.lastScanAt = now;
      lookupToken(decodedText);
    },
    () => { /* per-frame decode errors — ignore */ }
  );

  state.scanning = true;
  state.paused = false;
  setStartStopButtons({ startEnabled: false, stopEnabled: true });
  setStatus('live', 'Scanning');
  showOverlay(null);
  setStageActive(true);
}

/* ============================================================
   Start / Stop
   ============================================================ */
async function startCamera() {
  if (state.scanning) return;

  // Detect capabilities
  state.barcodeDetectorCtor = 'BarcodeDetector' in window ? window.BarcodeDetector : null;
  const hasNative = !!state.barcodeDetectorCtor;
  const hasMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  if (!hasMedia) {
    showCameraError('Camera not supported',
      'This browser does not expose camera access. Use manual entry below.');
    return;
  }

  // HTTPS required in production (except localhost)
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    showCameraError('HTTPS required',
      'Camera access requires a secure (HTTPS) page. Use manual entry below.');
    return;
  }

  clearResult();
  showOverlay(null);

  try {
    if (hasNative) {
      await startNativeCamera();
    } else {
      await startHtml5Fallback();
    }
  } catch (err) {
    console.error('[scanner] start failed', err);
    await cleanupCamera();
    showCameraError('Camera unavailable', friendlyCameraError(err));
  }
}

function friendlyCameraError(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Camera permission was denied. Allow access in your browser settings and retry.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No camera found on this device. Use manual entry below.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'The camera is being used by another app. Close it and retry.';
  }
  if (name === 'OverconstrainedError') {
    return 'Camera does not support the requested settings. Try a different device.';
  }
  return err?.message || 'Could not start the camera.';
}

function showCameraError(title, hint) {
  els.errorTitle.textContent = title;
  els.errorHint.textContent = hint;
  showOverlay('error');
  setStatus('error', 'Camera error');
  setStartStopButtons({ startEnabled: true, stopEnabled: false });
  setStageActive(false);
}

async function stopCamera() {
  await cleanupCamera();
  showOverlay('start');
  setStatus('off', 'Camera off');
  setStartStopButtons({ startEnabled: true, stopEnabled: false });
  setStageActive(false);
  clearResult();
}

async function cleanupCamera() {
  state.scanning = false;
  state.paused = false;

  if (state.html5Scanner) {
    try { await state.html5Scanner.stop(); } catch (_) {}
    try { await state.html5Scanner.clear(); } catch (_) {}
    state.html5Scanner = null;
    const container = document.getElementById('html5-qrcode-container');
    if (container) container.remove();
    els.video.style.display = '';
  }

  if (state.stream) {
    try { state.stream.getTracks().forEach(t => t.stop()); } catch (_) {}
    state.stream = null;
  }
  els.video.srcObject = null;
  state.detector = null;
  state.mode = null;
}

/* ============================================================
   Manual entry
   ============================================================ */
async function submitManualToken() {
  const token = els.manualInput.value.trim();
  if (!token) {
    els.manualInput.focus();
    return;
  }
  setButtonSpinner(els.manualBtn, true, 'Looking up…');
  els.manualInput.disabled = true;

  try {
    await lookupToken(token);
  } finally {
    setButtonSpinner(els.manualBtn, false);
    els.manualInput.disabled = false;
    els.manualInput.value = '';
    els.manualInput.focus();
  }
}

/* ============================================================
   Event wiring
   ============================================================ */
els.startBtn.addEventListener('click', startCamera);
els.stopBtn.addEventListener('click', stopCamera);
els.manualBtn.addEventListener('click', submitManualToken);
els.manualInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    submitManualToken();
  }
});
els.resumeBtn.addEventListener('click', () => {
  resumeScanning();
  // If camera is off, at least clear the result
  if (!state.scanning) {
    clearResult();
    showOverlay('start');
    setStatus('off', 'Camera off');
  }
});

/* Pause video track when the tab is hidden (saves battery) */
document.addEventListener('visibilitychange', () => {
  if (!state.stream) return;
  const tracks = state.stream.getVideoTracks();
  const hidden = document.hidden;
  tracks.forEach(t => { t.enabled = !hidden; });
});

/* Cleanup on unload */
window.addEventListener('beforeunload', () => {
  try { stopCamera(); } catch (_) {}
});

/* ============================================================
   Init
   ============================================================ */
async function loadStaffName() {
  try {
    const r = await fetch('/admin/api/me', { headers: { 'Accept': 'application/json' } });
    if (r.status === 401) { window.location.href = '/auth/login'; return; }
    const data = await r.json();
    if (data?.user?.name) els.staffName.textContent = data.user.name;
  } catch (_) { /* non-fatal */ }
}

(function init() {
  loadStaffName();
  setStatus('off', 'Camera off');
  setStartStopButtons({ startEnabled: true, stopEnabled: false });
  showOverlay('start');
})();