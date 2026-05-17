import { mountTopBar, mountFooter } from '/topbar.js';
import { applyTranslations, t, translateError, fmtHours } from '/i18n.js';
import { showMessage } from '/app.js';

mountTopBar(); mountFooter(); applyTranslations();

const $ = (id) => document.getElementById(id);
const msg = $('message');

const state = {
  reportType: 'timesheets',
  scope: 'all',          // employer default; pinned to 'me' for employees
  periodType: 'month',
  anchor: null,          // server fills via defaultAnchor when omitted
  targetId: '',          // employee id when scope=me & employer picks
  isEmployer: false,
};

function qs() {
  const p = new URLSearchParams();
  p.set('scope', state.scope);
  if (state.scope === 'me' && state.targetId) p.set('id', state.targetId);
  p.set('type', state.periodType);
  if (state.anchor) p.set('anchor', state.anchor);
  return p;
}
const apiUrl = (fmt) => `/api/reports/${state.reportType}?${(() => {
  const p = qs(); if (fmt) p.set('format', fmt); return p.toString();
})()}`;

function setActive(container, attr, val) {
  for (const b of container.querySelectorAll('.chip'))
    b.classList.toggle('active', b.dataset[attr] === val);
}

async function load() {
  showMessage(msg, '');
  $('result-error').hidden = true;
  let data;
  try {
    const r = await fetch(apiUrl(), { credentials: 'same-origin' });
    if (r.status === 401) { location.href = '/login'; return; }
    data = await r.json();
    if (!r.ok) throw new Error(translateError(data.errorCode, data.error || 'Failed'));
  } catch (e) {
    $('result-error').hidden = false;
    $('result-error').textContent = e.message;
    $('result-table-wrap').innerHTML = '';
    return;
  }
  state.anchor = data.period.from;          // lock anchor for nav
  $('period-label').textContent = data.period.label;
  $('csv-link').href = apiUrl('csv');
  $('print-meta').textContent =
    `${t('reports.type' + (state.reportType === 'leaves' ? 'Leaves' : 'Timesheets'))} · ` +
    `${state.scope === 'all' ? t('reports.scopeEveryone') : (data.name || '')} · ${data.period.label}`;
  render(data);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render(d) {
  const wrap = $('result-table-wrap');
  const empty = $('result-empty');
  wrap.innerHTML = '';
  if (d.scope === 'all') return renderMatrix(d, wrap, empty);
  if (state.reportType === 'timesheets') return renderHoursSingle(d, wrap, empty);
  return renderLeavesSingle(d, wrap, empty);
}

function renderMatrix(d, wrap, empty) {
  empty.hidden = d.rows.length > 0;
  const num = (v) => state.reportType === 'timesheets' ? fmtHours(v ?? 0) : (v ?? 0);
  const head = `<tr><th>${esc(t('reports.colBucket'))}</th>` +
    d.rows.map((r) => `<th>${esc(r.name)}</th>`).join('') +
    `<th>${esc(t('reports.total'))}</th></tr>`;
  const body = d.buckets.map((k) =>
    `<tr><td>${esc(k)}</td>` +
    d.rows.map((r) => `<td>${num(r.cells[k])}</td>`).join('') +
    `<td class="grand">${num(d.bucketTotals[k])}</td></tr>`).join('');
  const foot = `<tr><th>${esc(t('reports.total'))}</th>` +
    d.rows.map((r) => `<th>${num(r.total)}</th>`).join('') +
    `<th class="grand">${num(d.grandTotal)}</th></tr>`;
  wrap.innerHTML = `<table class="report-table"><thead>${head}</thead>` +
    `<tbody>${body}</tbody><tfoot>${foot}</tfoot></table>`;
}

function renderHoursSingle(d, wrap, empty) {
  empty.hidden = d.buckets.length > 0;
  const body = d.buckets.map((b) =>
    `<tr><td>${esc(b.key)}</td><td>${fmtHours(b.hours)}</td></tr>`).join('');
  wrap.innerHTML =
    `<table class="report-table"><thead><tr>` +
    `<th>${esc(t('reports.colBucket'))}</th><th>${esc(t('reports.colHours'))}</th>` +
    `</tr></thead><tbody>${body}</tbody><tfoot><tr>` +
    `<th>${esc(t('reports.total'))}</th><th>${fmtHours(d.totalHours)}</th>` +
    `</tr></tfoot></table>`;
}

function renderLeavesSingle(d, wrap, empty) {
  empty.hidden = d.leaves.length > 0;
  const stat = (n, k) => `<div class="stat"><div class="stat__num">${n}</div>` +
    `<div class="stat__lbl">${esc(t(k))}</div></div>`;
  const grid = `<div class="stat-grid">` +
    stat(d.byStatus.approved, 'reports.statApproved') +
    stat(d.byStatus.pending, 'reports.statPending') +
    stat(d.byStatus.rejected, 'reports.statRejected') +
    stat(d.byStatus.cancelled, 'reports.statCancelled') +
    stat(d.approvedDaysOff, 'reports.statDays') + `</div>`;
  const rows = d.leaves.map((l) =>
    `<tr><td>${esc(t('leaves.type.' + l.type))}</td>` +
    `<td>${esc(l.start)}${l.end && l.end !== l.start ? ' → ' + esc(l.end) : ''}</td>` +
    `<td>${l.unit === 'hours' ? esc((l.hours ?? 0) + 'h') : ''}</td>` +
    `<td>${esc(t('status.' + l.status))}</td></tr>`).join('');
  wrap.innerHTML = grid +
    `<table class="report-table"><thead><tr>` +
    `<th>${esc(t('reports.headerLeaves'))}</th><th>${esc(t('reports.colWhen'))}</th>` +
    `<th>${esc(t('reports.colDuration'))}</th><th>${esc(t('reports.colStatus'))}</th>` +
    `</tr></thead><tbody>${rows}</tbody></table>`;
}

// ---- Controls -------------------------------------------------------------
$('controls').querySelector('.rpt-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  state.reportType = b.dataset.rt;
  setActive(e.currentTarget, 'rt', state.reportType);
  load();
});
$('scope-wrap').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  state.scope = b.dataset.scope;
  setActive(e.currentTarget.querySelector('.chips'), 'scope', state.scope);
  const pick = $('employee-picker');
  pick.hidden = state.scope !== 'me';
  if (state.scope === 'me' && !state.targetId && pick.options.length)
    state.targetId = pick.value;
  load();
});
$('employee-picker').addEventListener('change', (e) => {
  state.targetId = e.target.value; load();
});
$('period-chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  state.periodType = b.dataset.pt; state.anchor = null;   // reset to current
  setActive(e.currentTarget, 'pt', state.periodType);
  load();
});
$('prev-period').addEventListener('click', () => step(-1));
$('next-period').addEventListener('click', () => step(+1));
function step(delta) {
  // Mirror of server shiftPeriod: nudge the anchor by one unit; the
  // server's resolvePeriod re-normalizes (e.g. week snaps to Monday).
  const a = state.anchor ? new Date(state.anchor) : new Date();
  if (state.periodType === 'day') a.setDate(a.getDate() + delta);
  else if (state.periodType === 'week') a.setDate(a.getDate() + delta * 7);
  else if (state.periodType === 'month') { a.setDate(1); a.setMonth(a.getMonth() + delta); }
  else a.setFullYear(a.getFullYear() + delta);
  state.anchor = `${a.getFullYear()}-${String(a.getMonth()+1).padStart(2,'0')}-${String(a.getDate()).padStart(2,'0')}`;
  load();
}
$('print-btn').addEventListener('click', () => window.print());

// ---- Bootstrap ------------------------------------------------------------
(async () => {
  const me = await fetch('/api/me', { credentials: 'same-origin' });
  if (me.status === 401) { location.href = '/login'; return; }
  const user = await me.json();
  state.isEmployer = user.role === 'employer';
  if (state.isEmployer) {
    $('scope-wrap').hidden = false;
    try {
      const er = await fetch('/api/employees', { credentials: 'same-origin' });
      const ed = await er.json();
      const pick = $('employee-picker');
      pick.innerHTML = (ed.employees || [])
        .map((e) => `<option value="${esc(e.id)}">${esc(e.fullName || e.username)}</option>`)
        .join('');
    } catch { /* picker stays empty; Everyone still works */ }
  } else {
    state.scope = 'me';                       // employees: always self
    $('scope-wrap').hidden = true;
  }
  load();
})();
