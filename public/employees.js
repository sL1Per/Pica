/**
 * Team list (M15, Plan 6). A frontend fan-out over existing endpoints —
 * /api/employees + /api/punches/today + /api/reports/timesheets?scope=all +
 * pending leaves/corrections + approved leaves — joined per employee into a
 * status / week-hours / today / pending-count table with search + status
 * chips. No backend change. Status logic is the shared team-status module.
 */
import { mountTopBar, mountFooter } from '/topbar.js';
import { t, applyTranslations, fmtHours } from '/i18n.js';
import { showMessage } from '/app.js';
import { pairSessions, workedMs, classify, groupByEmployee, STATUS_SORT } from '/team-status.js';

mountTopBar();
mountFooter();
applyTranslations();

// Flat weekly reference for the progress bar. The reports endpoint does not
// return per-employee targets; at ≤50 employees a 40h reference is a fine
// health indicator (documented as an Honest Disclosure).
const TEAM_WEEK_TARGET = 40;

const subEl = document.getElementById('tm-sub');
const chipsEl = document.getElementById('tm-chips');
const tbodyEl = document.getElementById('tm-tbody');
const emptyEl = document.getElementById('tm-empty');
const messageEl = document.getElementById('message');
const searchEl = document.getElementById('tm-search');

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const pad2 = (n) => String(n).padStart(2, '0');
const todayYmd = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
function initials(name) { return (String(name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('')) || '?'; }
function hue(s) { let h = 0; for (const ch of String(s || '')) h = (h + ch.charCodeAt(0)) % 360; return h; }
function avatar(emp, name) {
  const a = el('div', 'tm-avatar');
  if (emp.hasPicture) { const img = el('img'); img.src = `/api/employees/${emp.id}/picture`; img.alt = ''; a.appendChild(img); }
  else { a.textContent = initials(name); a.style.setProperty('--hue', hue(name)); }
  return a;
}
function statusDot(key) { const d = el('span', `st-dot st-dot--${key}`); d.setAttribute('aria-hidden', 'true'); return d; }
function hhmm(ms) { const tot = Math.max(0, Math.round(ms / 60000)); return `${Math.floor(tot / 60)}h${pad2(tot % 60)}`; }

const STATUS_LABEL = { working: 'team.status.working', break: 'team.status.break', done: 'team.status.done', leave: 'team.status.leave', off: 'team.status.off', deactivated: 'team.status.deactivated' };
const FILTERS = [
  { key: 'all', labelKey: 'team.filterAll' },
  { key: 'working', labelKey: 'team.filterWorking' },
  { key: 'break', labelKey: 'team.filterBreak' },
  { key: 'leave', labelKey: 'team.filterLeave' },
  { key: 'off', labelKey: 'team.filterOff' },
];

let model = [];          // [{ emp, status, weekHours, todayMs, pending }]
let activeFilter = 'all';
let query = '';

const nameOf = (r) => r.emp.fullName || r.emp.username || '';

function visible() {
  const q = query.trim().toLowerCase();
  return model.filter((r) => {
    if (activeFilter !== 'all' && r.status !== activeFilter) return false;
    if (!q) return true;
    return `${r.emp.fullName || ''} ${r.emp.username || ''} ${r.emp.position || ''}`.toLowerCase().includes(q);
  });
}

function counts() {
  const c = { all: model.length, working: 0, break: 0, done: 0, leave: 0, off: 0, deactivated: 0 };
  for (const r of model) c[r.status]++;
  return c;
}

function renderChips() {
  const c = counts();
  chipsEl.replaceChildren();
  for (const f of FILTERS) {
    const chip = el('button', 'tm-chip' + (activeFilter === f.key ? ' tm-chip--active' : ''));
    chip.type = 'button';
    chip.append(document.createTextNode(t(f.labelKey)));
    chip.append(el('span', 'tm-chip__count', `· ${c[f.key]}`));
    chip.addEventListener('click', () => { activeFilter = f.key; renderChips(); renderRows(); });
    chipsEl.append(chip);
  }
}

function rowEl(r) {
  const name = nameOf(r) || '—';
  const isDeactivated = r.emp.active === false;
  const a = el('a', 'tm-row' + (isDeactivated ? ' tm-row--deactivated' : '')); a.href = `/employees/${r.emp.id}`;

  const person = el('div', 'tm-person');
  person.append(avatar(r.emp, name));
  const ptext = el('div', 'tm-person__text');
  const pname = el('div', 'tm-person__name', name);
  pname.append(el('span', 'tm-badge' + (r.emp.role === 'employer' ? ' tm-badge--employer' : ''), t('employee.role.' + r.emp.role)));
  ptext.append(pname, el('div', 'tm-person__role', r.emp.position || ''));
  person.append(ptext);

  const status = el('div', 'tm-status');
  if (isDeactivated) {
    status.append(el('span', 'tm-deact-pill', t('team.deactivatedPill')));
  } else {
    status.append(statusDot(r.status), document.createTextNode(t(STATUS_LABEL[r.status])));
  }

  const week = el('div', 'tm-week');
  const nums = el('div', 'tm-week__nums');
  nums.append(document.createTextNode(`${fmtHours(r.weekHours)}h `), el('small', null, `/ ${TEAM_WEEK_TARGET}h`));
  const track = el('div', 'tm-week__track');
  const pct = Math.min(100, Math.round((r.weekHours / TEAM_WEEK_TARGET) * 100));
  const fill = el('div', 'tm-week__fill' + (pct >= 90 ? '' : pct >= 50 ? ' tm-week__fill--mid' : ' tm-week__fill--low'));
  fill.style.setProperty('--pct', pct);
  track.append(fill);
  week.append(nums, track);

  const today = r.todayMs > 0
    ? el('div', 'tm-today', hhmm(r.todayMs))
    : el('div', 'tm-today tm-today--none', '—');

  const end = el('div', 'tm-end');
  if (isDeactivated) {
    const re = el('button', 'tm-reactivate', t('team.reactivate'));
    re.type = 'button';
    re.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (re.disabled) return;
      re.disabled = true;
      const res = await fetch(`/api/employees/${r.emp.id}/reactivate`, { method: 'POST', credentials: 'same-origin' });
      if (res.ok) load(); else re.disabled = false;
    });
    end.append(re);
  } else {
    if (r.pending > 0) {
      const dot = el('span', 'tm-pending', String(r.pending));
      dot.title = t('team.pendingTitle', { n: r.pending });
      end.append(dot);
    }
    end.append(el('span', 'tm-chev', '›'));
  }

  a.append(person, status, week, today, end);
  return a;
}

