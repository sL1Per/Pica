/**
 * punch-today-employer.js — employer "everyone today" render module.
 *
 * Ported from punches-today.js. The IIFE bootstrap was stripped and the
 * grouping/render logic was wrapped in a single exported function so it
 * can be called from punch.js without the page-level fetch/redirect logic.
 *
 * i18n keys used (all pre-existing from 0.33.0):
 *   punchesToday.statusWorking / .statusDone / .stillWorking / .empty
 *   punch.todayBreak / punch.badgeIn / punch.badgeOut
 */
import { t } from '/i18n.js';
import { reverseGeocode } from '/geocode.js';
import { pairSessions as pairPunchSessions } from '/team-status.js';

function formatTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

/**
 * Compute worked milliseconds today from an ordered list of (in/out) pairs.
 * Unclosed clock-ins count up to "now" so active shifts still show progress.
 */
function workedMs(punches) {
  let total = 0;
  let inAt = null;
  for (const p of punches) {
    if (p.type === 'in') inAt = new Date(p.ts).getTime();
    else if (p.type === 'out' && inAt != null) {
      total += new Date(p.ts).getTime() - inAt;
      inAt = null;
    }
  }
  if (inAt != null) total += Date.now() - inAt;
  return Math.max(0, total);
}

/**
 * Sum the break time between closed sessions in the same day.
 * A break is the gap from an "out" punch to the next "in" punch.
 * Mirror of the helper on the /punch page (see public/punch.js).
 */
function breakMs(punches) {
  let total = 0;
  let lastOut = null;
  for (const p of punches) {
    if (p.type === 'in' && lastOut != null) {
      total += new Date(p.ts).getTime() - lastOut;
      lastOut = null;
    } else if (p.type === 'out') {
      lastOut = new Date(p.ts).getTime();
    }
  }
  return Math.max(0, total);
}

