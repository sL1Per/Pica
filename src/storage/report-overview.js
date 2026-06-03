/**
 * Reports dashboard aggregation. Produces one OverviewResult per request.
 *
 * Pure of access control: the route resolves `people`/`scope` and passes them
 * in. This module only computes numbers. Reuses reports.js punch pairing so
 * worked-hours math is identical to the timesheet report.
 */
import {
  pairAndSplit, parseYmd, hoursReport, approxDaysOff,
} from './reports.js';
import { isWeekday } from './period.js';

const MS_PER_HOUR = 3_600_000;
const round1 = (h) => Math.round(h * 10) / 10;
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Count weekdays in inclusive [from,to]. */
function weekdayCount(from, to) {
  let n = 0;
  const cur = parseYmd(from), end = parseYmd(to);
  while (cur <= end) { if (isWeekday(cur)) n++; cur.setDate(cur.getDate() + 1); }
  return n;
}

/** Read paired worked intervals for one user across [from,to]. */
function workedIntervals(punchesStore, userId, from, to, nowMs) {
  const fromD = parseYmd(from), toD = parseYmd(to);
  // Start one month before range to capture any open (in-only) punch that
  // started in the prior month and pairs with an out inside the range.
  const spanStart = new Date(fromD.getFullYear(), fromD.getMonth() - 1, 1);
  const raw = [];
  const cur = new Date(spanStart);
  while (cur <= toD) {
    raw.push(...punchesStore.listMonth(userId, cur.getFullYear(), cur.getMonth() + 1));
    cur.setMonth(cur.getMonth() + 1);
  }
  return pairAndSplit(raw, nowMs);
}

export function buildOverview(opts) {
  const {
    punchesStore, leavesStore, people, from, to, bucketBy, label,
    workingTimeFor, leaveCtx, scope, now = new Date(),
  } = opts;
  const nowMs = now.getTime();
  const rangeStartMs = parseYmd(from).getTime();
  const rangeEndMs = parseYmd(to).getTime() + 86_400_000 - 1;
  const weekdays = weekdayCount(from, to);

  const peopleRows = people.map((p) => {
    const wt = workingTimeFor(p.id);
    const ivs = workedIntervals(punchesStore, p.id, from, to, nowMs)
      .map((iv) => ({
        startMs: Math.max(iv.startMs, rangeStartMs),
        endMs: Math.min(iv.endMs, rangeEndMs + 1),
      }))
      .filter((iv) => iv.endMs > iv.startMs);

    let workedMs = 0;
    for (const iv of ivs) workedMs += iv.endMs - iv.startMs;
    const worked = round1(workedMs / MS_PER_HOUR);
    const target = round1((wt.dailyHours || 0) * weekdays);
    const overtime = round1(Math.max(0, worked - target));

    return {
      id: p.id, name: p.name, role: p.role,
      worked, target, overtime,
      vsTargetPct: target > 0 ? Math.round((worked / target) * 100) : null,
      // Placeholders filled by later tasks (punctuality, leaves, breaks):
      onLeave: 0, onTimePct: null, avgClockIn: null, lateDays: 0, avgBreakMin: 0,
    };
  });

  const totalHours = round1(peopleRows.reduce((s, r) => s + r.worked, 0));
  const targetHours = round1(peopleRows.reduce((s, r) => s + r.target, 0));
  const overtimeHours = round1(peopleRows.reduce((s, r) => s + r.overtime, 0));
  const active = peopleRows.length || 1;

  return {
    scope,
    period: { from, to, bucketBy, label },
    kpis: {
      totalHours,
      avgPerPerson: round1(totalHours / active),
      targetHours,
      vsTargetPct: targetHours > 0 ? Math.round((totalHours / targetHours) * 100) : null,
      overtimeHours,
      // Placeholders filled by later tasks (leaves, coverage):
      leaveDays: 0,
      coverageGaps: null,
    },
    // Placeholders filled by Tasks 4–7:
    hoursSeries: [],
    leaveByType: [],
    leaveTotalDays: 0,
    leaveBalances: [],
    breaksSeries: [],
    people: peopleRows,
    watchlist: [],
  };
}

// Internal exports for incremental tests in later tasks
export { weekdayCount, ymd };
