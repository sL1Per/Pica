import { showMessage } from '/app.js';
import { mountTopBar, mountFooter } from '/topbar.js';

mountTopBar();
mountFooter();

// -- DOM refs ---------------------------------------------------------------

const listEl = document.getElementById('leave-list');
const messageEl = document.getElementById('message');
const filterBar = document.querySelector('.filter-bar');
const yearSelect = document.getElementById('year-select');
const tblEmployee = document.getElementById('balance-table-employee');
const tblEmployer = document.getElementById('balance-table-employer');
const tblEmployerWrap = document.getElementById('balance-table-employer-wrap');

// -- State ------------------------------------------------------------------

let allLeaves = [];
let me = null;
let activeFilter = 'all';
let currentYear = new Date().getFullYear();

// -- Helpers ----------------------------------------------------------------

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatRange(leave) {
  if (leave.unit === 'days') {
    if (leave.start === leave.end) return leave.start;
    return `${leave.start} → ${leave.end}`;
  }
  const s = new Date(leave.start);
  const e = new Date(leave.end);
  const sameDay = s.toDateString() === e.toDateString();
  const ds = s.toISOString().slice(0, 10);
  const hs = `${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}`;
  const he = `${String(e.getHours()).padStart(2, '0')}:${String(e.getMinutes()).padStart(2, '0')}`;
  return sameDay ? `${ds}, ${hs}–${he}` : `${leave.start} → ${leave.end}`;
}

function fmt(n) {
  // Keep whole numbers clean, half-days visible.
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// -- List rendering (unchanged from before) ---------------------------------

function renderList() {
  const filtered = activeFilter === 'all'
    ? allLeaves
    : allLeaves.filter((l) => l.status === activeFilter);

  listEl.innerHTML = '';
  if (filtered.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = activeFilter === 'all'
      ? 'No leaves yet. Click "+ Request leave" to add one.'
      : `No ${activeFilter} leaves.`;
    listEl.appendChild(li);
    return;
  }
  for (const l of filtered) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = `leave-list__item leave-list__item--${l.status}`;
    a.href = `/leaves/${l.id}`;

    const who = (me.role === 'employer') ? (l.fullName || l.username) : null;

    a.innerHTML = `
      <div class="leave-list__row">
        <div class="leave-list__title">
          <span class="type-tag">${l.type}</span>${who ? escapeHtml(who) : escapeHtml(formatRange(l))}
        </div>
        <span class="status-badge status-badge--${l.status}">${l.status}</span>
      </div>
      <div class="leave-list__meta">${who ? escapeHtml(formatRange(l)) : ''}${l.reason ? (who ? ' · ' : '') + escapeHtml(l.reason) : ''}</div>
    `;
    li.appendChild(a);
    listEl.appendChild(li);
  }
}

// -- Balance rendering ------------------------------------------------------

function renderEmployeeBalance(balances) {
  const tbody = tblEmployee.querySelector('tbody');
  tbody.innerHTML = '';
  for (const b of balances) {
    const tr = document.createElement('tr');
    const overLimit = b.remaining < 0 ? ' balance-row--over' : '';
    tr.className = `balance-row${overLimit}`;
    // allowance===0 means "no cap" — display "—" instead of zeros that would
    // misread as "you have nothing".
    const unlimited = b.allowance === 0;
    tr.innerHTML = `
      <td><span class="type-tag">${escapeHtml(b.type)}</span></td>
      <td class="right">${unlimited ? '—' : fmt(b.allowance)}</td>
      <td class="right balance-cell--pending">${b.pending > 0 ? fmt(b.pending) : '—'}</td>
      <td class="right">${fmt(b.booked)}</td>
      <td class="right balance-cell--remaining">${unlimited ? '—' : fmt(b.remaining)}</td>
    `;
    tbody.appendChild(tr);
  }
  tblEmployee.hidden = false;
  tblEmployerWrap.hidden = true;
}

function renderEmployerMatrix({ rows }) {
  // Build the header from the types on the first row. All rows share types in
  // the same order since they come from the same org-settings list.
  const types = (rows[0]?.balances ?? []).map((b) => b.type);
  const thead = tblEmployer.querySelector('thead');
  const tbody = tblEmployer.querySelector('tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  // Header row — Employee column then one per type with colspan for
  // remaining / allowance presentation.
  const trh = document.createElement('tr');
  trh.innerHTML = `<th>Employee</th>` + types
    .map((t) => `<th class="right">${escapeHtml(t)}</th>`)
    .join('');
  thead.appendChild(trh);

  for (const row of rows) {
    const tr = document.createElement('tr');
    const displayName = row.fullName ? `${row.fullName}` : row.username;
    const subtle = row.fullName ? `<span class="muted"> · ${escapeHtml(row.username)}</span>` : '';
    const roleTag = row.role === 'employer' ? ` <span class="type-tag type-tag--role">boss</span>` : '';
    let html = `<td>${escapeHtml(displayName)}${subtle}${roleTag}</td>`;
    for (const b of row.balances) {
      const unlimited = b.allowance === 0;
      const over = !unlimited && b.remaining < 0;
      const cls = over ? ' balance-matrix__cell--over' : '';
      const pending = b.pending > 0 ? `<span class="balance-matrix__pending">+${fmt(b.pending)}</span>` : '';
      const main = unlimited
        ? `<strong>${fmt(b.booked)}</strong> <span class="muted">/ —</span>`
        : `<strong>${fmt(b.remaining)}</strong> <span class="muted">/ ${fmt(b.allowance)}</span>`;
      html += `
        <td class="right balance-matrix__cell${cls}">
          <span class="balance-matrix__main">${main}</span>
          ${pending}
        </td>
      `;
    }
    tr.innerHTML = html;
    tbody.appendChild(tr);
  }

  tblEmployee.hidden = true;
  tblEmployerWrap.hidden = false;
}

// -- Data fetches -----------------------------------------------------------

async function refreshBalances() {
  if (me.role === 'employer') {
    const res = await fetch(`/api/leaves/balances?year=${currentYear}`, { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    renderEmployerMatrix(data);
  } else {
    const res = await fetch(`/api/leaves/balances/${me.id}?year=${currentYear}`, { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    renderEmployeeBalance(data.balances);
  }
}

// -- Year selector ----------------------------------------------------------

function populateYears() {
  const now = new Date().getFullYear();
  const years = [now - 1, now, now + 1];
  yearSelect.innerHTML = years
    .map((y) => `<option value="${y}"${y === currentYear ? ' selected' : ''}>${y}</option>`)
    .join('');
}

yearSelect.addEventListener('change', async () => {
  currentYear = Number(yearSelect.value);
  await refreshBalances();
});

// -- Filter bar -------------------------------------------------------------

filterBar.addEventListener('click', (e) => {
  if (!e.target.matches('button.filter')) return;
  activeFilter = e.target.dataset.filter;
  filterBar.querySelectorAll('.filter').forEach((b) =>
    b.classList.toggle('active', b === e.target));
  renderList();
});

// -- Bootstrap --------------------------------------------------------------

(async () => {
  const [meRes, leavesRes] = await Promise.all([
    fetch('/api/me',     { credentials: 'same-origin' }),
    fetch('/api/leaves', { credentials: 'same-origin' }),
  ]);
  if (meRes.status === 401) { window.location.href = '/login'; return; }
  me = await meRes.json();

  populateYears();

  if (!leavesRes.ok) {
    showMessage(messageEl, 'Failed to load leaves.', 'error');
    return;
  }
  allLeaves = (await leavesRes.json()).leaves;
  renderList();

  await refreshBalances();
})();
