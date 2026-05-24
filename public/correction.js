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

// Status icon glyphs — pure text, no SVG, no inline style.
const HERO_ICONS = {
  pending:   '⏳',
  approved:  '✓',
  rejected:  '✕',
  cancelled: '—',
};

// NEW i18n keys referenced here; locale strings added in the upcoming i18n task.
// Label keys (big serif status word):
//   correction.heroPending   — e.g. "Pending review"
//   correction.heroApproved  — e.g. "Approved"
//   correction.heroRejected  — e.g. "Rejected"
//   correction.heroCancelled — e.g. "Cancelled"
// Blurb keys (one-sentence context):
//   correction.heroPendingBlurb   — e.g. "Waiting for a manager decision."
//   correction.heroApprovedBlurb  — e.g. "The correction has been applied."
//   correction.heroRejectedBlurb  — e.g. "Not approved. See the notes below."
//   correction.heroCancelledBlurb — e.g. "Withdrawn. No changes were made."
//
// tSoft(key) returns the translated string if the key exists, or '' if not.
// This lets the new keys be absent until the locale files are updated.
function tSoft(key) {
  const v = t(key);
  // t() returns '[key]' for missing keys — treat that as absent.
  return v === `[${key}]` ? '' : v;
}

// Status-to-modifier class mapping for the hero card.
const HERO_MODIFIERS = {
  pending:   'cdet-hero--pending',
  approved:  'cdet-hero--approved',
  rejected:  'cdet-hero--rejected',
  cancelled: 'cdet-hero--cancelled',
};

function render() {
  // --- Preserved f-status (hidden element, kept for JS contract) ---
  $('f-status').textContent = t('status.' + correction.status);
  $('f-status').className = `status-tag status-tag--${correction.status}`;

  // --- Status hero ---
  const heroEl = $('cdet-hero');
  // Strip any previous modifier then apply the current one.
  heroEl.className = 'cdet-hero ' + (HERO_MODIFIERS[correction.status] || '');

  $('cdet-hero-icon').textContent = HERO_ICONS[correction.status] || '';

  // Hero label: "Pending review" / "Approved" / "Rejected" / "Cancelled"
  // Uses new i18n keys correction.heroPending/heroApproved/heroRejected/heroCancelled.
  // Falls back to the existing status.* key until the locale files are updated.
  const cap = correction.status.charAt(0).toUpperCase() + correction.status.slice(1);
  const heroLabelKey = 'correction.hero' + cap;
  $('cdet-hero-label').textContent = tSoft(heroLabelKey) || t('status.' + correction.status);

  // Hero blurb: one-sentence context line (new keys, empty until locale update).
  const heroBlurbKey = 'correction.hero' + cap + 'Blurb';
  $('cdet-hero-blurb').textContent = tSoft(heroBlurbKey);

  // --- Details card ---
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

  $('f-created').textContent = fmtDateTime(correction.createdAt);

  if (correction.decidedAt) {
    $('dt-decided').hidden = false;
    $('f-decided').hidden = false;
    $('f-decided').textContent = `${t('status.' + correction.status)} · ${fmtDateTime(correction.decidedAt)}`;
  }

  // --- Reason / Justification card ---
  const justEl = $('f-justification');
  if (correction.justification) {
    justEl.textContent = correction.justification;
    justEl.className = 'cdet-reason--filled';
  } else {
    justEl.textContent = t('correction.fieldJustificationNone');
    justEl.className = 'cdet-reason--empty';
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
    $('actions-card').hidden = false;
  } else if (correction.status === 'pending' && isOwner) {
    const cancel = document.createElement('button');
    cancel.className = 'btn-ghost';
    cancel.textContent = t('correction.actionCancel');
    cancel.addEventListener('click', () => {
      if (confirm(t('correction.confirmCancel'))) action('cancel');
    });
    actionsEl.appendChild(cancel);
    actionsEl.hidden = false;
    $('actions-card').hidden = false;
  } else if (correction.status === 'approved' && isEmployer) {
    // Employer can reverse an approval. This does NOT remove the materialized
    // punches (they stay in the audit log).
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
    $('actions-card').hidden = false;
  } else {
    // No actions available — hide the card entirely.
    $('actions-card').hidden = true;
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
