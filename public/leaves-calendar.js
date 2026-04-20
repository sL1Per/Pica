import { showMessage } from '/app.js';

import { mountTopBar } from '/topbar.js';
mountTopBar();

const $ = (id) => document.getElementById(id);
const grid       = $('cal-grid');
const titleEl    = $('cal-title');
const prevBtn    = $('prev-month');
const nextBtn    = $('next-month');
const todayBtn   = $('today-btn');
const messageEl  = $('message');

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Week starts Monday (ISO) — feels natural for a work tool.
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

let me = null;
let allLeaves = [];
let cursor = new Date(); // which month is being viewed

// -- Date helpers -----------------------------------------------------------

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function parseYmd(s) {
  // "YYYY-MM-DD" → local-date (avoids UTC off-by-ones)
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// -- Leaves → day map --------------------------------------------------------

/**
 * For a leave that spans [startDate, endDate], returns true if it overlaps
 * the given calendar date (inclusive of both ends for days mode; includes
 * the start date for hours-mode, since it's always intraday).
 */
function leaveTouches(leave, date) {
  if (leave.unit === 'days') {
    return ymd(date) >= leave.start && ymd(date) <= leave.end;
  }
  // hours mode — use just the start date (same-day by API contract)
  const leaveDate = new Date(leave.start);
  return sameDay(leaveDate, date);
}

function leavesForDay(date) {
  return allLeaves.filter((l) => leaveTouches(l, date));
}

// -- Rendering --------------------------------------------------------------

function renderMonth() {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  titleEl.textContent = `${MONTHS[month]} ${year}`;

  grid.innerHTML = '';

  // Weekday headers.
  for (const w of WEEKDAYS) {
    const h = document.createElement('div');
    h.className = 'cal-weekday';
    h.textContent = w;
    grid.appendChild(h);
  }

  // First day of the month, shifted so Monday = 0.
  const first = new Date(year, month, 1);
  const jsDow = first.getDay();             // Sun=0 … Sat=6
  const offset = (jsDow + 6) % 7;           // Mon=0 … Sun=6

  // 6 rows × 7 cols = 42 cells, starting from the Monday on/before the 1st.
  const start = new Date(year, month, 1 - offset);
  const today = new Date();

  for (let i = 0; i < 42; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);

    const cell = document.createElement('div');
    cell.className = 'cal-day';
    if (date.getMonth() !== month) cell.classList.add('cal-day--other-month');
    if (sameDay(date, today))      cell.classList.add('cal-day--today');

    const num = document.createElement('div');
    num.className = 'cal-day__num';
    num.textContent = date.getDate();
    cell.appendChild(num);

    const dayLeaves = leavesForDay(date);
    for (const leave of dayLeaves) {
      cell.appendChild(renderBar(leave));
    }
    if (dayLeaves.length === 0) {
      const spacer = document.createElement('div');
      spacer.className = 'cal-day__empty';
      cell.appendChild(spacer);
    }

    grid.appendChild(cell);
  }
}

function renderBar(leave) {
  const a = document.createElement('a');
  a.className = `cal-bar cal-bar--${leave.type}`;
  if (leave.employeeId === me.id) a.classList.add('cal-bar--self');

  // Employers and owners can click through to the leave detail page.
  // Other employees get a non-clickable view (no access on the detail page).
  const canOpen = me.role === 'employer' || leave.employeeId === me.id;
  if (canOpen) {
    a.href = `/leaves/${leave.id}`;
  } else {
    a.href = '#';
    a.addEventListener('click', (e) => e.preventDefault());
    a.style.cursor = 'default';
  }

  const name = document.createElement('span');
  name.className = 'cal-bar__name';
  name.textContent = leave.username || 'someone';
  a.appendChild(name);

  // Title tooltip includes the full span for hover.
  const range = leave.unit === 'days'
    ? (leave.start === leave.end ? leave.start : `${leave.start} → ${leave.end}`)
    : `${leave.start.slice(0,10)}`;
  a.title = `${leave.username || 'someone'} · ${leave.type} · ${range}`;
  return a;
}

// -- Nav --------------------------------------------------------------------

prevBtn.addEventListener('click', () => {
  cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
  renderMonth();
});
nextBtn.addEventListener('click', () => {
  cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  renderMonth();
});
todayBtn.addEventListener('click', () => {
  cursor = new Date();
  renderMonth();
});

// -- Bootstrap --------------------------------------------------------------

(async () => {
  const [meRes, lvRes] = await Promise.all([
    fetch('/api/me',              { credentials: 'same-origin' }),
    fetch('/api/leaves/approved', { credentials: 'same-origin' }),
  ]);
  if (meRes.status === 401) { window.location.href = '/login'; return; }
  me = await meRes.json();

  if (!lvRes.ok) {
    showMessage(messageEl, 'Failed to load approved leaves.', 'error');
    return;
  }
  allLeaves = (await lvRes.json()).leaves;
  renderMonth();
})();
