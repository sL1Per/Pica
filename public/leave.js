import { postJson, showMessage, setBusy } from '/app.js';
import { t, tn, translateError, applyTranslations, fmtHours, fmtDateTime, getLocale } from '/i18n.js';

import { mountTopBar, mountFooter } from '/topbar.js';
mountTopBar();
mountFooter();
applyTranslations();

const leaveId = window.location.pathname.split('/').pop();

const $ = (id) => document.getElementById(id);
const detail = $('detail');
const heroEl = $('status-hero');
const actionsEl = $('actions');
const actionsCard = $('actions-card');
const rejectDialog = $('reject-dialog');
const messageEl = $('message');

let me = null;
let leave = null;

const HERO_ICONS = { pending: '⏳', approved: '✓', rejected: '✕', cancelled: '—' };

// -- Formatting helpers ------------------------------------------------------

function pad2(n) { return String(n).padStart(2, '0'); }
function ymd(s) { return String(s).slice(0, 10); }
function parseYmd(s) { const [y, m, d] = String(s).split('-').map(Number); return Date.UTC(y, m - 1, d); }

function formatWhen(l) {
  if (l.unit === 'days') {
    return l.start === l.end ? l.start : `${l.start} → ${l.end}`;
  }
  const s = new Date(l.start);
  const e = new Date(l.end);
  const sameDay = s.toDateString() === e.toDateString();
  const ds = s.toISOString().slice(0, 10);
  const hs = `${pad2(s.getHours())}:${pad2(s.getMinutes())}`;
  const he = `${pad2(e.getHours())}:${pad2(e.getMinutes())}`;
  return sameDay ? `${ds}, ${hs}–${he}` : `${l.start} → ${l.end}`;
}

function formatDuration(l) {
  if (l.unit === 'hours' && typeof l.hours === 'number') {
    return tn('leave.durHours', l.hours, { count: fmtHours(l.hours) });
  }
  const s = new Date(l.start);
  const e = new Date(l.end);
  const days = Math.round((e - s) / 86_400_000) + 1;
  return tn('leave.durDays', days, { count: days });
}

// -- Main render -------------------------------------------------------------

function render() {
  // Status hero
  heroEl.className = `ldet-hero ldet-hero--${leave.status}`;
  $('hero-icon').textContent = HERO_ICONS[leave.status] || '';
  $('hero-label').textContent = t('status.' + leave.status);
  $('hero-blurb').textContent = t('leave.hero' + leave.status.charAt(0).toUpperCase() + leave.status.slice(1));

  // Details
  $('f-employee').textContent = leave.fullName || leave.username || leave.employeeId;
  $('f-type').textContent = t('leaves.type.' + leave.type);
  $('f-when').textContent = formatWhen(leave);
  $('f-duration').textContent = formatDuration(leave);
  $('f-created').textContent = fmtDateTime(leave.createdAt);

  // Reason
  const reasonEl = $('f-reason');
  if (leave.reason) {
    reasonEl.className = 'ldet-reason--filled';
    reasonEl.textContent = leave.reason;
  } else {
    reasonEl.className = 'ldet-reason--empty';
    reasonEl.textContent = t('leave.reasonEmpty');
  }

  renderAttachment();

  // Decision note
  const note = $('decided-note');
  if (leave.status === 'approved') {
    note.hidden = false;
    $('decided-label').textContent = t('leave.decidedApproved', { date: fmtDateTime(leave.decidedAt) });
    $('decided-notes').textContent = '';
  } else if (leave.status === 'rejected') {
    note.hidden = false;
    $('decided-label').textContent = t('leave.decidedRejected', { date: fmtDateTime(leave.decidedAt) });
    $('decided-notes').textContent = leave.notes || '';
  } else if (leave.status === 'cancelled') {
    note.hidden = false;
    $('decided-label').textContent = t('leave.decidedCancelled', { date: fmtDateTime(leave.cancelledAt) });
    $('decided-notes').textContent = '';
  } else {
    note.hidden = true;
  }

  renderActions();
  renderMiniCal();
  renderActivity();
  detail.hidden = false;
}

function renderAttachment() {
  const card = $('attachment-card');
  const dd = $('f-attachment');
  const edit = $('attachment-edit');
  const removeBtn = $('att-remove');

  const isOwner    = leave.employeeId === me.id;
  const isEmployer = me.role === 'employer';
  const canEdit = leave.status === 'pending' && (isOwner || isEmployer);

  dd.replaceChildren();
  if (leave.attachment) {
    const a = document.createElement('a');
    a.className = 'ldet-att__pill';
    a.href = `/api/leaves/${leaveId}/attachment`;
    a.setAttribute('download', leave.attachment.name || 'attachment');
    a.rel = 'noopener';
    const badge = document.createElement('span');
    badge.className = 'ldet-att__badge';
    const name = leave.attachment.name || '';
    const ext = name.includes('.') ? name.split('.').pop() : 'file';
    badge.textContent = ext.slice(0, 4);
    const label = document.createElement('span');
    label.textContent = name || t('leave.fieldAttachment');
    a.append(badge, label);
    dd.appendChild(a);
  }

  // The card is shown if there's a file to display OR the viewer may add one.
  card.hidden = !leave.attachment && !canEdit;
  edit.hidden = !canEdit;
  if (removeBtn) removeBtn.hidden = !leave.attachment;
}

