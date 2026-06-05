import { showMessage } from '/app.js';
import { t, applyTranslations, fmtHours } from '/i18n.js';
import { mountTopBar, mountFooter } from '/topbar.js';
import { openRequestLeaveModal } from '/request-leave-modal.js';
import { openLeaveModal } from '/leave-detail-modal.js';
import { approveLeaveWithCheck, rejectLeave } from '/leave-actions.js';
import { capView, appendShowAll, LIST_CAP } from '/list-cap.js';

mountTopBar();
mountFooter();
applyTranslations();

// -- DOM refs ---------------------------------------------------------------

const messageEl     = document.getElementById('message');
const requestBtn    = document.getElementById('request-btn');
const empRegion     = document.getElementById('emp-region');
const emprRegion    = document.getElementById('empr-region');
// Employee
const balanceBlocks = document.getElementById('balance-blocks');
const filterBar     = document.getElementById('filter-bar');
const listEl        = document.getElementById('leave-list');
// Employer
const balanceBlocksEmpr = document.getElementById('balance-blocks-empr');
const pendingList   = document.getElementById('pending-list');
const pendingTag    = document.getElementById('pending-tag');
const yearSelect    = document.getElementById('year-select');
const matrix        = document.getElementById('balance-matrix');
const filterBarEmpr = document.getElementById('filter-bar-empr');
const listEmpr      = document.getElementById('leave-list-empr');

// -- State ------------------------------------------------------------------

const FILTERS = ['all', 'pending', 'approved', 'rejected', 'cancelled'];
let allLeaves = [];
let me = null;
let activeFilter = 'all';        // employee history
let activeFilterEmpr = 'all';    // employer all-requests
let listExpanded = false;        // employee history "Show all"
let listEmprExpanded = false;    // employer all-requests "Show all"
let currentYear = new Date().getFullYear();

// -- Helpers ----------------------------------------------------------------

function fmt(n) { return fmtHours(n); }

function initials(name) {
  return (String(name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('')) || '?';
}
function hue(s) { let h = 0; for (const ch of String(s || '')) h = (h + ch.charCodeAt(0)) % 360; return h; }
// Round, hue-tinted avatar (uploaded picture when present, else initials) —
// matches the team list / dashboard avatars.
//
// The picture ALWAYS takes priority when one exists: we render hue-tinted
// initials immediately (no broken-image flash, instant paint) and attempt the
// picture in the background — on a successful load it replaces the initials, on
// error (no picture on disk) the initials simply stay. This is more robust than
// gating on a `hasPicture` flag, which isn't always present in every endpoint's
// rows (e.g. the balances matrix) and would otherwise need a server restart to
// surface.
function avatar(l, name, cls = 'lv-row__av') {
  const a = document.createElement('div');
  a.className = cls;
  a.style.setProperty('--hue', hue(name));
  a.textContent = initials(name);
  const id = l.employeeId;
  if (id) {
    const img = new Image();
    img.alt = '';
    img.addEventListener('load', () => { a.textContent = ''; a.appendChild(img); });
    img.src = `/api/employees/${encodeURIComponent(id)}/picture`;
  }
  return a;
}

function formatRange(leave) {
  if (leave.unit === 'days') {
    return leave.start === leave.end ? leave.start : `${leave.start} → ${leave.end}`;
  }
  const s = new Date(leave.start);
  const e = new Date(leave.end);
  const sameDay = s.toDateString() === e.toDateString();
  const ds = s.toISOString().slice(0, 10);
  const hs = `${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}`;
  const he = `${String(e.getHours()).padStart(2, '0')}:${String(e.getMinutes()).padStart(2, '0')}`;
  return sameDay ? `${ds}, ${hs}–${he}` : `${leave.start} → ${leave.end}`;
}

// Compact count badge for the row aside (e.g. "3d" / "4h").
function dayCount(leave) {
  if (leave.unit === 'hours') {
    return typeof leave.hours === 'number' ? `${fmt(leave.hours)}h` : '';
  }
  const s = new Date(leave.start);
  const e = new Date(leave.end);
  const days = Math.round((e - s) / 86_400_000) + 1;
  return `${days}d`;
}

function countsByStatus(leaves) {
  const c = { all: leaves.length, pending: 0, approved: 0, rejected: 0, cancelled: 0 };
  for (const l of leaves) if (c[l.status] !== undefined) c[l.status] += 1;
  return c;
}

// -- Row rendering ----------------------------------------------------------

function renderRow(l, { showName, withActions }) {
  const li = document.createElement('li');

  const row = document.createElement('div');
  row.className = `lv-row lv-row--${l.status}`;

  const accent = document.createElement('span');
  accent.className = 'lv-row__accent';
  row.appendChild(accent);

  const a = document.createElement('a');
  a.className = 'lv-row__link';
  // Open in an in-page modal; keep the href so ⌘/middle-click + SRs still
  // reach the /leaves/:id page (the deep-link fallback).
  a.href = `/leaves/${l.id}`;
  a.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openLeaveModal({ id: l.id, me, onDone: loadAll });
  });

  const main = document.createElement('div');
  main.className = 'lv-row__main';

  const who = document.createElement('div');
  who.className = 'lv-row__who';
  who.textContent = showName ? (l.fullName || l.username || l.employeeId) : t('leaves.type.' + l.type);
  main.appendChild(who);

  const when = document.createElement('div');
  when.className = 'lv-row__when';
  when.textContent = formatRange(l);
  main.appendChild(when);

  if (showName) {
    const chips = document.createElement('div');
    chips.className = 'lv-row__chips';
    const typeChip = document.createElement('span');
    typeChip.className = 'lv-type';
    typeChip.textContent = t('leaves.type.' + l.type);
    chips.appendChild(typeChip);
    main.appendChild(chips);
  }

  if (l.reason) {
    const note = document.createElement('div');
    note.className = 'subtle';
    note.textContent = l.reason;
    main.appendChild(note);
  }

  const aside = document.createElement('div');
  aside.className = 'lv-row__chips';
  const days = document.createElement('span');
  days.className = 'lv-row__days';
  days.textContent = dayCount(l);
  const status = document.createElement('span');
  status.className = `lv-status lv-status--${l.status}`;
  status.textContent = t('status.' + l.status);
  aside.append(days, status);

  if (showName) a.append(avatar(l, l.fullName || l.username || l.employeeId), main, aside);
  else a.append(main, aside);
  row.appendChild(a);

  if (withActions) row.appendChild(buildInlineActions(l, li));

  li.appendChild(row);
  return li;
}

