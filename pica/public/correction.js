import { postJson, showMessage } from '/app.js';
import { t, translateError, applyTranslations } from '/i18n.js';
import { mountTopBar, mountFooter } from '/topbar.js';

mountTopBar();
mountFooter();
applyTranslations();

const $ = (id) => document.getElementById(id);
const correctionId = window.location.pathname.split('/').pop();

const titleEl    = $('page-title');
const messageEl  = $('message');
const actionsEl  = $('actions');
const rejectDialog = $('reject-dialog');
const rejectNotes  = $('reject-notes');

let correction = null;
let me = null;

function fmtDateTime(iso) {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mn = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mn}`;
}
function fmtHours(h) {
  const total = Math.round(h * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  if (hh === 0) return `${mm} min`;
  if (mm === 0) return `${hh}h`;
  return `${hh}h ${mm}m`;
}

function render() {
  $('f-status').textContent = t('status.' + correction.status);
  $('f-status').className = `status-tag status-tag--${correction.status}`;
  $('f-employee').textContent = correction.fullName || correction.username || correction.employeeId;

  // Render time fields based on kind.
  const startDt = document.querySelector('dt[data-row="start"]') || $('f-start')?.previousElementSibling;
  const endDt = document.querySelector('dt[data-row="end"]') || $('f-end')?.previousElementSibling;
  const hoursDt = document.querySelector('dt[data-row="hours"]') || $('f-hours')?.previousElementSibling;

  if (correction.kind === 'both') {
    if (startDt) startDt.hidden = false;
    $('f-start').hidden = false;
    $('f-start').textContent = fmtDateTime(correction.start);
    if (endDt) endDt.hidden = false;
    $('f-end').hidden = false;
    $('f-end').textContent = fmtDateTime(correction.end);
    if (hoursDt) hoursDt.hidden = false;
    $('f-hours').hidden = false;
    $('f-hours').textContent = fmtHours(correction.hours);
  } else if (correction.kind === 'in') {
    if (startDt) { startDt.hidden = false; startDt.textContent = t('correction.fieldArrived'); }
    $('f-start').hidden = false;
    $('f-start').textContent = fmtDateTime(correction.start);
    if (endDt) endDt.hidden = true;
    $('f-end').hidden = true;
    if (hoursDt) hoursDt.hidden = true;
    $('f-hours').hidden = true;
  } else if (correction.kind === 'out') {
    if (startDt) startDt.hidden = true;
    $('f-start').hidden = true;
    if (endDt) { endDt.hidden = false; endDt.textContent = t('correction.fieldLeft'); }
    $('f-end').hidden = false;
    $('f-end').textContent = fmtDateTime(correction.end);
    if (hoursDt) hoursDt.hidden = true;
    $('f-hours').hidden = true;
  }

  $('f-justification').textContent = correction.justification || t('correction.fieldJustificationNone');

  // Bank impact text adapts to kind.
  const bankImpactEl = $('f-bank-impact');
  if (correction.kind !== 'both') {
    bankImpactEl.textContent = t('correction.bankImpactNoneSingleSide');
  } else if (correction.isJustified) {
    bankImpactEl.textContent = t('correction.bankImpactNoneJustified');
  } else if (correction.status === 'approved') {
    bankImpactEl.textContent = t('correction.bankImpactAdded', { hours: fmtHours(correction.hours) });
  } else {
    bankImpactEl.textContent = t('correction.bankImpactWouldAdd', { hours: fmtHours(correction.hours) });
  }

  $('f-created').textContent = fmtDateTime(correction.createdAt);

  if (correction.decidedAt) {
    $('dt-decided').hidden = false;
    $('f-decided').hidden = false;
    $('f-decided').textContent = `${t('status.' + correction.status)} · ${fmtDateTime(correction.decidedAt)}`;
  }
  if (correction.notes) {
    $('dt-notes').hidden = false;
    $('f-notes').hidden = false;
    $('f-notes').textContent = correction.notes;
  }

  titleEl.textContent = correction.fullName || correction.username
    ? `Correction — ${correction.fullName || correction.username}`
    : 'Correction';

  renderActions();
}

function renderActions() {
  actionsEl.innerHTML = '';
  const isEmployer = me.role === 'employer';
  const isOwner = correction.employeeId === me.id;

  if (correction.status === 'pending' && isEmployer) {
    const approve = document.createElement('button');
    approve.className = 'btn-approve';
    approve.textContent = t('correction.actionApprove');
    approve.addEventListener('click', () => {
      let msg;
      if (correction.kind === 'in') {
        msg = t('correction.confirmApproveIn', { time: fmtDateTime(correction.start) });
      } else if (correction.kind === 'out') {
        msg = t('correction.confirmApproveOut', { time: fmtDateTime(correction.end) });
      } else if (correction.isJustified) {
        msg = t('correction.confirmApproveBoth');
      } else {
        msg = t('correction.confirmApproveBothUnjust', { hours: fmtHours(correction.hours) });
      }
      if (confirm(msg)) action('approve');
    });

    const reject = document.createElement('button');
    reject.className = 'btn-reject';
    reject.textContent = t('correction.actionReject');
    reject.addEventListener('click', () => { rejectDialog.showModal?.() ?? (rejectDialog.hidden = false); });

    actionsEl.appendChild(approve);
    actionsEl.appendChild(reject);
    actionsEl.hidden = false;
  } else if (correction.status === 'pending' && isOwner) {
    const cancel = document.createElement('button');
    cancel.className = 'btn-ghost';
    cancel.textContent = t('correction.actionCancel');
    cancel.addEventListener('click', () => {
      if (confirm(t('correction.confirmCancel'))) action('cancel');
    });
    actionsEl.appendChild(cancel);
    actionsEl.hidden = false;
  } else if (correction.status === 'approved' && isEmployer) {
    // Employer can reverse an approval. This does NOT remove the materialized
    // punches (they stay in the audit log) — bank reverses though.
    const undo = document.createElement('button');
    undo.className = 'btn-ghost';
    undo.textContent = t('correction.actionReverse');
    undo.addEventListener('click', () => {
      if (confirm(t('correction.confirmReverse'))) {
        action('cancel');
      }
    });
    actionsEl.appendChild(undo);
    actionsEl.hidden = false;
  }
}

async function action(name, body = {}) {
  showMessage(messageEl, '');
  const result = await postJson(`/api/corrections/${correctionId}/${name}`, body);
  if (result.ok) {
    correction = result.data.correction;
    render();
    showMessage(messageEl, t('correction.statusUpdated', { status: t('status.' + correction.status) }), 'success');
  } else {
    showMessage(messageEl, translateError(result.data.errorCode, result.data.error || t('correction.couldNotLoad')), 'error');
  }
}

// Reject dialog wiring.
$('reject-cancel').addEventListener('click', () => {
  rejectDialog.close?.() ?? (rejectDialog.hidden = true);
});
$('reject-confirm').addEventListener('click', () => {
  const notes = rejectNotes.value.trim() || undefined;
  rejectDialog.close?.() ?? (rejectDialog.hidden = true);
  action('reject', { notes });
});

// -------- Bootstrap ---------------------------------------------------------

(async () => {
  const meRes = await fetch('/api/me', { credentials: 'same-origin' });
  if (meRes.status === 401) { window.location.href = '/login'; return; }
  me = await meRes.json();

  const res = await fetch(`/api/corrections/${correctionId}`, { credentials: 'same-origin' });
  if (res.status === 404) {
    showMessage(messageEl, t('correction.notFound'), 'error');
    return;
  }
  if (res.status === 403) {
    showMessage(messageEl, 'You do not have access to this correction.', 'error');
    return;
  }
  if (!res.ok) {
    showMessage(messageEl, 'Could not load correction.', 'error');
    return;
  }
  correction = (await res.json()).correction;
  render();
})();
