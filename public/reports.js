import { t, applyTranslations } from '/i18n.js';
import { showMessage, setBusy } from '/app.js';

import { mountTopBar, mountFooter } from '/topbar.js';
mountTopBar();
mountFooter();
applyTranslations();

const $ = (id) => document.getElementById(id);

const employeePickerWrap = $('employee-picker-wrap');
const employeePicker     = $('employee-picker');
const fromDate  = $('from-date');
const toDate    = $('to-date');
const leaveYear = $('leave-year');
const leaveMonth = $('leave-month');
const refreshBtn = $('refresh-btn');
const printBtn   = $('print-btn');
const messageEl  = $('message');

const hoursTbody = $('hours-table').querySelector('tbody');
const hoursEmpty = $('hours-empty');
const hoursRange = $('hours-range');
const hoursTotal = $('hours-total');
const hoursKeyCol = $('hours-key-col');
const hoursCsvLink = $('hours-csv-link');

const leavesTbody = $('leaves-table').querySelector('tbody');
const leavesEmpty = $('leaves-empty');
const leavesRange = $('leaves-range');
const leavesCsvLink = $('leaves-csv-link');

const statApproved  = $('stat-approved');
const statPending   = $('stat-pending');
const statRejected  = $('stat-rejected');
const statCancelled = $('stat-cancelled');
const statDays      = $('stat-days');

const printTitle    = $('print-title');
const printSubtitle = $('print-subtitle');

let me = null;
let targetId = null;
let targetUsername = '';
let groupBy = 'day';

// ---- Helpers --------------------------------------------------------------

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function pad2(n) { return String(n).padStart(2, '0'); }

function formatWhen(l) {
  if (l.unit === 'days') {
    return l.start === l.end ? l.start : `${l.start} → ${l.end}`;
  }
  const s = new Date(l.start), e = new Date(l.end);
  const ds = s.toISOString().slice(0, 10);
  const hs = `${pad2(s.getHours())}:${pad2(s.getMinutes())}`;
  const he = `${pad2(e.getHours())}:${pad2(e.getMinutes())}`;
  return `${ds}, ${hs}–${he}`;
}

function formatDuration(l) {
  if (l.unit === 'hours' && typeof l.hours === 'number') return `${l.hours.toFixed(1)} h`;
  const s = new Date(l.start), e = new Date(l.end);
  const days = Math.round((e - s) / 86_400_000) + 1;
  return `${days} day${days === 1 ? '' : 's'}`;
}

function prettyGroupBy(gb) {
  return gb === 'day' ? 'Day' : gb === 'week' ? 'Week' : 'Month';
}

// ---- State → URL helpers --------------------------------------------------

function buildHoursUrl(ext = '') {
  const qs = new URLSearchParams({ from: fromDate.value, to: toDate.value, groupBy });
  return `/api/reports/hours/${targetId}${ext}?${qs.toString()}`;
}
function buildLeavesUrl(ext = '') {
  const qs = new URLSearchParams({ year: leaveYear.value, month: leaveMonth.value });
  return `/api/reports/leaves/${targetId}${ext}?${qs.toString()}`;
}

// ---- Rendering ------------------------------------------------------------

function renderHours(report) {
  hoursKeyCol.textContent = prettyGroupBy(report.groupBy);
  hoursTbody.innerHTML = '';
  if (report.buckets.length === 0) {
    hoursEmpty.hidden = false;
  } else {
    hoursEmpty.hidden = true;
    for (const b of report.buckets) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(b.key)}</td><td class="right">${b.hours.toFixed(1)}</td>`;
      hoursTbody.appendChild(tr);
    }
  }
  hoursTotal.textContent = report.totalHours.toFixed(1);
  hoursRange.textContent = `${report.range.from} → ${report.range.to} · ${prettyGroupBy(report.groupBy)}`;
  hoursCsvLink.href = buildHoursUrl('.csv');
}

function renderLeaves(report) {
  statApproved.textContent  = report.byStatus.approved  ?? 0;
  statPending.textContent   = report.byStatus.pending   ?? 0;
  statRejected.textContent  = report.byStatus.rejected  ?? 0;
  statCancelled.textContent = report.byStatus.cancelled ?? 0;
  statDays.textContent      = report.approvedDaysOff.toFixed(1);

  leavesTbody.innerHTML = '';
  if (report.leaves.length === 0) {
    leavesEmpty.hidden = false;
  } else {
    leavesEmpty.hidden = true;
    for (const l of report.leaves) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(l.type)}</td>
        <td>${escapeHtml(formatWhen(l))}</td>
        <td class="right">${escapeHtml(formatDuration(l))}</td>
        <td><span class="status-badge status-badge--${l.status}">${escapeHtml(t("status." + l.status))}</span></td>
      `;
      leavesTbody.appendChild(tr);
    }
  }
  leavesRange.textContent = `${report.year}-${pad2(report.month)} · ${report.totalLeaves} total`;
  leavesCsvLink.href = buildLeavesUrl('.csv');
}

function updatePrintTitle() {
  printTitle.textContent = `Pica — Report · ${targetUsername || ''}`;
  const ymStr = `${leaveYear.value}-${pad2(leaveMonth.value)}`;
  printSubtitle.textContent = `Hours ${fromDate.value} to ${toDate.value} (${prettyGroupBy(groupBy)}) · Leaves ${ymStr}`;
}

// ---- Data fetch -----------------------------------------------------------