// -- Employer inline approve / reject --------------------------------------

function buildInlineActions(l, li) {
  const wrap = document.createElement('div');
  wrap.className = 'lv-rowact';

  const approve = document.createElement('button');
  approve.type = 'button';
  approve.className = 'lv-act lv-act--approve';
  approve.textContent = '✓';
  approve.title = t('leave.actionApprove');
  approve.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    inlineApprove(l, approve);
  });

  const reject = document.createElement('button');
  reject.type = 'button';
  reject.className = 'lv-act lv-act--reject';
  reject.textContent = '✗';
  reject.title = t('leave.actionReject');
  reject.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleRejectNote(l, li);
  });

  wrap.append(approve, reject);
  return wrap;
}

async function inlineApprove(l, btn) {
  showMessage(messageEl, '');
  btn.disabled = true;
  const res = await approveLeaveWithCheck(l);   // shared concurrency check + confirm
  if (res.cancelled) { btn.disabled = false; return; }
  if (res.ok) {
    await loadAll();
  } else {
    btn.disabled = false;
    showMessage(messageEl, res.data?.error || t('leaves.actionFailed'), 'error');
  }
}

function toggleRejectNote(l, li) {
  const existing = li.querySelector('.lv-reject');
  if (existing) { existing.remove(); return; }

  const box = document.createElement('div');
  box.className = 'lv-reject';

  const ta = document.createElement('textarea');
  ta.className = 'lv-reject__input';
  ta.rows = 2;
  ta.maxLength = 500;
  ta.placeholder = t('leave.rejectNotesEmployee');

  const actions = document.createElement('div');
  actions.className = 'lv-reject__actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn-ghost';
  cancel.textContent = t('leave.cancelButton');
  cancel.addEventListener('click', () => box.remove());
  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'btn-reject';
  confirmBtn.textContent = t('leave.actionReject');
  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    showMessage(messageEl, '');
    const res = await rejectLeave(l.id, ta.value.trim());
    if (res.ok) { await loadAll(); }
    else { confirmBtn.disabled = false; showMessage(messageEl, res.data?.error || t('leaves.actionFailed'), 'error'); }
  });
  actions.append(cancel, confirmBtn);

  box.append(ta, actions);
  li.appendChild(box);
  ta.focus();
}

// -- Filter tabs ------------------------------------------------------------

function renderFilterBar(barEl, active, counts, onPick) {
  barEl.replaceChildren();
  for (const f of FILTERS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lv-filter__btn' + (f === active ? ' lv-filter__btn--active' : '');
    const label = document.createElement('span');
    label.textContent = t('leaves.filter' + f.charAt(0).toUpperCase() + f.slice(1));
    btn.appendChild(label);
    const cnt = document.createElement('span');
    cnt.className = 'lv-filter__count';
    cnt.textContent = String(counts[f] ?? 0);
    btn.appendChild(cnt);
    btn.addEventListener('click', () => onPick(f));
    barEl.appendChild(btn);
  }
}

function filtered(leaves, f) {
  return f === 'all' ? leaves : leaves.filter((l) => l.status === f);
}

