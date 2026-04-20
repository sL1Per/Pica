import { mountTopBar } from '/topbar.js';

(async () => {
  const data = await mountTopBar();
  if (!data) return; // mountTopBar redirected to /login

  document.getElementById('current-user').textContent =
    `${data.user.username} (${data.user.role})`;

  if (data.branding.name) {
    document.getElementById('company-name').textContent = data.branding.name;
  }
})();
