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
  if (info.valid) {
    const expected = info.partySize;
    const el = renderResult('success', {
      title: `${escapeHtml(info.name)} <span class="party-badge">Expected ${expected}</span>`,
      body: `
        <div style="margin-top:.5rem">
          <div style="font-size:.85rem;opacity:.8;margin-bottom:.4rem">
            How many actually arrived?
          </div>
          <div style="display:flex;align-items:center;gap:.5rem">
            <button type="button" class="btn btn-outline-light btn-sm" data-step="-1"
                    aria-label="Decrease">−</button>
            <input type="number" min="1" max="${expected}" value="${expected}"
                   class="form-control form-control-sm" style="width:70px;text-align:center"
                   data-role="actualSize">
            <button type="button" class="btn btn-outline-light btn-sm" data-step="1"
                    aria-label="Increase">+</button>
            <span style="font-size:.8rem;opacity:.7">of ${expected}</span>
          </div>
        </div>`,
      actions: [{
        action: 'checkin',
        className: 'btn-success',
        label: '<i class="bi bi-check2-circle"></i> Confirm check-in',
      }],
    });

    const input = el.querySelector('[data-role="actualSize"]');
    el.querySelectorAll('[data-step]').forEach(btn => {
      btn.addEventListener('click', () => {
        const step = parseInt(btn.dataset.step, 10);
        const next = Math.min(expected, Math.max(1, (parseInt(input.value, 10) || expected) + step));
        input.value = next;
      });
    });
    input.addEventListener('input', () => {
      // Clamp in real-time
      const n = parseInt(input.value, 10);
      if (!Number.isInteger(n)) return;
      if (n < 1) input.value = 1;
      else if (n > expected) input.value = expected;
    });

    el.querySelector('[data-action="checkin"]').addEventListener('click', (e) => {
      const size = parseInt(input.value, 10);
      if (!Number.isInteger(size) || size < 1 || size > expected) {
        renderResult('danger', {
          title: 'Invalid party size',
          body: `Enter a number between 1 and ${expected}.`,
        });
        return;
      }
      doCheckin(token, e.currentTarget, size);
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
  const when = info.checkedInAt ? new Date(info.checkedInAt).toLocaleString() : 'unknown';
  const by = info.staffName ? escapeHtml(info.staffName) : 'unknown staff';
  const remaining = Number(info.remaining || 0);
  const expected = Number(info.expectedPartySize || 0);
  const actual = Number(info.actualPartySize || 0);

  const bodyHtml = remaining > 0
    ? `<div style="margin-top:.35rem">
         Admitted: <strong>${actual}</strong> of <strong>${expected}</strong>.
         <div style="font-size:.8rem;opacity:.75;margin-top:.15rem">
           ${remaining} guest${remaining === 1 ? '' : 's'} not yet arrived.
         </div>
       </div>`
    : `<div style="margin-top:.35rem">All <strong>${expected}</strong> guests already admitted.</div>`;

  const actions = remaining > 0
    ? [{
        action: 'late',
        className: 'btn-warning',
        label: `<i class="bi bi-person-plus"></i> Add late arrival`,
      }]
    : [];

  const el = renderResult('warn', {
    title: `<i class="bi bi-exclamation-circle me-1"></i> Already checked in`,
    body: `<div><strong>${escapeHtml(info.name || '')}</strong></div>${bodyHtml}`,
    meta: `Original check-in ${escapeHtml(when)} by ${by}`,
    actions,
  });

  if (remaining > 0) {
    el.querySelector('[data-action="late"]').addEventListener('click', (e) => {
      showLateArrivalForm(el, token, info, e.currentTarget);
    });
  }
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

async function doCheckin(token, btn, actualPartySize) {
  setButtonSpinner(btn, true, 'Checking in…');
  els.result.querySelectorAll('button[data-action]').forEach(b => { b.disabled = true; });

  try {
    const r = await fetchWithTimeout('/admin/scanner/api/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ qrToken: token, actualPartySize }),
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
      const admitted = data.invitation.actualPartySize;
      const expected = data.invitation.expectedPartySize;
      const delta = expected - admitted;
      renderResult('success', {
        title: `<i class="bi bi-check-circle-fill me-1"></i> Checked in: ${escapeHtml(data.invitation.name)}`,
        body: delta === 0
          ? `Party of ${admitted} admitted.`
          : `Party of ${admitted} admitted (expected ${expected}).`,
        meta: `Recorded ${escapeHtml(when)}`,
      });
      return;
    }

    renderLookupResult({
      valid: false,
      reason: data.reason || 'INVALID',
      name: data.invitation?.name,
      partySize: data.invitation?.expectedPartySize || data.invitation?.partySize,
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

function showLateArrivalForm(resultEl, token, info, originBtn) {
  originBtn.disabled = true;
  const remaining = Number(info.remaining || 0);

  const form = document.createElement('div');
  form.innerHTML = `
    <div style="margin-top:.75rem;border-top:1px solid rgba(255,255,255,.15);padding-top:.75rem">
      <div style="font-size:.85rem;opacity:.85;margin-bottom:.4rem">
        How many late arrivals?
      </div>
      <div style="display:flex;align-items:center;gap:.5rem">
        <input type="number" min="1" max="${remaining}" value="1"
               class="form-control form-control-sm" style="width:70px;text-align:center"
               data-role="lateCount">
        <span style="font-size:.8rem;opacity:.7">of ${remaining} remaining</span>
      </div>
      <div style="display:flex;gap:.5rem;margin-top:.6rem">
        <button class="btn btn-sm btn-success" data-action="late-confirm">
          <i class="bi bi-check2"></i> Confirm
        </button>
        <button class="btn btn-sm btn-outline-light" data-action="late-cancel">
          Cancel
        </button>
      </div>
    </div>`;
  resultEl.appendChild(form);

  const input = form.querySelector('[data-role="lateCount"]');
  form.querySelector('[data-action="late-cancel"]').addEventListener('click', () => {
    form.remove();
    originBtn.disabled = false;
  });

  form.querySelector('[data-action="late-confirm"]').addEventListener('click', async (e) => {
    const n = parseInt(input.value, 10);
    if (!Number.isInteger(n) || n < 1 || n > remaining) {
      input.focus();
      return;
    }
    await doLateArrival(token, e.currentTarget, n);
  });
}

async function doLateArrival(token, btn, additionalCount) {
  setButtonSpinner(btn, true, 'Updating…');
  try {
    const r = await fetchWithTimeout('/admin/scanner/api/late-arrival', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ qrToken: token, additionalCount }),
    });

    if (r.status === 401) {
      setTimeout(() => { window.location.href = '/auth/login'; }, 800);
      return;
    }

    const data = await r.json().catch(() => ({}));

    if (data.ok) {
      const now = data.invitation.actualPartySize;
      const expected = data.invitation.expectedPartySize;
      const delta = expected - now;
      renderResult('success', {
        title: `<i class="bi bi-check-circle-fill me-1"></i> Late arrival recorded: ${escapeHtml(data.invitation.name)}`,
        body: delta === 0
          ? `Party fully admitted — ${now} of ${expected}.`
          : `${additionalCount} added. Now ${now} of ${expected}.`,
        meta: `Updated ${new Date().toLocaleTimeString()}`,
      });
      return;
    }

    // Surface server-side reason (TOO_MANY, FULLY_CHECKED_IN, etc.)
    renderResult('danger', {
      title: 'Could not add late arrival',
      body: escapeHtml(data.message || 'Please check the code and try again.'),
    });
  } catch (err) {
    renderResult('danger', {
      title: 'Network error',
      body: escapeHtml(err.message || 'Could not reach the server.'),
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