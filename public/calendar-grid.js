// Pica — shared month-grid helper (M15 Plan 5).
//
// Builds the Monday-first 6×7 (42-cell) day matrix that backs both the full
// leaves calendar (leaves-calendar.js) and the leave-detail mini-calendar
// (leave.js). Local-time throughout (no UTC off-by-one). Pure except for the
// `isToday` flag, which is computed against the real "now" at call time.
//
// No DOM, no imports — plain ES module so Node can import it directly in tests.

/** Local "YYYY-MM-DD" for a Date. */
export function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/**
 * @param {number} year   full year, e.g. 2026
 * @param {number} month  0-based month (0 = January)
 * @returns {Array<{date: Date, ymd: string, inMonth: boolean, isToday: boolean}>}
 *   42 cells, starting from the Monday on/before the 1st of the month.
 */
export function monthMatrix(year, month) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;   // Sun=0..Sat=6 → Mon=0..Sun=6
  const start = new Date(year, month, 1 - offset);
  const today = new Date();

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({
      date,
      ymd: ymd(date),
      inMonth: date.getMonth() === month,
      isToday: sameDay(date, today),
    });
  }
  return cells;
}
