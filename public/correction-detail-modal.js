// Pica — Correction detail modal (M15).
//
// Opens a detail view for a single correction inside the generic modal shell,
// salvaging the render/decide logic from the standalone correction.js detail
// page.  The standalone /corrections/:id deep-link page is preserved; this
// module is a sibling used wherever an in-page modal is more appropriate
// (e.g. the Corrections tab inside the punch page).
//
// Public API:
//   import { openCorrectionModal } from '/correction-detail-modal.js';
//   openCorrectionModal({ id, me, onDecided });
//
//   id        — correction id to fetch and show
//   me        — the viewer object ({id, role, …}) from /api/me
//   onDecided — optional callback fired after a successful approve/reject/cancel
//               so the caller can refresh its list
//
// The modal is a module-level singleton built lazily.  Per-open state
// (viewer, onDecided, current correction) is stored in module-level vars —
// NOT via modal.onClose() — to avoid the additive callback accumulation that
// onClose() would cause across reopens.
//
// No inline styles, no innerHTML with dynamic data. Conforms to the CSP
// constraints enforced by test-security-headers.mjs.

import { createModal } from '/modal.js';
import { postJson } from '/app.js';
import { t, translateError, fmtDateTime, fmtHours } from '/i18n.js';

// ---- Module-level singletons -----------------------------------------------

let modal = null;

// Per-open state. Reset at the start of each openCorrectionModal() call.
let onDecidedCb = null;   // caller's refresh callback
let viewer = null;        // { id, role, … } from /api/me
let current = null;       // the correction object currently displayed

// ---- Helpers ---------------------------------------------------------------

// tSoft(key) — like t(key) but returns '' for keys absent from the active
// locale instead of the '[key]' placeholder that t() returns.  Used for
// hero blurb keys so the hero renders gracefully if a locale is incomplete.
function tSoft(key) {
  const v = t(key);
  return v === `[${key}]` ? '' : v;
}

// Status icon glyphs — pure text characters, no SVG, no inline style.
const HERO_ICONS = {
  pending:   '⏳',
  approved:  '✓',
  rejected:  '✕',
  cancelled: '—',
};

// errorNode(status) — a <p class="cdm-error"> with a translated message.
// 404 → correction.notFound; anything else → correction.couldNotLoad.
function errorNode(status) {
  const p = document.createElement('p');
  p.className = 'cdm-error';
  p.textContent = status === 404 ? t('correction.notFound') : t('correction.couldNotLoad');
  return p;
}

// ---- Body rendering --------------------------------------------------------

// Render the full detail into `body`, replacing whatever was there before.
// Called on initial load and again after every successful decide action so
// the status hero + actions update in-place.
function renderBody(body) {
  const c = current;
  const status = c.status;

  // Capitalise first letter for hero key construction (pending → Pending).
  const cap = status.charAt(0).toUpperCase() + status.slice(1);

  // ---- Status hero ---------------------------------------------------------

  const hero = document.createElement('div');
  hero.className = `cdm-hero cdm-hero--${status}`;

  const iconEl = document.createElement('div');
  iconEl.className = 'cdm-hero__icon';
  iconEl.textContent = HERO_ICONS[status] || '';
  hero.appendChild(iconEl);

  const heroBody = document.createElement('div');
  heroBody.className = 'cdm-hero__body';

  const labelEl = document.createElement('p');
  labelEl.className = 'cdm-hero__label';
  // Prefer the correction.heroXxx key; fall back to the generic status.xxx key.
  labelEl.textContent = tSoft('correction.hero' + cap) || t('status.' + status);
  heroBody.appendChild(labelEl);

  const blurbEl = document.createElement('p');
  blurbEl.className = 'cdm-hero__blurb';
  blurbEl.textContent = tSoft('correction.hero' + cap + 'Blurb');
  heroBody.appendChild(blurbEl);

  hero.appendChild(heroBody);

  // ---- Details card --------------------------------------------------------

  const card = document.createElement('div');
  card.className = 'cdm-card';

  const cardTitle = document.createElement('p');
  cardTitle.className = 'cdm-card__title';
  cardTitle.textContent = t('correction.cardDetails');
  card.appendChild(cardTitle);

  const dl = document.createElement('dl');
  dl.className = 'cdm-fields';

  // Employee
  addDlRow(dl, t('correction.fieldEmployee'),
    c.fullName || c.username || c.employeeId);

  // Time fields — which rows appear depends on kind.
  if (c.kind === 'both') {
    addDlRow(dl, t('correction.fieldArrived'), fmtDateTime(c.start), true);
    addDlRow(dl, t('correction.fieldLeft'),    fmtDateTime(c.end),   true);
    addDlRow(dl, t('correction.fieldDuration'), fmtHours(c.hours),   true);
  } else if (c.kind === 'in') {
    addDlRow(dl, t('correction.fieldArrived'), fmtDateTime(c.start), true);
  } else if (c.kind === 'out') {
    addDlRow(dl, t('correction.fieldLeft'),    fmtDateTime(c.end),   true);
  }

  // Filed at
  addDlRow(dl, t('correction.fieldFiled'), fmtDateTime(c.createdAt));

  // Decision date (only when decided)
  if (c.decidedAt) {
    addDlRow(dl, t('correction.fieldDecision'),
      t('status.' + status) + ' · ' + fmtDateTime(c.decidedAt));
  }

  card.appendChild(dl);

  // ---- Reason / Justification card ----------------------------------------

  const reasonCard = document.createElement('div');
  reasonCard.className = 'cdm-card';

  const reasonTitle = document.createElement('p');
  reasonTitle.className = 'cdm-card__title';
  reasonTitle.textContent = t('correction.fieldJustification');
  reasonCard.appendChild(reasonTitle);

  const justEl = document.createElement('p');
  justEl.className = c.justification ? 'cdm-reason--filled' : 'cdm-reason--empty';
  justEl.textContent = c.justification || t('correction.fieldJustificationNone');
  reasonCard.appendChild(justEl);

  // Notes from employer (only when present)
  if (c.notes) {
    const notesDt = document.createElement('p');
    notesDt.className = 'cdm-card__title cdm-card__title--notes';
    notesDt.textContent = t('correction.fieldNotes');
    reasonCard.appendChild(notesDt);

    const notesEl = document.createElement('p');
    notesEl.className = 'cdm-notes';
    notesEl.textContent = c.notes;
    reasonCard.appendChild(notesEl);
  }

  // ---- Inline message placeholder (filled on decide errors) ---------------

  const msgEl = document.createElement('p');
  msgEl.className = 'cdm-msg';
  // Hidden until an error occurs — use [hidden] per project convention.
  msgEl.hidden = true;

  // ---- Actions card --------------------------------------------------------

  // renderActions returns either a <div class="cdm-actions-card"> element or
  // null when there are no applicable actions.
  const actionsCard = renderActions(msgEl);

  // ---- Assemble -----------------------------------------------------------

  body.replaceChildren(hero, card, reasonCard, msgEl, ...(actionsCard ? [actionsCard] : []));
}

