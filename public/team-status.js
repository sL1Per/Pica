/**
 * Shared session-pairing + status classification for the employer-facing
 * screens (home stat strip + Team-today, the /employees team list, and the
 * /employees/:id detail page). Pure functions — no DOM, no `/`-absolute
 * imports — so Node can import this directly in tests (same pattern as
 * calendar-grid.js / leave-actions.js).
 *
 * "On break" vs "Done" is a HEURISTIC: Pica's punch data cannot tell whether a
 * clocked-out employee is on a break and will return, or has gone home. We
 * treat closed-sessions-with-no-open as "break" before BREAK_CUTOFF_HOUR and
 * "done" at/after it. This is an approximation, documented in RELEASES.md.
 */

// Local hour at/after which a clocked-out employee reads as "Done", not "Break".
export const BREAK_CUTOFF_HOUR = 18;

// Render/sort order for the five statuses.
export const STATUS_SORT = { working: 0, break: 1, done: 2, leave: 3, off: 4, deactivated: 5 };

/**
 * Pair an employee's day of punches into [{in, out}] sessions, sorted by time.
 * A trailing unmatched `in` becomes an open session {in, out: null}. Tolerates
 * unordered input (server may send newest-first).
 */
export function pairSessions(punches) {
  const sorted = [...punches].sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const pairs = [];
  let open = null;
  for (const p of sorted) {
    if (p.type === 'in') {
      if (open) pairs.push({ in: open, out: null }); // back-to-back ins
      open = p;
    } else if (p.type === 'out' && open) {
      pairs.push({ in: open, out: p });
      open = null;
    }
  }
  if (open) pairs.push({ in: open, out: null });
  return pairs;
}

/** Total worked milliseconds; an open session counts up to `nowMs`. */
export function workedMs(pairs, nowMs = Date.now()) {
  let ms = 0;
  for (const { in: i, out } of pairs) {
    const start = new Date(i.ts).getTime();
    const end = out ? new Date(out.ts).getTime() : nowMs;
    if (end > start) ms += end - start;
  }
  return ms;
}

/** Total break milliseconds = sum of gaps between consecutive closed sessions. */
export function breakMs(pairs) {
  let ms = 0;
  for (let k = 1; k < pairs.length; k++) {
    const prevOut = pairs[k - 1].out;
    if (!prevOut) continue; // previous session still open → no measurable break
    const gap = new Date(pairs[k].in.ts).getTime() - new Date(prevOut.ts).getTime();
    if (gap > 0) ms += gap;
  }
  return ms;
}

/** Bucket a flat punch list by employeeId; each bucket sorted by ts ascending. */
export function groupByEmployee(punches) {
  const map = new Map();
  for (const p of punches) {
    if (!map.has(p.employeeId)) map.set(p.employeeId, []);
    map.get(p.employeeId).push(p);
  }
  for (const arr of map.values()) arr.sort((a, b) => new Date(a.ts) - new Date(b.ts));
  return map;
}

/**
 * Classify one employee's current state.
 *   pairs   — pairSessions() for today
 *   onLeave — has an approved leave covering today
 *   nowHour — local hour (0–23), defaults to now
 * → 'leave' | 'working' | 'break' | 'done' | 'off'
 */
export function classify({ pairs = [], onLeave = false, nowHour = new Date().getHours() } = {}) {
  if (onLeave) return 'leave';
  if (pairs.some((p) => p.out === null)) return 'working';
  if (pairs.length > 0) return nowHour < BREAK_CUTOFF_HOUR ? 'break' : 'done';
  return 'off';
}
