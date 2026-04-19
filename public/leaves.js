import { showMessage } from '/app.js';

const listEl = document.getElementById('leave-list');
const messageEl = document.getElementById('message');
const filterBar = document.querySelector('.filter-bar');

let allLeaves = [];
let me = null;
let activeFilter = 'all';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatRange(leave) {
  if (leave.unit === 'days') {
    if (leave.start === leave.end) return leave.start;
    return `${leave.start} → ${leave.end}`;
  }
  // hours
  const s = new Date(leave.start);
  const e = new Date(leave.end);
  const sameDay = s.toDateString() === e.toDateString();
  const ds = s.toISOString().slice(0, 10);
  const hs = `${String(s.getHours()).padStart(2,'0')}:${String(s.getMinutes()).padStart(2,'0')}`;
  const he = `${String(e.getHours()).padStart(2,'0')}:${String(e.getMinutes()).padStart(2,'0')}`;
  return sameDay ? `${ds}, ${hs}–${he}` : `${leave.start} → ${leave.end}`;
}

function render() {
  const filtered = activeFilter === 'all'
    ? allLeaves
    : allLeaves.filter((l) => l.status === activeFilter);

  listEl.innerHTML = '';
  if (filtered.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = activeFilter === 'all'
      ? 'No leaves yet. Click "+ Request leave" to add one.'
      : `No ${activeFilter} leaves.`;
    listEl.appendChild(li);
    return;
  }
  for (const l of filtered) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = `leave-list__item leave-list__item--${l.status}`;
    a.href = `/leaves/${l.id}`;

    const who = (me.role === 'employer' && l.username) ? l.username : null;

    a.innerHTML = `
      <div class="leave-list__row">
        <div class="leave-list__title">
          <span class="type-tag">${l.type}</span>${who ? escapeHtml(who) : escapeHtml(formatRange(l))}
        </div>
        <span class="status-badge status-badge--${l.status}">${l.status}</span>
      </div>
      <div class="leave-list__meta">${who ? escapeHtml(formatRange(l)) : ''}${l.reason ? (who ? ' · ' : '') + escapeHtml(l.reason) : ''}</div>
    `;

    li.appendChild(a);
    listEl.appendChild(li);
  }
}

filterBar.addEventListener('click', (e) => {
  if (!e.target.matches('button.filter')) return;
  activeFilter = e.target.dataset.filter;
  filterBar.querySelectorAll('.filter').forEach((b) =>
    b.classList.toggle('active', b === e.target));
  render();
});

(async () => {
  const [meRes, leavesRes] = await Promise.all([
    fetch('/api/me',     { credentials: 'same-origin' }),
    fetch('/api/leaves', { credentials: 'same-origin' }),
  ]);
  if (meRes.status === 401) { window.location.href = '/login'; return; }
  me = await meRes.json();

  if (!leavesRes.ok) {
    showMessage(messageEl, 'Failed to load leaves.', 'error');
    return;
  }
  allLeaves = (await leavesRes.json()).leaves;
  render();
})();
