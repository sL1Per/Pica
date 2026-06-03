/**
 * Employee detail (employer view) — M15, Plan 6.
 *
 * One /summary round-trip (profile, week/month hours + missing, upcoming
 * leaves, pending) PLUS a frontend fan-out to /api/punches/by-employee/:id
 * (today, for the status pill + segments + Today stat; current month, for the
 * Recent-days log). Inline approve/decline reuses leave-actions.js for leaves
 * and a plain POST for corrections. Reset-password rides the shared modal.js
 * shell. No backend change.
 */
import { mountTopBar, mountFooter } from '/topbar.js';
import { t, applyTranslations, fmtDate, fmtTime, fmtHours, translateError } from '/i18n.js';
import { showMessage } from '/app.js';
import { pairSessions, workedMs, classify } from '/team-status.js';
import { createModal } from '/modal.js';
import { openLeaveModal } from '/leave-detail-modal.js';
import { approveLeaveWithCheck, rejectLeave } from '/leave-actions.js';

mountTopBar();
mountFooter();
applyTranslations();

const segs = window.location.pathname.split('/').filter(Boolean);
const employeeId = segs[segs.indexOf('employees') + 1];

const $ = (id) => document.getElementById(id);
const heroEl = $('ed-hero');
const statsEl = $('ed-stats');
const gridEl = $('ed-grid');
const recentBody = $('ed-recent-body');
const pendingBody = $('ed-pending-body');
const pendingTitle = $('ed-pending-title');
const upcomingBody = $('ed-upcoming-body');
const messageEl = $('message');
const errorEl = $('error');

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayYmd = () => ymd(new Date());
function initials(name) { return (String(name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('')) || '?'; }
function hue(s) { let h = 0; for (const ch of String(s || '')) h = (h + ch.charCodeAt(0)) % 360; return h; }
function statusDot(key) { const d = el('span', `st-dot st-dot--${key}`); d.setAttribute('aria-hidden', 'true'); return d; }
function hhmm(ms) { const tot = Math.max(0, Math.round(ms / 60000)); return `${Math.floor(tot / 60)}h${pad2(tot % 60)}`; }

function avatar(name, hasPicture) {
  const a = el('div', 'ed-avatar');
  if (hasPicture) { const img = el('img'); img.src = `/api/employees/${encodeURIComponent(employeeId)}/picture`; img.alt = ''; a.appendChild(img); }
  else { a.textContent = initials(name); a.style.setProperty('--hue', hue(name)); }
  return a;
}

const STATUS_LABEL = { working: 'team.status.working', break: 'team.status.break', done: 'team.status.done', leave: 'team.status.leave', off: 'team.status.off' };
const KIND = { both: 'corrections.kindBoth', in: 'corrections.kindIn', out: 'corrections.kindOut' };

function fmtRange(start, end, unit) {
  if (unit === 'hours') {
    // Corrections can carry a single endpoint: an in-only correction has
    // end === null, an out-only one has start === null. Derive the date
    // from whichever side exists and collapse to one time when only one
    // is present, so the row reads "Jun 2, 2026 17:00" rather than a
    // half-empty "Jun 2, 2026  –17:00".
    const date = fmtDate(start || end);
    const a = start ? fmtTime(start) : '';
    const b = end ? fmtTime(end) : '';
    const time = a && b ? `${a}–${b}` : (a || b);
    return `${date} ${time}`.trim();
  }
  const s = String(start), e = String(end);
  const sY = s.slice(0, 10), eY = e.slice(0, 10);
  return sY === eY ? fmtDate(sY) : `${fmtDate(sY)} → ${fmtDate(eY)}`;
}

let data = null;          // /summary payload
let me = null;            // viewer ({id, role}) from /api/me — for the leave modal
let todayPunches = [];
let monthPunches = [];

async function getJson(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}

function isOnLeaveToday() {
  const today = todayYmd();
  return (data.upcomingLeaves || []).some((l) =>
    String(l.start).slice(0, 10) <= today && today <= String(l.end).slice(0, 10));
}

function renderHero() {
  const profile = data.profile || {};
  const name = profile.fullName || data.username;
  document.title = `Pica — ${name}`;

  heroEl.replaceChildren();
  heroEl.append(avatar(name, profile.hasPicture));

  const text = el('div', 'ed-hero__text');
  const nameEl = el('h1', 'ed-name', name);
  nameEl.append(el('span', 'ed-badge' + (data.role === 'employer' ? ' ed-badge--employer' : ''), t('employee.role.' + data.role)));
  text.append(nameEl);
  if (profile.position) text.append(el('div', 'ed-position', profile.position));

  const pairs = pairSessions(todayPunches);
  const status = classify({ pairs, onLeave: isOnLeaveToday(), nowHour: new Date().getHours() });
  const pill = el('div', 'ed-status ed-status--' + status);
  pill.append(statusDot(status), document.createTextNode(t(STATUS_LABEL[status])));
  text.append(pill);

  const segText = pairs.length
    ? pairs.map((p) => `${fmtTime(p.in.ts)}–${p.out ? fmtTime(p.out.ts) : '…'}`).join('   ·   ')
    : t('employee.detail.segmentsNone');
  text.append(el('div', 'ed-segments', segText));
  heroEl.append(text);

  const actions = el('div', 'ed-hero__actions');
  const resetBtn = el('button', 'ed-btn', t('employee.summary.resetPw')); resetBtn.type = 'button';
  resetBtn.addEventListener('click', openResetModal);
  const editLink = el('a', 'ed-btn ed-btn--primary', t('employee.summary.viewProfile'));
  editLink.href = `/employees/${encodeURIComponent(employeeId)}/profile`;
  actions.append(resetBtn, editLink);
  heroEl.append(actions);
}

function statBlock(label, hours, target, capText) {
  const card = el('div', 'ed-stat');
  card.append(el('div', 'ed-stat__label', label));
  const num = el('div', 'ed-stat__num');
  num.append(document.createTextNode(fmtHours(hours)));
  num.append(el('small', null, target ? ` / ${fmtHours(target)}h` : ' h'));
  card.append(num);
  if (target) {
    const track = el('div', 'ed-stat__track');
    const fill = el('div', 'ed-stat__fill');
    fill.style.setProperty('--pct', Math.min(100, Math.round((hours / target) * 100)));
    track.append(fill);
    card.append(track);
  }
  if (capText) card.append(el('div', 'ed-stat__cap', capText));
  return card;
}

function missCap(missing) {
  return (missing && missing > 0)
    ? t('employee.detail.missingCap', { h: fmtHours(missing) })
    : t('employee.detail.onTrack');
}

function renderStats() {
  const w = data.week || {}, m = data.month || {};
  const todayWorked = workedMs(pairSessions(todayPunches)) / 3600000;
  const dailyTarget = w.scheduled ? Math.round((w.scheduled / 5) * 10) / 10 : null;
  statsEl.replaceChildren(
    statBlock(t('employee.detail.weekTitle'), w.hours ?? 0, w.scheduled, missCap(w.missing)),
    statBlock(t('employee.detail.monthTitle'), m.hours ?? 0, m.scheduled, missCap(m.missing)),
    statBlock(t('employee.detail.todayStat'), todayWorked, dailyTarget, t('employee.detail.loggedToday')),
  );
}

function renderRecent() {
  const byDay = new Map();
  for (const p of monthPunches) {
    const key = ymd(new Date(p.ts));
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(p);
  }
  const today = todayYmd();
  const days = [...byDay.keys()].filter((k) => k < today).sort().reverse().slice(0, 7);
  if (days.length === 0) { recentBody.replaceChildren(el('div', 'ed-empty', t('employee.detail.recentEmpty'))); return; }
  const frag = document.createDocumentFragment();
  for (const k of days) {
    const pairs = pairSessions(byDay.get(k));
    const row = el('div', 'ed-day');
    row.append(el('div', 'ed-day__date', fmtDate(k)));
    row.append(el('div', 'ed-day__sessions', pairs.map((p) => `${fmtTime(p.in.ts)}–${p.out ? fmtTime(p.out.ts) : '…'}`).join(', ')));
    row.append(el('div', 'ed-day__total', `${fmtHours(workedMs(pairs) / 3600000)}h`));
    frag.append(row);
  }
  recentBody.replaceChildren(frag);
}

function pendRow(when, detail, onApprove, onReject) {
  const row = el('div', 'ed-pend');
  const main = el('div', 'ed-pend__main');
  main.append(el('div', 'ed-pend__when', when), el('div', 'ed-pend__detail', detail));
  const acts = el('div', 'ed-pend__acts');
  const ok = el('button', 'ed-act ed-act--approve', '✓'); ok.type = 'button'; ok.setAttribute('aria-label', t('corrections.inlineApprove'));
  const no = el('button', 'ed-act ed-act--reject', '✗'); no.type = 'button'; no.setAttribute('aria-label', t('corrections.inlineReject'));
  acts.append(ok, no);
  const note = el('div', 'ed-note'); note.hidden = true;
  const input = el('input'); input.type = 'text'; input.maxLength = 500; input.placeholder = t('corrections.rejectNotesPlaceholder');
  const send = el('button', 'ed-act ed-act--reject', '✗'); send.type = 'button'; send.setAttribute('aria-label', t('corrections.inlineReject'));
  note.append(input, send);
  ok.addEventListener('click', async () => { ok.disabled = no.disabled = true; await onApprove(); });
  no.addEventListener('click', () => { note.hidden = !note.hidden; if (!note.hidden) input.focus(); });
  send.addEventListener('click', async () => { send.disabled = true; await onReject(input.value.trim()); });
  row.append(main, acts, note);
  return row;
}

async function decideCorrection(id, action, notes) {
  try {
    const res = await fetch(`/api/corrections/${encodeURIComponent(id)}/${action}`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: action === 'reject' ? JSON.stringify({ notes: notes || '' }) : undefined,
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); showMessage(messageEl, translateError(d.errorCode, d.error || t('widgets.couldNotLoad')), 'error'); return false; }
    return true;
  } catch { showMessage(messageEl, t('widgets.couldNotLoad'), 'error'); return false; }
}

