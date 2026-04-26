import { mountTopBar, mountFooter } from '/topbar.js';

const NAV_EMPLOYEE = [
  { href: '/punch',           label: 'Punches',  desc: 'Clock in / out and see today' },
  { href: '/leaves/calendar', label: 'Calendar', desc: 'Who is on approved leave' },
  { href: '/leaves',          label: 'Leaves',   desc: 'Your leaves and balances' },
  { href: '/reports',         label: 'Reports',  desc: 'Your hours and time-off' },
];

const NAV_EMPLOYER = [
  { href: '/employees',       label: 'Employees', desc: 'Manage the team' },
  { href: '/leaves/calendar', label: 'Calendar',  desc: 'Who is on approved leave' },
  { href: '/leaves',          label: 'Leaves',    desc: 'Approve and review requests' },
  { href: '/punch',           label: 'Punches',   desc: 'Clock in / out and see today' },
  { href: '/reports',         label: 'Reports',   desc: 'Hours and leaves across the team' },
  { href: '/settings',        label: 'Settings',  desc: 'Company, organization, backups' },
];

function renderNavCards(role) {
  const items = role === 'employer' ? NAV_EMPLOYER : NAV_EMPLOYEE;
  const root = document.getElementById('nav-cards');
  root.innerHTML = items.map((it) => `
    <a class="nav-card" href="${it.href}">
      <div class="nav-card__title">${it.label}</div>
      <div class="nav-card__desc">${it.desc}</div>
    </a>
  `).join('');
}

(async () => {
  const data = await mountTopBar();
mountFooter();
  if (!data) return; // mountTopBar redirected to /login

  document.getElementById('current-user').textContent =
    `${data.user.fullName || data.user.username} (${data.user.role})`;

  renderNavCards(data.user.role);

  if (data.branding.name) {
    document.getElementById('company-name').textContent = data.branding.name;
  }
})();
