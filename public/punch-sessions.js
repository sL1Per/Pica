import { t, tn, fmtDate } from '/i18n.js';
import { reverseGeocode } from '/geocode.js';

// -------- Time formatting (24-hour HH:MM from an ISO timestamp) -------------

export function formatTime(iso) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function relative(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return t('punch.relJustNow');
  if (mins < 60) return t('punch.relMinAgo', { n: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('punch.relHourAgo', { n: hrs });
  const days = Math.floor(hrs / 24);
  return days === 1 ? t('punch.relYesterday') : t('punch.relDaysAgo', { n: days });
}

/** HH:MM:SS from an elapsed-milliseconds value (used by the live readout). */
export function formatElapsed(ms) {
  const totalSecs = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(h)}:${p2(m)}:${p2(s)}`;
}

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
export function buildSessCard(pair, { live = false } = {}) {
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
export function buildTimeRow(p, kind, addrSink) {
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
export function buildLiveOutRow() {
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
export function buildMissingRow(kind) {
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

/**
 * Sum total time worked from today's punches.
 * Pair each "in" with the next "out". An open session (in with no
 * matching out yet) counts from its in-time up to "now".
 * Returns a milliseconds total; use formatDuration() to render.
 */
export function totalWorkedMs(punches) {
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
export function totalBreakMs(punches) {
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

export function formatDuration(ms) {
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

/**
 * True when a punch was materialized from an approved correction (vs an
 * auto clock event). Coupled to the clientId convention in
 * src/routes/corrections.js (`correction:<id>:in|out`) — if that prefix
 * changes there, the MANUAL badge that consumes this silently stops appearing.
 */
export function isManual(clientId) {
  return typeof clientId === 'string' && clientId.startsWith('correction:');
}