async function refresh() {
  if (!targetId) return;
  showMessage(messageEl, '');
  setBusy(refreshBtn, true, 'Loading…');

  const [hRes, lRes] = await Promise.all([
    fetch(buildHoursUrl(),  { credentials: 'same-origin' }),
    fetch(buildLeavesUrl(), { credentials: 'same-origin' }),
  ]);

  if (hRes.status === 403 || lRes.status === 403) {
    showMessage(messageEl, "You don't have access to this employee's reports.", 'error');
    setBusy(refreshBtn, false);
    return;
  }
  if (!hRes.ok) {
    const err = await hRes.json().catch(() => ({}));
    showMessage(messageEl, err.error || 'Failed to load hours', 'error');
    setBusy(refreshBtn, false);
    return;
  }
  if (!lRes.ok) {
    const err = await lRes.json().catch(() => ({}));
    showMessage(messageEl, err.error || 'Failed to load leaves', 'error');
    setBusy(refreshBtn, false);
    return;
  }

  const [hoursData, leavesData] = await Promise.all([hRes.json(), lRes.json()]);
  targetUsername = hoursData.username || targetUsername;
  renderHours(hoursData);
  renderLeaves(leavesData);
  updatePrintTitle();
  setBusy(refreshBtn, false);
}

// ---- Controls -------------------------------------------------------------

// Scope to the controls card only — the team-overview section also has
// chips (with data-period instead of data-groupby), and a global
// .chip selector would catch both: clicking a team chip would set
// groupBy=undefined and stomp the per-employee chip's active state.
const groupByChips = document.querySelectorAll('.controls-grid .chip[data-groupby]');
for (const chip of groupByChips) {
  chip.addEventListener('click', () => {
    groupBy = chip.dataset.groupby;
    for (const c of groupByChips) c.classList.toggle('active', c === chip);
    refresh();
  });
}

refreshBtn.addEventListener('click', refresh);
printBtn.addEventListener('click', () => window.print());

for (const el of [fromDate, toDate, leaveYear, leaveMonth]) {
  el.addEventListener('change', refresh);
}
employeePicker.addEventListener('change', () => {
  targetId = employeePicker.value;
  targetUsername = employeePicker.options[employeePicker.selectedIndex]?.text || '';
  refresh();
});

// ---- Initial defaults + bootstrap ----------------------------------------

function initDefaults() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  fromDate.value = `${y}-${pad2(m)}-01`;
  toDate.value   = `${y}-${pad2(m)}-${pad2(now.getDate())}`;
  leaveYear.value = String(y);
  leaveMonth.value = String(m);
}

// ---- Team overview (employer only) -------------------------------------

const teamSection      = $('team-section');
const teamPeriodChips  = $('team-period-chips');
const teamRange        = $('team-range');
const teamTbody        = $('team-table')?.querySelector('tbody');
const teamEmpty        = $('team-empty');
const teamError        = $('team-error');
let teamPeriod = 'month';

function fmtHoursCell(h) {
  // 0 → "0", 9 → "9", 9.5 → "9.5". Matches the Timesheets column in the example.
  if (!Number.isFinite(h)) return '0';
  if (Math.abs(h - Math.round(h)) < 0.05) return String(Math.round(h));
  return String(Math.round(h * 10) / 10);
}

function renderTeamRows(data) {
  if (!teamTbody) return;
  teamTbody.innerHTML = '';
  teamRange.textContent = data.label || '';

  if (!data.rows || data.rows.length === 0) {
    teamEmpty.hidden = false;
    return;
  }
  teamEmpty.hidden = true;

  for (const r of data.rows) {
    const tr = document.createElement('tr');
    const periodCell = data.label;
    const name = r.fullName || r.username;
    const avatar = r.hasPicture
      ? `<img class="team-avatar" src="/api/employees/${encodeURIComponent(r.id)}/picture" alt="">`
      : `<span class="team-avatar team-avatar--placeholder" aria-hidden="true">${escapeHtml(name.charAt(0).toUpperCase())}</span>`;
    tr.innerHTML = `
      <td class="team-period">${escapeHtml(periodCell)}</td>
      <td class="team-staff">${avatar}<span class="team-staff__name">${escapeHtml(name)}</span></td>
      <td class="right">${escapeHtml(fmtHoursCell(r.scheduled))}</td>
      <td class="right">${escapeHtml(fmtHoursCell(r.worked))}</td>
    `;
    teamTbody.appendChild(tr);
  }
}

async function loadTeamOverview() {
  if (!teamSection || teamSection.hidden) return;
  teamError.hidden = true;
  try {
    const res = await fetch(`/api/reports/team-hours?period=${encodeURIComponent(teamPeriod)}`, {
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderTeamRows(data);
  } catch (err) {
    teamTbody.innerHTML = '';
    teamEmpty.hidden = true;
    teamError.hidden = false;
    teamError.textContent = t('widgets.couldNotLoad');
  }
}

function wireTeamPeriodChips() {
  if (!teamPeriodChips) return;
  teamPeriodChips.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-period]');
    if (!btn) return;
    const p = btn.dataset.period;
    if (p === teamPeriod) return;
    teamPeriod = p;
    teamPeriodChips.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.dataset.period === p);
    });
    loadTeamOverview();
  });
}

(async () => {
  initDefaults();

  const meRes = await fetch('/api/me', { credentials: 'same-origin' });
  if (meRes.status === 401) { window.location.href = '/login'; return; }
  me = await meRes.json();
  targetId = me.id;
  targetUsername = me.username;

  if (me.role === 'employer') {
    // Populate picker.
    employeePickerWrap.hidden = false;
    const empRes = await fetch('/api/employees', { credentials: 'same-origin' });
    const empData = await empRes.json();
    for (const e of empData.employees) {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = e.fullName ? `${e.fullName} (${e.username})` : e.username;
      if (e.id === me.id) opt.selected = true;
      employeePicker.appendChild(opt);
    }
    // Show the team-overview section and wire its chips.
    teamSection.hidden = false;
    wireTeamPeriodChips();
    loadTeamOverview();
  }

  await refresh();
})();