// addDlRow — appends a <dt>/<dd> pair to a <dl>.
// mono=true applies the monospace tabular-nums class to the value.
function addDlRow(dl, label, value, mono = false) {
  const dt = document.createElement('dt');
  dt.textContent = label;

  const dd = document.createElement('dd');
  if (mono) dd.className = 'cdm-mono';
  dd.textContent = value;

  dl.appendChild(dt);
  dl.appendChild(dd);
}

// renderActions — builds the actions card if any action is applicable.
// Returns the card element (to be appended by renderBody) or null.
// msgEl is passed in so decide() can write errors into it.
function renderActions(msgEl) {
  if (!viewer) return null;

  const c = current;
  const isEmployer = viewer.role === 'employer';
  const isOwner    = c.employeeId === viewer.id;

  const hasApprove = c.status === 'pending' && isEmployer;
  const hasOwnerCancel = c.status === 'pending' && isOwner && !isEmployer;
  const hasReverse = c.status === 'approved' && isEmployer;

  // No applicable actions → return null so the card is omitted entirely.
  if (!hasApprove && !hasOwnerCancel && !hasReverse) return null;

  const actionsCard = document.createElement('div');
  actionsCard.className = 'cdm-card cdm-actions-card';

  const cardTitle = document.createElement('p');
  cardTitle.className = 'cdm-card__title';
  cardTitle.textContent = t('correction.cardActions');
  actionsCard.appendChild(cardTitle);

  const actionsRow = document.createElement('div');
  actionsRow.className = 'cdm-actions';

  if (hasApprove) {
    // Approve button — kind/justified-dependent confirm string.
    const approve = document.createElement('button');
    approve.type = 'button';
    approve.className = 'btn-approve';
    approve.textContent = t('correction.actionApprove');
    approve.addEventListener('click', () => {
      let msg;
      if (c.kind === 'in') {
        msg = t('correction.confirmApproveIn', { time: fmtDateTime(c.start) });
      } else if (c.kind === 'out') {
        msg = t('correction.confirmApproveOut', { time: fmtDateTime(c.end) });
      } else if (c.isJustified) {
        msg = t('correction.confirmApproveBoth');
      } else {
        msg = t('correction.confirmApproveBothUnjust', { hours: fmtHours(c.hours) });
      }
      if (confirm(msg)) decide('approve', {}, msgEl);
    });
    actionsRow.appendChild(approve);

    // Reject button — opens an inline notes sub-form.
    const rejectWrap = buildRejectInline(actionsRow, msgEl);
    actionsRow.appendChild(rejectWrap);
  }

  if (hasOwnerCancel) {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn-ghost';
    cancel.textContent = t('correction.actionCancel');
    cancel.addEventListener('click', () => {
      if (confirm(t('correction.confirmCancel'))) decide('cancel', {}, msgEl);
    });
    actionsRow.appendChild(cancel);
  }

  if (hasReverse) {
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'btn-ghost';
    undo.textContent = t('correction.actionReverse');
    undo.addEventListener('click', () => {
      if (confirm(t('correction.confirmReverse'))) decide('cancel', {}, msgEl);
    });
    actionsRow.appendChild(undo);
  }

  actionsCard.appendChild(actionsRow);
  return actionsCard;
}

