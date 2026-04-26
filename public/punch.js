import { postJson, showMessage, setBusy } from '/app.js';

import { mountTopBar, mountFooter } from '/topbar.js';
mountTopBar();
mountFooter();

const $ = (id) => document.getElementById(id);
const statusBlock = $('status-block');
const statusLabel = $('status-label');
const statusMeta  = $('status-meta');
const commentEl   = $('comment');
const shareGeo    = $('share-geo');
const geoStatusEl = $('geo-status');
const inBtn       = $('clock-in-btn');
const outBtn      = $('clock-out-btn');
const messageEl   = $('message');
const listEl      = $('today-list');
const allLink     = $('all-today-link');
const mapCard     = $('map-card');
const mapTile     = $('map-tile');
const mapMeta     = $('map-meta');
const retryGeoBtn = $('retry-geo-btn');

let isOpen = false;
let me = null;
let lastFix = null;     // most recent {lat, lng, accuracy, ts} from a real geolocation reading

// -------- sessionStorage cache --------------------------------------------
// Cache the last successful fix per browser session so navigating between
// pages doesn't re-trigger the platform geolocation backend (which on macOS
// emits a kCLErrorLocationUnknown to the console on every failed call).
//
// We also remember a "tried and failed" sentinel so the bootstrap doesn't
// auto-retry on every page load when location is unavailable. The user can
// always click "Retry location" to force a fresh attempt.

const GEO_CACHE_KEY = 'pica-last-geo-fix';
const GEO_FAILED_KEY = 'pica-geo-failed-this-session';

function loadCachedFix() {
  try {
    const raw = sessionStorage.getItem(GEO_CACHE_KEY);
    if (!raw) return null;
    const fix = JSON.parse(raw);
    if (typeof fix?.lat === 'number' && typeof fix?.lng === 'number') return fix;
  } catch {}
  return null;
}
function saveCachedFix(fix) {
  try { sessionStorage.setItem(GEO_CACHE_KEY, JSON.stringify(fix)); } catch {}
  try { sessionStorage.removeItem(GEO_FAILED_KEY); } catch {}
}
function markGeoFailed() {
  try { sessionStorage.setItem(GEO_FAILED_KEY, '1'); } catch {}
}
function geoFailedThisSession() {
  try { return sessionStorage.getItem(GEO_FAILED_KEY) === '1'; } catch { return false; }
}

// -------- Time formatting (24-hour HH:MM from an ISO timestamp) -------------

function formatTime(iso) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function relative(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// -------- Status block + button enable/disable ------------------------------

/**
 * Repaint the status header and lock the two buttons so only the one that
 * makes sense is clickable. The other is `disabled` but stays visually
 * present (the CSS overrides the default greyed-out wash).
 */
function paintStatus({ open, lastPunch }) {
  isOpen = open;
  statusBlock.classList.remove('status-block--in', 'status-block--out', 'status-block--unknown');
  if (open) {
    statusBlock.classList.add('status-block--in');
    statusLabel.textContent = 'Clocked in';
    statusMeta.textContent  = lastPunch ? `since ${formatTime(lastPunch.ts)} (${relative(lastPunch.ts)})` : '';
    inBtn.disabled  = true;
    outBtn.disabled = false;
  } else {
    statusBlock.classList.add('status-block--out');
    statusLabel.textContent = 'Clocked out';
    statusMeta.textContent  = lastPunch ? `last: ${formatTime(lastPunch.ts)} (${relative(lastPunch.ts)})` : 'no punches yet';
    inBtn.disabled  = false;
    outBtn.disabled = true;
  }
}

// -------- Geolocation -------------------------------------------------------

/**
 * Get a geolocation fix.
 *
 * Strategy:
 *   1. Try a fast low-accuracy reading (Wi-Fi/IP triangulation, ~15s timeout).
 *      Accept any reading from the last 5 minutes from the browser's cache.
 *   2. If that times out or errors, try once more with high-accuracy on
 *      (some platforms only fill in a position when explicitly asked).
 *   3. If both fail and we have a remembered last fix, return null without
 *      clearing the map — the caller decides whether to keep showing the
 *      stale map or hide it.
 *
 * Returns {lat, lng, accuracy} on success, null on failure.
 */
function getGeo() {
  return new Promise((resolve) => {
    if (!shareGeo.checked) return resolve(null);
    if (!('geolocation' in navigator)) {
      geoStatusEl.textContent = 'Your browser does not support geolocation.';
      return resolve(null);
    }

    geoStatusEl.textContent = 'Getting your location…';

    const success = (pos) => {
      geoStatusEl.textContent = '';
      retryGeoBtn.hidden = true;
      resolve({
        lat:      pos.coords.latitude,
        lng:      pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      });
    };

    // Attempt #2 — high-accuracy fallback. Some browsers/platforms refuse
    // to return a quick low-accuracy fix and only respond to this mode.
    const tryHighAccuracy = (prevErr) => {
      navigator.geolocation.getCurrentPosition(
        success,
        (err) => {
          const msg = err.code === err.TIMEOUT
            ? 'Location request timed out. Try again, or move closer to a window.'
            : `Location unavailable: ${err.message}`;
          geoStatusEl.textContent = msg;
          retryGeoBtn.hidden = false;
          markGeoFailed();
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 300_000 },
      );
    };

    // Attempt #1 — fast low-accuracy.
    navigator.geolocation.getCurrentPosition(
      success,
      tryHighAccuracy,
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300_000 },
    );
  });
}