function renderPending() {
  const firstName = (data.profile?.fullName || data.username || '').split(/\s+/)[0] || data.username;
  pendingTitle.textContent = t('employee.detail.pendingFrom', { name: firstName });
  const leaves = data.pending?.leaves ?? [];
  const corrs = data.pending?.corrections ?? [];

  if (leaves.length === 0 && corrs.length === 0) {
    const wrap = el('div', 'ed-allcaught');
    wrap.append(el('span', 'ed-allcaught__check', '✓'), document.createTextNode(t('employee.summary.pendingEmpty')));
    pendingBody.replaceChildren(wrap);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const l of leaves) {
    frag.append(pendRow(fmtRange(l.start, l.end, l.unit), t('leaves.type.' + l.type),
      async () => { const r = await approveLeaveWithCheck(l); if (r.ok) load(); },
      async (notes) => { const r = await rejectLeave(l.id, notes); if (r.ok) load(); }));
  }
  for (const c of corrs) {
    frag.append(pendRow(fmtRange(c.start, c.end, 'hours'), `${t(KIND[c.kind] || 'corrections.kindBoth')} · ${fmtHours(c.hours || 0)}h`,
      async () => { const ok = await decideCorrection(c.id, 'approve'); if (ok) load(); },
      async (notes) => { const ok = await decideCorrection(c.id, 'reject', notes); if (ok) load(); }));
  }
  pendingBody.replaceChildren(frag);
}

