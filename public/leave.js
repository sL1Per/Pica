import { postJson, showMessage, setBusy } from '/app.js';

import { mountTopBar, mountFooter } from '/topbar.js';
mountTopBar();
mountFooter();

const leaveId = window.location.pathname.split('/').pop();

const $ = (id) => document.getElementById(id);
const detail = $('detail');
const banner = $('status-banner');
const actionsEl = $('actions');
const rejectDialog = $('reject-dialog');
const messageEl = $('message');

let me = null;
let leave = null;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatDate(iso) {
  return new Date(iso).toLocaleString();
}

function formatWhen(l) {
  if (l.unit === 'days') {
    if (l.start === l.end) return l.start;
    return `${l.start} → ${l.end}`;
  }
  const s = new Date(l.start);
  const e = new Date(l.end);
  const sameDay = s.toDateString() === e.toDateString();
  const ds = s.toISOString().slice(0, 10);
  const hs = `${String(s.getHours()).padStart(2,'0')}:${String(s.getMinutes()).padStart(2,'0')}`;
  const he = `${String(e.getHours()).padStart(2,'0')}:${String(e.getMinutes()).padStart(2,'0')}`;
  return sameDay ? `${ds}, ${hs}–${he}` : `${l.start} → ${l.end}`;
}

function formatDuration(l) {
  if (l.unit === 'hours' && typeof l.hours === 'number') {
    return `${l.hours.toFixed(1)} hours`;
  }
  // days — inclusive
  const s = new Date(l.start);
  const e = new Date(l.end);
  const days = Math.round((e - s) / 86_400_000) + 1;
  return `${days} day${days === 1 ? '' : 's'}`;
}

function render() {
  $('page-title').textContent = `Leave · ${leave.type}`;
  $('f-employee').textContent = leave.fullName || leave.username || leave.employeeId;
  $('f-type').textContent = leave.type;
  $('f-when').textContent = formatWhen(leave);
  $('f-duration').textContent = formatDuration(leave);
  $('f-created').textContent = formatDate(leave.createdAt);

  if (leave.reason) {
    $('l-reason-dt').hidden = false;
    $('f-reason').hidden = false;
    $('f-reason').textContent = leave.reason;
  }

  banner.className = `status-banner status-banner--${leave.status}`;
  banner.innerHTML = `<span>${leave.status.toUpperCase()}</span>`;

  // Decision history note.
  const note = $('decided-note');
  if (leave.status === 'approved') {
    note.hidden = false;
    $('decided-label').textContent = `Approved ${formatDate(leave.decidedAt)}`;
    $('decided-notes').textContent = '';
  } else if (leave.status === 'rejected') {
    note.hidden = false;
    $('decided-label').textContent = `Rejected ${formatDate(leave.decidedAt)}`;
    $('decided-notes').textContent = leave.notes || '';
  } else if (leave.status === 'cancelled') {
    note.hidden = false;
    $('decided-label').textContent = `Cancelled ${formatDate(leave.cancelledAt)}`;
    $('decided-notes').textContent = '';
  } else {
    note.hidden = true;
  }

  renderActions();
  detail.hidden = false;
}

function renderActions() {
  actionsEl.innerHTML = '';
  const isOwner    = leave.employeeId === me.id;
  const isEmployer = me.role === 'employer';

  if (leave.status === 'pending' && isEmployer) {
    const approve = document.createElement('button');
    approve.className = 'btn-approve';
    approve.textContent = 'Approve';
    approve.addEventListener('click', () => action('approve'));
    const reject = document.createElement('button');
    reject.className = 'btn-reject';
    reject.textContent = 'Reject';
    reject.addEventListener('click', () => { rejectDialog.hidden = false; });
    actionsEl.appendChild(approve);
    actionsEl.appendChild(reject);
  }

  if (leave.status === 'pending' && isOwner) {
    const cancel = document.createElement('button');
    cancel.className = 'secondary';
    cancel.textContent = 'Cancel request';
    cancel.addEventListener('click', () => action('cancel'));
    actionsEl.appendChild(cancel);
  }

  if (leave.status === 'approved' && isEmployer) {
    const cancel = document.createElement('button');
    cancel.className = 'secondary';
    cancel.textContent = 'Cancel approved leave';
    cancel.addEventListener('click', () => {
      if (confirm('Cancel this approved leave?')) action('cancel');
    });
    actionsEl.appendChild(cancel);
  }
}

async function action(name, body = {}) {
  showMessage(messageEl, '');
  const res = await postJson(`/api/leaves/${leaveId}/${name}`, body);
  if (res.ok) {
    leave = res.data.leave;
    render();
    showMessage(messageEl, `Leave ${leave.status}.`, 'success');
  } else {
    showMessage(messageEl, res.data.error || `Failed to ${name}`, 'error');
  }
}

$('reject-cancel').addEventListener('click', () => { rejectDialog.hidden = true; });
$('reject-confirm').addEventListener('click', async () => {
  const btn = $('reject-confirm');
  setBusy(btn, true, 'Rejecting…');
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

  if (leaveRes.status === 403) {
    showMessage(messageEl, 'You don’t have access to this leave.', 'error');
    return;
  }
  if (leaveRes.status === 404) {
    showMessage(messageEl, 'Leave not found.', 'error');
    return;
  }
  leave = (await leaveRes.json()).leave;
  render();
})();
