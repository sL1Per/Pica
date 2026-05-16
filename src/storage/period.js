/**
 * Period helpers used by the team-hours report endpoint and by
 * the per-employee summary endpoint.
 *
 * Pure functions of (period, Date). Local-timezone arithmetic — the
 * server's notion of "today" is whatever clock the host sees. Date
 * boundaries are returned as YYYY-MM-DD strings to match the rest of
 * the storage layer's date-keyed indexing.
 */

import { bucketKeyFor } from './reports.js';

function pad2(n) { return String(n).padStart(2, '0'); }

/** YYYY-MM-DD in the local time zone for a Date instance. */
export function ymdOf(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** True for Mon-Fri, false for Saturday/Sunday. */
export function isWeekday(d) {
  const day = d.getDay();
  return day !== 0 && day !== 6;
}

/**
 * Compute period boundaries for one of: 'today', 'week', 'month'.
 *
 * Returns an object:
 *   { from, to, label, weekdays }
 *
 * - `from` / `to` are YYYY-MM-DD strings, inclusive at both ends.
 * - `label` is a human-readable description of the period.
 * - `weekdays` is the count of Mon-Fri days within [from, to] —
 *   used by monthly scheduled-hours math (dailyHours × weekdays).
 *
 * Week is ISO (Monday → Sunday) containing the supplied `now`.
 * Month is the calendar month containing `now`.
 */
export function computePeriod(period, now) {
  if (period === 'today') {
    const ymd = ymdOf(now);
    return {
      from: ymd, to: ymd,
      label: ymd,
      weekdays: isWeekday(now) ? 1 : 0,
    };
  }

  if (period === 'week') {
    // ISO week: Monday is the first day. JS getDay() has Sunday=0,
    // so we shift: 1=Mon → offset 0, 2=Tue → 1, ..., 0=Sun → 6.
    const dayIdx = (now.getDay() + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - dayIdx);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    let weekdays = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      if (isWeekday(d)) weekdays++;
    }
    return {
      from: ymdOf(monday),
      to:   ymdOf(sunday),
      label: `${ymdOf(monday)} → ${ymdOf(sunday)}`,
      weekdays, // typically 5; less if a holiday-laden week ever lands here
    };
  }

  if (period === 'month') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last  = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    let weekdays = 0;
    for (let day = 1; day <= last.getDate(); day++) {
      const d = new Date(now.getFullYear(), now.getMonth(), day);
      if (isWeekday(d)) weekdays++;
    }
    return {
      from: ymdOf(first),
      to:   ymdOf(last),
      label: `${first.getFullYear()}-${pad2(first.getMonth() + 1)}`,
      weekdays,
    };
  }

  throw new Error(`unknown period '${period}'`);
}

// ---- Period presets (M13 reports revamp) --------------------------------
// Additive. computePeriod/ymdOf/isWeekday above are unchanged — they are
// still used by src/routes/employees.js (dashboard summary).

function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Any date inside the "current" period; resolvePeriod normalizes it. */
export function defaultAnchor(type, now = new Date()) {
  // `type` is accepted for call-site symmetry with resolvePeriod and to
  // allow future per-type anchoring; today's date sits inside every
  // current period so it is sufficient for all types now.
  return ymdOf(now);
}

/**
 * Resolve a period preset to concrete bounds.
 * @returns {{type,from,to,bucketBy,label}}
 */
export function resolvePeriod(type, anchorYmd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorYmd)) {
    throw new Error('anchor must be YYYY-MM-DD');
  }
  const a = parseYmd(anchorYmd);

  if (type === 'day') {
    return { type, from: anchorYmd, to: anchorYmd, bucketBy: 'day', label: anchorYmd };
  }
  if (type === 'week') {
    const dayIdx = (a.getDay() + 6) % 7;       // Mon=0 … Sun=6
    const mon = new Date(a); mon.setDate(a.getDate() - dayIdx);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return {
      type, from: ymdOf(mon), to: ymdOf(sun),
      bucketBy: 'day', label: bucketKeyFor(a, 'week'),
    };
  }
  if (type === 'month') {
    const y = a.getFullYear(), m = a.getMonth();
    const first = new Date(y, m, 1);
    const last  = new Date(y, m + 1, 0);
    return {
      type, from: ymdOf(first), to: ymdOf(last),
      bucketBy: 'day', label: `${y}-${String(m + 1).padStart(2, '0')}`,
    };
  }
  if (type === 'year') {
    const y = a.getFullYear();
    return {
      type, from: `${y}-01-01`, to: `${y}-12-31`,
      bucketBy: 'month', label: String(y),
    };
  }
  throw new Error(`unknown period type '${type}'`);
}

/** Step the anchor by `delta` units of `type`; returns YYYY-MM-DD. */
export function shiftPeriod(type, anchorYmd, delta) {
  const a = parseYmd(anchorYmd);
  if (type === 'day')   a.setDate(a.getDate() + delta);
  else if (type === 'week')  a.setDate(a.getDate() + delta * 7);
  else if (type === 'month') { a.setDate(1); a.setMonth(a.getMonth() + delta); }
  else if (type === 'year')  a.setFullYear(a.getFullYear() + delta);
  else throw new Error(`unknown period type '${type}'`);
  return ymdOf(a);
}

/** Canonical, sorted bucket keys spanning [from..to] for a bucketBy. */
export function enumerateBuckets(from, to, bucketBy) {
  const start = parseYmd(from), end = parseYmd(to);
  if (bucketBy === 'month') {
    const out = [];
    const cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= end) {
      out.push(bucketKeyFor(cur, 'month'));
      cur.setMonth(cur.getMonth() + 1);
    }
    return out;
  }
  const seen = new Set();
  const cur = new Date(start);
  while (cur <= end) {
    seen.add(bucketKeyFor(cur, bucketBy === 'week' ? 'week' : 'day'));
    cur.setDate(cur.getDate() + 1);
  }
  return [...seen];
}