function renderUpcoming() {
  const leaves = data.upcomingLeaves || [];
  if (leaves.length === 0) { upcomingBody.replaceChildren(el('div', 'ed-empty', t('employee.summary.upcomingEmpty'))); return; }
  const frag = document.createDocumentFragment();
  for (const l of leaves) {
    const status = l.status || 'approved';
    const row = el('div', 'ed-leave');
    row.append(el('div', 'ed-leave__bar' + (status === 'pending' ? ' ed-leave__bar--pending' : '')));
    const main = el('div', 'ed-leave__main');
    main.append(el('div', 'ed-leave__type', t('leaves.type.' + l.type)), el('div', 'ed-leave__when', fmtRange(l.start, l.end, l.unit)));
    row.append(main);
    const pill = el('a', 'ed-leave__pill ed-leave__pill--' + (status === 'pending' ? 'pending' : 'approved'), t('leaves.status.' + status));
    // Open the in-page detail modal on a plain click; keep the href so
    // ⌘/middle-click + screen readers still reach the /leaves/:id page.
    pill.href = `/leaves/${encodeURIComponent(l.id)}`;
    if (me) {
      pill.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        openLeaveModal({ id: l.id, me, onDone: load });
      });
    }
    row.append(pill);
    frag.append(row);
  }
  upcomingBody.replaceChildren(frag);
}

