import { showMessage } from '/app.js';
import { t, applyTranslations, getLocale, fmtDate, fmtHours } from '/i18n.js';
import { mountTopBar, mountFooter } from '/topbar.js';
import { monthMatrix, ymd } from '/calendar-grid.js';
import { openRequestLeaveModal } from '/request-leave-modal.js';
import { approveLeaveWithCheck, rejectLeave } from '/leave-actions.js';

mountTopBar();
mountFooter();
applyTranslations();

const $ = (id) => document.getElementById(id);
const grid       = $('cal-grid');
const weekhead   = $('cal-weekhead');
const monthEl    = $('cal-month');
const subEl      = $('cal-sub');
const chipsEl    = $('cal-chips');
const scopeEl    = $('cal-scope');
const messageEl  = $('message');
const railRole       = $('rail-role');
const railOutToday   = $('rail-out-today');
const railOutTomorrow = $('rail-out-tomorrow');

const TYPES = ['vacation', 'sick', 'appointment', 'other'];
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

let me = null;
let allLeaves = [];          // merged, status ∈ {pending, approved}
let blockedRanges = [];
let balances = null;         // employee only
let cursor = new Date();
let scope = 'team';          // employee Mine|Team
const hidden = new Set();    // type keys toggled off ('vacation'…/'blocked')
let popoverEl = null;

// -- Date helpers -----------------------------------------------------------

