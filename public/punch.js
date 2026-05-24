import { postJson, showMessage, setBusy } from '/app.js';
import { t, tn, translateError, applyTranslations, fmtDate } from '/i18n.js';
import { reverseGeocode } from '/geocode.js';
import { openManualTimeModal } from '/manual-time-modal.js';

import { mountTopBar, mountFooter } from '/topbar.js';
mountTopBar();
mountFooter();
applyTranslations();

const $ = (id) => document.getElementById(id);
const statusBlock = $('status-block');
const statusLabel = $('status-label');
const statusMeta  = $('status-meta');
const clockBig    = $('clock-big');
const clockStatus = $('clock-status');
const punchSub    = $('punch-sub');
const locLine     = $('map-meta-line');
const locText     = $('clock-loc-text');
const commentEl   = $('comment');
// shareGeo removed in 0.10.2 — location is mandatory. If the browser
// can't deliver a fix we still allow the punch but log the reason.
let lastGeoSkipReason = null;
const geoStatusEl = $('geo-status');
const inBtn       = $('clock-in-btn');
const outBtn      = $('clock-out-btn');
const messageEl   = $('message');
const listEl      = $('today-list');
const weekListEl  = $('week-list');
const allLink     = $('all-today-link');
const mapCard     = $('map-card');
const mapTile     = $('map-tile');
const mapMeta     = $('map-meta');
const retryGeoBtn = $('retry-geo-btn');

let isOpen = false;
let me = null;
let lastFix = null;     // most recent {lat, lng, accuracy, ts} from a real geolocation reading
let openSinceTs = null; // ISO ts of the open "in" punch while working (for the live readout)
let clockTimer = null;  // setInterval handle driving the hero's live elapsed / wall clock

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

// -------- Status hero + button enable/disable -------------------------------

