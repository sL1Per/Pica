// Pica — Leave detail modal (M15 follow-up).
//
// Opens a detail view for a single leave inside the generic modal shell,
// salvaging the render/decide logic from the standalone leave.js detail page.
// The standalone /leaves/:id deep-link page is preserved; this module is a
// sibling used wherever an in-page modal is more appropriate (the calendar
// pills + day-popover rows, the /leaves request lists, and the employee-detail
// upcoming-leaves pills).
//
// Public API:
//   import { openLeaveModal } from '/leave-detail-modal.js';
//   openLeaveModal({ id, me, onDone });
//
//   id     — leave id to fetch and show
//   me     — the viewer object ({id, role, …}) from /api/me
//   onDone — optional callback fired after a successful approve/reject/cancel
//            or an attachment change, so the caller can refresh its list
//
// The modal is a module-level singleton built lazily.  Per-open state
// (viewer, onDone, current leave) is stored in module-level vars — NOT via
// modal.onClose() — to avoid the additive callback accumulation that
// onClose() would cause across reopens (same convention as
// correction-detail-modal.js).
//
// No inline styles, no innerHTML with dynamic data. Conforms to the CSP
// constraints enforced by test-security-headers.mjs.

import { createModal } from '/modal.js';
import { postJson } from '/app.js';
import { t, tn, translateError, fmtDateTime, fmtHours, getLocale } from '/i18n.js';
import { monthMatrix } from '/calendar-grid.js';

// ---- Module-level singletons -----------------------------------------------

let modal = null;

// Per-open state. Reset at the start of each openLeaveModal() call.
let onDoneCb = null;   // caller's refresh callback
let viewer = null;     // { id, role, … } from /api/me
let current = null;    // the leave object currently displayed

const HERO_ICONS = { pending: '⏳', approved: '✓', rejected: '✕', cancelled: '—' };

// ---- Small helpers ---------------------------------------------------------

function pad2(n) { return String(n).padStart(2, '0'); }
function ymd(s) { return String(s).slice(0, 10); }
function parseYmd(s) { const [y, m, d] = String(s).split('-').map(Number); return Date.UTC(y, m - 1, d); }

// errorNode(status) — a <p class="ldm-error"> with a translated message.
// 404 → leave.notFound; anything else → leave.failedToLoad.
function errorNode(status) {
  const p = document.createElement('p');
  p.className = 'ldm-error';
  p.textContent = status === 404 ? t('leave.notFound')
    : (status === 403 ? t('leave.noAccess') : t('leave.failedToLoad'));
  return p;
}

// formatWhen / formatDuration — ported verbatim from leave.js so the modal
// reads the same as the page.
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

// addDlRow — appends a <dt>/<dd> pair to a <dl>. mono=true applies the
// monospace tabular-nums class to the value.
function addDlRow(dl, label, value, mono = false) {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  if (mono) dd.className = 'ldm-mono';
  dd.textContent = value;
  dl.appendChild(dt);
  dl.appendChild(dd);
}

function card(titleText) {
  const c = document.createElement('div');
  c.className = 'ldm-card';
  if (titleText) {
    const title = document.createElement('p');
    title.className = 'ldm-card__title';
    title.textContent = titleText;
    c.appendChild(title);
  }
  return c;
}

// ---- Body rendering --------------------------------------------------------