function humanDuration(ms) {
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Pair chronological punches into sessions.
 * An "in" opens a session; the next "out" closes it.
 * A trailing "in" with no closing "out" yields outTs: null (still working).
 * Returns [{inTs, outTs|null, inGeo, outGeo, inComment, outComment}].
 */
function pairSessions(punches) {
  // The in→out pairing algorithm lives in /team-status.js (shared with the
  // team + employee-detail pages). It returns {in, out} punch pairs; this page
  // renders a flatter {inTs, outTs, inGeo, …} shape, so adapt here.
  return pairPunchSessions(punches).map(({ in: i, out }) => ({
    inTs: i.ts,
    outTs: out ? out.ts : null,
    inGeo: i.geo || null,
    outGeo: out ? (out.geo || null) : null,
    inComment: i.comment || null,
    outComment: out ? (out.comment || null) : null,
  }));
}

/**
 * Build one address <div> whose text starts as coords and upgrades to a
 * label when reverse geocoding resolves.
 */
function buildAddrEl(geo) {
  const el = document.createElement('div');
  el.className = 'sess__addr subtle';
  el.textContent = `${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)}`;
  reverseGeocode(geo.lat, geo.lng).then((label) => { if (label) el.textContent = label; });
  return el;
}

/**
 * Build a .sess__times row for one side (in or out) of a session.
 * kind = 'in' | 'out'.  ts = ISO string.  geo/comment optional.
 */
function buildSessRow(kind, ts, geo, comment) {
  const row = document.createElement('div');
  row.className = 'sess__times';

  const badge = document.createElement('span');
  badge.className = `sess__time sess__time--${kind}`;
  badge.textContent = kind === 'in' ? t('punch.badgeIn') : t('punch.badgeOut');
  row.appendChild(badge);

  const mid = document.createElement('div');
  const time = document.createElement('div');
  time.className = 'sess__timeval mono';
  time.textContent = formatTime(ts);
  mid.appendChild(time);
  if (geo) mid.appendChild(buildAddrEl(geo));
  if (comment) {
    const c = document.createElement('div');
    c.className = 'sess__comment-inline';
    c.textContent = comment;
    mid.appendChild(c);
  }
  row.appendChild(mid);

  // Empty trailing cell keeps the 3-column grid aligned (badge | mid | origin).
  const origin = document.createElement('span');
  origin.className = 'sess__origin';
  row.appendChild(origin);

  return row;
}

/**
 * Build the "— still working" out-row for a live (open) session.
 */
function buildLiveSessRow() {
  const row = document.createElement('div');
  row.className = 'sess__times';

  const badge = document.createElement('span');
  badge.className = 'sess__time sess__time--out';
  badge.textContent = t('punch.badgeOut');
  row.appendChild(badge);

  const mid = document.createElement('div');
  const time = document.createElement('div');
  time.className = 'sess__timeval mono';
  time.textContent = `— ${t('punchesToday.stillWorking')}`;
  mid.appendChild(time);
  row.appendChild(mid);

  const origin = document.createElement('span');
  origin.className = 'sess__origin';
  row.appendChild(origin);

  return row;
}

/**
 * Build a complete .sess card for one session pair.
 * live = true when outTs is null and the employee is still on the clock.
 */
function buildSessCard(sess, { live = false } = {}) {
  const card = document.createElement('li');
  card.className = 'sess';

  // Accent strip — must be first child so `.sess__times + .sess__times`
  // still selects only the gap between consecutive time rows.
  const accent = document.createElement('div');
  accent.className = 'sess__accent';
  accent.setAttribute('aria-hidden', 'true');
  // Live session → sage; completed → neutral line. Set via CSSOM.
  accent.style.background = live ? 'var(--sage)' : 'var(--line)';
  card.appendChild(accent);

  card.appendChild(buildSessRow('in', sess.inTs, sess.inGeo, sess.inComment));

  if (sess.outTs) {
    card.appendChild(buildSessRow('out', sess.outTs, sess.outGeo, sess.outComment));
  } else if (live) {
    card.appendChild(buildLiveSessRow());
  }
  // A non-live open session (forgotten clock-out) just omits the out row.
  // The accent stays neutral and no "missing" link is shown — this employer
  // view is read-only; corrections are filed from the Corrections tab.

  return card;
}

/**
 * Render one per-employee card into the .ptoday container.
 * name     — full display name (may be undefined/null, falls back to username)
 * username — @-handle / role label
 * punches  — chronological punches array for this employee today
 */
function renderGroup(name, username, punches) {
  const card = document.createElement('article');
  card.className = 'ptoday-emp';

  // ---- Head row -----------------------------------------------------------
  const head = document.createElement('div');
  head.className = 'ptoday-emp__head';

  const nameEl = document.createElement('span');
  nameEl.className = 'ptoday-emp__name';
  nameEl.textContent = name || username;
  head.appendChild(nameEl);

  const roleEl = document.createElement('span');
  roleEl.className = 'ptoday-emp__role';
  roleEl.textContent = username;
  head.appendChild(roleEl);

  // Status pill — working if the last punch is an "in" (no closing "out").
  const lastPunch = punches[punches.length - 1];
  const isWorking = lastPunch && lastPunch.type === 'in';

  const pill = document.createElement('span');
  pill.className = isWorking ? 'ptoday-status ptoday-status--working' : 'ptoday-status ptoday-status--done';
  if (isWorking) {
    const dot = document.createElement('span');
    dot.className = 'ptoday-status__dot';
    pill.appendChild(dot);
  }
  const pillLabel = document.createElement('span');
  pillLabel.textContent = isWorking ? t('punchesToday.statusWorking') : t('punchesToday.statusDone');
  pill.appendChild(pillLabel);
  head.appendChild(pill);

  // Stats aside — worked duration, optional break.
  const stats = document.createElement('span');
  stats.className = 'ptoday-emp__stats';
  let statsText = humanDuration(workedMs(punches));
  const brk = breakMs(punches);
  if (brk > 0) statsText += ` · ${t('punch.todayBreak', { dur: humanDuration(brk) })}`;
  stats.textContent = statsText;
  head.appendChild(stats);

  card.appendChild(head);

  // ---- Session rows -------------------------------------------------------
  const sessions = pairSessions(punches);
  const sessionsWrapper = document.createElement('ul');
  sessionsWrapper.className = 'ptoday-sessions';

  for (let i = 0; i < sessions.length; i++) {
    const sess = sessions[i];
    // A trailing open session is "live" when the employee is still working
    // (i.e. last punch is type "in" and this is the final session entry).
    const live = isWorking && sess.outTs === null && i === sessions.length - 1;
    sessionsWrapper.appendChild(buildSessCard(sess, { live }));
  }

  card.appendChild(sessionsWrapper);
  return card;
}

/**
 * Render the employer "everyone today" view into `container`.
 * @param {HTMLElement} container  the <div id="employer-today-groups">
 * @param {Array}       punches    flat array of today's punches for ALL employees
 *                                 (each has employeeId, username, type, ts, geo, comment)
 * @param {Map}         nameById   Map<employeeId, displayName>
 */
export function renderEmployerToday(container, punches, nameById) {
  // Group punches by employeeId.
  const byId = new Map();
  for (const p of punches) {
    if (!byId.has(p.employeeId)) byId.set(p.employeeId, { username: p.username, punches: [] });
    byId.get(p.employeeId).punches.push(p);
  }

  container.replaceChildren();

  if (byId.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'ptoday-empty';
    const emptyTitle = document.createElement('p');
    emptyTitle.className = 'ptoday-empty__title';
    emptyTitle.textContent = t('punchesToday.empty');
    empty.appendChild(emptyTitle);
    container.appendChild(empty);
    return;
  }

  // Sort: most-recently-active first.
  const rows = [...byId.entries()].sort((a, b) => {
    const lastA = a[1].punches[a[1].punches.length - 1].ts;
    const lastB = b[1].punches[b[1].punches.length - 1].ts;
    return lastB.localeCompare(lastA);
  });

  for (const [id, group] of rows) {
    container.appendChild(renderGroup(nameById.get(id), group.username, group.punches));
  }
}