/** HH:MM:SS from an elapsed-milliseconds value (used by the live readout). */
function formatElapsed(ms) {
  const totalSecs = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(h)}:${p2(m)}:${p2(s)}`;
}

/**
 * Tick the hero's big readout. When clocked in, shows the live elapsed time
 * since the open punch (updated each second); otherwise the wall-clock HH:MM.
 * Driven by a single setInterval that is always cleared before being
 * recreated (paintStatus), so it can never leak or double up.
 */
function tickClock() {
  if (openSinceTs) {
    clockBig.textContent = formatElapsed(Date.now() - new Date(openSinceTs).getTime());
  } else {
    const now = new Date();
    clockBig.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }
}

/**
 * Repaint the clock hero from the punch status and lock the two buttons so
 * only the one that makes sense is clickable. The other stays `disabled` but
 * visually present. Manages the live readout interval (leak-safe: always
 * cleared before re-creating).
 */
function paintStatus({ open, lastPunch }) {
  isOpen = open;

  // Reset the live-readout interval on every repaint. Clearing first means a
  // status change (in→out, out→in) never leaves two intervals running.
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }

  statusBlock.classList.toggle('clock-hero--working', open);
  clockStatus.classList.toggle('clock-status--working', open);

  if (open) {
    statusLabel.textContent = t('punch.workingNow');
    openSinceTs = lastPunch ? lastPunch.ts : null;
    statusMeta.textContent = lastPunch
      ? t('punch.statusSince', { time: formatTime(lastPunch.ts), rel: relative(lastPunch.ts) })
      : '';
    inBtn.disabled  = true;
    outBtn.disabled = false;
  } else {
    statusLabel.textContent = t('punch.notClockedIn');
    openSinceTs = null;
    statusMeta.textContent = lastPunch
      ? t('punch.statusLast', { time: formatTime(lastPunch.ts), rel: relative(lastPunch.ts) })
      : t('punch.statusNoPunches');
    inBtn.disabled  = false;
    outBtn.disabled = true;
  }

  // Render once immediately so there's no 1s blank, then tick every second.
  tickClock();
  clockTimer = setInterval(tickClock, 1000);

  // Hero location chip — reuse the last successful fix's address.
  paintHeroLocation();
}

/**
 * Show the hero's inline location chip from the most recent fix. Coordinates
 * render immediately; the reverse-geocode swap-in upgrades to an address.
 * Hidden when no fix is available.
 */
function paintHeroLocation() {
  if (!lastFix || typeof lastFix.lat !== 'number' || typeof lastFix.lng !== 'number') {
    locLine.hidden = true;
    return;
  }
  const acc = lastFix.accuracy ? ` · ±${Math.round(lastFix.accuracy)} m` : '';
  locText.textContent = `${lastFix.lat.toFixed(4)}, ${lastFix.lng.toFixed(4)}${acc}`;
  locLine.hidden = false;
  reverseGeocode(lastFix.lat, lastFix.lng).then((label) => {
    if (label && !locLine.hidden) locText.textContent = `${label}${acc}`;
  });
}

// -------- Geolocation -------------------------------------------------------

/**
 * Get a geolocation fix — thorough variant, used by the Retry button and
 * the page-load map preview where the user is not blocked on the result.
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
 * For the Clock-in/out click path use getGeoFast() instead — the long
 * 35s worst-case wait here is unacceptable when the user is staring at
 * a "Working…" button.
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

/**
 * Fast geolocation for the punch-click path. Single low-accuracy attempt
 * with a 3s hard budget — if the platform can't deliver a fix in that
 * window, the punch goes through without geo. The Retry button and the
 * background map preview keep using the thorough getGeo() above.
 *
 * The browser will NOT re-prompt for permission once the user has
 * blocked the site — that's a security boundary, not a Pica decision.
 * If permission is denied this function resolves null in a few ms with
 * lastGeoSkipReason='denied'; the punch still happens.
 *
 * Returns {lat, lng, accuracy} on success, null on any failure or timeout.
 */
function getGeoFast() {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      lastGeoSkipReason = 'unsupported';
      return resolve(null);
    }
    let settled = false;
    const settle = (val, reason) => {
      if (settled) return;
      settled = true;
      lastGeoSkipReason = val ? null : (reason || 'unavailable');
      resolve(val);
    };
    const timer = setTimeout(() => settle(null, 'timeout'), 3000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        settle({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        clearTimeout(timer);
        const reason = err.code === err.PERMISSION_DENIED ? 'denied'
                     : err.code === err.TIMEOUT ? 'timeout'
                     : 'unavailable';
        settle(null, reason);
      },
      { enableHighAccuracy: false, timeout: 3000, maximumAge: 300_000 },
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
  // Show coords immediately, then upgrade to address when reverse
  // geocoding completes. The accuracy suffix stays attached either way.
  const coordStr = `${lat.toFixed(5)}, ${lng.toFixed(5)}${acc}`;
  mapMeta.textContent = coordStr;
  mapCard.hidden = false;
  reverseGeocode(lat, lng).then((label) => {
    if (label) mapMeta.textContent = `${label}${acc}`;
  });
}

function hideMap() {
  mapCard.hidden = true;
}

// -------- Today list --------------------------------------------------------

let dailyHoursTarget = null;  // null until /api/settings/working-time lands

// -------- Session-pair card builder ----------------------------------------

/**
 * Build one `.sess` card for an { in, out|null } pair. The DOM contract the
 * CSS depends on: `.sess__accent` is the FIRST child (a <div>; its colour is
 * set via el.style — CSSOM, never an inline HTML style attribute), then the
 * `.sess__times` rows (IN row, then OUT row). The CSS separates rows via
 * `.sess__times + .sess__times`, so we always emit accent-then-rows.
 *
 * `live` marks the open trailing session (its `out` is null but the user is
 * still on the clock) — it gets a sage accent + a "now" out-time, NOT a
 * missing-punch hint. A non-live incomplete pair (out=null, e.g. a forgotten
 * clock-out from an earlier session) gets the clay `.sess__missing` hint.
 */
function buildSessCard(pair, { live = false } = {}) {
  const card = document.createElement('li');
  card.className = 'sess';

  // Accent strip — must be the first child so `.sess__times + .sess__times`
  // still selects only the gap between consecutive rows.
  const accent = document.createElement('div');
  accent.className = 'sess__accent';
  accent.setAttribute('aria-hidden', 'true');
  // Live session → sage; completed/incomplete → neutral line. Set via CSSOM.
  accent.style.background = live ? 'var(--sage)' : 'var(--line)';
  card.appendChild(accent);

  const missingAddrs = [];

  // IN row (may be null if an "out" has no preceding "in").
  if (pair.in) {
    card.appendChild(buildTimeRow(pair.in, 'in', missingAddrs));
  } else {
    card.appendChild(buildMissingRow('in'));
  }

  // OUT row — a real out, a live "now" placeholder, or a missing hint.
  if (pair.out) {
    card.appendChild(buildTimeRow(pair.out, 'out', missingAddrs));
  } else if (live) {
    card.appendChild(buildLiveOutRow());
  } else {
    card.appendChild(buildMissingRow('out'));
  }

  // Resolve any coordinate labels into addresses asynchronously.
  for (const { span, geo } of missingAddrs) {
    reverseGeocode(geo.lat, geo.lng).then((label) => { if (label) span.textContent = label; });
  }

  return card;
}

/**
 * Build a `.sess__times` row for one punch. Columns (per the CSS grid):
 * kind badge | address/comment | duration. Coordinates render immediately;
 * the reverse-geocode swap-in is registered via `addrSink`.
 */
function buildTimeRow(p, kind, addrSink) {
  const row = document.createElement('div');
  row.className = 'sess__times';

  const badge = document.createElement('span');
  badge.className = `sess__time sess__time--${kind}`;
  badge.textContent = kind === 'in' ? t('punch.badgeIn') : t('punch.badgeOut');
  row.appendChild(badge);

  const mid = document.createElement('div');
  // Time of the punch, plus the reverse-geocoded address (coords first).
  const time = document.createElement('div');
  time.className = 'sess__timeval mono';
  time.textContent = formatTime(p.ts);
  mid.appendChild(time);

  if (p.geo) {
    const addr = document.createElement('div');
    addr.className = 'sess__addr subtle';
    addr.textContent = `${p.geo.lat.toFixed(4)}, ${p.geo.lng.toFixed(4)}`;
    mid.appendChild(addr);
    addrSink.push({ span: addr, geo: p.geo });
  }
  if (p.comment) {
    const c = document.createElement('div');
    c.className = 'sess__comment-inline';
    c.textContent = p.comment;
    mid.appendChild(c);
  }
  row.appendChild(mid);

  // Origin badge — all current punches are auto-recorded by the clock; the
  // data layer carries no manual flag yet (manual entries arrive via
  // corrections, a later plan). Show the auto badge for clarity.
  const origin = document.createElement('span');
  origin.className = 'sess__origin';
  origin.textContent = t('punch.originAuto');
  row.appendChild(origin);

  return row;
}

/** The "— now" out row for the live (still-open) session. */
function buildLiveOutRow() {
  const row = document.createElement('div');
  row.className = 'sess__times';

  const badge = document.createElement('span');
  badge.className = 'sess__time sess__time--out';
  badge.textContent = t('punch.badgeOut');
  row.appendChild(badge);

  const mid = document.createElement('div');
  const time = document.createElement('div');
  time.className = 'sess__timeval mono';
  time.textContent = `— ${t('punch.live')}`;
  mid.appendChild(time);
  row.appendChild(mid);

  // Empty trailing cell keeps the live row's 3-column grid aligned with
  // buildTimeRow (badge | mid | duration) — don't drop it.
  const dur = document.createElement('span');
  dur.className = 'sess__dur';
  dur.textContent = '';
  row.appendChild(dur);

  return row;
}

/** Clay missing-punch hint row with a link to file a correction. */
function buildMissingRow(kind) {
  const row = document.createElement('div');
  row.className = 'sess__missing';

  const badge = document.createElement('span');
  badge.className = `sess__time sess__time--${kind}`;
  badge.textContent = kind === 'in' ? t('punch.badgeIn') : t('punch.badgeOut');
  row.appendChild(badge);

  const link = document.createElement('a');
  link.href = '/corrections/new';
  link.textContent = t('punch.sessMissing');
  row.appendChild(link);

  return row;
}

function renderList(punches) {
  // Update the today-total label next to the section heading.
  // Format: "5h 23m / 8h · break 1h" (break segment only when > 0).
  const totalEl = document.getElementById('today-total');
  if (totalEl) {
    if (punches.length === 0) {
      totalEl.hidden = true;
    } else {
      totalEl.hidden = false;
      const worked = totalWorkedMs(punches);
      const workedStr = formatDuration(worked);
      let line = workedStr;
      if (dailyHoursTarget != null && dailyHoursTarget > 0) {
        line += ` / ${dailyHoursTarget}h`;
      }
      const brk = totalBreakMs(punches);
      if (brk > 0) {
        line += ` · ${t('punch.todayBreak', { dur: formatDuration(brk) })}`;
      }
      totalEl.textContent = line;
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

  // One `.sess` card per in→out pair, in chronological order. The trailing
  // open pair (out=null while the user is clocked in) is the live session.
  const pairs = pairDay(groupPunchesByDay(punches)[0]?.list || []);
  pairs.forEach((pair, i) => {
    const live = pair.out == null && pair.in != null && i === pairs.length - 1 && isOpen;
    listEl.appendChild(buildSessCard(pair, { live }));
  });
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

/**
 * Sum the break time between closed sessions on the same day.
 * A break is the gap from an "out" punch to the next "in" punch.
 * An open trailing session (no closing out yet) is not a break.
 * Returns a milliseconds total; use formatDuration() to render.
 */
function totalBreakMs(punches) {
  const sorted = [...punches].sort((a, b) => a.ts.localeCompare(b.ts));
  let total = 0;
  let lastOut = null;
  for (const p of sorted) {
    if (p.type === 'in' && lastOut != null) {
      total += new Date(p.ts).getTime() - lastOut;
      lastOut = null;
    } else if (p.type === 'out') {
      lastOut = new Date(p.ts).getTime();
    }
  }
  return total;
}

function formatDuration(ms) {
  const totalMins = Math.floor(ms / 60_000);
  if (totalMins < 1) return t('punch.durLessThanMinute');
  if (totalMins < 60) return tn('punch.durMinutes', totalMins);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (m === 0) return tn('punch.durHours', h);
  return `${h}h ${m}m`;
}

// -------- Pure week-grouping + pairing helpers ------------------------------
// These two are mirrored (byte-for-byte) by inline copies in
// tests/test-punch-week.mjs — punch.js imports /-absolute browser modules
// Node can't resolve, so the suite re-implements them per the project pattern.
// Keep this source and the test's copies identical.

// Group an ascending punch array by UTC day → [{ ymd, list }]. Pure.
export function groupPunchesByDay(punches) {
  const byDay = new Map();
  for (const p of [...punches].sort((a, b) => new Date(a.ts) - new Date(b.ts))) {
    const ymd = new Date(p.ts).toISOString().slice(0, 10);
    if (!byDay.has(ymd)) byDay.set(ymd, []);
    byDay.get(ymd).push(p);
  }
  return [...byDay.entries()].map(([ymd, list]) => ({ ymd, list }));
}

// Pair in→out within one day's list → [{ in, out|null }]. Pure. Trailing
// open `in` yields { in, out:null } (a live/again-missing session).
export function pairDay(list) {
  const pairs = []; let open = null;
  for (const p of list) {
    if (p.type === 'in') { if (open) pairs.push({ in: open, out: null }); open = p; }
    else if (p.type === 'out') { pairs.push({ in: open, out: p }); open = null; } // open may be null → missing in
  }
  if (open) pairs.push({ in: open, out: null });
  return pairs;
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
  paintSubLine(status, mine);
}

/**
 * Head sub line under the page title. When clocked in: "Working since HH:MM ·
 * Xh Ym so far". Otherwise: "Today: Xh Ym across N sessions" (or blank when
 * there are no punches yet today).
 */
function paintSubLine(status, todayPunches) {
  if (!punchSub) return;
  if (status.open && status.lastPunch) {
    punchSub.textContent = t('punch.subWorkingSince', {
      time: formatTime(status.lastPunch.ts),
      dur:  formatDuration(totalWorkedMs(todayPunches)),
    });
    return;
  }
  if (todayPunches.length === 0) { punchSub.textContent = ''; return; }
  const sessions = pairDay(groupPunchesByDay(todayPunches)[0]?.list || [])
    .filter((p) => p.in && p.out).length;
  punchSub.textContent = t('punch.subToday', {
    dur: formatDuration(totalWorkedMs(todayPunches)),
    n:   sessions,
  });
}

// -------- Action ------------------------------------------------------------

async function doPunch(direction) {
  showMessage(messageEl, '');
  const btn = direction === 'in' ? inBtn : outBtn;
  setBusy(btn, true, t('punch.working'));

  // Geolocation is best-effort on the click path — the punch happens
  // whether or not we get a fix. Order of preference:
  //   1. Reuse the in-session lastFix if we have one (instant).
  //   2. Otherwise try getGeoFast() with a 3s budget (unless this
  //      session has already failed once — don't lag every click).
  //   3. Fall through to a no-geo punch with a skipReason.
  let geo = null;
  if (lastFix) {
    geo = { lat: lastFix.lat, lng: lastFix.lng, accuracy: lastFix.accuracy };
  } else if (!geoFailedThisSession()) {
    geo = await getGeoFast();
    if (geo) {
      lastFix = { ...geo, ts: new Date().toISOString() };
      saveCachedFix(lastFix);
      renderMap(lastFix);
      paintHeroLocation();
    } else {
      markGeoFailed();
    }
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
    paintHeroLocation();
  }
});

// -------- Sub-tabs + This-week panel ----------------------------------------

const tabToday = $('tab-today'), tabWeek = $('tab-week');
const panelToday = $('panel-today'), panelWeek = $('panel-week');
let weekLoaded = false;
function showTab(which) {
  const onWeek = which === 'week';
  panelToday.hidden = onWeek; panelWeek.hidden = !onWeek;
  tabToday.classList.toggle('punch-tab--active', !onWeek);
  tabWeek.classList.toggle('punch-tab--active', onWeek);
  if (onWeek && !weekLoaded) { weekLoaded = true; loadWeek(); }
}
tabToday.addEventListener('click', () => showTab('today'));
tabWeek.addEventListener('click', () => showTab('week'));

/** Zero-pad a 1-based month to "MM". */
function pad2(n) { return String(n).padStart(2, '0'); }

/** YYYY-MM-DD for a Date in UTC (matches the by-UTC-day grouping helpers). */
function ymdOf(d) { return d.toISOString().slice(0, 10); }

/**
 * Load and render the This-week panel: Monday–Sunday of the current week.
 * Fetches the month(s) the week spans (one extra fetch when the week crosses
 * the 1st), filters to the week window, groups by UTC day, and renders each
 * day as a `.day-group` with a date header + day total and `.sess` rows.
 *
 * Uses UTC-day boundaries to stay consistent with the reports/home views and
 * the `groupPunchesByDay` helper (which slices the ISO string at UTC).
 */
async function loadWeek() {
  // Monday of this week (UTC). getUTCDay(): 0=Sun..6=Sat → days since Monday.
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = today.getUTCDay();           // 0..6, Sun..Sat
  const sinceMon = (dow + 6) % 7;          // 0 for Mon … 6 for Sun
  const monday = new Date(today.getTime() - sinceMon * 86_400_000);
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  const weekStart = ymdOf(monday), weekEnd = ymdOf(sunday);

  // Which (year, month) pairs does the Mon–Sun window touch? Usually one;
  // two when the week straddles a month boundary (the 1st falls mid-week).
  const months = new Map(); // key "y-m" → {y, m}
  const addMonth = (d) => { const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1; months.set(`${y}-${m}`, { y, m }); };
  addMonth(monday); addMonth(sunday);

  let punches = [];
  try {
    for (const { y, m } of months.values()) {
      const res = await fetch(`/api/punches/by-employee/${me.id}?year=${y}&month=${pad2(m)}`, { credentials: 'same-origin' });
      if (res.status === 401) { window.location.href = '/login'; return; }
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data.punches)) punches.push(...data.punches);
    }
  } catch {
    weekListEl.innerHTML = '';
    const li = document.createElement('li');
    li.className = 'subtle';
    li.textContent = t('punch.couldNotLoad');
    weekListEl.appendChild(li);
    return;
  }

  // Keep only this employee's punches within the Mon–Sun window. The IN/OUT
  // pairing is handled per day by pairDay.
  const mine = punches.filter((p) => p.employeeId === me.id);
  const inWeek = mine.filter((p) => {
    const ymd = ymdOf(new Date(p.ts));
    return ymd >= weekStart && ymd <= weekEnd;
  });

  renderWeek(inWeek);
}

/** Render the grouped This-week days into #week-list. */
function renderWeek(punches) {
  weekListEl.innerHTML = '';
  const days = groupPunchesByDay(punches);
  if (days.length === 0) {
    const li = document.createElement('li');
    li.className = 'punch-empty';
    const title = document.createElement('div');
    title.className = 'punch-empty__title';
    title.textContent = t('punch.weekEmpty');
    li.appendChild(title);
    weekListEl.appendChild(li);
    return;
  }

  const todayYmd = ymdOf(new Date());

  // Newest day first.
  for (const { ymd, list } of [...days].reverse()) {
    const group = document.createElement('li');
    group.className = 'day-group';

    const head = document.createElement('div');
    head.className = 'day-head';
    const title = document.createElement('span');
    title.className = 'day-title';
    title.textContent = fmtDate(`${ymd}T00:00:00Z`);
    const total = document.createElement('span');
    total.className = 'day-total mono';
    total.textContent = formatDuration(totalWorkedMs(list));
    head.appendChild(title);
    head.appendChild(total);
    group.appendChild(head);

    const rows = document.createElement('ul');
    rows.className = 'punch-list';
    // Only today's trailing open `in` (while still clocked in) is "live"; a
    // trailing open `in` on a past day is a forgotten clock-out (missing).
    const pairs = pairDay(list);
    pairs.forEach((pair, i) => {
      const live = ymd === todayYmd && isOpen
        && pair.out == null && pair.in != null && i === pairs.length - 1;
      rows.appendChild(buildSessCard(pair, { live }));
    });
    group.appendChild(rows);

    weekListEl.appendChild(group);
  }
}

// -------- Manual-time modal wiring ------------------------------------------
// Both .punch-forgot and .punch-reminder are anchor fallbacks to
// /corrections/new. When JS is running we intercept and open the modal
// in-place instead. querySelectorAll guards against either element being
// absent (e.g. future DOM changes), so the loop is a no-op in that case.

document.querySelectorAll('.punch-forgot, .punch-reminder').forEach((anchor) => {
  anchor.addEventListener('click', (e) => {
    e.preventDefault();
    openManualTimeModal({
      onFiled: () => {
        showMessage(messageEl, t('manualTime.filed'), 'success');
      },
    });
  });
});

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
    paintHeroLocation();
  } else if (geoFailedThisSession()) {
    retryGeoBtn.hidden = false;
    geoStatusEl.textContent = 'Location unavailable. Click Retry to try again.';
  } else {
    const fix = await getGeo();
    if (fix) {
      lastFix = { ...fix, ts: new Date().toISOString() };
      saveCachedFix(lastFix);
      renderMap(lastFix);
      paintHeroLocation();
    }
  }

  // Queue: paint any outstanding badge, then try to drain. Subsequent
  // drains run whenever the browser flips back online.
  paintQueueBadge();
  drainQueue();
  window.addEventListener('online', drainQueue);
})();