// Render the full detail into `body`, replacing whatever was there before.
// Called on initial load and again after every successful action so the
// status hero + actions update in-place.
function renderBody(body) {
  const l = current;
  const status = l.status;
  const cap = status.charAt(0).toUpperCase() + status.slice(1);

  // ---- Status hero ---------------------------------------------------------
  const hero = document.createElement('div');
  hero.className = `ldm-hero ldm-hero--${status}`;
  const iconEl = document.createElement('div');
  iconEl.className = 'ldm-hero__icon';
  iconEl.textContent = HERO_ICONS[status] || '';
  hero.appendChild(iconEl);
  const heroBody = document.createElement('div');
  heroBody.className = 'ldm-hero__body';
  const labelEl = document.createElement('p');
  labelEl.className = 'ldm-hero__label';
  labelEl.textContent = t('status.' + status);
  const blurbEl = document.createElement('p');
  blurbEl.className = 'ldm-hero__blurb';
  blurbEl.textContent = t('leave.hero' + cap);
  heroBody.append(labelEl, blurbEl);
  hero.appendChild(heroBody);

  // ---- Details card --------------------------------------------------------
  const details = card(t('leave.detailsHeading'));
  const dl = document.createElement('dl');
  dl.className = 'ldm-dl';
  addDlRow(dl, t('leave.fieldEmployee'), l.fullName || l.username || l.employeeId);
  addDlRow(dl, t('leave.fieldType'), t('leaves.type.' + l.type));
  addDlRow(dl, t('leave.fieldWhen'), formatWhen(l), true);
  addDlRow(dl, t('leave.fieldDuration'), formatDuration(l));
  addDlRow(dl, t('leave.fieldRequested'), fmtDateTime(l.createdAt), true);
  details.appendChild(dl);

  // ---- Reason card ---------------------------------------------------------
  const reason = card(t('leave.fieldReason'));
  const reasonEl = document.createElement('p');
  reasonEl.className = l.reason ? 'ldm-reason--filled' : 'ldm-reason--empty';
  reasonEl.textContent = l.reason || t('leave.reasonEmpty');
  reason.appendChild(reasonEl);

  // ---- Inline message placeholder (filled on action errors) ---------------
  const msgEl = document.createElement('p');
  msgEl.className = 'ldm-msg';
  msgEl.hidden = true;

  // ---- Attachment card (conditional) --------------------------------------
  const attachmentCard = renderAttachment(msgEl);

  // ---- Decision note (conditional) ----------------------------------------
  const decided = renderDecided();

  // ---- Actions card (conditional) -----------------------------------------
  const actionsCard = renderActions(msgEl);

  // ---- Mini-calendar + activity -------------------------------------------
  const miniCard = card(t('leave.inCalendar'));
  miniCard.appendChild(renderMiniCal());
  const activityCard = card(t('leave.activity'));
  activityCard.appendChild(renderActivity());

  // ---- Assemble ------------------------------------------------------------
  body.replaceChildren(
    hero, details, reason,
    ...(attachmentCard ? [attachmentCard] : []),
    ...(decided ? [decided] : []),
    msgEl,
    ...(actionsCard ? [actionsCard] : []),
    miniCard, activityCard,
  );
}

// renderAttachment — download pill (if a file is attached) plus an
// upload/remove sub-form when the viewer may edit (pending + owner|employer).
// Returns the card element, or null when there's nothing to show.
function renderAttachment(msgEl) {
  const l = current;
  const isOwner = l.employeeId === viewer.id;
  const isEmployer = viewer.role === 'employer';
  const canEdit = l.status === 'pending' && (isOwner || isEmployer);
  if (!l.attachment && !canEdit) return null;

  const c = card(t('leave.fieldAttachment'));

  if (l.attachment) {
    const a = document.createElement('a');
    a.className = 'ldm-att__pill';
    a.href = `/api/leaves/${encodeURIComponent(l.id)}/attachment`;
    a.setAttribute('download', l.attachment.name || 'attachment');
    a.rel = 'noopener';
    const badge = document.createElement('span');
    badge.className = 'ldm-att__badge';
    const name = l.attachment.name || '';
    const ext = name.includes('.') ? name.split('.').pop() : 'file';
    badge.textContent = ext.slice(0, 4);
    const label = document.createElement('span');
    label.textContent = name || t('leave.fieldAttachment');
    a.append(badge, label);
    c.appendChild(a);
  }

  if (canEdit) {
    const edit = document.createElement('div');
    edit.className = 'ldm-att-edit';
    const lab = document.createElement('label');
    lab.textContent = t('leave.attachmentChange');
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    const actions = document.createElement('div');
    actions.className = 'ldm-att-edit__actions';
    const upload = document.createElement('button');
    upload.type = 'button';
    upload.className = 'btn-ghost';
    upload.textContent = t('leave.attachmentUpload');
    upload.addEventListener('click', () => uploadAttachment(fileInput, msgEl));
    actions.appendChild(upload);
    if (l.attachment) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn-ghost';
      remove.textContent = t('leave.attachmentRemove');
      remove.addEventListener('click', () => removeAttachment(msgEl));
      actions.appendChild(remove);
    }
    edit.append(lab, fileInput, actions);
    c.appendChild(edit);
  }

  return c;
}

