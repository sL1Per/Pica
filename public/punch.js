import { postJson, showMessage, setBusy } from '/app.js';
import { t, tn, translateError, applyTranslations, fmtTime as i18nFmtTime } from '/i18n.js';

import { mountTopBar, mountFooter } from '/topbar.js';
mountTopBar();
mountFooter();
applyTranslations();

const $ = (id) => document.getElementById(id);
const statusBlock = $('status-block');
const statusLabel = $('status-label');
const statusMeta  = $('status-meta');
const commentEl   = $('comment');
// shareGeo removed in 0.10.2 — location is mandatory. If the browser
// can't deliver a fix we still allow the punch but log the reason.
let lastGeoSkipReason = null;
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

// -------- Offline punch queue ---------------------------------------------
// When the user clicks Clock in/out and the request fails (network down,
// server unreachable, response timeout), the punch is queued in localStorage
// and replayed automatically on next page load + on `window.online`. Each
// queued item carries a clientId UUID; the backend uses it for idempotency
// so retries don't create duplicates.

const PUNCH_QUEUE_KEY = 'pica-pending-punches';

function loadQueue() {
  try {
    const raw = localStorage.getItem(PUNCH_QUEUE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveQueue(arr) {
  try { localStorage.setItem(PUNCH_QUEUE_KEY, JSON.stringify(arr)); } catch {}
}
function enqueuePunch(item) {
  const q = loadQueue();
  q.push(item);
  saveQueue(q);
  paintQueueBadge();
}
function paintQueueBadge() {
  const badge = document.getElementById('queue-badge');
  if (!badge) return;
  const n = loadQueue().length;
  if (n === 0) { badge.hidden = true; return; }
  badge.hidden = false;
  badge.textContent = tn('punch.queueWaiting', n);
}

function newClientId() {
  // RFC 4122 v4-ish — random hex with the version + variant bits planted.
  // crypto.randomUUID would be cleaner but isn't on every target browser.
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  (crypto?.getRandomValues || ((arr) => arr.forEach((_, i, a) => a[i] = (Math.random()*256)|0)))(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

/**
 * Try to send every queued punch in chronological order. Successes and
 * idempotent duplicates are removed from the queue; transient failures stay
 * for the next attempt. Called on page load and on the `online` event.
 */
async function drainQueue() {
  let q = loadQueue();
  if (q.length === 0) return;
  // Sort by clientTs so replays go in the order the user actually punched.
  q.sort((a, b) => a.clientTs.localeCompare(b.clientTs));

  const remaining = [];
  for (const item of q) {
    const url = item.type === 'in' ? '/api/punches/clock-in' : '/api/punches/clock-out';
    try {
      const result = await postJson(url, {
        comment: item.comment,
        geo: item.geo,
        geoSkipReason: item.geoSkipReason,
        clientId: item.clientId,
        clientTs: item.clientTs,
      });
      if (result.ok) {
        // Success or idempotent duplicate — drop from queue.
        continue;
      }
      // Server rejected (e.g. "already clocked in" — the queue went stale).
      // Drop it; surfacing every stale-queue error would be more annoying
      // than helpful. The user can see actual state on the page.
      continue;
    } catch {
      // Network still failing — keep this and later items for next time.
      remaining.push(item);
    }
  }
  saveQueue(remaining);
  paintQueueBadge();
  if (remaining.length === 0 && q.length > 0) {
    showMessage(messageEl, tn('punch.queueSynced', q.length), 'success');
    await refresh();
  }
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
  if (mins < 1)  return t('punch.relJustNow');
  if (mins < 60) return t('punch.relMinAgo', { n: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('punch.relHourAgo', { n: hrs });
  const days = Math.floor(hrs / 24);
  return days === 1 ? t('punch.relYesterday') : t('punch.relDaysAgo', { n: days });
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
    statusLabel.textContent = t('punch.statusIn');
    statusMeta.textContent  = lastPunch ? t('punch.statusSince', { time: formatTime(lastPunch.ts), rel: relative(lastPunch.ts) }) : '';
    inBtn.disabled  = true;
    outBtn.disabled = false;
  } else {
    statusBlock.classList.add('status-block--out');
    statusLabel.textContent = t('punch.statusOut');
    statusMeta.textContent  = lastPunch ? t('punch.statusLast', { time: formatTime(lastPunch.ts), rel: relative(lastPunch.ts) }) : t('punch.statusNoPunches');
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
    if (!('geolocation' in navigator)) {
      geoStatusEl.textContent = t('punch.geoUnsupported');
      lastGeoSkipReason = 'unsupported';
      return resolve(null);
    }

    geoStatusEl.textContent = t('punch.geoFetching');

    const success = (pos) => {
      geoStatusEl.textContent = '';
      retryGeoBtn.hidden = true;
      lastGeoSkipReason = null;
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
            ? t('punch.geoTimeout')
            : err.code === err.PERMISSION_DENIED
              ? t('punch.geoDenied')
              : t('punch.geoFailed');
          geoStatusEl.textContent = msg;
          retryGeoBtn.hidden = false;
          markGeoFailed();
          lastGeoSkipReason = err.code === err.TIMEOUT ? 'timeout'
                            : err.code === err.PERMISSION_DENIED ? 'denied'
                            : 'unavailable';
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

let dailyHoursTarget = null;  // null until /api/settings/working-time lands

function renderList(punches) {
  // Update the today-total label next to the section heading.
  // Format: "5h 23m / 8h" if target known, else just "5h 23m".
  const totalEl = document.getElementById('today-total');
  if (totalEl) {
    if (punches.length === 0) {
      totalEl.hidden = true;
    } else {
      totalEl.hidden = false;
      const worked = totalWorkedMs(punches);
      const workedStr = formatDuration(worked);
      if (dailyHoursTarget != null && dailyHoursTarget > 0) {
        const targetStr = `${dailyHoursTarget}h`;
        totalEl.textContent = `${workedStr} / ${targetStr}`;
      } else {
        totalEl.textContent = workedStr;
      }
    }
  }

  listEl.innerHTML = '';
  if (punches.length === 0) {
    const li = document.createElement('li');
    li.className = 'subtle';
    li.textContent = t('punch.todayEmpty');
    listEl.appendChild(li);
    return;
  }
  // Newest first — easier to scan on a phone.
  for (const p of [...punches].reverse()) {
    const li = document.createElement('li');
    li.className = 'punch-list__item';

    const badge = document.createElement('span');
    badge.className = `punch-list__badge punch-list__badge--${p.type}`;
    badge.textContent = p.type === 'in' ? t('punch.badgeIn') : t('punch.badgeOut');

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
  setBusy(btn, true, t('punch.working'));

  const geo = await getGeo();
  if (geo) {
    lastFix = { ...geo, ts: new Date().toISOString() };
    saveCachedFix(lastFix);
    renderMap(lastFix);
  }

  // Build the request payload. clientId + clientTs always present:
  //   - clientId gives the backend an idempotency key for retries.
  //   - clientTs anchors the punch to "now" client-side, so an offline
  //     replay 30 minutes later still records the original time.
  const item = {
    type: direction,
    clientId: newClientId(),
    clientTs: new Date().toISOString(),
    comment: commentEl.value.trim() || undefined,
    geo: geo || undefined,
    geoSkipReason: geo ? undefined : (lastGeoSkipReason || 'unavailable'),
  };
  const url = direction === 'in' ? '/api/punches/clock-in' : '/api/punches/clock-out';

  try {
    const result = await postJson(url, item);
    if (result.ok) {
      commentEl.value = '';
      showMessage(messageEl, direction === 'in' ? t('punch.clockedIn') : t('punch.clockedOut'), 'success');
      await refresh();
    } else {
      const msg = translateError(result.data.errorCode, result.data.error || t('punch.actionFailed'));
      showMessage(messageEl, msg, 'error');
    }
  } catch (err) {
    // Network failure — queue for replay. UI keeps showing the optimistic
    // result via the badge so the user knows the punch is captured.
    enqueuePunch(item);
    commentEl.value = '';
    showMessage(messageEl, t('punch.savedOffline'), 'success');
  }

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

retryGeoBtn.addEventListener('click', async () => {
  retryGeoBtn.hidden = true;
  const fix = await getGeo();
  if (fix) {
    lastFix = { ...fix, ts: new Date().toISOString() };
    saveCachedFix(lastFix);
    renderMap(lastFix);
  }
});

// -------- Bank balance display ----------------------------------------------
// Fetches /api/corrections/bank and shows the bank-line if non-zero.
// Called on page load. Refresh after a successful punch is overkill (bank
// only changes when corrections are approved) — that happens elsewhere.

async function refreshBank() {
  // Employer doesn't see "their" bank prominently — they see employee banks
  // on the corrections detail page. Skip rendering the line for them.
  if (!me || me.role === 'employer') return;
  try {
    const r = await fetch('/api/corrections/bank', { credentials: 'same-origin' });
    if (!r.ok) return;
    const { hours } = await r.json();
    const line = document.getElementById('bank-line');
    const value = document.getElementById('bank-line__value');
    if (!line || !value) return;
    if (hours > 0) {
      const total = Math.round(hours * 60);
      const hh = Math.floor(total / 60);
      const mm = total % 60;
      value.textContent = mm === 0 ? `${hh}h` : (hh === 0 ? `${mm}m` : `${hh}h ${mm}m`);
      line.hidden = false;
    } else {
      line.hidden = true;
    }
  } catch { /* non-fatal */ }
}

// -------- Bootstrap ---------------------------------------------------------

(async () => {
  const meRes = await fetch('/api/me', { credentials: 'same-origin' });
  if (meRes.status === 401) { window.location.href = '/login'; return; }
  me = await meRes.json();
  if (me.role === 'employer') allLink.hidden = false;

  // Fetch the daily-hours target before refresh() so the today-total
  // renders with "/ Xh" on first paint instead of plain hours.
  try {
    const r = await fetch('/api/settings/working-time', { credentials: 'same-origin' });
    if (r.ok) {
      const j = await r.json();
      dailyHoursTarget = j.workingTime?.dailyHours ?? null;
    }
  } catch { /* non-fatal — punch page works without the target */ }

  await refresh();
  refreshBank();

  // Map preview at page load. Strategy:
  //   1. If we have a cached fix from this session → render it immediately,
  //      don't re-trigger geolocation. Map is "as of last successful fix".
  //   2. If we tried and failed earlier this session → don't auto-retry;
  //      show the Retry button so the user opts back in.
  //   3. Otherwise (first time this session) → fetch.
  // Punches always go through whether or not a fix is obtained.
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

  // Queue: paint any outstanding badge, then try to drain. Subsequent
  // drains run whenever the browser flips back online.
  paintQueueBadge();
  drainQueue();
  window.addEventListener('online', drainQueue);
})();