function openResetModal() {
  const modal = createModal({ titleKey: 'employee.summary.resetPwModalTitle' });
  modal.body.replaceChildren();
  const help = el('p', 'muted', t('employee.summary.resetPwModalHelp'));
  const msg = el('div', 'message');
  const form = el('form'); form.autocomplete = 'off';
  const l1 = el('label', null, t('employee.summary.resetPwNewLabel')); l1.htmlFor = 'rp-new';
  const i1 = el('input'); i1.type = 'password'; i1.id = 'rp-new'; i1.autocomplete = 'new-password'; i1.minLength = 8; i1.required = true;
  const l2 = el('label', null, t('employee.summary.resetPwConfirmLabel')); l2.htmlFor = 'rp-confirm';
  const i2 = el('input'); i2.type = 'password'; i2.id = 'rp-confirm'; i2.autocomplete = 'new-password'; i2.minLength = 8; i2.required = true;
  const btns = el('div', 'btn-row mt-5'); // mt-5: separate the actions from the confirm-password field above
  const cancel = el('button', 'secondary', t('employee.summary.resetPwCancel')); cancel.type = 'button';
  const submit = el('button', null, t('employee.summary.resetPwSubmit')); submit.type = 'submit';
  cancel.addEventListener('click', () => modal.close());
  btns.append(cancel, submit);
  form.append(l1, i1, l2, i2, btns);
  modal.body.append(help, msg, form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const np = i1.value, cf = i2.value;
    if (np !== cf) { showMessage(msg, t('employee.summary.resetPwMismatch'), 'error'); return; }
    if (np.length < 8) { showMessage(msg, t('errors.password_too_short'), 'error'); return; }
    submit.disabled = true;
    try {
      const res = await fetch(`/api/employees/${encodeURIComponent(employeeId)}/password-reset`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: np }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(translateError(d.errorCode, d.error || `HTTP ${res.status}`));
      modal.close();
      showMessage(messageEl, t('employee.summary.resetPwSuccess'), 'success');
    } catch (err) {
      showMessage(msg, err.message, 'error');
      submit.disabled = false;
    }
  });

  modal.open();
  i1.focus();
}

async function load() {
  errorEl.hidden = true;
  let summary;
  try {
    summary = await getJson(`/api/employees/${encodeURIComponent(employeeId)}/summary`);
  } catch (e) {
    if (e.status === 401) { window.location.href = '/login'; return; }
    if (e.status === 403) { window.location.href = '/'; return; }
    if (e.status === 404) { errorEl.hidden = false; errorEl.textContent = t('employee.summary.notFound'); return; }
    errorEl.hidden = false; errorEl.textContent = t('widgets.couldNotLoad'); return;
  }

  const now = new Date();
  const [today, month] = await Promise.allSettled([
    getJson(`/api/punches/by-employee/${encodeURIComponent(employeeId)}?date=${todayYmd()}`),
    getJson(`/api/punches/by-employee/${encodeURIComponent(employeeId)}?year=${now.getFullYear()}&month=${now.getMonth() + 1}`),
  ]);
  data = summary;
  if (!me) me = await getJson('/api/me').catch(() => null);
  todayPunches = today.status === 'fulfilled' ? (today.value.punches ?? []) : [];
  monthPunches = month.status === 'fulfilled' ? (month.value.punches ?? []) : [];

  renderHero();
  renderStats();
  renderRecent();
  renderPending();
  renderUpcoming();
  heroEl.hidden = false;
  statsEl.hidden = false;
  gridEl.hidden = false;
}

load();
