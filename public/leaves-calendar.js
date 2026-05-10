import { showMessage } from '/app.js';
import { t, applyTranslations, getLocale, fmtDate } from '/i18n.js';

import { mountTopBar, mountFooter } from '/topbar.js';
mountTopBar();
mountFooter();
applyTranslations();

const $ = (id) => document.getElementById(id);
const grid       = $('cal-grid');
const titleEl    = $('cal-title');
const prevBtn    = $('prev-month');
const nextBtn    = $('next-month');
const todayBtn   = $('today-btn');
const messageEl  = $('message');
const detailsEl       = $('cal-details');
const detailsTitleEl  = $('cal-details-title');
const detailsListEl   = $('cal-details-list');
const detailsCloseBtn = $('cal-details-close');

// Currently selected day in the details panel ("YYYY-MM-DD" string),
// or null when the panel is closed.
let selectedDateStr = null;

// Locale-aware month name via Intl. Falls back to the en-US fixed list
// if Intl errors out for any reason.
function monthName(monthIndex, year) {
  try {
    return new Intl.DateTimeFormat(getLocale(), { month: 'long' }).format(new Date(year, monthIndex, 1));
  } catch {
    return ['January','February','March','April','May','June','July','August','September','October','November','December'][monthIndex];
  }
}

// Week starts Monday (ISO) — feels natural for a work tool.
// Localized via the calendar.weekday.* dictionary keys.
const WEEKDAYS = ['mon','tue','wed','thu','fri','sat','sun'];

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
  titleEl.textContent = `${monthName(month, year)} ${year}`;

  grid.innerHTML = '';

  // Weekday headers.
  for (const w of WEEKDAYS) {
    const h = document.createElement('div');
    h.className = 'cal-weekday';
    h.textContent = t('calendar.weekday.' + w);
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
    const dateStr = ymd(date);
    cell.dataset.date = dateStr;
    if (date.getMonth() !== month) cell.classList.add('cal-day--other-month');
    if (sameDay(date, today))      cell.classList.add('cal-day--today');
    if (dateStr === selectedDateStr) cell.classList.add('cal-day--selected');

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

// -- Details panel -----------------------------------------------------------

function openDetailsForDate(dateStr) {
  // Re-derive the leaves for the selected day so the panel reflects the
  // current dataset (re-renders after month changes pull from allLeaves).
  const date = parseYmd(dateStr);
  const dayLeaves = leavesForDay(date);

  // Tapping a day with no leaves: just close the panel rather than
  // showing an empty card. Keeps the surface minimal.
  if (dayLeaves.length === 0) {
    closeDetails();
    return;
  }

  selectedDateStr = dateStr;
  detailsTitleEl.textContent = fmtDate(date);

  detailsListEl.innerHTML = '';
  for (const leave of dayLeaves) {
    detailsListEl.appendChild(renderDetailRow(leave));
  }
  detailsEl.hidden = false;

  // Repaint to update the .cal-day--selected highlight.
  paintSelectedHighlight();

  // Bring the panel into view on mobile (it sits below the grid; the
  // user has just tapped the grid so the viewport may not include it).
  if (window.matchMedia('(max-width: 600px)').matches) {
    detailsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function closeDetails() {
  selectedDateStr = null;
  detailsEl.hidden = true;
  paintSelectedHighlight();
}

function paintSelectedHighlight() {
  for (const cell of grid.querySelectorAll('.cal-day')) {
    cell.classList.toggle('cal-day--selected', cell.dataset.date === selectedDateStr);
  }
}

function renderDetailRow(leave) {
  // Anonymized: non-link, type stripped server-side.
  if (leave.anonymized) {
    const li = document.createElement('li');
    li.className = 'cal-details__row cal-details__row--anonymized';
    const name = document.createElement('span');
    name.className = 'cal-details__row-name';
    name.textContent = t('calendar.anonymized');
    li.appendChild(name);
    const meta = document.createElement('span');
    meta.className = 'cal-details__row-meta';
    meta.textContent = formatRange(leave);
    li.appendChild(meta);
    return li;
  }

  const isSelf = leave.employeeId === me.id;
  const canOpen = me.role === 'employer' || isSelf;
  const li = document.createElement(canOpen ? 'a' : 'li');
  li.className = `cal-details__row cal-details__row--${leave.type}`;
  if (isSelf) li.classList.add('cal-details__row--self');
  if (canOpen) li.href = `/leaves/${leave.id}`;

  const name = document.createElement('span');
  name.className = 'cal-details__row-name';
  name.textContent = leave.fullName || leave.username || '—';
  li.appendChild(name);

  const type = document.createElement('span');
  type.className = 'cal-details__row-meta';
  type.textContent = `${t('leaves.type.' + leave.type)} · ${formatRange(leave)}`;
  li.appendChild(type);
  return li;
}

function formatRange(leave) {
  if (leave.unit === 'days') {
    return leave.start === leave.end
      ? fmtDate(parseYmd(leave.start))
      : `${fmtDate(parseYmd(leave.start))} → ${fmtDate(parseYmd(leave.end))}`;
  }
  // Hours-mode is always intraday; just show the date.
  return fmtDate(parseYmd(leave.start.slice(0, 10)));
}

function renderBar(leave) {
  const a = document.createElement('a');

  // Anonymized bar — another employee's leave seen by an employee.
  // Server stripped identity + type; render a generic capacity block.
  if (leave.anonymized) {
    a.className = 'cal-bar cal-bar--anonymized';
    a.href = '#';
    a.addEventListener('click', (e) => e.preventDefault());
    a.style.cursor = 'default';
    const name = document.createElement('span');
    name.className = 'cal-bar__name';
    name.textContent = t('calendar.anonymized');
    a.appendChild(name);
    const range = leave.unit === 'days'
      ? (leave.start === leave.end ? leave.start : `${leave.start} → ${leave.end}`)
      : `${leave.start.slice(0,10)}`;
    a.title = `${t('calendar.anonymized')} · ${range}`;
    return a;
  }

  a.className = `cal-bar cal-bar--${leave.type}`;
  if (leave.employeeId === me.id) a.classList.add('cal-bar--self');

  // Employers and owners can click through to the leave detail page.
  // (Anonymized bars never reach this branch.)
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
  name.textContent = leave.fullName || leave.username || '—';
  a.appendChild(name);

  // Title tooltip includes the full span for hover.
  const range = leave.unit === 'days'
    ? (leave.start === leave.end ? leave.start : `${leave.start} → ${leave.end}`)
    : `${leave.start.slice(0,10)}`;
  a.title = `${leave.fullName || leave.username || 'someone'} · ${leave.type} · ${range}`;
  return a;
}

// -- Nav --------------------------------------------------------------------

prevBtn.addEventListener('click', () => {
  cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
  closeDetails();
  renderMonth();
});
nextBtn.addEventListener('click', () => {
  cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  closeDetails();
  renderMonth();
});
todayBtn.addEventListener('click', () => {
  cursor = new Date();
  closeDetails();
  renderMonth();
});

// Delegated click handler on the grid: tapping a day cell opens the
// details panel for that day. Bars on mobile have pointer-events: none
// (CSS), so the cell handler always wins. On desktop, bars keep their
// own click → /leaves/:id navigation; we only react when the click did
// NOT land on a bar.
grid.addEventListener('click', (e) => {
  if (e.target.closest('.cal-bar')) return;
  const cell = e.target.closest('.cal-day');
  if (!cell || !cell.dataset.date) return;
  // Toggle: tapping the already-selected day closes the panel.
  if (cell.dataset.date === selectedDateStr) {
    closeDetails();
  } else {
    openDetailsForDate(cell.dataset.date);
  }
});

detailsCloseBtn.addEventListener('click', closeDetails);

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