async function uploadAttachment(fileInput, msgEl) {
  const file = fileInput?.files?.[0];
  if (!file) { showMsg(msgEl, t('leave.attachmentPick')); return; }
  if (file.size > 5 * 1024 * 1024) { showMsg(msgEl, t('leaveNew.attachmentTooLarge')); return; }
  const fd = new FormData();
  fd.append('file', file, file.name);
  try {
    const res = await fetch(`/api/leaves/${encodeURIComponent(current.id)}/attachment`, {
      method: 'PUT', body: fd, credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      current = data.leave;
      renderBody(modal.body);
      fireDone();
    } else {
      showMsg(msgEl, translateError(data.errorCode, data.error || t('leave.attachmentFailed')));
    }
  } catch {
    showMsg(msgEl, t('leave.attachmentFailed'));
  }
}

async function removeAttachment(msgEl) {
  try {
    const res = await fetch(`/api/leaves/${encodeURIComponent(current.id)}/attachment`, {
      method: 'DELETE', credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      current = data.leave;
      renderBody(modal.body);
      fireDone();
    } else {
      showMsg(msgEl, translateError(data.errorCode, data.error || t('leave.attachmentFailed')));
    }
  } catch {
    showMsg(msgEl, t('leave.attachmentFailed'));
  }
}

// renderDecided — the "Approved/Rejected/Cancelled {date}" note (+ reject
// notes), or null while the leave is still pending.
function renderDecided() {
  const l = current;
  if (l.status === 'pending') return null;
  const c = document.createElement('div');
  c.className = 'ldm-card ldm-decided';
  const label = document.createElement('div');
  label.className = 'ldm-decided__label';
  const notes = document.createElement('div');
  notes.className = 'ldm-decided__notes';
  if (l.status === 'approved') {
    label.textContent = t('leave.decidedApproved', { date: fmtDateTime(l.decidedAt) });
  } else if (l.status === 'rejected') {
    label.textContent = t('leave.decidedRejected', { date: fmtDateTime(l.decidedAt) });
    notes.textContent = l.notes || '';
  } else if (l.status === 'cancelled') {
    label.textContent = t('leave.decidedCancelled', { date: fmtDateTime(l.cancelledAt) });
  }
  c.append(label, notes);
  return c;
}

// renderActions — builds the actions card if any action is applicable.
// Returns the card element or null. msgEl receives action errors.
function renderActions(msgEl) {
  const l = current;
  const isOwner = l.employeeId === viewer.id;
  const isEmployer = viewer.role === 'employer';

  const hasApprove = l.status === 'pending' && isEmployer;
  const hasOwnerCancel = l.status === 'pending' && isOwner;
  const hasCancelApproved = l.status === 'approved' && isEmployer;
  if (!hasApprove && !hasOwnerCancel && !hasCancelApproved) return null;

  const c = card(t('leave.actionsHeading'));
  const row = document.createElement('div');
  row.className = 'ldm-actions';

  if (hasApprove) {
    const approve = document.createElement('button');
    approve.type = 'button';
    approve.className = 'btn-approve';
    approve.textContent = t('leave.actionApprove');
    approve.addEventListener('click', () => approveWithConcurrencyCheck(msgEl));
    row.appendChild(approve);
    row.appendChild(buildRejectInline(msgEl));
  }

  if (hasOwnerCancel) {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn-ghost';
    cancel.textContent = t('leave.cancelRequest');
    cancel.addEventListener('click', () => {
      if (confirm(t('leave.confirmCancel'))) decide('cancel', {}, msgEl);
    });
    row.appendChild(cancel);
  }

  if (hasCancelApproved) {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn-ghost';
    cancel.textContent = t('leave.cancelApproved');
    cancel.addEventListener('click', () => {
      if (confirm(t('leave.cancelApprovedConfirm'))) decide('cancel', {}, msgEl);
    });
    row.appendChild(cancel);
  }

  c.appendChild(row);
  return c;
}

// buildRejectInline — Reject button + collapsible notes sub-form, mirroring
// the correction modal: clicking Reject reveals an optional notes input + a
// confirm button.
function buildRejectInline(msgEl) {
  const wrap = document.createElement('div');
  wrap.className = 'ldm-reject-wrap';

  const rejectBtn = document.createElement('button');
  rejectBtn.type = 'button';
  rejectBtn.className = 'btn-reject';
  rejectBtn.textContent = t('leave.actionReject');

  const subForm = document.createElement('div');
  subForm.className = 'ldm-reject-sub';
  subForm.hidden = true;

  const notesInput = document.createElement('input');
  notesInput.type = 'text';
  notesInput.className = 'ldm-reject-notes';
  notesInput.maxLength = 500;
  notesInput.placeholder = t('leave.rejectPlaceholder');

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'btn-reject';
  confirmBtn.textContent = t('leave.actionReject');

  const cancelSubBtn = document.createElement('button');
  cancelSubBtn.type = 'button';
  cancelSubBtn.className = 'btn-ghost';
  cancelSubBtn.textContent = t('leave.cancelButton');

  subForm.append(notesInput, confirmBtn, cancelSubBtn);

  rejectBtn.addEventListener('click', () => {
    rejectBtn.hidden = true;
    subForm.hidden = false;
    notesInput.focus();
  });
  cancelSubBtn.addEventListener('click', () => {
    notesInput.value = '';
    subForm.hidden = true;
    rejectBtn.hidden = false;
  });
  confirmBtn.addEventListener('click', () => {
    const notes = notesInput.value.trim();
    decide('reject', notes ? { notes } : {}, msgEl);
  });

  wrap.append(rejectBtn, subForm);
  return wrap;
}

/**
 * Approve, but first check for overlapping approved leaves of OTHER employees.
 * If any exist and the org setting `concurrentAllowed` is false, confirm before
 * sending the approve POST. (Ported from leave.js.)
 */
async function approveWithConcurrencyCheck(msgEl) {
  let overlaps = [];
  let concurrentAllowed = true;
  try {
    const r = await fetch(`/api/leaves/${encodeURIComponent(current.id)}/overlaps`, { credentials: 'same-origin' });
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

  decide('approve', {}, msgEl);
}

// decide — POST to a decide endpoint, update `current`, re-render, fire onDone.
// On failure, render a translated error inline (no page-level showMessage —
// we're inside a modal).
async function decide(name, body, msgEl) {
  const buttons = modal.body.querySelectorAll('button');
  for (const btn of buttons) btn.disabled = true;

  const result = await postJson(`/api/leaves/${encodeURIComponent(current.id)}/${name}`, body);

  if (result.ok) {
    current = result.data.leave;
    renderBody(modal.body);
    fireDone();
  } else {
    for (const btn of buttons) btn.disabled = false;
    showMsg(msgEl, result.data?.error
      ? translateError(result.data.errorCode, result.data.error)
      : t('leaves.actionFailed'));
  }
}

// ---- Mini-calendar (ported from leave.js) ----------------------------------

function renderMiniCal() {
  const host = document.createElement('div');
  const l = current;
  const startYmd = ymd(l.start);
  const [y, m] = startYmd.split('-').map(Number);   // m: 1-12
  const locale = getLocale();

  const monthLabel = document.createElement('div');
  monthLabel.className = 'ldm-mini__month';
  monthLabel.textContent = new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  host.appendChild(monthLabel);

  const grid = document.createElement('div');
  grid.className = `ldm-mini__grid ldm-mini--${l.type}`;

  for (let i = 0; i < 7; i++) {
    const dn = new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(locale, { weekday: 'narrow' });
    const dow = document.createElement('div');
    dow.className = 'ldm-mini__dow';
    dow.textContent = dn;
    grid.appendChild(dow);
  }

  const inRange = new Set();
  if (l.unit === 'hours') {
    inRange.add(ymd(l.start));
  } else {
    let cur = parseYmd(l.start);
    const end = parseYmd(l.end);
    while (cur <= end) {
      const dt = new Date(cur);
      inRange.add(`${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`);
      cur += 86_400_000;
    }
  }

  for (const cell of monthMatrix(y, m - 1)) {
    const c = document.createElement('div');
    let cls = 'ldm-mini__cell';
    if (!cell.inMonth) cls += ' ldm-mini__cell--muted';
    if (cell.inMonth && inRange.has(cell.ymd)) cls += ' ldm-mini__cell--inrange';
    if (cell.isToday) cls += ' ldm-mini__cell--today';
    c.className = cls;
    c.textContent = cell.inMonth ? String(cell.date.getDate()) : '';
    grid.appendChild(c);
  }

  host.appendChild(grid);
  return host;
}

// ---- Activity timeline (ported from leave.js) ------------------------------

function renderActivity() {
  const l = current;
  const items = [{ kind: 'requested', title: t('leave.evtRequested'), ts: l.createdAt }];
  if (l.status === 'approved') {
    items.push({ kind: 'approved', title: t('leave.evtApproved'), ts: l.decidedAt });
  } else if (l.status === 'rejected') {
    items.push({ kind: 'rejected', title: t('leave.evtRejected'), ts: l.decidedAt, note: l.notes });
  } else if (l.status === 'cancelled') {
    items.push({ kind: 'cancelled', title: t('leave.evtCancelled'), ts: l.cancelledAt });
  }

  const ul = document.createElement('ul');
  ul.className = 'ldm-time__list';
  for (const it of items) {
    const li = document.createElement('li');
    li.className = 'ldm-time__item';
    const dot = document.createElement('span');
    dot.className = `ldm-time__dot ldm-time__dot--${it.kind}`;
    const title = document.createElement('div');
    title.className = 'ldm-time__title';
    title.textContent = it.title;
    li.append(dot, title);
    if (it.ts) {
      const ts = document.createElement('div');
      ts.className = 'ldm-time__ts';
      ts.textContent = fmtDateTime(it.ts);
      li.appendChild(ts);
    }
    if (it.note) {
      const note = document.createElement('div');
      note.className = 'ldm-time__note';
      note.textContent = it.note;
      li.appendChild(note);
    }
    ul.appendChild(li);
  }
  return ul;
}

// ---- Shared inline-message + callback helpers ------------------------------

function showMsg(msgEl, text) {
  msgEl.textContent = text;
  msgEl.className = 'ldm-msg ldm-msg--error';
  msgEl.hidden = false;
}

function fireDone() {
  try { onDoneCb?.(); } catch (_) { /* best-effort */ }
}

// ---- Public API ------------------------------------------------------------

/**
 * Open the leave detail modal.
 *
 * @param {object} opts
 * @param {string}   opts.id      Leave ID to fetch and display.
 * @param {object}   opts.me      Viewer object from /api/me ({id, role, …}).
 * @param {Function} [opts.onDone] Called after a successful action/edit.
 */
export async function openLeaveModal({ id, me, onDone }) {
  viewer = me;
  onDoneCb = onDone || null;

  if (!modal) modal = createModal({ titleKey: 'leave.modalTitle', className: 'ldm' });
  modal.open();

  const body = modal.body;
  const loading = document.createElement('p');
  loading.className = 'ldm-loading';
  loading.textContent = t('punch.loading');
  body.replaceChildren(loading);

  try {
    const res = await fetch(`/api/leaves/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
    if (!res.ok) { body.replaceChildren(errorNode(res.status)); return; }
    current = (await res.json()).leave;
    renderBody(body);
  } catch {
    body.replaceChildren(errorNode(0));
  }
}
