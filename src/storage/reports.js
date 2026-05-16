/**
 * Reports — aggregation functions.
 *
 * No new storage. Reads the plaintext fields of punches and leaves
 * (ts, type, start, end, status) and produces grouped views.
 *
 * All inputs and outputs use local-date YYYY-MM-DD strings. Hours are
 * returned as numbers (floats, rounded to minutes: one decimal digit).
 */

import { enumerateBuckets } from './period.js';

const MS_PER_HOUR = 3_600_000;

function pad2(n) { return String(n).padStart(2, '0'); }

/** Local-calendar YYYY-MM-DD for a Date. */
function ymd(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Round hours to one decimal minute (closest 0.1h ≈ 6 min). */
function round1(h) { return Math.round(h * 10) / 10; }

/**
 * ISO-8601 week number (Monday-based). Returns "YYYY-Www".
 * Standard algorithm: Thursday of the current week determines the year.
 */
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (t.getUTCDay() + 6) % 7;   // Mon=0 … Sun=6
  t.setUTCDate(t.getUTCDate() - dayNum + 3); // shift to Thursday of this week
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const firstThuDay = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstThuDay + 3);
  const weekNum = 1 + Math.round((t - firstThu) / (7 * 86_400_000));
  return `${t.getUTCFullYear()}-W${pad2(weekNum)}`;
}

function monthKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }

// ----------------------------------------------------------------------------
// Punch pairing → worked intervals
// ----------------------------------------------------------------------------

/**
 * Walk a chronologically-ordered list of punches, pairing clock-ins with
 * the next clock-out. Returns intervals in the form { startMs, endMs }.
 *
 * - An "in" not followed by an "out" is treated as an open shift and
 *   clipped at `nowMs` (so active shifts count up to "now").
 * - A stray "out" with no preceding "in" is ignored — shouldn't happen
 *   because the API guards against it, but we're defensive on read.
 * - Intervals spanning midnight are split at midnight boundaries, so
 *   day-level buckets attribute hours to the right day.
 */
function pairAndSplit(punches, nowMs) {
  const sorted = [...punches].sort((a, b) => a.ts.localeCompare(b.ts));
  const intervals = [];

  let inAt = null;
  for (const p of sorted) {
    if (p.type === 'in') {
      if (inAt == null) inAt = new Date(p.ts).getTime();
      // Double "in" would be a data bug; keep the earliest by ignoring later ones.
    } else if (p.type === 'out') {
      if (inAt == null) continue; // stray out
      const endMs = new Date(p.ts).getTime();
      splitByMidnight(inAt, endMs, intervals);
      inAt = null;
    }
  }
  if (inAt != null) {
    splitByMidnight(inAt, nowMs, intervals);
  }
  return intervals;
}

/** Push one interval to `out`, splitting on midnight boundaries. */
function splitByMidnight(startMs, endMs, out) {
  if (endMs <= startMs) return;
  let cursor = startMs;
  while (cursor < endMs) {
    const date = new Date(cursor);
    const nextMidnight = new Date(
      date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0,
    ).getTime();
    const sliceEnd = Math.min(endMs, nextMidnight);
    out.push({ startMs: cursor, endMs: sliceEnd });
    cursor = sliceEnd;
  }
}

// ----------------------------------------------------------------------------
// Hours aggregation
// ----------------------------------------------------------------------------

/**
 * Read all punches for an employee in the closed date range [from..to]
 * (both inclusive, YYYY-MM-DD). Walks monthly files. Trims the raw list
 * to the range (same-day precision) before pairing.
 */
function readPunchesInRange(punchesStore, employeeId, from, to, nowMs) {
  // Expand to cover one month before `from` — an open shift from the last
  // day of the previous month could contribute to the first day of `from`.
  const fromDate = parseYmd(from);
  const toDate = parseYmd(to);
  const spanStart = new Date(fromDate.getFullYear(), fromDate.getMonth() - 1, 1);

  const collected = [];
  const cur = new Date(spanStart);
  while (cur <= toDate) {
    const month = punchesStore.listMonth(employeeId, cur.getFullYear(), cur.getMonth() + 1);
    collected.push(...month);
    cur.setMonth(cur.getMonth() + 1);
  }
  return collected;
}

function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Produce per-day/week/month hour totals for one employee over a range.
 *
 * @param {object} punchesStore
 * @param {string} employeeId
 * @param {string} from   YYYY-MM-DD, inclusive (local date)
 * @param {string} to     YYYY-MM-DD, inclusive (local date)
 * @param {'day'|'week'|'month'} groupBy
 * @returns {{ buckets: Array<{key, hours}>, totalHours: number, range: {from, to} }}
 */