function parseYmd(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); }
function todayYmd() { return ymd(new Date()); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function monthLabel(year, month) {
  try { return new Intl.DateTimeFormat(getLocale(), { month: 'long', year: 'numeric' }).format(new Date(year, month, 1)); }
  catch { return `${['January','February','March','April','May','June','July','August','September','October','November','December'][month]} ${year}`; }
}
function initials(name) {
  return String(name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
}

// -- Leaves → day -----------------------------------------------------------

function leaveTouches(leave, ymdStr) {
  if (leave.unit === 'days') return leave.start <= ymdStr && ymdStr <= leave.end;
  return String(leave.start).slice(0, 10) === ymdStr;   // hours = intraday
}
function blockedForDay(ymdStr) {
  for (const r of blockedRanges) if (r.start <= ymdStr && ymdStr <= r.end) return r;
  return null;
}
function scopedLeaves() {
  let ls = allLeaves;
  if (me.role !== 'employer' && scope === 'mine') ls = ls.filter((l) => l.employeeId === me.id);
  return ls.filter((l) => !hidden.has(l.type));
}
function leavesForDay(ymdStr, list) { return list.filter((l) => leaveTouches(l, ymdStr)); }
function rangeText(l) {
  if (l.unit === 'days') return l.start === l.end ? fmtDate(parseYmd(l.start)) : `${fmtDate(parseYmd(l.start))} → ${fmtDate(parseYmd(l.end))}`;
  return fmtDate(parseYmd(String(l.start).slice(0, 10)));
}
function canOpen(l) { return !l.anonymized && (me.role === 'employer' || l.employeeId === me.id); }

// -- Toolbar: chips + scope -------------------------------------------------

function renderChips() {
  chipsEl.replaceChildren();
  const keys = [...TYPES, 'blocked'];
  for (const k of keys) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `cal-chip cal-chip--${k}` + (hidden.has(k) ? '' : ' cal-chip--on');
    const dot = document.createElement('span');
    dot.className = 'cal-chip__dot';
    const label = document.createElement('span');
    label.textContent = k === 'blocked' ? t('calendar.blocked') : t('leaves.type.' + k);
    btn.append(dot, label);
    btn.addEventListener('click', () => {
      if (hidden.has(k)) hidden.delete(k); else hidden.add(k);
      renderChips();
      renderMonth();
    });
    chipsEl.appendChild(btn);
  }
}

function renderScope() {
  if (me.role === 'employer') { scopeEl.hidden = true; return; }
  scopeEl.hidden = false;
  scopeEl.replaceChildren();
  for (const [key, labelKey] of [['mine', 'calendar.scopeMine'], ['team', 'calendar.scopeTeam']]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cal-scope__btn' + (scope === key ? ' cal-scope__btn--active' : '');
    btn.textContent = t(labelKey);
    btn.addEventListener('click', () => { scope = key; renderScope(); renderMonth(); });
    scopeEl.appendChild(btn);
  }
}

// -- Grid -------------------------------------------------------------------

function renderWeekhead() {
  weekhead.replaceChildren();
  WEEKDAYS.forEach((w, i) => {
    const c = document.createElement('div');
    c.className = 'cal-weekhead__cell' + (i >= 5 ? ' cal-weekhead__cell--weekend' : '');
    c.textContent = t('calendar.weekday.' + w);
    weekhead.appendChild(c);
  });
}

function renderMonth() {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  monthEl.textContent = monthLabel(year, month);
  closePopover();

  const list = scopedLeaves();
  grid.replaceChildren();

  for (const cell of monthMatrix(year, month)) {
    const el = document.createElement('div');
    el.className = 'cal-cell';
    el.dataset.date = cell.ymd;
    const dow = (cell.date.getDay() + 6) % 7;   // Mon=0
    if (dow >= 5) el.classList.add('cal-cell--weekend');
    if (!cell.inMonth) el.classList.add('cal-cell--outside');
    if (cell.isToday) el.classList.add('cal-cell--today');

    const num = document.createElement('div');
    num.className = 'cal-cell__num';
    num.textContent = String(cell.date.getDate());
    el.appendChild(num);

    const blk = blockedForDay(cell.ymd);
    if (blk && !hidden.has('blocked')) {
      el.classList.add('cal-cell--blocked');
      const tag = document.createElement('div');
      tag.className = 'cal-cell__closed';
      tag.textContent = t('calendar.closed');
      el.appendChild(tag);
    }

    if (cell.inMonth) {
      const dayLeaves = leavesForDay(cell.ymd, list);
      const shown = dayLeaves.slice(0, 3);
      for (const l of shown) el.appendChild(renderPill(l));
      if (dayLeaves.length > 3) {
        const more = document.createElement('div');
        more.className = 'cal-more';
        more.textContent = t('calendar.moreN', { n: dayLeaves.length - 3 });
        el.appendChild(more);
      }
    }
    grid.appendChild(el);
  }
}

function renderPill(l) {
  const node = canOpen(l) ? document.createElement('a') : document.createElement('span');
  if (l.anonymized) {
    node.className = 'cal-pill cal-pill--anonymized';
    node.textContent = t('calendar.anonymized');
    return node;
  }
  node.className = `cal-pill cal-pill--${l.type}`;
  if (l.status === 'pending') node.classList.add('cal-pill--pending');
  if (l.employeeId === me.id) node.classList.add('cal-pill--self');
  if (canOpen(l)) node.href = `/leaves/${l.id}`;
  node.textContent = l.fullName || l.username || '—';
  return node;
}

// -- Popover ----------------------------------------------------------------

function closePopover() {
  if (popoverEl) { popoverEl.remove(); popoverEl = null; }
  document.removeEventListener('keydown', onPopKey);
  document.removeEventListener('mousedown', onPopOutside);
}
function onPopKey(e) { if (e.key === 'Escape') closePopover(); }
function onPopOutside(e) {
  if (popoverEl && !popoverEl.contains(e.target) && !e.target.closest('.cal-cell')) closePopover();
}

function openPopover(cellEl, ymdStr) {
  closePopover();
  const date = parseYmd(ymdStr);
  const dayLeaves = leavesForDay(ymdStr, scopedLeaves());
  const blk = blockedForDay(ymdStr);
  if (dayLeaves.length === 0 && !(blk && !hidden.has('blocked')) && me.role === 'employer') {
    // employer: nothing to show and no quick action → no popover
    return;
  }

  const pop = document.createElement('div');
  pop.className = 'cal-pop';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'cal-pop__close';
  close.setAttribute('aria-label', t('calendar.detailsClose'));
  close.textContent = '×';
  close.addEventListener('click', closePopover);
  pop.appendChild(close);

  const dateEl = document.createElement('div');
  dateEl.className = 'cal-pop__date';
  dateEl.textContent = fmtDate(date);
  pop.appendChild(dateEl);

  if (blk && !hidden.has('blocked')) pop.appendChild(popBlockedRow(blk));
  for (const l of dayLeaves) pop.appendChild(popLeaveRow(l));
  if (dayLeaves.length === 0 && !blk) {
    const empty = document.createElement('div');
    empty.className = 'cal-pop__empty';
    empty.textContent = t('calendar.noLeavesDay');
    pop.appendChild(empty);
  }

  if (me.role !== 'employer') {
    const req = document.createElement('button');
    req.type = 'button';
    req.className = 'cal-pop__req';
    req.textContent = t('calendar.requestThisDay');
    req.addEventListener('click', () => {
      closePopover();
      openRequestLeaveModal({ prefillDate: ymdStr, onCreated: reload });
    });
    pop.appendChild(req);
  }

  document.body.appendChild(pop);
  popoverEl = pop;
  positionPopover(cellEl);

  document.addEventListener('keydown', onPopKey);
  setTimeout(() => document.addEventListener('mousedown', onPopOutside), 0);
}

function positionPopover(cellEl) {
  if (window.matchMedia('(max-width: 600px)').matches) {
    popoverEl.style.left = '';
    popoverEl.style.top = '';
    return;   // CSS bottom-sheet takes over
  }
  const r = cellEl.getBoundingClientRect();
  const w = popoverEl.offsetWidth;
  const h = popoverEl.offsetHeight;
  const pad = 8;
  let left = r.left + window.scrollX + r.width / 2 - w / 2;
  let top = r.bottom + window.scrollY + pad;
  left = Math.max(pad + window.scrollX, Math.min(left, window.scrollX + window.innerWidth - w - pad));
  if (r.bottom + h + pad > window.innerHeight) top = r.top + window.scrollY - h - pad;
  popoverEl.style.left = `${left}px`;
  popoverEl.style.top = `${top}px`;
}

function popBlockedRow(blk) {
  const row = document.createElement('div');
  row.className = 'cal-pop__row';
  const av = document.createElement('span');
  av.className = 'cal-pop__av';
  av.textContent = '—';
  const body = document.createElement('div');
  body.className = 'cal-pop__body';
  const name = document.createElement('div');
  name.className = 'cal-pop__name';
  name.textContent = blk.label || t('calendar.closed');
  const meta = document.createElement('div');
  meta.className = 'cal-pop__meta';
  meta.textContent = t('calendar.closed');
  body.append(name, meta);
  row.append(av, body);
  return row;
}

function popLeaveRow(l) {
  const node = canOpen(l) ? document.createElement('a') : document.createElement('div');
  node.className = 'cal-pop__row';
  if (canOpen(l)) node.href = `/leaves/${l.id}`;
  const av = document.createElement('span');
  av.className = 'cal-pop__av';
  av.textContent = l.anonymized ? '–' : initials(l.fullName || l.username);
  const body = document.createElement('div');
  body.className = 'cal-pop__body';
  const name = document.createElement('div');
  name.className = 'cal-pop__name';
  name.textContent = l.anonymized ? t('calendar.anonymized') : (l.fullName || l.username || '—');
  const meta = document.createElement('div');
  meta.className = 'cal-pop__meta';
  meta.textContent = l.anonymized ? rangeText(l) : `${t('leaves.type.' + l.type)} · ${rangeText(l)}`;
  body.append(name, meta);
  node.append(av, body);
  return node;
}

// -- Right rail -------------------------------------------------------------

function approvedTouching(ymdStr) {
  return allLeaves.filter((l) => l.status === 'approved' && l.type !== 'blocked' && leaveTouches(l, ymdStr));
}

function renderOutList(host, ymdStr) {
  host.replaceChildren();
  const rows = approvedTouching(ymdStr);
  if (rows.length === 0) {
    const e = document.createElement('div');
    e.className = 'cal-rail__empty';
    e.textContent = t('calendar.noneOut');
    host.appendChild(e);
    return;
  }
  for (const l of rows) {
    const row = document.createElement('div');
    row.className = 'cal-out__row';
    const body = document.createElement('div');
    body.className = 'cal-out__body';
    const name = document.createElement('div');
    name.className = 'cal-out__name';
    name.textContent = l.anonymized ? t('calendar.anonymized') : (l.fullName || l.username || '—');
    const sub = document.createElement('div');
    sub.className = 'cal-out__sub';
    sub.textContent = rangeText(l);
    body.append(name, sub);
    row.appendChild(body);
    if (!l.anonymized) {
      const tag = document.createElement('span');
      tag.className = `cal-out__tag cal-out__tag--${l.type}`;
      tag.textContent = t('leaves.type.' + l.type);
      row.appendChild(tag);
    }
    host.appendChild(row);
  }
}

function renderRail() {
  renderOutList(railOutToday, todayYmd());
  renderOutList(railOutTomorrow, ymd(addDays(new Date(), 1)));

  railRole.replaceChildren();
  if (me.role === 'employer') {
    const title = document.createElement('h3');
    title.className = 'cal-rail__title';
    title.textContent = t('calendar.pendingTitle');
    railRole.appendChild(title);
    const pending = allLeaves.filter((l) => l.status === 'pending');
    if (pending.length === 0) {
      const e = document.createElement('div');
      e.className = 'cal-rail__empty';
      e.textContent = t('leaves.noPending');
      railRole.appendChild(e);
    } else {
      for (const l of pending) railRole.appendChild(renderPendingRow(l));
    }
  } else {
    const title = document.createElement('h3');
    title.className = 'cal-rail__title';
    title.textContent = t('calendar.balanceTitle');
    railRole.appendChild(title);
    const vac = balances?.find((b) => b.type === 'vacation');
    const cap = vac ? (vac.effectiveAllowance ?? vac.allowance) : 0;
    const remaining = vac ? vac.remaining : 0;
    const row = document.createElement('div');
    row.className = 'cal-bal__row';
    const big = document.createElement('span');
    big.className = 'cal-bal__big';
    big.textContent = fmtHours(remaining);
    const unit = document.createElement('span');
    unit.className = 'cal-bal__unit';
    unit.textContent = `/ ${cap ? fmtHours(cap) : '—'}`;
    row.append(big, unit);
    railRole.appendChild(row);
    const bar = document.createElement('div');
    bar.className = 'cal-bal__bar';
    const fill = document.createElement('div');
    fill.className = 'cal-bal__fill';
    const pct = cap > 0 ? Math.min(100, Math.max(0, (vac.booked / cap) * 100)) : 0;
    fill.style.setProperty('--pct', String(pct));
    bar.appendChild(fill);
    railRole.appendChild(bar);
    const cta = document.createElement('button');
    cta.type = 'button';
    cta.className = 'cal-cta';
    cta.textContent = t('calendar.requestNew');
    cta.addEventListener('click', () => openRequestLeaveModal({ onCreated: reload }));
    railRole.appendChild(cta);
  }
}

function renderPendingRow(l) {
  const row = document.createElement('div');
  row.className = 'cal-pend__row';
  const body = document.createElement('div');
  body.className = 'cal-pend__body';
  const name = document.createElement('div');
  name.className = 'cal-pend__name';
  name.textContent = l.fullName || l.username || '—';
  const meta = document.createElement('div');
  meta.className = 'cal-pend__meta';
  meta.textContent = rangeText(l);
  body.append(name, meta);

  const actions = document.createElement('div');
  actions.className = 'cal-pend__actions';
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'cal-act cal-act--approve';
  ok.textContent = '✓';
  ok.title = t('leave.actionApprove');
  ok.addEventListener('click', async () => {
    ok.disabled = true;
    const res = await approveLeaveWithCheck(l);
    if (res.cancelled) { ok.disabled = false; return; }
    if (res.ok) reload();
    else { ok.disabled = false; showMessage(messageEl, res.data?.error || t('leaves.actionFailed'), 'error'); }
  });
  const no = document.createElement('button');
  no.type = 'button';
  no.className = 'cal-act cal-act--reject';
  no.textContent = '✗';
  no.title = t('leave.actionReject');
  no.addEventListener('click', async () => {
    no.disabled = true;
    const res = await rejectLeave(l.id, '');
    if (res.ok) reload();
    else { no.disabled = false; showMessage(messageEl, res.data?.error || t('leaves.actionFailed'), 'error'); }
  });
  actions.append(ok, no);
  row.append(body, actions);
  return row;
}

// -- Subtitle ---------------------------------------------------------------

function renderSubtitle() {
  if (me.role === 'employer') {
    const out = approvedTouching(todayYmd()).length;
    const pending = allLeaves.filter((l) => l.status === 'pending').length;
    subEl.textContent = t('calendar.subEmployer', { out, pending });
  } else {
    const vac = balances?.find((b) => b.type === 'vacation');
    const cap = vac ? (vac.effectiveAllowance ?? vac.allowance) : 0;
    subEl.textContent = t('calendar.subEmployee', { n: fmtHours(vac ? vac.remaining : 0), cap: cap ? fmtHours(cap) : '—' });
  }
}

// -- Data -------------------------------------------------------------------

function mergeLeaves(mine, approved) {
  const active = (l) => l.status === 'pending' || l.status === 'approved';
  if (me.role === 'employer') return mine.filter(active);
  // employee: own (all-status from /api/leaves) + anonymized others from approved feed
  const own = mine.filter(active);
  const others = approved.filter((l) => l.anonymized);
  return [...own, ...others];
}

async function reload() {
  const reqs = [
    fetch('/api/leaves', { credentials: 'same-origin' }),
    fetch('/api/leaves/approved', { credentials: 'same-origin' }),
  ];
  if (me.role !== 'employer') reqs.push(fetch(`/api/leaves/balances/${me.id}?year=${new Date().getFullYear()}`, { credentials: 'same-origin' }));
  const [lvRes, apRes, balRes] = await Promise.all(reqs);
  if (!lvRes.ok || !apRes.ok) { showMessage(messageEl, t('leaves.failedToLoad'), 'error'); return; }
  const mine = (await lvRes.json()).leaves;
  const approvedPayload = await apRes.json();
  allLeaves = mergeLeaves(mine, approvedPayload.leaves);
  blockedRanges = approvedPayload.blockedRanges || [];
  if (balRes && balRes.ok) balances = (await balRes.json()).balances;
  renderSubtitle();
  renderMonth();
  renderRail();
}

// -- Nav --------------------------------------------------------------------

$('prev-month').addEventListener('click', () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); renderMonth(); });
$('next-month').addEventListener('click', () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); renderMonth(); });
$('today-btn').addEventListener('click', () => { cursor = new Date(); renderMonth(); });

grid.addEventListener('click', (e) => {
  if (e.target.closest('.cal-pill')) return;          // pills are their own links
  const cell = e.target.closest('.cal-cell');
  if (!cell || !cell.dataset.date || cell.classList.contains('cal-cell--outside')) return;
  openPopover(cell, cell.dataset.date);
});

// -- Bootstrap --------------------------------------------------------------

(async () => {
  const meRes = await fetch('/api/me', { credentials: 'same-origin' });
  if (meRes.status === 401) { window.location.href = '/login'; return; }
  me = await meRes.json();

  renderWeekhead();
  renderChips();
  renderScope();
  await reload();
})();
