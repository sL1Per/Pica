import { showMessage } from '/app.js';

import { mountTopBar, mountFooter } from '/topbar.js';
mountTopBar();
mountFooter();

const groupsEl = document.getElementById('groups');
const messageEl = document.getElementById('message');

function formatTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/**
 * Compute worked milliseconds today from an ordered list of (in/out) pairs.
 * Unclosed clock-ins count up to "now" so active shifts still show progress.
 */
function workedMs(punches) {
  let total = 0;
  let inAt = null;
  for (const p of punches) {
    if (p.type === 'in') inAt = new Date(p.ts).getTime();
    else if (p.type === 'out' && inAt != null) {
      total += new Date(p.ts).getTime() - inAt;
      inAt = null;
    }
  }
  if (inAt != null) total += Date.now() - inAt;
  return Math.max(0, total);
}

function humanDuration(ms) {
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function renderGroup(name, username, punches) {
  const section = document.createElement('section');
  section.className = 'group';

  const header = document.createElement('div');
  header.className = 'group__header';
  const nameEl = document.createElement('span');
  nameEl.className = 'group__name';
  nameEl.textContent = name || username;
  const hoursEl = document.createElement('span');
  hoursEl.className = 'group__hours';
  hoursEl.textContent = humanDuration(workedMs(punches));
  header.appendChild(nameEl);
  header.appendChild(hoursEl);
  section.appendChild(header);

  const ul = document.createElement('ul');
  ul.className = 'punch-list';
  for (const p of [...punches].reverse()) {
    const li = document.createElement('li');
    li.className = 'punch-list__item';

    const badge = document.createElement('span');
    badge.className = `punch-list__badge punch-list__badge--${p.type}`;
    badge.textContent = p.type === 'in' ? 'In' : 'Out';

    const body = document.createElement('div');
    body.className = 'punch-list__body';
    const time = document.createElement('div');
    time.className = 'punch-list__time';
    time.textContent = formatTime(p.ts);
    body.appendChild(time);

    const parts = [];
    if (p.comment) parts.push(escapeHtml(p.comment));
    if (p.geo) parts.push(`<span class="punch-list__geo">${p.geo.lat.toFixed(4)}, ${p.geo.lng.toFixed(4)}</span>`);
    if (parts.length) {
      const meta = document.createElement('div');
      meta.className = 'punch-list__meta';
      meta.innerHTML = parts.join(' · ');
      body.appendChild(meta);
    }

    li.appendChild(badge);
    li.appendChild(body);
    ul.appendChild(li);
  }
  section.appendChild(ul);
  return section;
}

(async () => {
  const meRes = await fetch('/api/me', { credentials: 'same-origin' });
  if (meRes.status === 401) { window.location.href = '/login'; return; }
  const me = await meRes.json();
  if (me.role !== 'employer') { window.location.href = '/punch'; return; }

  const res = await fetch('/api/punches/today', { credentials: 'same-origin' });
  if (res.status === 403) {
    showMessage(messageEl, 'Employer access only.', 'error');
    return;
  }
  const data = await res.json();

  const empRes = await fetch('/api/employees', { credentials: 'same-origin' });
  const employees = (await empRes.json()).employees;
  const nameById = new Map(employees.map((e) => [e.id, e.fullName || e.username]));

  // Group punches by employeeId.
  const byId = new Map();
  for (const p of data.punches) {
    if (!byId.has(p.employeeId)) byId.set(p.employeeId, { username: p.username, punches: [] });
    byId.get(p.employeeId).punches.push(p);
  }

  groupsEl.innerHTML = '';
  if (byId.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'group__empty';
    empty.textContent = 'No punches yet today.';
    groupsEl.appendChild(empty);
    return;
  }

  // Sort: most-recently-active first.
  const rows = [...byId.entries()].sort((a, b) => {
    const lastA = a[1].punches[a[1].punches.length - 1].ts;
    const lastB = b[1].punches[b[1].punches.length - 1].ts;
    return lastB.localeCompare(lastA);
  });

  for (const [id, group] of rows) {
    groupsEl.appendChild(renderGroup(nameById.get(id), group.username, group.punches));
  }
})();