export function hoursReport(punchesStore, employeeId, from, to, groupBy = 'day', now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('from must be YYYY-MM-DD');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to))   throw new Error('to must be YYYY-MM-DD');
  if (from > to) throw new Error('from must be <= to');
  if (!['day', 'week', 'month'].includes(groupBy)) {
    throw new Error('groupBy must be day, week or month');
  }

  const nowMs = now.getTime();
  const rangeStartMs = parseYmd(from).getTime();
  const rangeEndMs   = new Date(parseYmd(to).getTime() + 86_400_000 - 1).getTime(); // end-of-day

  const raw = readPunchesInRange(punchesStore, employeeId, from, to, nowMs);
  const intervals = pairAndSplit(raw, nowMs);

  // Clip intervals to the requested range. Anything outside is dropped.
  const buckets = new Map();
  let totalMs = 0;

  for (const iv of intervals) {
    const clippedStart = Math.max(iv.startMs, rangeStartMs);
    const clippedEnd   = Math.min(iv.endMs,   rangeEndMs + 1);
    if (clippedEnd <= clippedStart) continue;
    const durMs = clippedEnd - clippedStart;
    totalMs += durMs;

    const key = keyFor(new Date(clippedStart), groupBy);
    buckets.set(key, (buckets.get(key) ?? 0) + durMs);
  }

  // Convert to sorted array of {key, hours}.
  const sortedKeys = [...buckets.keys()].sort();
  const rows = sortedKeys.map((key) => ({ key, hours: round1(buckets.get(key) / MS_PER_HOUR) }));

  return {
    employeeId,
    range: { from, to },
    groupBy,
    buckets: rows,
    totalHours: round1(totalMs / MS_PER_HOUR),
  };
}

export function bucketKeyFor(date, groupBy) {
  if (groupBy === 'day')   return ymd(date);
  if (groupBy === 'week')  return isoWeek(date);
  return monthKey(date);
}
function keyFor(date, groupBy) { return bucketKeyFor(date, groupBy); }

// ----------------------------------------------------------------------------
// Leaves report
// ----------------------------------------------------------------------------

/**
 * Count leaves that overlap an arbitrary date range [from..to], broken down
 * by type and status. Includes a days-off estimate using the stored unit:
 * days-mode sums inclusive day counts; hours-mode sums the stored `hours`
 * field divided by 8.
 */
export function leavesRangeReport(leavesStore, employeeId, from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('from must be YYYY-MM-DD');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to))   throw new Error('to must be YYYY-MM-DD');
  if (from > to) throw new Error('from must be <= to');

  const all = leavesStore.list({ employeeId });
  const touching = all.filter((l) => overlapsRange(l, from, to));

  const byStatus = { pending: 0, approved: 0, rejected: 0, cancelled: 0 };
  const byType   = { vacation: 0, sick: 0, appointment: 0, other: 0 };
  let approvedDays = 0;

  for (const l of touching) {
    byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
    byType[l.type]     = (byType[l.type]     ?? 0) + 1;
    if (l.status === 'approved') approvedDays += approxDaysOff(l);
  }

  return {
    employeeId, from, to,
    totalLeaves: touching.length,
    byStatus, byType,
    approvedDaysOff: round1(approvedDays),
    leaves: touching.map((l) => ({
      id: l.id, type: l.type, unit: l.unit,
      start: l.start, end: l.end, hours: l.hours, status: l.status,
    })),
  };
}

function overlapsRange(l, from, to) {
  if (l.unit === 'days') return !(l.end < from || l.start > to);
  const day = l.start.slice(0, 10);          // hours mode → ISO ts
  return day >= from && day <= to;
}

/**
 * Count leaves for a given calendar month. Delegates to leavesRangeReport.
 */