async function uploadAttachment() {
  const fileEl = $('att-file');
  const file = fileEl?.files?.[0];
  if (!file) { showMessage(messageEl, t('leave.attachmentPick'), 'error'); return; }
  if (file.size > 5 * 1024 * 1024) {
    showMessage(messageEl, t('leaveNew.attachmentTooLarge'), 'error');
    return;
  }
  showMessage(messageEl, '');
  const fd = new FormData();
  fd.append('file', file, file.name);
  try {
    const res = await fetch(`/api/leaves/${leaveId}/attachment`, {
      method: 'PUT', body: fd, credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      leave = data.leave;
      fileEl.value = '';
      render();
      showMessage(messageEl, t('leave.attachmentSaved'), 'success');
    } else {
      showMessage(messageEl, translateError(data.errorCode, data.error || t('leave.attachmentFailed')), 'error');
    }
  } catch {
    showMessage(messageEl, t('leave.attachmentFailed'), 'error');
  }
}

async function removeAttachment() {
  showMessage(messageEl, '');
  try {
    const res = await fetch(`/api/leaves/${leaveId}/attachment`, {
      method: 'DELETE', credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      leave = data.leave;
      render();
      showMessage(messageEl, t('leave.attachmentRemoved'), 'success');
    } else {
      showMessage(messageEl, translateError(data.errorCode, data.error || t('leave.attachmentFailed')), 'error');
    }
  } catch {
    showMessage(messageEl, t('leave.attachmentFailed'), 'error');
  }
}

function renderActions() {
  actionsEl.replaceChildren();
  const isOwner    = leave.employeeId === me.id;
  const isEmployer = me.role === 'employer';

  if (leave.status === 'pending' && isEmployer) {
    const approve = document.createElement('button');
    approve.className = 'btn-approve';
    approve.textContent = t('leave.actionApprove');
    approve.addEventListener('click', () => approveWithConcurrencyCheck());
    const reject = document.createElement('button');
    reject.className = 'btn-reject';
    reject.textContent = t('leave.actionReject');
    reject.addEventListener('click', () => { rejectDialog.hidden = false; });
    actionsEl.append(approve, reject);
  }

  if (leave.status === 'pending' && isOwner) {
    const cancel = document.createElement('button');
    cancel.className = 'btn-ghost';
    cancel.textContent = t('leave.cancelRequest');
    cancel.addEventListener('click', () => action('cancel'));
    actionsEl.appendChild(cancel);
  }

  if (leave.status === 'approved' && isEmployer) {
    const cancel = document.createElement('button');
    cancel.className = 'btn-ghost';
    cancel.textContent = t('leave.cancelApproved');
    cancel.addEventListener('click', () => {
      if (confirm(t('leave.cancelApprovedConfirm'))) action('cancel');
    });
    actionsEl.appendChild(cancel);
  }

  // Show the Actions card only when there is at least one action available.
  actionsCard.hidden = actionsEl.children.length === 0;
}

async function action(name, body = {}) {
  showMessage(messageEl, '');
  const res = await postJson(`/api/leaves/${leaveId}/${name}`, body);
  if (res.ok) {
    leave = res.data.leave;
    render();
    showMessage(messageEl, t('leave.actionDone', { status: t('status.' + leave.status) }), 'success');
  } else {
    showMessage(messageEl, res.data.error || t('leaves.actionFailed'), 'error');
  }
}

/**
 * Approve, but first check for overlapping approved leaves of OTHER employees.
 * If any exist and the org setting `concurrentAllowed` is false, confirm before
 * sending the approve POST.
 */
async function approveWithConcurrencyCheck() {
  showMessage(messageEl, '');
  let overlaps = [];
  let concurrentAllowed = true;
  try {
    const r = await fetch(`/api/leaves/${leaveId}/overlaps`, { credentials: 'same-origin' });
    if (r.ok) {
      const j = await r.json();
      overlaps = j.overlaps ?? [];
      concurrentAllowed = j.concurrentAllowed !== false;
    }
  } catch { /* non-fatal — skip the warning if unreachable */ }

  if (overlaps.length > 0 && !concurrentAllowed) {
    const names = overlaps.map((l) => l.fullName || l.username || t('rlm.someone')).join(', ');
    if (!confirm(t('leaves.concurrentConfirm', { n: overlaps.length, names }))) return;
  }

  await action('approve');
}

// -- Mini-calendar -----------------------------------------------------------

function renderMiniCal() {
  const host = $('mini-cal');
  host.replaceChildren();

  const startYmd = ymd(leave.start);
  const [y, m] = startYmd.split('-').map(Number);   // m: 1-12
  const locale = getLocale();

  const monthLabel = document.createElement('div');
  monthLabel.className = 'ldet-mini__month';
  monthLabel.textContent = new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  host.appendChild(monthLabel);

  const grid = document.createElement('div');
  grid.className = `ldet-mini__grid ldet-mini--${leave.type}`;

  // Weekday headers, Monday-first (2024-01-01 was a Monday).
  for (let i = 0; i < 7; i++) {
    const dn = new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(locale, { weekday: 'narrow' });
    const dow = document.createElement('div');
    dow.className = 'ldet-mini__dow';
    dow.textContent = dn;
    grid.appendChild(dow);
  }

  // In-range day set (this month only; spanning leaves highlight their portion).
  const inRange = new Set();
  if (leave.unit === 'hours') {
    inRange.add(ymd(leave.start));
  } else {
    let cur = parseYmd(leave.start);
    const end = parseYmd(leave.end);
    while (cur <= end) {
      const dt = new Date(cur);
      inRange.add(`${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`);
      cur += 86_400_000;
    }
  }

  const now = new Date();
  const todayYmd = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

  // Leading blanks (Monday-first).
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();   // 0=Sun
  const offset = (firstDow + 6) % 7;                              // Mon=0
  for (let i = 0; i < offset; i++) {
    const blank = document.createElement('div');
    blank.className = 'ldet-mini__cell ldet-mini__cell--muted';
    grid.appendChild(blank);
  }

  const daysInMonth = new Date(y, m, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const cellYmd = `${y}-${pad2(m)}-${pad2(d)}`;
    const cell = document.createElement('div');
    let cls = 'ldet-mini__cell';
    if (inRange.has(cellYmd)) cls += ' ldet-mini__cell--inrange';
    if (cellYmd === todayYmd) cls += ' ldet-mini__cell--today';
    cell.className = cls;
    cell.textContent = String(d);
    grid.appendChild(cell);
  }

  host.appendChild(grid);
}

// -- Activity timeline -------------------------------------------------------

function renderActivity() {
  const host = $('activity');
  host.replaceChildren();

  const items = [{ kind: 'requested', title: t('leave.evtRequested'), ts: leave.createdAt }];
  if (leave.status === 'approved') {
    items.push({ kind: 'approved', title: t('leave.evtApproved'), ts: leave.decidedAt });
  } else if (leave.status === 'rejected') {
    items.push({ kind: 'rejected', title: t('leave.evtRejected'), ts: leave.decidedAt, note: leave.notes });
  } else if (leave.status === 'cancelled') {
    items.push({ kind: 'cancelled', title: t('leave.evtCancelled'), ts: leave.cancelledAt });
  }

  const ul = document.createElement('ul');
  ul.className = 'ldet-time__list';
  for (const it of items) {
    const li = document.createElement('li');
    li.className = 'ldet-time__item';
    const dot = document.createElement('span');
    dot.className = `ldet-time__dot ldet-time__dot--${it.kind}`;
    const title = document.createElement('div');
    title.className = 'ldet-time__title';
    title.textContent = it.title;
    li.append(dot, title);
    if (it.ts) {
      const ts = document.createElement('div');
      ts.className = 'ldet-time__ts';
      ts.textContent = fmtDateTime(it.ts);
      li.appendChild(ts);
    }
    if (it.note) {
      const note = document.createElement('div');
      note.className = 'ldet-time__note';
      note.textContent = it.note;
      li.appendChild(note);
    }
    ul.appendChild(li);
  }
  host.appendChild(ul);
}

// -- Wiring ------------------------------------------------------------------

$('att-upload')?.addEventListener('click', uploadAttachment);
$('att-remove')?.addEventListener('click', removeAttachment);

$('reject-cancel').addEventListener('click', () => { rejectDialog.hidden = true; });
$('reject-confirm').addEventListener('click', async () => {
  const btn = $('reject-confirm');
  setBusy(btn, true, t('leaveNew.submitting'));
  await action('reject', { notes: $('reject-notes').value.trim() });
  rejectDialog.hidden = true;
  setBusy(btn, false);
});

(async () => {
  const [meRes, leaveRes] = await Promise.all([
    fetch('/api/me', { credentials: 'same-origin' }),
    fetch(`/api/leaves/${leaveId}`, { credentials: 'same-origin' }),
  ]);
  if (meRes.status === 401) { window.location.href = '/login'; return; }
  me = await meRes.json();

  if (leaveRes.status === 403) { showMessage(messageEl, t('leave.noAccess'), 'error'); return; }
  if (leaveRes.status === 404) { showMessage(messageEl, t('leave.notFound'), 'error'); return; }
  leave = (await leaveRes.json()).leave;
  render();
})();
