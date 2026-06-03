import { mountTopBar, mountFooter } from '/topbar.js';
import { applyTranslations, t, translateError, fmtHours } from '/i18n.js';
import { barChart, donutChart, miniBar } from '/charts.js';

mountTopBar(); mountFooter(); applyTranslations();
const $ = (id) => document.getElementById(id);

const state = { scope: 'all', periodType: 'week', anchor: null, targetId: '', isEmployer: false };

function qs() {
  const p = new URLSearchParams();
  p.set('scope', state.scope);
  if (state.scope === 'me' && state.targetId) p.set('id', state.targetId);
  p.set('type', state.periodType);
  if (state.anchor) p.set('anchor', state.anchor);
  return p;
}
const overviewUrl = () => `/api/reports/overview?${qs().toString()}`;
const csvUrl = () => {
  const p = qs(); p.set('format', 'csv');
  return `/api/reports/timesheets?${p.toString()}`;
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const setActive = (c, attr, val) => { for (const b of c.querySelectorAll('.chip')) b.classList.toggle('active', b.dataset[attr] === val); };

// Avatar — mirrors the team list: hue-tinted initials paint immediately, the
// uploaded picture (priority) loads after and replaces them on success, leaving
// initials in place on error. CSP forbids inline onerror, so we emit an initials
// placeholder and hydrate the <img> in JS once the markup is in the DOM.
const initials = (name) => (String(name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('')) || '?';
const hue = (s) => { let h = 0; for (const ch of String(s || '')) h = (h + ch.charCodeAt(0)) % 360; return h; };
const avatarSpan = (id, name) =>
  `<span class="rpt-av" data-id="${esc(id)}" style="--hue:${hue(name)}">${esc(initials(name))}</span>`;
function hydrateAvatars(root) {
  for (const el of root.querySelectorAll('.rpt-av[data-id]')) {
    const id = el.dataset.id; if (!id) continue;
    const img = new Image(); img.alt = '';
    img.addEventListener('load', () => { el.textContent = ''; el.appendChild(img); });
    img.src = `/api/employees/${encodeURIComponent(id)}/picture`;
  }
}

async function load() {
  $('result-error').hidden = true;
  let d;
  try {
    const r = await fetch(overviewUrl(), { credentials: 'same-origin' });
    if (r.status === 401) { location.href = '/login'; return; }
    d = await r.json();
    if (!r.ok) throw new Error(translateError(d.errorCode, d.error || 'Failed'));
  } catch (e) {
    $('result-error').hidden = false; $('result-error').textContent = e.message; return;
  }
  state.anchor = d.period.from;
  $('period-label').textContent = d.period.label;
  $('csv-link').href = csvUrl();
  render(d);
}

function render(d) {
  const empty = (d.people.length === 0);
  $('result-empty').hidden = !empty;
  renderKpis(d); renderHours(d); renderLeave(d); renderBreaks(d); renderPeople(d); renderWatchlist(d);
  $('watchlist-card').hidden = d.scope !== 'all';
}

function kpiCard(label, value, sub) {
  return `<div class="kpi-card"><div class="kpi-card__lbl">${esc(label)}</div>` +
    `<div class="kpi-card__val">${esc(value)}</div>` +
    (sub ? `<div class="kpi-card__sub">${esc(sub)}</div>` : '') + `</div>`;
}
function renderKpis(d) {
  const k = d.kpis;
  let html = kpiCard(t('reports.kpiTeamHours'), fmtHours(k.totalHours) + 'h',
    k.vsTargetPct != null ? `${k.vsTargetPct}% ${t('reports.kpiVsTarget')}` : '');
  if (d.scope === 'all') html += kpiCard(t('reports.kpiAvgPerson'), fmtHours(k.avgPerPerson) + 'h', '');
  html += kpiCard(t('reports.kpiLeaveDays'), k.leaveDays, '');
  html += kpiCard(t('reports.kpiOvertime'), fmtHours(k.overtimeHours) + 'h', '');
  $('kpi-grid').innerHTML = html;
}

function renderHours(d) {
  const labels = d.hoursSeries.map((s) => s.key.slice(5));
  $('chart-hours').innerHTML = barChart({ series: d.hoursSeries, labels, ariaLabel: t('reports.chartHoursTitle') });
  $('hours-legend').innerHTML =
    `<span class="legend__item"><i class="dot dot--worked"></i>${esc(t('reports.legendWorked'))}</span>` +
    `<span class="legend__item"><i class="dot dot--leave"></i>${esc(t('reports.legendOnLeave'))}</span>` +
    `<span class="legend__item"><i class="dash"></i>${esc(t('reports.legendTarget'))}</span>`;
}

function renderLeave(d) {
  const slices = d.leaveByType.map((x) => ({ label: t('leaves.type.' + x.type), value: x.days, cls: 'seg--' + x.type }));
  $('chart-leave').innerHTML = donutChart({ slices, centerValue: d.leaveTotalDays,
    centerLabel: t('reports.kpiLeaveDays'), ariaLabel: t('reports.chartLeaveTitle') });
  $('leave-legend').innerHTML = d.leaveByType.map((x) =>
    `<span class="legend__item"><i class="dot seg--${esc(x.type)}"></i>${esc(t('leaves.type.' + x.type))} <b>${x.days}</b></span>`).join('');
}

function renderBreaks(d) {
  const labels = d.breaksSeries.map((s) => s.key.slice(5));
  const series = d.breaksSeries.map((s) => ({ key: s.key, worked: s.avgBreakMin / 60, onLeave: 0, target: 0 }));
  $('chart-breaks').innerHTML = series.length
    ? barChart({ series, labels, ariaLabel: t('reports.chartBreaksTitle') })
    : `<p class="muted">${esc(t('reports.noData'))}</p>`;
}

function renderPeople(d) {
  if (!d.people.length) { $('people-table').innerHTML = ''; return; }
  const head = `<tr><th>${esc(t('reports.employee'))}</th><th>${esc(t('reports.colWorked'))}</th>` +
    `<th>${esc(t('reports.colVsTarget'))}</th><th>${esc(t('reports.colOnLeave'))}</th>` +
    `<th>${esc(t('reports.colOnTime'))}</th><th>${esc(t('reports.colAvgIn'))}</th>` +
    `<th>${esc(t('reports.colLate'))}</th><th>${esc(t('reports.colAvgBreak'))}</th></tr>`;
  const body = d.people.map((p) =>
    `<tr><td><span class="rpt-person">${avatarSpan(p.id, p.name)}<span>${esc(p.name)}</span></span></td><td>${fmtHours(p.worked)}h</td>` +
    `<td>${miniBar(p.vsTargetPct)}</td><td>${fmtHours(p.onLeave)}</td>` +
    `<td>${p.onTimePct == null ? '—' : p.onTimePct + '%'}</td><td>${esc(p.avgClockIn ?? '—')}</td>` +
    `<td>${p.lateDays}</td><td>${p.avgBreakMin}m</td></tr>`).join('');
  $('people-table').innerHTML = `<table class="data-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  hydrateAvatars($('people-table'));
}

function renderWatchlist(d) {
  $('watchlist').innerHTML = d.watchlist.map((w) =>
    `<div class="watch-row">${avatarSpan(w.id, w.name)}<span class="watch-name">${esc(w.name)}</span>` +
    `<span class="watch-meta">${esc(w.avgClockIn ?? '—')} · ${w.lateDays} ${esc(t('reports.colLate').toLowerCase())} · ${fmtHours(w.overtimeHours)}h</span>` +
    `<span class="watch-pct">${w.onTimePct == null ? '—' : w.onTimePct + '%'}</span></div>`).join('');
  hydrateAvatars($('watchlist'));
}

$('period-chips').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return;
  state.periodType = b.dataset.pt; state.anchor = null; setActive(e.currentTarget, 'pt', state.periodType); load(); });
// Scope: a single select — "All team" (value 'all') or one employee (value = id).
$('scope-select').addEventListener('change', (e) => {
  const v = e.target.value;
  if (v === 'all') { state.scope = 'all'; state.targetId = ''; }
  else { state.scope = 'me'; state.targetId = v; }
  load();
});
$('prev-period').addEventListener('click', () => step(-1));
$('next-period').addEventListener('click', () => step(+1));
function step(delta) {
  let a; if (state.anchor) { const [y, m, d] = state.anchor.split('-').map(Number); a = new Date(y, m - 1, d); } else a = new Date();
  if (state.periodType === 'day') a.setDate(a.getDate() + delta);
  else if (state.periodType === 'week') a.setDate(a.getDate() + delta * 7);
  else if (state.periodType === 'month') { a.setDate(1); a.setMonth(a.getMonth() + delta); }
  else a.setFullYear(a.getFullYear() + delta);
  state.anchor = `${a.getFullYear()}-${String(a.getMonth()+1).padStart(2,'0')}-${String(a.getDate()).padStart(2,'0')}`;
  load();
}
$('print-btn').addEventListener('click', () => window.print());

(async () => {
  const me = await fetch('/api/me', { credentials: 'same-origin' });
  if (me.status === 401) { location.href = '/login'; return; }
  const user = await me.json();
  state.isEmployer = user.role === 'employer';
  if (state.isEmployer) {
    $('scope-wrap').hidden = false;
    try {
      const ed = await (await fetch('/api/employees', { credentials: 'same-origin' })).json();
      const opts = `<option value="all">${esc(t('reports.scopeEveryone'))}</option>` +
        (ed.employees || []).map((e) =>
          `<option value="${esc(e.id)}">${esc(e.fullName || e.username)}</option>`).join('');
      $('scope-select').innerHTML = opts;
    } catch { /* select shows only "All team"; team view still works */ }
  } else { state.scope = 'me'; $('scope-wrap').hidden = true; }
  load();
})();