export function leavesReport(leavesStore, employeeId, year, month) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error('year must be a 4-digit year');
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('month must be 1..12');
  }
  const from = `${year}-${pad2(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to   = `${year}-${pad2(month)}-${pad2(lastDay)}`;
  const r = leavesRangeReport(leavesStore, employeeId, from, to);
  return { ...r, year, month };
}

export function approxDaysOff(l) {
  if (l.unit === 'hours') {
    return typeof l.hours === 'number' ? l.hours / 8 : 0;
  }
  const s = parseYmd(l.start);
  const e = parseYmd(l.end);
  return Math.round((e - s) / 86_400_000) + 1;
}

// ----------------------------------------------------------------------------
// Hours matrix — employees × buckets
// ----------------------------------------------------------------------------

/**
 * Build a cross-tabulation of hours for a set of employees over a date range.
 *
 * Each row represents one user; each cell holds the hours worked in one bucket.
 * Bucket keys are the same YYYY-MM-DD / YYYY-Www / YYYY-MM strings produced by
 * hoursReport. Zero-hour cells are omitted from `cells` (callers use `?? 0`).
 *
 * @param {object} punchesStore
 * @param {Array<{id, name}>} users
 * @param {string} from       YYYY-MM-DD
 * @param {string} to         YYYY-MM-DD
 * @param {'day'|'week'|'month'} bucketBy
 * @returns {{ from, to, bucketBy, buckets, rows, bucketTotals, grandTotal }}
 */
export function hoursMatrix(punchesStore, users, from, to, bucketBy, now = new Date()) {
  const buckets = enumerateBuckets(from, to, bucketBy);
  const bucketTotals = Object.fromEntries(buckets.map((k) => [k, 0]));
  let grandTotal = 0;

  const rows = users.map((u) => {
    const cells = {};
    let total = 0;
    try {
      const r = hoursReport(punchesStore, u.id, from, to, bucketBy, now);
      for (const b of r.buckets) {
        cells[b.key] = b.hours;
        if (b.key in bucketTotals) bucketTotals[b.key] = round1(bucketTotals[b.key] + b.hours);
      }
      total = r.totalHours;
    } catch { /* unreadable punches for one user → empty row */ }
    grandTotal = round1(grandTotal + total);
    return { id: u.id, name: u.name, cells, total };
  });

  return { from, to, bucketBy, buckets, rows, bucketTotals, grandTotal };
}

// ----------------------------------------------------------------------------
// Leaves matrix — employees × buckets
// ----------------------------------------------------------------------------

/**
 * Build a cross-tabulation of approved days off for a set of employees over
 * a date range.
 *
 * Days-unit leaves: each calendar day in [start..end] ∩ [from..to] contributes
 * 1 to the bucket that contains it. Hours-unit leaves: the stored `hours` value
 * divided by 8, attributed to the bucket containing the leave's start date,
 * clipped to [from..to].
 *
 * @param {object} leavesStore  — must expose `.list({ employeeId })`
 * @param {Array<{id, name}>} users
 * @param {string} from         YYYY-MM-DD, inclusive
 * @param {string} to           YYYY-MM-DD, inclusive
 * @param {'day'|'week'|'month'} bucketBy
 * @returns {{ from, to, bucketBy, buckets, rows, bucketTotals, grandTotal }}
 */
export function leavesMatrix(leavesStore, users, from, to, bucketBy) {
  const buckets = enumerateBuckets(from, to, bucketBy);
  const bucketTotals = Object.fromEntries(buckets.map((k) => [k, 0]));
  let grandTotal = 0;

  const rows = users.map((u) => {
    const cells = {};
    let total = 0;
    const approved = leavesStore.list({ employeeId: u.id })
      .filter((l) => l.status === 'approved');

    for (const l of approved) {
      if (l.unit === 'hours') {
        const day = l.start.slice(0, 10);
        if (day < from || day > to) continue;
        const k = bucketKeyFor(parseYmd(day), bucketBy);
        const v = typeof l.hours === 'number' ? l.hours / 8 : 0;
        cells[k] = round1((cells[k] ?? 0) + v);
        if (k in bucketTotals) bucketTotals[k] = round1(bucketTotals[k] + v);
        total = round1(total + v);
        continue;
      }
      // days unit: one day each, clipped to [from, to]
      const s = l.start < from ? from : l.start;
      const e = l.end   > to   ? to   : l.end;
      if (s > e) continue;
      const cur = parseYmd(s), end = parseYmd(e);
      while (cur <= end) {
        const k = bucketKeyFor(cur, bucketBy);
        cells[k] = round1((cells[k] ?? 0) + 1);
        if (k in bucketTotals) bucketTotals[k] = round1(bucketTotals[k] + 1);
        total = round1(total + 1);
        cur.setDate(cur.getDate() + 1);
      }
    }
    grandTotal = round1(grandTotal + total);
    return { id: u.id, name: u.name, cells, total };
  });

  return { from, to, bucketBy, buckets, rows, bucketTotals, grandTotal };
}

// ----------------------------------------------------------------------------
// CSV helpers
// ----------------------------------------------------------------------------

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function hoursReportToCsv(report) {
  const lines = [];
  lines.push(`"Employee",${csvEscape(report.employeeId)}`);
  lines.push(`"Range",${csvEscape(report.range.from)},${csvEscape(report.range.to)}`);
  lines.push(`"GroupBy",${csvEscape(report.groupBy)}`);
  lines.push('');
  lines.push(`"${report.groupBy}","hours"`);
  for (const b of report.buckets) {
    lines.push(`${csvEscape(b.key)},${csvEscape(b.hours)}`);
  }
  lines.push('');
  lines.push(`"Total",${csvEscape(report.totalHours)}`);
  return lines.join('\n') + '\n';
}

export function leavesReportToCsv(report) {
  const lines = [];
  lines.push(`"Employee",${csvEscape(report.employeeId)}`);
  lines.push(`"Year",${report.year},"Month",${pad2(report.month)}`);
  lines.push(`"Total leaves",${report.totalLeaves}`);
  lines.push(`"Approved days off (approx)",${report.approvedDaysOff}`);
  lines.push('');
  lines.push('"type","unit","start","end","hours","status"');
  for (const l of report.leaves) {
    lines.push([
      csvEscape(l.type),
      csvEscape(l.unit),
      csvEscape(l.start),
      csvEscape(l.end),
      csvEscape(l.hours ?? ''),
      csvEscape(l.status),
    ].join(','));
  }
  return lines.join('\n') + '\n';
}

// Re-exports useful to the routes layer.
export { isoWeek, ymd };