function renderListInto(ulEl, leaves, f, opts) {
  ulEl.replaceChildren();
  const rows = filtered(leaves, f);
  if (rows.length === 0) {
    const li = document.createElement('li');
    li.className = 'lv-empty';
    li.textContent = f === 'all'
      ? t('leaves.noEntriesAll')
      : t('leaves.noEntriesFiltered', { filter: t('leaves.filter' + f.charAt(0).toUpperCase() + f.slice(1)).toLowerCase() });
    ulEl.appendChild(li);
    return;
  }
  const { visible, showToggle, expanded } = capView(rows.length, LIST_CAP, opts.expanded);
  for (const l of rows.slice(0, visible)) ulEl.appendChild(renderRow(l, opts));
  if (showToggle) {
    appendShowAll(ulEl, { total: rows.length, expanded, t, onToggle: opts.onToggle });
  }
}

// -- Employee balance blocks ------------------------------------------------

function renderBalanceBlocks(balances, container = balanceBlocks) {
  container.replaceChildren();
  for (const b of balances) {
    const unlimited = b.allowance === 0;
    const cap = b.effectiveAllowance ?? b.allowance;

    const block = document.createElement('div');
    block.className = 'lv-bal__block';

    const type = document.createElement('span');
    type.className = 'lv-bal__type';
    type.textContent = t('leaves.type.' + b.type);
    block.appendChild(type);

    const nums = document.createElement('div');
    nums.className = 'lv-bal__nums';
    const num = document.createElement('span');
    num.className = 'lv-bal__num';
    num.textContent = unlimited ? fmt(b.booked) : fmt(b.remaining);
    nums.appendChild(num);
    if (!unlimited) {
      const total = document.createElement('span');
      total.className = 'lv-bal__total';
      total.textContent = `/ ${fmt(cap)}`;
      nums.appendChild(total);
    }
    block.appendChild(nums);

    const bar = document.createElement('div');
    bar.className = 'lv-bal__bar';
    const fill = document.createElement('div');
    fill.className = 'lv-bal__fill' + (!unlimited && b.remaining < 0 ? ' lv-bal__fill--over' : '');
    const pct = unlimited || cap <= 0 ? 0 : Math.min(100, Math.max(0, (b.booked / cap) * 100));
    fill.style.setProperty('--pct', String(pct));   // CSSOM, not inline attr (CSP-safe)
    bar.appendChild(fill);
    block.appendChild(bar);

    const meta = document.createElement('div');
    meta.className = 'lv-bal__meta';
    meta.textContent = t('leaves.balUsed', { n: fmt(b.booked) });
    if (b.pending > 0) {
      meta.appendChild(document.createTextNode(' · '));
      const pend = document.createElement('span');
      pend.className = 'lv-bal__pending';
      pend.textContent = t('leaves.balPending', { n: fmt(b.pending) });
      meta.appendChild(pend);
    }
    block.appendChild(meta);

    container.appendChild(block);
  }
}

// -- Employer matrix --------------------------------------------------------

