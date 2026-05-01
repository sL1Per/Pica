import { showMessage } from '/app.js';
import { t, applyTranslations } from '/i18n.js';

import { mountTopBar, mountFooter } from '/topbar.js';
mountTopBar();
mountFooter();
applyTranslations();

const listEl = document.getElementById('employee-list');
const messageEl = document.getElementById('message');

function initials(name) {
  if (!name) return '?';
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');
}

function renderItem(emp) {
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.className = 'employee-list__item';
  a.href = `/employees/${emp.id}`;

  const avatar = document.createElement('div');
  avatar.className = 'employee-list__avatar';
  if (emp.hasPicture) {
    const img = document.createElement('img');
    img.src = `/api/employees/${emp.id}/picture`;
    img.alt = '';
    avatar.appendChild(img);
  } else {
    avatar.textContent = initials(emp.fullName || emp.username);
  }

  const info = document.createElement('div');
  info.className = 'employee-list__info';
  const name = document.createElement('div');
  name.className = 'employee-list__name';
  name.textContent = emp.fullName || emp.username;
  const meta = document.createElement('div');
  meta.className = 'employee-list__meta';
  meta.textContent = emp.position || (emp.hasProfile ? '' : t('employees.noProfile'));

  const badge = document.createElement('span');
  badge.className = `employee-list__badge ${emp.role === 'employee' ? 'employee-list__badge--employee' : ''}`;
  badge.textContent = t('employee.role.' + emp.role);
  name.appendChild(badge);

  info.appendChild(name);
  info.appendChild(meta);

  a.appendChild(avatar);
  a.appendChild(info);
  li.appendChild(a);
  return li;
}

(async () => {
  const res = await fetch('/api/employees', { credentials: 'same-origin' });
  if (res.status === 401) { window.location.href = '/login'; return; }
  if (res.status === 403) {
    showMessage(messageEl, t('employees.employerOnly'), 'error');
    return;
  }
  const data = await res.json();

  listEl.innerHTML = '';
  if (data.employees.length === 0) {
    const li = document.createElement('li');
    li.className = 'employee-list__empty subtle';
    li.textContent = t('employees.emptyHint');
    listEl.appendChild(li);
    return;
  }
  for (const emp of data.employees) listEl.appendChild(renderItem(emp));
})();