// -------- OSM map (single static tile) --------------------------------------

/**
 * Compute (x, y) tile coordinates for a given (lat, lng, zoom).
 * Standard slippy-map math (Mercator projection).
 */
function lngLatToTile(lng, lat, zoom) {
  const n = 2 ** zoom;
  const x = Math.floor((lng + 180) / 360 * n);
  const latRad = lat * Math.PI / 180;
  const y = Math.floor(
    (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n
  );
  return { x, y };
}

/**
 * Render a single OSM tile centered (close enough) on the given coords.
 * Fetched directly from tile.openstreetmap.org — no API key, no JS library.
 */
function renderMap({ lat, lng, accuracy }) {
  const zoom = 16;
  const { x, y } = lngLatToTile(lng, lat, zoom);
  // Cache-bust per fix so a new punch refreshes the tile reliably.
  mapTile.src = `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
  const acc = accuracy ? ` (±${Math.round(accuracy)} m)` : '';
  mapMeta.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}${acc}`;
  mapCard.hidden = false;
}

function hideMap() {
  mapCard.hidden = true;
}

// -------- Today list --------------------------------------------------------

function renderList(punches) {
  // Update the today-total label next to the section heading.
  const totalEl = document.getElementById('today-total');
  if (totalEl) {
    if (punches.length === 0) {
      totalEl.hidden = true;
    } else {
      totalEl.hidden = false;
      totalEl.textContent = formatDuration(totalWorkedMs(punches));
    }
  }

  listEl.innerHTML = '';
  if (punches.length === 0) {
    const li = document.createElement('li');
    li.className = 'subtle';
    li.textContent = 'No punches yet today.';
    listEl.appendChild(li);
    return;
  }
  // Newest first — easier to scan on a phone.
  for (const p of [...punches].reverse()) {
    const li = document.createElement('li');
    li.className = 'punch-list__item';

    const badge = document.createElement('span');
    badge.className = `punch-list__badge punch-list__badge--${p.type}`;
    badge.textContent = p.type === 'in' ? 'In' : 'Out';

    const body = document.createElement('div');
    body.className = 'punch-list__body';
    const time = document.createElement('div');
    time.className = 'punch-list__time';
    time.textContent = formatTime(p.ts);
    body.appendChild(time);

    const meta = document.createElement('div');
    meta.className = 'punch-list__meta';
    const parts = [];
    if (p.comment) parts.push(escapeHtml(p.comment));
    if (p.geo) {
      parts.push(`<span class="punch-list__geo">${p.geo.lat.toFixed(4)}, ${p.geo.lng.toFixed(4)}</span>`);
    }
    meta.innerHTML = parts.join(' · ');
    if (parts.length > 0) body.appendChild(meta);

    li.appendChild(badge);
    li.appendChild(body);
    listEl.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/**
 * Sum total time worked from today's punches.
 * Pair each "in" with the next "out". An open session (in with no
 * matching out yet) counts from its in-time up to "now".
 * Returns a milliseconds total; use formatDuration() to render.
 */
function totalWorkedMs(punches) {
  // Punches arrive newest-first from the server. Sort to chronological for pairing.
  const sorted = [...punches].sort((a, b) => a.ts.localeCompare(b.ts));
  let total = 0;
  let openIn = null;
  for (const p of sorted) {
    if (p.type === 'in') {
      // If we already had an unmatched in, drop it (data anomaly, don't crash).
      openIn = new Date(p.ts).getTime();
    } else if (p.type === 'out' && openIn != null) {
      total += new Date(p.ts).getTime() - openIn;
      openIn = null;
    }
  }
  // Open session — count up to now.
  if (openIn != null) total += Date.now() - openIn;
  return total;
}

function formatDuration(ms) {
  const totalMins = Math.floor(ms / 60_000);
  if (totalMins < 1) return 'less than a minute';
  if (totalMins < 60) return totalMins === 1 ? '1 minute' : `${totalMins} minutes`;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (m === 0) return h === 1 ? '1 hour' : `${h} hours`;
  return `${h}h ${m}m`;
}

// -------- Data refresh ------------------------------------------------------

async function refresh() {
  const [statusRes, todayRes] = await Promise.all([
    fetch('/api/punches/status', { credentials: 'same-origin' }),
    fetch('/api/punches/today',  { credentials: 'same-origin' }),
  ]);
  if (statusRes.status === 401) { window.location.href = '/login'; return; }
  const status = await statusRes.json();
  paintStatus(status);

  const today = await todayRes.json();
  // For an employer, /today returns all users — on this page we only care
  // about the current user. Filter client-side.
  const mine = today.punches.filter((p) => p.employeeId === me.id);
  renderList(mine);
}

// -------- Action ------------------------------------------------------------

async function doPunch(direction) {
  showMessage(messageEl, '');
  const btn = direction === 'in' ? inBtn : outBtn;
  setBusy(btn, true, 'Working…');

  const geo = await getGeo();
  if (geo) {
    lastFix = { ...geo, ts: new Date().toISOString() };
    saveCachedFix(lastFix);
    renderMap(lastFix);
  }

  const payload = {
    comment: commentEl.value.trim() || undefined,
    geo: geo || undefined,
  };
  const url = direction === 'in' ? '/api/punches/clock-in' : '/api/punches/clock-out';
  const result = await postJson(url, payload);

  if (result.ok) {
    commentEl.value = '';
    showMessage(messageEl, direction === 'in' ? 'Clocked in.' : 'Clocked out.', 'success');
    await refresh();
  } else {
    showMessage(messageEl, result.data.error || 'Action failed', 'error');
  }
  // refresh() repaints the buttons, so we don't need setBusy(..., false) here —
  // but call it anyway for the failure path so the original label restores.
  setBusy(btn, false);
}

inBtn.addEventListener('click', () => {
  if (inBtn.disabled) return;     // belt-and-suspenders
  doPunch('in');
});
outBtn.addEventListener('click', () => {
  if (outBtn.disabled) return;
  doPunch('out');
});

// Live preview: when the user toggles Share my location, fetch (or hide) on demand.
shareGeo.addEventListener('change', async () => {
  if (shareGeo.checked) {
    const fix = await getGeo();
    if (fix) {
      lastFix = { ...fix, ts: new Date().toISOString() };
      saveCachedFix(lastFix);
      renderMap(lastFix);
    }
  } else {
    hideMap();
  }
});

retryGeoBtn.addEventListener('click', async () => {
  retryGeoBtn.hidden = true;
  const fix = await getGeo();
  if (fix) {
    lastFix = { ...fix, ts: new Date().toISOString() };
    saveCachedFix(lastFix);
    renderMap(lastFix);
  }
});

// -------- Bootstrap ---------------------------------------------------------

(async () => {
  const meRes = await fetch('/api/me', { credentials: 'same-origin' });
  if (meRes.status === 401) { window.location.href = '/login'; return; }
  me = await meRes.json();
  if (me.role === 'employer') allLink.hidden = false;
  await refresh();

  // Map preview at page load. Strategy:
  //   1. If sharing is off → nothing.
  //   2. If we have a cached fix from this session → render it immediately,
  //      don't re-trigger geolocation. Map is "as of last successful fix".
  //   3. If we tried and failed earlier this session → don't auto-retry;
  //      show the Retry button so the user opts back in.
  //   4. Otherwise (first time this session, sharing on) → fetch.
  if (shareGeo.checked) {
    const cached = loadCachedFix();
    if (cached) {
      lastFix = cached;
      renderMap(cached);
    } else if (geoFailedThisSession()) {
      retryGeoBtn.hidden = false;
      geoStatusEl.textContent = 'Location unavailable. Click Retry to try again.';
    } else {
      const fix = await getGeo();
      if (fix) {
        lastFix = { ...fix, ts: new Date().toISOString() };
        saveCachedFix(lastFix);
        renderMap(lastFix);
      }
    }
  }
})();
