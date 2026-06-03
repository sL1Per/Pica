/**
 * Reports dashboard aggregation. Produces one OverviewResult per request.
 *
 * Pure of access control: the route resolves `people`/`scope` and passes them
 * in. This module only computes numbers. Reuses reports.js punch pairing so
 * worked-hours math is identical to the timesheet report.
 */
import {
  pairAndSplit, parseYmd, hoursReport, bucketKeyFor,
} from './reports.js';
import { isWeekday, enumerateBuckets } from './period.js';

const MS_PER_HOUR = 3_600_000;
const round1 = (h) => Math.round(h * 10) / 10;
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
// 60% is the minimum fraction of staff that must clock in on a weekday before
// we flag it as a coverage gap — a commonly used operational threshold.
const COVERAGE_THRESHOLD = 0.60;

/** Minutes-since-midnight for an "HH:MM" string. */
function hhmmToMin(s) { const [h, m] = s.split(':').map(Number); return h * 60 + m; }
/** Minutes-since-midnight for a local Date. */
function minOfDay(d) { return d.getHours() * 60 + d.getMinutes(); }
function minToHhmm(min) {
  // Truncate fractional minutes so 09:12.5 → "09:12" (floor, not round).
  const m = Math.floor(min);
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/**
 * Total break minutes per local day for one user. A break is the gap from an
 * OUT to the very next IN on the same calendar day. Cross-midnight gaps and
 * trailing opens are ignored. Returns Map<ymd, minutes>.
 */
function breaksByDay(rawPunches) {
  const sorted = [...rawPunches].sort((a, b) => a.ts.localeCompare(b.ts));
  const byDay = new Map();
  let lastOut = null;
  for (const p of sorted) {
    const d = new Date(p.ts);
    if (p.type === 'out') { lastOut = d; }
    else if (p.type === 'in') {
      if (lastOut && ymd(lastOut) === ymd(d) && d.getTime() > lastOut.getTime()) {
        const mins = (d.getTime() - lastOut.getTime()) / 60000;
        byDay.set(ymd(d), (byDay.get(ymd(d)) ?? 0) + mins);
      }
      lastOut = null;
    }
  }
  return byDay;
}

/** True if an approved leave overlaps the [from,to] report range. */
function overlaps(l, from, to) {
  if (l.unit === 'days') return !(l.end < from || l.start > to);
  const day = l.start.slice(0, 10); return day >= from && day <= to;
}

/**
 * Days a leave contributes to the range, clipped to [from,to]. Hour-unit
 * leaves convert via ÷8 so the team total stays in "days" for the KPI.
 */
function clippedDays(l, from, to) {
  if (l.unit === 'hours') return typeof l.hours === 'number' ? round1(l.hours / 8) : 0;
  const s = l.start < from ? from : l.start, e = l.end > to ? to : l.end;
  if (s > e) return 0;
  return Math.round((parseYmd(e) - parseYmd(s)) / 86_400_000) + 1;
}

/** Yields each calendar day a leave covers inside [from,to]. */
function* inRangeDays(l, from, to) {
  if (l.unit === 'hours') { const d = l.start.slice(0, 10); if (d >= from && d <= to) yield d; return; }
  const s = l.start < from ? from : l.start, e = l.end > to ? to : l.end;
  if (s > e) return;
  const cur = parseYmd(s), end = parseYmd(e);
  while (cur <= end) { yield ymd(cur); cur.setDate(cur.getDate() + 1); }
}

/** All raw punches for a user covering [from,to], plus one prior month so an
 *  open shift from the previous month can contribute to `from`. */
function readRawPunches(punchesStore, userId, from, to) {
  const fromD = parseYmd(from), toD = parseYmd(to);
  const cur = new Date(fromD.getFullYear(), fromD.getMonth() - 1, 1);
  const out = [];
  while (cur <= toD) {
    out.push(...punchesStore.listMonth(userId, cur.getFullYear(), cur.getMonth() + 1));
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

/** Count weekdays in inclusive [from,to]. */
function weekdayCount(from, to) {
  let n = 0;
  const cur = parseYmd(from), end = parseYmd(to);
  while (cur <= end) { if (isWeekday(cur)) n++; cur.setDate(cur.getDate() + 1); }
  return n;
}

/** Inclusive date span a bucket key covers, clipped to the report range. */
function bucketRange(key, bucketBy, from, to) {
  if (bucketBy === 'day') return [key, key];
  if (bucketBy === 'month') {
    const [y, m] = key.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    const bf = `${key}-01`, bt = `${key}-${pad2(last)}`;
    return [bf < from ? from : bf, bt > to ? to : bt];
  }
  // week: key "YYYY-Www" — walk the range and collect matching days.
  // String comparison is sufficient for YYYY-MM-DD bounds.
  const cur = parseYmd(from), end = parseYmd(to);
  let lo = null, hi = null;
  while (cur <= end) {
    if (bucketKeyFor(cur, 'week') === key) { const s = ymd(cur); if (!lo) lo = s; hi = s; }
    cur.setDate(cur.getDate() + 1);
  }
  return [lo ?? from, hi ?? to];
}

/** Read paired worked intervals for one user across [from,to]. */
function workedIntervals(punchesStore, userId, from, to, nowMs) {
  // Start one month before range to capture any open (in-only) punch that
  // started in the prior month and pairs with an out inside the range.
  return pairAndSplit(readRawPunches(punchesStore, userId, from, to), nowMs);
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

  const seriesAccum = []; // { key: bucketKey, mins } collected per person/day

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

    // Collect the full monthly span of raw punches once — shared by both the
    // punctuality scan and the breaks calculation below, avoiding a double read.
    const raw2 = readRawPunches(punchesStore, p.id, from, to);

    // First clock-in per local day (for punctuality).
    const firstInByDay = new Map();
    for (const punch of raw2) {
      if (punch.type !== 'in') continue;
      const d = new Date(punch.ts);
      const key = ymd(d);
      if (key < from || key > to) continue;
      const prev = firstInByDay.get(key);
      if (prev == null || d.getTime() < prev.getTime()) firstInByDay.set(key, d);
    }

    const graceCutoff = hhmmToMin(wt.expectedStart) + (wt.graceMinutes || 0);
    let onTime = 0, late = 0, sumInMin = 0, daysWorked = 0;
    for (const [, d] of firstInByDay) {
      daysWorked++;
      const mins = minOfDay(d);
      sumInMin += mins;
      if (mins <= graceCutoff) onTime++; else late++;
    }

    // Intra-day break minutes (OUT→IN gap on the same calendar day).
    const dayBreaks = breaksByDay(raw2.filter((x) => {
      const k = ymd(new Date(x.ts)); return k >= from && k <= to;
    }));
    let breakSum = 0, breakDays = 0;
    for (const [, mins] of dayBreaks) { breakSum += mins; breakDays++; }
    for (const [day, mins] of dayBreaks) {
      seriesAccum.push({ key: bucketKeyFor(parseYmd(day), bucketBy), mins });
    }

    return {
      id: p.id, name: p.name, role: p.role,
      worked, target, overtime,
      vsTargetPct: target > 0 ? Math.round((worked / target) * 100) : null,
      onLeave: 0,
      onTimePct: daysWorked > 0 ? Math.round((onTime / daysWorked) * 100) : null,
      avgClockIn: daysWorked > 0 ? minToHhmm(sumInMin / daysWorked) : null,
      lateDays: late,
      avgBreakMin: breakDays > 0 ? Math.round(breakSum / breakDays) : 0,
    };
  });

  const totalHours = round1(peopleRows.reduce((s, r) => s + r.worked, 0));
  const targetHours = round1(peopleRows.reduce((s, r) => s + r.target, 0));
  const overtimeHours = round1(peopleRows.reduce((s, r) => s + r.overtime, 0));
  const active = peopleRows.length || 1;

  // Fold per-person/day break minutes into per-bucket team averages.
  const breaksSeries = (() => {
    const m = new Map(); // bucketKey -> { sum, n }
    for (const { key, mins } of seriesAccum) {
      const e = m.get(key) ?? { sum: 0, n: 0 };
      e.sum += mins; e.n += 1; m.set(key, e);
    }
    return [...m.entries()].sort()
      .map(([key, e]) => ({ key, avgBreakMin: Math.round(e.sum / e.n) }));
  })();

  // Per-bucket worked and target hours summed across all people.
  // hoursReport accepts 'day'|'week'|'month'; 'year' periods always set
  // bucketBy='month' (see resolvePeriod), so no unsupported value reaches here.
  const buckets = enumerateBuckets(from, to, bucketBy);
  const workedByBucket = Object.fromEntries(buckets.map((k) => [k, 0]));
  for (const p of people) {
    try {
      const hr = hoursReport(punchesStore, p.id, from, to, bucketBy, now);
      for (const b of hr.buckets) {
        if (b.key in workedByBucket) workedByBucket[b.key] = round1(workedByBucket[b.key] + b.hours);
      }
    } catch { /* unreadable person store → skip, leave bucket at 0 */ }
  }
  // Target per bucket = (weekdays in bucket) × dailyHours for each person.
  const targetByBucket = Object.fromEntries(buckets.map((k) => [k, 0]));
  for (const k of buckets) {
    const [bf, bt] = bucketRange(k, bucketBy, from, to);
    const wd = weekdayCount(bf, bt);
    let t = 0;
    for (const p of people) t += (workingTimeFor(p.id).dailyHours || 0) * wd;
    targetByBucket[k] = round1(t);
  }
  const hoursSeries = buckets.map((k) => ({
    key: k, worked: workedByBucket[k], onLeave: 0, target: targetByBucket[k],
  }));

  // --- Leaves: approved days overlapping [from,to], per person + per type. ---
  // leaveCtx.leaveTypes drives the displayed type list so the summary rows
  // are always in the same order as the org's configured types.
  const TYPES = leaveCtx.leaveTypes ?? ['vacation', 'sick', 'appointment', 'other'];
  const byType = Object.fromEntries(TYPES.map((t) => [t, 0]));
  // Accumulates leave hours per bucket across all people; filled during the
  // per-person loop and applied to hoursSeries[].onLeave afterward.
  const leaveHoursByBucket = new Map();
  for (const row of peopleRows) {
    const approved = leavesStore.list({ employeeId: row.id })
      .filter((l) => l.status === 'approved' && overlaps(l, from, to));
    const pd = workingTimeFor(row.id).dailyHours || 0;
    let personDays = 0;
    for (const l of approved) {
      const d = clippedDays(l, from, to);
      personDays += d;
      byType[l.type] = round1((byType[l.type] ?? 0) + d);
      if (l.unit === 'hours') {
        const day = l.start.slice(0, 10);
        if (day >= from && day <= to) {
          const k = bucketKeyFor(parseYmd(day), bucketBy);
          const h = typeof l.hours === 'number' ? l.hours : 0;
          leaveHoursByBucket.set(k, round1((leaveHoursByBucket.get(k) ?? 0) + h));
        }
      } else {
        for (const day of inRangeDays(l, from, to)) {
          const dd = parseYmd(day);
          if (!isWeekday(dd)) continue;               // weekends have no target/worked
          const k = bucketKeyFor(dd, bucketBy);
          leaveHoursByBucket.set(k, round1((leaveHoursByBucket.get(k) ?? 0) + pd));
        }
      }
    }
    row.onLeave = round1(personDays);
  }
  const leaveByType = TYPES.map((t) => ({ type: t, days: round1(byType[t]) }));
  const leaveTotalDays = round1(leaveByType.reduce((s, x) => s + x.days, 0));

  // --- Leave balances (annual, year of `from`). Team view sums per type. ---
  // computeBalances can be expensive and may throw on unusual configs;
  // we absorb errors and return an empty array rather than crashing the overview.
  const balYear = Number(from.slice(0, 4));
  const balAgg = new Map(); // type -> { used, allowance, remaining }
  for (const p of people) {
    let bals = [];
    try {
      bals = leavesStore.computeBalances({
        userId: p.id, year: balYear,
        orgSettings: leaveCtx.orgSettings, leaveTypes: TYPES, daysOf: leaveCtx.daysOf,
      }) || [];
    } catch { bals = []; }
    for (const b of bals) {
      const e = balAgg.get(b.type) ?? { used: 0, allowance: 0, remaining: 0 };
      e.used += (b.booked ?? 0) + (b.pending ?? 0);
      e.allowance += (b.effectiveAllowance ?? b.allowance ?? 0);
      e.remaining += (b.remaining ?? 0);
      balAgg.set(b.type, e);
    }
  }
  const leaveBalances = [...balAgg.entries()].map(([type, e]) => ({
    type, used: round1(e.used), allowance: round1(e.allowance), remaining: round1(e.remaining),
  }));

  // --- on-leave per bucket (fills hoursSeries[].onLeave) ---
  // Per-person, weekday-aware, unit-aware: hours-unit credits actual hours;
  // days-unit credits the person's own dailyHours, skipping weekend days.
  for (const [k, hours] of leaveHoursByBucket) {
    const s = hoursSeries.find((x) => x.key === k);
    if (s) s.onLeave = round1(s.onLeave + hours);
  }

  // --- coverage gaps (scope=all only): weekdays where < 60% of staff clocked in. ---
  // Null for single-person scope — "coverage" is meaningless without a team.
  let coverageGaps = null;
  if (scope === 'all' && people.length > 0) {
    coverageGaps = 0;
    const presentByDay = new Map(); // ymd -> Set(userId with ≥1 IN punch)
    for (const p of people) {
      const raw = readRawPunches(punchesStore, p.id, from, to);
      for (const punch of raw) {
        if (punch.type !== 'in') continue;
        const k = ymd(new Date(punch.ts)); if (k < from || k > to) continue;
        const set = presentByDay.get(k) ?? new Set(); set.add(p.id); presentByDay.set(k, set);
      }
    }
    const cur = parseYmd(from), end = parseYmd(to);
    while (cur <= end) {
      if (isWeekday(cur)) {
        const present = (presentByDay.get(ymd(cur)) ?? new Set()).size;
        if (present / people.length < COVERAGE_THRESHOLD) coverageGaps++;
      }
      cur.setDate(cur.getDate() + 1);
    }
  }

  // --- watchlist: worst punctuality first; null on-time (no work) sorts last. ---
  // Surfaced on the dashboard so employers can quickly see who may need attention.
  const watchlist = peopleRows
    .map((r) => ({
      id: r.id, name: r.name,
      onTimePct: r.onTimePct, avgClockIn: r.avgClockIn,
      lateDays: r.lateDays, overtimeHours: r.overtime,
    }))
    .sort((a, b) => (a.onTimePct ?? 999) - (b.onTimePct ?? 999));

  return {
    scope,
    period: { from, to, bucketBy, label },
    kpis: {
      totalHours,
      avgPerPerson: round1(totalHours / active),
      targetHours,
      vsTargetPct: targetHours > 0 ? Math.round((totalHours / targetHours) * 100) : null,
      overtimeHours,
      leaveDays: leaveTotalDays,
      coverageGaps,
    },
    hoursSeries,
    leaveByType,
    leaveTotalDays,
    leaveBalances,
    breaksSeries,
    people: peopleRows,
    watchlist,
  };
}

// Internal exports for incremental tests in later tasks
export { weekdayCount, ymd };