function renderRows() {
  const rows = visible().sort((a, b) =>
    (STATUS_SORT[a.status] - STATUS_SORT[b.status]) || nameOf(a).localeCompare(nameOf(b)));
  emptyEl.hidden = rows.length > 0;
  const frag = document.createDocumentFragment();
  for (const r of rows) frag.append(rowEl(r));
  tbodyEl.replaceChildren(frag);
}

async function getJson(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}

async function load() {
  let employees;
  try {
    employees = (await getJson('/api/employees')).employees ?? [];
  } catch (e) {
    if (e.status === 401) { window.location.href = '/login'; return; }
    if (e.status === 403) { showMessage(messageEl, t('employees.employerOnly'), 'error'); return; }
    showMessage(messageEl, t('employees.couldNotLoad'), 'error'); return;
  }

  const anchor = todayYmd();
  const [today, week, leaves, corrs, approved] = await Promise.allSettled([
    getJson('/api/punches/today'),
    getJson(`/api/reports/timesheets?scope=all&type=week&anchor=${anchor}`),
    getJson('/api/leaves'),
    getJson('/api/corrections?status=pending'),
    getJson('/api/leaves/approved'),
  ]);

  const byEmp = groupByEmployee(today.status === 'fulfilled' ? (today.value.punches ?? []) : []);
  const weekById = new Map((week.status === 'fulfilled' ? (week.value.rows ?? []) : []).map((r) => [r.id, r.total || 0]));

  const onLeaveIds = new Set();
  if (approved.status === 'fulfilled') {
    for (const l of (approved.value.leaves ?? [])) {
      const s = String(l.start).slice(0, 10), e = String(l.end).slice(0, 10);
      if (s <= anchor && anchor <= e) onLeaveIds.add(l.employeeId);
    }
  }

  const pending = new Map();
  const bump = (id) => pending.set(id, (pending.get(id) || 0) + 1);
  if (leaves.status === 'fulfilled') for (const l of (leaves.value.leaves ?? [])) if (l.status === 'pending') bump(l.employeeId);
  if (corrs.status === 'fulfilled') for (const c of (corrs.value.corrections ?? [])) bump(c.employeeId);

  const nowHour = new Date().getHours();
  model = employees.map((emp) => {
    const pairs = pairSessions(byEmp.get(emp.id) ?? []);
    const status = emp.active === false
      ? 'deactivated'
      : classify({ pairs, onLeave: onLeaveIds.has(emp.id), nowHour });
    return {
      emp,
      status,
      weekHours: weekById.get(emp.id) || 0,
      todayMs: workedMs(pairs),
      pending: pending.get(emp.id) || 0,
    };
  });

  if (subEl) subEl.textContent = t('team.countSub', { n: model.length });
  renderChips();
  renderRows();
}

searchEl?.addEventListener('input', (e) => { query = e.target.value; renderRows(); });

load();
