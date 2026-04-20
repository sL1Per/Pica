/**
 * Reports — aggregation functions.
 *
 * No new storage. Reads the plaintext fields of punches and leaves
 * (ts, type, start, end, status) and produces grouped views.
 *
 * All inputs and outputs use local-date YYYY-MM-DD strings. Hours are
 * returned as numbers (floats, rounded to minutes: one decimal digit).
 */

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

function keyFor(date, groupBy) {
  if (groupBy === 'day')   return ymd(date);
  if (groupBy === 'week')  return isoWeek(date);
  return monthKey(date);
}

// ----------------------------------------------------------------------------
// Leaves report
// ----------------------------------------------------------------------------

/**
 * Count leaves that overlap a given month, broken down by type and status.
 * Includes a days-off estimate (working-day count, Mon–Fri), using the
 * stored unit to decide: days-mode sums inclusive day counts; hours-mode
 * sums the stored `hours` field divided by 8.
 */
export function leavesReport(leavesStore, employeeId, year, month) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error('year must be a 4-digit year');
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('month must be 1..12');
  }

  const monthStart = `${year}-${pad2(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${pad2(month)}-${pad2(lastDay)}`;

  const all = leavesStore.list({ employeeId });
  const touching = all.filter((l) => overlapsMonth(l, monthStart, monthEnd));

  const byStatus = { pending: 0, approved: 0, rejected: 0, cancelled: 0 };
  const byType   = { vacation: 0, sick: 0, appointment: 0, other: 0 };

  let approvedDays = 0;

  for (const l of touching) {
    byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
    byType[l.type] = (byType[l.type] ?? 0) + 1;

    if (l.status === 'approved') {
      approvedDays += approxDaysOff(l);
    }
  }

  return {
    employeeId,
    year,
    month,
    totalLeaves: touching.length,
    byStatus,
    byType,
    approvedDaysOff: round1(approvedDays),
    leaves: touching.map((l) => ({
      id: l.id,
      type: l.type,
      unit: l.unit,
      start: l.start,
      end: l.end,
      hours: l.hours,
      status: l.status,
    })),
  };
}

function overlapsMonth(l, monthStart, monthEnd) {
  if (l.unit === 'days') {
    return !(l.end < monthStart || l.start > monthEnd);
  }
  // hours mode — start/end are ISO timestamps
  const leaveDay = l.start.slice(0, 10);
  return leaveDay >= monthStart && leaveDay <= monthEnd;
}

function approxDaysOff(l) {
  if (l.unit === 'hours') {
    return typeof l.hours === 'number' ? l.hours / 8 : 0;
  }
  const s = parseYmd(l.start);
  const e = parseYmd(l.end);
  return Math.round((e - s) / 86_400_000) + 1;
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