// buildRejectInline — builds the Reject button + collapsible notes sub-form.
// When the Reject button is clicked, a small inline notes input + confirm
// button appear; the user may optionally type a reason before confirming.
// Returns the wrapper <div> to be appended into the actions row.
function buildRejectInline(actionsRow, msgEl) {
  // Wrapper that groups the Reject trigger + the expanded sub-form.
  const wrap = document.createElement('div');
  wrap.className = 'cdm-reject-wrap';

  const rejectBtn = document.createElement('button');
  rejectBtn.type = 'button';
  rejectBtn.className = 'btn-reject';
  rejectBtn.textContent = t('correction.actionReject');

  // Sub-form (initially hidden).
  const subForm = document.createElement('div');
  subForm.className = 'cdm-reject-sub';
  subForm.hidden = true;

  const notesInput = document.createElement('input');
  notesInput.type = 'text';
  notesInput.className = 'cdm-reject-notes';
  notesInput.maxLength = 500;
  notesInput.placeholder = t('correction.rejectPlaceholder');

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'btn-reject';
  confirmBtn.textContent = t('correction.actionReject');

  const cancelSubBtn = document.createElement('button');
  cancelSubBtn.type = 'button';
  cancelSubBtn.className = 'btn-ghost';
  cancelSubBtn.textContent = t('correctionNew.cancel');

  subForm.appendChild(notesInput);
  subForm.appendChild(confirmBtn);
  subForm.appendChild(cancelSubBtn);

  // Show the sub-form when the top Reject button is clicked; hide the button.
  rejectBtn.addEventListener('click', () => {
    rejectBtn.hidden = true;
    subForm.hidden = false;
    notesInput.focus();
  });

  // Cancel the sub-form — restore original state.
  cancelSubBtn.addEventListener('click', () => {
    notesInput.value = '';
    subForm.hidden = true;
    rejectBtn.hidden = false;
  });

  // Confirm rejection.
  confirmBtn.addEventListener('click', () => {
    const notes = notesInput.value.trim() || undefined;
    decide('reject', notes ? { notes } : {}, msgEl);
  });

  wrap.appendChild(rejectBtn);
  wrap.appendChild(subForm);
  return wrap;
}

// decide — sends a POST to the decide endpoint, updates `current`, and
// re-renders the body.  On failure, renders a translated error into msgEl
// rather than using showMessage (which targets a page-level element) since
// we're inside a modal.
async function decide(name, body, msgEl) {
  // Disable all action buttons while the request is in flight.
  const buttons = modal.body.querySelectorAll('button');
  for (const btn of buttons) btn.disabled = true;

  const result = await postJson(`/api/corrections/${encodeURIComponent(current.id)}/${name}`, body);

  if (result.ok) {
    current = result.data.correction;
    renderBody(modal.body);
    // Fire the caller's refresh callback so the corrections list updates.
    try { onDecidedCb?.(); } catch (_) { /* best-effort */ }
  } else {
    // Re-enable buttons on failure so the user can retry.
    for (const btn of buttons) btn.disabled = false;
    // Show the error inline inside the modal.
    msgEl.textContent = translateError(result.data.errorCode,
      result.data.error || t('correction.couldNotLoad'));
    msgEl.className = 'cdm-msg cdm-msg--error';
    msgEl.hidden = false;
  }
}

// ---- Public API ------------------------------------------------------------

/**
 * Open the correction detail modal.
 *
 * @param {object} opts
 * @param {string}   opts.id         Correction ID to fetch and display.
 * @param {object}   opts.me         Viewer object from /api/me ({id, role, …}).
 * @param {Function} [opts.onDecided] Called after a successful decide action.
 */
export async function openCorrectionModal({ id, me, onDecided }) {
  viewer     = me;
  onDecidedCb = onDecided || null;

  // Build the singleton modal shell lazily on first call.
  if (!modal) modal = createModal({ titleKey: 'correction.modalTitle', className: 'cdm' });

  modal.open();

  const body = modal.body;

  // Show a loading placeholder while the API call is in flight.
  const loading = document.createElement('p');
  loading.className = 'cdm-loading';
  loading.textContent = t('punch.loading');
  body.replaceChildren(loading);

  try {
    const res = await fetch(`/api/corrections/${encodeURIComponent(id)}`, {
      credentials: 'same-origin',
    });
    if (!res.ok) {
      body.replaceChildren(errorNode(res.status));
      return;
    }
    current = (await res.json()).correction;
    renderBody(body);
  } catch {
    body.replaceChildren(errorNode(0));
  }
}