function renderEmployerMatrix({ rows }) {
  const types = (rows[0]?.balances ?? []).map((b) => b.type);
  const thead = matrix.querySelector('thead');
  const tbody = matrix.querySelector('tbody');
  thead.replaceChildren();
  tbody.replaceChildren();

  const trh = document.createElement('tr');
  const thName = document.createElement('th');
  thName.textContent = t('reports.employee');
  trh.appendChild(thName);
  for (const typ of types) {
    const th = document.createElement('th');
    th.className = 'right';
    th.textContent = t('leaves.type.' + typ);
    trh.appendChild(th);
  }
  thead.appendChild(trh);

  for (const row of rows) {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    // Avatar + name + role badge — mirrors the team list. The role replaces
    // the @-handle (which used to sit here as a muted sub-label); the username
    // is identity-only noise in this balance view.
    const displayName = row.fullName || row.username;
    const person = document.createElement('div');
    person.className = 'lv-matrix__person';
    person.appendChild(avatar({ employeeId: row.userId }, displayName, 'lv-matrix__av'));
    const nameWrap = document.createElement('span');
    nameWrap.className = 'lv-matrix__name';
    nameWrap.textContent = displayName;
    person.appendChild(nameWrap);
    const role = document.createElement('span');
    role.className = 'lv-type--role';
    role.textContent = t('employee.role.' + row.role);
    person.appendChild(role);
    tdName.appendChild(person);
    tr.appendChild(tdName);

    for (const b of row.balances) {
      const unlimited = b.allowance === 0;
      const over = !unlimited && b.remaining < 0;
      const cap = b.effectiveAllowance ?? b.allowance;
      const td = document.createElement('td');
      td.className = 'right lv-matrix__cell' + (over ? ' lv-matrix__cell--over' : '');
      const mainSpan = document.createElement('span');
      mainSpan.className = 'lv-matrix__main';
      const strong = document.createElement('strong');
      strong.textContent = unlimited ? fmt(b.booked) : fmt(b.remaining);
      const slash = document.createElement('span');
      slash.className = 'muted';
      slash.textContent = unlimited ? ' / —' : ` / ${fmt(cap)}`;
      mainSpan.append(strong, slash);
      td.appendChild(mainSpan);
      if (b.pending > 0) {
        const pend = document.createElement('span');
        pend.className = 'lv-matrix__pending';
        pend.textContent = `+${fmt(b.pending)}`;
        td.appendChild(pend);
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

// -- Render orchestration ---------------------------------------------------

function renderEmployee() {
  const counts = countsByStatus(allLeaves);
  renderFilterBar(filterBar, activeFilter, counts, (f) => { activeFilter = f; listExpanded = false; renderEmployee(); });
  renderListInto(listEl, allLeaves, activeFilter, {
    showName: false,
    withActions: false,
    expanded: listExpanded,
    onToggle: () => { listExpanded = !listExpanded; renderEmployee(); },
  });
}

function renderEmployer() {
  const pending = allLeaves.filter((l) => l.status === 'pending');
  pendingTag.hidden = pending.length === 0;
  pendingTag.textContent = t('leaves.pendingTag', { n: pending.length });
  pendingList.replaceChildren();
  if (pending.length === 0) {
    const li = document.createElement('li');
    li.className = 'lv-empty';
    li.textContent = t('leaves.noPending');
    pendingList.appendChild(li);
  } else {
    for (const l of pending) pendingList.appendChild(renderRow(l, { showName: true, withActions: true }));
  }

  const counts = countsByStatus(allLeaves);
  renderFilterBar(filterBarEmpr, activeFilterEmpr, counts, (f) => { activeFilterEmpr = f; listEmprExpanded = false; renderEmployer(); });
  renderListInto(listEmpr, allLeaves, activeFilterEmpr, {
    showName: true,
    withActions: false,
    expanded: listEmprExpanded,
    onToggle: () => { listEmprExpanded = !listEmprExpanded; renderEmployer(); },
  });
}

function renderAll() {
  if (me.role === 'employer') renderEmployer();
  else renderEmployee();
}

// -- Data fetches -----------------------------------------------------------

async function refreshBalances() {
  if (me.role === 'employer') {
    const res = await fetch(`/api/leaves/balances?year=${currentYear}`, { credentials: 'same-origin' });
    if (res.ok) renderEmployerMatrix(await res.json());
    // The employer is a person too — show their own balance cards (same shape as
    // the employee view) alongside the team matrix.
    const selfRes = await fetch(`/api/leaves/balances/${me.id}?year=${currentYear}`, { credentials: 'same-origin' });
    if (selfRes.ok) renderBalanceBlocks((await selfRes.json()).balances, balanceBlocksEmpr);
  } else {
    const res = await fetch(`/api/leaves/balances/${me.id}?year=${currentYear}`, { credentials: 'same-origin' });
    if (res.ok) renderBalanceBlocks((await res.json()).balances);
  }
}

async function loadAll() {
  const res = await fetch('/api/leaves', { credentials: 'same-origin' });
  if (!res.ok) { showMessage(messageEl, t('leaves.failedToLoad'), 'error'); return; }
  allLeaves = (await res.json()).leaves;
  renderAll();
  await refreshBalances();
}

// -- Year selector ----------------------------------------------------------

function populateYears() {
  const now = new Date().getFullYear();
  yearSelect.replaceChildren();
  for (const y of [now - 1, now, now + 1]) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    if (y === currentYear) opt.selected = true;
    yearSelect.appendChild(opt);
  }
}

yearSelect.addEventListener('change', async () => {
  currentYear = Number(yearSelect.value);
  await refreshBalances();
});

// -- Request modal wiring ---------------------------------------------------

function openRequest(prefillDate) {
  openRequestLeaveModal({ prefillDate, onCreated: () => loadAll() });
}

requestBtn.addEventListener('click', () => openRequest());

// -- Bootstrap --------------------------------------------------------------

(async () => {
  const meRes = await fetch('/api/me', { credentials: 'same-origin' });
  if (meRes.status === 401) { window.location.href = '/login'; return; }
  me = await meRes.json();

  if (me.role === 'employer') {
    emprRegion.hidden = false;
    populateYears();
  } else {
    empRegion.hidden = false;
  }

  await loadAll();

  // ?new=1 → auto-open the request modal (the retired /leaves/new redirect, and
  // the home / calendar "Request leave" buttons, both arrive here).
  if (new URLSearchParams(location.search).get('new') === '1') {
    openRequest();
    history.replaceState({}, '', '/leaves');
  }
})();
