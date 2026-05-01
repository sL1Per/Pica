import { mountTopBar, mountFooter } from '/topbar.js';
import { t } from '/i18n.js';

const NAV_EMPLOYEE = [
  { href: '/punch',           titleKey: 'dashboard.card.punches.title',     descKey: 'dashboard.card.punches.desc' },
  { href: '/leaves/calendar', titleKey: 'dashboard.card.calendar.title',    descKey: 'dashboard.card.calendar.desc' },
  { href: '/leaves',          titleKey: 'dashboard.card.leaves.title',      descKey: 'dashboard.card.leavesEmployee.desc' },
  { href: '/corrections',     titleKey: 'dashboard.card.corrections.title', descKey: 'dashboard.card.correctionsEmployee.desc' },
  { href: '/reports',         titleKey: 'dashboard.card.reports.title',     descKey: 'dashboard.card.reportsEmployee.desc' },
];

const NAV_EMPLOYER = [
  { href: '/employees',       titleKey: 'dashboard.card.employees.title',   descKey: 'dashboard.card.employees.desc' },
  { href: '/leaves/calendar', titleKey: 'dashboard.card.calendar.title',    descKey: 'dashboard.card.calendar.desc' },
  { href: '/leaves',          titleKey: 'dashboard.card.leaves.title',      descKey: 'dashboard.card.leaves.desc' },
  { href: '/corrections',     titleKey: 'dashboard.card.corrections.title', descKey: 'dashboard.card.correctionsEmployer.desc' },
  { href: '/punch',           titleKey: 'dashboard.card.punches.title',     descKey: 'dashboard.card.punches.desc' },
  { href: '/reports',         titleKey: 'dashboard.card.reports.title',     descKey: 'dashboard.card.reportsEmployer.desc' },
  { href: '/settings',        titleKey: 'dashboard.card.settings.title',    descKey: 'dashboard.card.settings.desc' },
];

function renderNavCards(role) {
  const items = role === 'employer' ? NAV_EMPLOYER : NAV_EMPLOYEE;
  const root = document.getElementById('nav-cards');
  root.innerHTML = items.map((it) => `
    <a class="nav-card" href="${it.href}">
      <div class="nav-card__title">${t(it.titleKey)}</div>
      <div class="nav-card__desc">${t(it.descKey)}</div>
    </a>
  `).join('');
}

(async () => {
  const data = await mountTopBar();
  mountFooter();
  if (!data) return; // mountTopBar redirected to /login

  // Welcome heading uses the company name (or app name fallback).
  const companyName = data.branding?.name || 'Pica';
  const welcomeEl = document.getElementById('welcome');
  if (welcomeEl) welcomeEl.textContent = t('dashboard.welcome', { name: companyName });

  // "Signed in as Pedro Viegas (employer). Use the top menu to navigate."
  // The role is parameterized so the parens come naturally in the
  // translation, and the period inside the template keeps punctuation
  // localized (some languages don't end with a period in this context).
  const signedInEl = document.getElementById('signed-in-line');
  if (signedInEl) {
    signedInEl.textContent = t('dashboard.signedIn', {
      name: data.user.fullName || data.user.username,
      role: data.user.role,
    });
  }

  // Dashboard description block + cards.
  const dashTitle = document.getElementById('dashboard-title');
  if (dashTitle) dashTitle.textContent = t('dashboard.dashboardTitle');
  const dashBody = document.getElementById('dashboard-body');
  if (dashBody) dashBody.textContent = t('dashboard.dashboardBody');

  renderNavCards(data.user.role);
})();
