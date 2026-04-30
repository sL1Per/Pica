import { showMessage } from '/app.js';
import { mountTopBar, mountFooter } from '/topbar.js';

mountTopBar();
mountFooter();

const $ = (id) => document.getElementById(id);
const messageEl    = $('message');
const pendingList  = $('pending-list');
const historyList  = $('history-list');
const subtitleEl   = $('page-subtitle');
const headingEl    = $('list-heading');
const bankCard     = $('bank-card');
const bankHoursEl  = $('bank-hours');

let me = null;

// -------- Formatting --------------------------------------------------------

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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// -------- Render -------------------------------------------------------------

function renderRow(c) {
  const li = document.createElement('li');
  li.className = `correction-row correction-row--${c.status}`;

  const who = (me.role === 'employer') ? (c.fullName || c.username || 'someone') : '';
  // When + duration depend on kind.
  let when, hoursLabel;
  if (c.kind === 'both') {
    when = `${fmtDateTime(c.start)} → ${fmtDateTime(c.end)}`;
    hoursLabel = fmtHours(c.hours);
  } else if (c.kind === 'in') {
    when = `Arrived ${fmtDateTime(c.start)}`;
    hoursLabel = 'in only';
  } else {
    when = `Left ${fmtDateTime(c.end)}`;
    hoursLabel = 'out only';
  }

  // Justified / no-justification chip on every row.
  const justChip = c.isJustified
    ? `<span class="chip chip--ok">justified</span>`
    : `<span class="chip chip--warn">no justification</span>`;
  // Bank chip only on approved both-kind without justification.
  const bankChip = (c.status === 'approved' && c.kind === 'both' && !c.isJustified)
    ? `<span class="chip chip--bank">+${fmtHours(c.hours)} to bank</span>`
    : '';
  // Kind chip for visual differentiation in lists.
  const kindChipMap = { both: 'both', in: 'in only', out: 'out only' };
  const kindChip = `<span class="chip chip--kind">${kindChipMap[c.kind] ?? c.kind}</span>`;

  li.innerHTML = `
    <a class="correction-row__link" href="/corrections/${c.id}">
      <div class="correction-row__main">
        ${who ? `<div class="correction-row__who">${escapeHtml(who)}</div>` : ''}
        <div class="correction-row__when">${when}</div>
        <div class="correction-row__chips">
          <span class="status-tag status-tag--${c.status}">${c.status}</span>
          ${kindChip}
          ${justChip}
          ${bankChip}
        </div>
      </div>
      <div class="correction-row__hours">${hoursLabel}</div>
    </a>
  `;
  return li;
}

function renderEmptyMsg(text) {
  const li = document.createElement('li');
  li.className = 'subtle';
  li.textContent = text;
  return li;
}

function render(corrections) {
  // Sort split: pending first, history (approved/rejected/cancelled) below.
  const pending = corrections.filter((c) => c.status === 'pending');
  const history = corrections.filter((c) => c.status !== 'pending');

  pendingList.innerHTML = '';
  if (pending.length === 0) {
    pendingList.appendChild(renderEmptyMsg(
      me.role === 'employer'
        ? 'No corrections waiting for your decision.'
        : 'No pending corrections. Use the button above to register one.'
    ));
  } else {
    pending.forEach((c) => pendingList.appendChild(renderRow(c)));
  }

  historyList.innerHTML = '';
  if (history.length === 0) {
    historyList.appendChild(renderEmptyMsg('No history yet.'));
  } else {
    history.forEach((c) => historyList.appendChild(renderRow(c)));
  }
}

async function loadBank() {
  // Bank only makes sense for the employee viewing their own. For employers
  // the per-user bank shows up on the correction detail page.
  if (me.role === 'employer') return;
  try {
    const res = await fetch('/api/corrections/bank', { credentials: 'same-origin' });
    if (!res.ok) return;
    const { hours } = await res.json();
    bankHoursEl.textContent = fmtHours(hours);
    bankCard.hidden = false;
  } catch { /* non-fatal */ }
}

async function load() {
  try {
    const res = await fetch('/api/corrections', { credentials: 'same-origin' });
    if (res.status === 401) { window.location.href = '/login'; return; }
    const { corrections } = await res.json();
    render(corrections);
  } catch (err) {
    showMessage(messageEl, 'Could not load corrections.', 'error');
  }
}

// -------- Bootstrap ---------------------------------------------------------

(async () => {
  const meRes = await fetch('/api/me', { credentials: 'same-origin' });
  if (meRes.status === 401) { window.location.href = '/login'; return; }
  me = await meRes.json();
  if (me.role === 'employer') {
    subtitleEl.textContent = 'Manual time entries filed by employees, awaiting your decision.';
    headingEl.textContent = 'Awaiting decision';
  }
  await Promise.all([load(), loadBank()]);
})();
