import { postJson } from '/app.js';

const userEl    = document.getElementById('current-user');
const logoutBtn = document.getElementById('logout-btn');
const employeesCard = document.getElementById('employees-card');

// Populate current user and tailor navigation by role.
(async () => {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (!res.ok) { window.location.href = '/login'; return; }
    const user = await res.json();
    userEl.textContent = `${user.username} (${user.role})`;
    if (user.role === 'employer') employeesCard.hidden = false;
  } catch {
    window.location.href = '/login';
  }
})();

logoutBtn.addEventListener('click', async () => {
  await postJson('/api/logout', {});
  window.location.href = '/login';
});
