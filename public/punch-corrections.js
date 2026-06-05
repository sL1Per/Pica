// Pica — Corrections tab panel module (M15).
//
// Owns the Corrections panel that lives inside the /punch page tabs.
// Salvaged from public/corrections.js (the standalone list page) and
// adapted so it renders into caller-supplied container elements rather
// than fixed DOM ids.
//
// Public API:
//   import { initCorrectionsPanel } from '/punch-corrections.js';
//   const { reload } = initCorrectionsPanel({
//     me, pendingList, historyList, pendingTag, listHeading,
//     messageEl, onCountChange,
//   });
//
// Row clicks open the correction detail modal (correction-detail-modal.js).
// The real <a href="/corrections/:id"> is preserved as a fallback so
// middle-click / open-in-new-tab still lands on the standalone detail page.
//
// No inline styles, no innerHTML with dynamic data. Conforms to the CSP
// constraints enforced by test-security-headers.mjs.

import { postJson, showMessage } from '/app.js';
import { t, translateError, fmtDateTime, fmtHours } from '/i18n.js';
import { openCorrectionModal } from '/correction-detail-modal.js';
import { capView, appendShowAll, LIST_CAP } from '/list-cap.js';

// -------- Avatar helpers (match the team list / Today tab) -------------------
function initials(name) { return (String(name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('')) || '?'; }
function hue(s) { let h = 0; for (const ch of String(s || '')) h = (h + ch.charCodeAt(0)) % 360; return h; }

/**
 * Round avatar for one person. The uploaded picture ALWAYS takes priority when
 * it exists: hue-tinted initials paint immediately (no broken-image flash) and
 * the picture loads in the background, replacing the initials on success or
 * leaving them in place on error (no picture on disk).
 */
function buildAvatar(id, name) {
  const a = document.createElement('div');
  a.className = 'corr-row__av';
  a.style.setProperty('--hue', hue(name));
  a.textContent = initials(name);
  if (id) {
    const img = new Image();
    img.alt = '';
    img.addEventListener('load', () => { a.textContent = ''; a.appendChild(img); });
    img.src = `/api/employees/${encodeURIComponent(id)}/picture`;
  }
  return a;
}

/**
 * Initialize the Corrections tab panel.
 *
 * @param {object} opts
 *   me            — viewer { id, role } (employer sees everyone + inline ✓/✗;
 *                   employee sees own list only)
 *   pendingList   — <ul> element for pending rows
 *   historyList   — <ul> element for decided rows
 *   pendingTag    — <span> element for "N waiting on you" (employer only; may be null)
 *   listHeading   — <h2> heading element to relabel for employer (optional; null-safe)
 *   messageEl     — element for error messages (page-level, above the lists)
 *   onCountChange — (pendingCount: number) => void, called after each render
 *   onRendered    — () => void, called after each render (optional; lets the
 *                   caller re-apply transient DOM state such as a search filter)
 *
 * @returns {{ reload: () => Promise<void> }}
 */
export function initCorrectionsPanel(opts) {
  const { me, pendingList, historyList, pendingTag, listHeading, messageEl, onCountChange, onRendered } = opts;

  let historyExpanded = false;   // corrections history "Show all"

  // -------- Row builder -------------------------------------------------------

  function buildRow(c) {
    const li = document.createElement('li');
    li.className = `corr-row corr-row--${c.status}`;
    // Tag with the employee id so the Corrections person-picker on /punch can
    // filter to one person (the picker matches li.dataset.empId).
    if (c.employeeId) li.dataset.empId = c.employeeId;

    // Accent bar — absolutely positioned on the left edge of the card.
    // Decorative; lives OUTSIDE the <a> so it doesn't affect link hit area.
    const accent = document.createElement('div');
    accent.className = 'corr-row__accent';
    accent.setAttribute('aria-hidden', 'true');
    li.appendChild(accent);

    // Real anchor — the navigable area. Carries the main content and the aside
    // (hours/status). A real <a href> preserves keyboard focus, Enter-to-open,
    // middle-click/open-in-new-tab, and screen-reader link semantics.
    // Click is intercepted to open the detail modal instead of navigating;
    // middle-click / right-click → open-in-tab → standalone /corrections/:id.
    const link = document.createElement('a');
    link.className = 'corr-row__link';
    link.href = `/corrections/${c.id}`;
    link.addEventListener('click', (e) => {
      // Only intercept plain left-clicks (not middle, ctrl, meta).
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      openCorrectionModal({ id: c.id, me, onDecided: reload });
    });
    li.appendChild(link);

    // Left column: avatar (employer only) + main content. The avatar sits
    // beside the text — matching the Today tab and team list — so the employer
    // can recognise the requester at a glance.
    const left = document.createElement('div');
    left.className = 'corr-row__left';

    // Main content column.
    const main = document.createElement('div');
    main.className = 'corr-row__main';

    // Who — only shown for the employer (employee sees their own list only).
    if (me.role === 'employer' && (c.fullName || c.username)) {
      left.appendChild(buildAvatar(c.employeeId, c.fullName || c.username));
      const who = document.createElement('div');
      who.className = 'corr-row__who';
      who.textContent = c.fullName || c.username;
      main.appendChild(who);
    }

    // When — mono date/time string; content depends on correction kind.
    const when = document.createElement('div');
    when.className = 'corr-row__when';
    if (c.kind === 'both') {
      when.textContent = `${fmtDateTime(c.start)} → ${fmtDateTime(c.end)}`;
    } else if (c.kind === 'in') {
      when.textContent = t('corrections.arrived', { time: fmtDateTime(c.start) });
    } else {
      when.textContent = t('corrections.left', { time: fmtDateTime(c.end) });
    }
    main.appendChild(when);

    // Chips row: kind + status pill + justification indicator.
    const chips = document.createElement('div');
    chips.className = 'corr-row__chips';

    const kindChipMap = {
      both: t('corrections.kindBoth'),
      in:   t('corrections.kindIn'),
      out:  t('corrections.kindOut'),
    };
    const kindChip = document.createElement('span');
    kindChip.className = 'corr-chip corr-chip--kind';
    kindChip.textContent = kindChipMap[c.kind] ?? c.kind;
    chips.appendChild(kindChip);

    const statusPill = document.createElement('span');
    statusPill.className = `corr-status corr-status--${c.status}`;
    statusPill.textContent = t('status.' + c.status);
    chips.appendChild(statusPill);

    const justChip = document.createElement('span');
    justChip.className = c.isJustified ? 'corr-chip corr-chip--ok' : 'corr-chip corr-chip--warn';
    justChip.textContent = c.isJustified ? t('corrections.justified') : t('corrections.noJustification');
    chips.appendChild(justChip);

    main.appendChild(chips);
    left.appendChild(main);
    link.appendChild(left);

    // Aside: hours display goes inside the link; inline actions are a sibling.
    const hoursEl = document.createElement('div');
    hoursEl.className = 'corr-row__hours';
    if (c.kind === 'both') {
      hoursEl.textContent = fmtHours(c.hours);
    } else if (c.kind === 'in') {
      hoursEl.textContent = t('corrections.kindIn');
    } else {
      hoursEl.textContent = t('corrections.kindOut');
    }
    link.appendChild(hoursEl);

    // Employer inline approve/reject actions — sibling of the <a>, NOT inside it
    // (buttons inside an anchor is invalid HTML). stopPropagation prevents the
    // click from bubbling up to the row's link click handler.
    if (me.role === 'employer' && c.status === 'pending') {
      li.appendChild(buildInlineActions(c));
    }

    return li;
  }

  // -------- Inline employer approve / reject ----------------------------------

  function buildInlineActions(c) {
    // Wrapper that holds the approve/reject buttons AND the optional inline
    // reject-notes form. Both sit in the aside column of the pending row.
    const wrapper = document.createElement('div');

    const actions = document.createElement('div');
    actions.className = 'corr-actions';

    // Approve button — ✓ icon.
    const approveBtn = document.createElement('button');
    approveBtn.type = 'button';
    approveBtn.className = 'corr-act corr-act--approve';
    approveBtn.setAttribute('aria-label', t('corrections.inlineApprove'));
    approveBtn.textContent = '✓';
    approveBtn.addEventListener('click', (e) => {
      e.stopPropagation();   // prevent the click from bubbling into the <a> link
      handleInlineApprove(c, approveBtn, rejectBtn);
    });

    // Reject button — ✗ icon.
    const rejectBtn = document.createElement('button');
    rejectBtn.type = 'button';
    rejectBtn.className = 'corr-act corr-act--reject';
    rejectBtn.setAttribute('aria-label', t('corrections.inlineReject'));
    rejectBtn.textContent = '✗';
    rejectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      notesForm.hidden = !notesForm.hidden;
    });

    actions.appendChild(approveBtn);
    actions.appendChild(rejectBtn);
    wrapper.appendChild(actions);

    // Inline reject-notes form — hidden until the ✗ button is clicked.
    // Toggle is done via the `hidden` attribute (never display:none inline).
    const notesForm = buildRejectForm(c, actions);
    notesForm.hidden = true;
    notesForm.addEventListener('click', (e) => e.stopPropagation());
    wrapper.appendChild(notesForm);

    return wrapper;
  }

  function buildRejectForm(c, actionsEl) {
    // A small form that sits below the action buttons when the ✗ is clicked.
    // Clicking inside it stops propagation so it doesn't fire row navigation.
    const form = document.createElement('div');

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = t('corrections.rejectNotesPlaceholder');
    input.maxLength = 500;
    form.appendChild(input);

    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'btn-reject';
    submitBtn.textContent = t('corrections.inlineReject');
    submitBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      // Disable the form controls for the duration of the request to prevent
      // double-submit. Mirror the approve path's in-flight guarding on actionsEl.
      submitBtn.disabled = true;
      input.disabled = true;
      await handleInlineReject(c, input.value.trim() || undefined, actionsEl, submitBtn, input);
    });
    form.appendChild(submitBtn);

    return form;
  }

  // Approve flow — mirrors correction.js's confirm logic exactly.
  async function handleInlineApprove(c, approveBtn, rejectBtn) {
    let msg;
    if (c.kind === 'in') {
      msg = t('correction.confirmApproveIn', { time: fmtDateTime(c.start) });
    } else if (c.kind === 'out') {
      msg = t('correction.confirmApproveOut', { time: fmtDateTime(c.end) });
    } else if (c.isJustified) {
      msg = t('correction.confirmApproveBoth');
    } else {
      // Unjustified both — extra-strong confirm with hours count.
      msg = t('correction.confirmApproveBothUnjust', { hours: fmtHours(c.hours) });
    }
    if (!confirm(msg)) return;

    approveBtn.disabled = true;
    rejectBtn.disabled  = true;
    const result = await postJson(`/api/corrections/${c.id}/approve`, {});
    if (result.ok) {
      await reload();
    } else {
      approveBtn.disabled = false;
      rejectBtn.disabled  = false;
      showMessage(messageEl, translateError(result.data.errorCode, result.data.error || t('corrections.couldNotLoad')), 'error');
    }
  }

  // Reject flow — collects notes inline, then POSTs.
  async function handleInlineReject(c, notes, actionsEl, submitBtn, notesInput) {
    // Disable toggle buttons while the request is in flight (mirrors approve path).
    // submitBtn and notesInput are already disabled by the caller before this runs.
    const btns = actionsEl.querySelectorAll('button');
    btns.forEach((b) => { b.disabled = true; });

    const result = await postJson(`/api/corrections/${c.id}/reject`, { notes });
    if (result.ok) {
      await reload();
    } else {
      btns.forEach((b) => { b.disabled = false; });
      submitBtn.disabled = false;
      notesInput.disabled = false;
      showMessage(messageEl, translateError(result.data.errorCode, result.data.error || t('corrections.couldNotLoad')), 'error');
    }
  }

  // -------- Empty state -------------------------------------------------------

  function buildEmpty(text) {
    const p = document.createElement('p');
    p.className = 'corr-empty';
    p.textContent = text;
    return p;
  }

  // -------- Render ------------------------------------------------------------

  function renderPendingTag(count) {
    if (!pendingTag) return;
    if (me.role !== 'employer' || count === 0) {
      pendingTag.hidden = true;
      return;
    }
    // e.g. "3 waiting on you"
    pendingTag.textContent = t('corrections.pendingTag', { n: count });
    pendingTag.hidden = false;
  }

  function render(corrections) {
    const pending = corrections.filter((c) => c.status === 'pending');
    const history = corrections.filter((c) => c.status !== 'pending');

    // Employer sees a relabeled heading to distinguish the "inbox" view.
    // null-safe: listHeading is optional — not all callers need to relabel it.
    if (me.role === 'employer' && listHeading) {
      listHeading.textContent = t('corrections.pendingHeading.employer');
    }

    renderPendingTag(pending.length);

    // replaceChildren avoids .innerHTML and is CSP-safe.
    pendingList.replaceChildren();
    if (pending.length === 0) {
      pendingList.appendChild(buildEmpty(
        me.role === 'employer'
          ? t('corrections.noPendingEmployer')
          : t('corrections.noPendingOwn')
      ));
    } else {
      pending.forEach((c) => pendingList.appendChild(buildRow(c)));
    }

    historyList.replaceChildren();
    if (history.length === 0) {
      historyList.appendChild(buildEmpty(t('corrections.noHistory')));
    } else {
      const { visible, showToggle, expanded } = capView(history.length, LIST_CAP, historyExpanded);
      history.slice(0, visible).forEach((c) => historyList.appendChild(buildRow(c)));
      if (showToggle) {
        appendShowAll(historyList, {
          total: history.length,
          expanded,
          t,
          onToggle: () => { historyExpanded = !historyExpanded; render(corrections); },
        });
      }
    }

    // Notify the caller of the new pending count so it can update e.g. a tab badge.
    if (typeof onCountChange === 'function') onCountChange(pending.length);
    // Fired after every render (initial, tab-switch, post-decision reload) so a
    // caller can re-apply transient DOM state — e.g. the Corrections tab search
    // filter, which would otherwise be lost when the rows are rebuilt.
    if (typeof onRendered === 'function') onRendered();
  }

  // -------- Data load ---------------------------------------------------------

  async function reload() {
    try {
      const res = await fetch('/api/corrections', { credentials: 'same-origin' });
      if (res.status === 401) { window.location.href = '/login'; return; }
      const { corrections } = await res.json();
      render(corrections);
    } catch {
      showMessage(messageEl, t('corrections.couldNotLoad'), 'error');
    }
  }

  return { reload };
}
