/**
 * Period helpers used by the team-hours report endpoint and by
 * the per-employee summary endpoint.
 *
 * Pure functions of (period, Date). Local-timezone arithmetic — the
 * server's notion of "today" is whatever clock the host sees. Date
 * boundaries are returned as YYYY-MM-DD strings to match the rest of
 * the storage layer's date-keyed indexing.
 */

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
