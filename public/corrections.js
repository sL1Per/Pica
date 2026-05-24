import { postJson, showMessage } from '/app.js';
import { t, translateError, applyTranslations, fmtDateTime, fmtHours } from '/i18n.js';
import { mountTopBar, mountFooter } from '/topbar.js';

mountTopBar();
mountFooter();
applyTranslations();

const $ = (id) => document.getElementById(id);
const messageEl   = $('message');
const pendingList = $('pending-list');
const historyList = $('history-list');
const subtitleEl  = $('page-subtitle');
const headingEl   = $('list-heading');
const pendingTag  = $('pending-tag');

let me = null;
// currentCorrections holds the last-fetched array so we can re-render in place
// after an inline approve/reject without a full page navigation.
let currentCorrections = [];

// -------- Row builder -------------------------------------------------------

function buildRow(c) {
  const li = document.createElement('li');
  li.className = `corr-row corr-row--${c.status}`;

  // Accent bar — absolutely positioned, must be first child of the positioned
  // .corr-row so the CSS left:-16px places it against the card's inner edge.
  const accent = document.createElement('div');
  accent.className = 'corr-row__accent';
  accent.setAttribute('aria-hidden', 'true');
  li.appendChild(accent);

  // Clicking anywhere on the row navigates to the detail page. The inline
  // approve/reject buttons inside stop propagation so they don't trigger this.
  li.addEventListener('click', () => { window.location.href = `/corrections/${c.id}`; });

  // Main content column.
  const main = document.createElement('div');
  main.className = 'corr-row__main';

  // Who — only shown for the employer (employee sees their own list only).
  if (me.role === 'employer' && (c.fullName || c.username)) {
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
  li.appendChild(main);

  // Aside column — hours display, or inline actions for employer+pending rows.
  if (me.role === 'employer' && c.status === 'pending') {
    li.appendChild(buildInlineActions(c));
  } else {
    const hoursEl = document.createElement('div');
    hoursEl.className = 'corr-row__hours';
    if (c.kind === 'both') {
      hoursEl.textContent = fmtHours(c.hours);
    } else if (c.kind === 'in') {
      hoursEl.textContent = t('corrections.kindIn');
    } else {
      hoursEl.textContent = t('corrections.kindOut');
    }
    li.appendChild(hoursEl);
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
    e.stopPropagation();   // prevent row-click navigation
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
  input.className = 'field';
  input.placeholder = t('corrections.rejectNotesPlaceholder');
  input.maxLength = 500;
  form.appendChild(input);

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'btn-reject';
  submitBtn.textContent = t('corrections.inlineReject');
  submitBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await handleInlineReject(c, input.value.trim() || undefined, actionsEl, form);
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
    await reloadList();
  } else {
    approveBtn.disabled = false;
    rejectBtn.disabled  = false;
    showMessage(messageEl, translateError(result.data.errorCode, result.data.error || t('corrections.couldNotLoad')), 'error');
  }
}

// Reject flow — collects notes inline, then POSTs.
async function handleInlineReject(c, notes, actionsEl, notesForm) {
  // Disable buttons while the request is in flight.
  const btns = actionsEl.querySelectorAll('button');
  btns.forEach((b) => { b.disabled = true; });

  const result = await postJson(`/api/corrections/${c.id}/reject`, { notes });
  if (result.ok) {
    await reloadList();
  } else {
    btns.forEach((b) => { b.disabled = false; });
    notesForm.hidden = false;
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

  // Employer sees both section headings; employee sees the generic "Pending".
  if (me.role === 'employer') {
    headingEl.textContent = t('corrections.pendingHeading.employer');
  }

  renderPendingTag(pending.length);

  pendingList.innerHTML = '';
  if (pending.length === 0) {
    pendingList.appendChild(buildEmpty(
      me.role === 'employer'
        ? t('corrections.noPendingEmployer')
        : t('corrections.noPendingOwn')
    ));
  } else {
    pending.forEach((c) => pendingList.appendChild(buildRow(c)));
  }

  historyList.innerHTML = '';
  if (history.length === 0) {
    historyList.appendChild(buildEmpty(t('corrections.noHistory')));
  } else {
    history.forEach((c) => historyList.appendChild(buildRow(c)));
  }
}

// -------- Data load ---------------------------------------------------------

async function reloadList() {
  try {
    const res = await fetch('/api/corrections', { credentials: 'same-origin' });
    if (res.status === 401) { window.location.href = '/login'; return; }
    const { corrections } = await res.json();
    currentCorrections = corrections;
    render(corrections);
  } catch {
    showMessage(messageEl, t('corrections.couldNotLoad'), 'error');
  }
}

// -------- Bootstrap ---------------------------------------------------------

(async () => {
  const meRes = await fetch('/api/me', { credentials: 'same-origin' });
  if (meRes.status === 401) { window.location.href = '/login'; return; }
  me = await meRes.json();

  if (me.role === 'employer') {
    subtitleEl.textContent = t('corrections.subtitleAll');
    // headingEl text is updated inside render() once we know the pending count.
  }

  await reloadList();
})();
