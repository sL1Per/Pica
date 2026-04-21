// Shared top navigation bar. Every authenticated page imports mountTopBar().
//
// The bar is injected as the first child of <body>. Pages do NOT need to
// include any HTML for it — this module controls the markup, styles, and
// behavior. Adding a new page means just calling mountTopBar() from its
// module and the bar appears.

const NAV_EMPLOYEE = [
  { href: '/punch',            label: 'Punches' },
  { href: '/leaves/calendar',  label: 'Calendar' },
  { href: '/leaves',           label: 'Leaves' },
  { href: '/reports',          label: 'Reports' },
  { href: '/settings',         label: 'Settings' },
];

const NAV_EMPLOYER = [
  { href: '/employees',        label: 'Employees' },
  { href: '/leaves/calendar',  label: 'Calendar' },
  { href: '/leaves',           label: 'Leaves' },
  { href: '/punch',            label: 'Punches' },
  { href: '/reports',          label: 'Reports' },
  { href: '/settings',         label: 'Settings' },
];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** Returns initials for a fallback avatar, 1–2 chars. */
function initialsFor(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? '?';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** True when the current URL matches an item's href exactly or as a prefix. */
function isActive(currentPath, href) {
  if (href === '/') return currentPath === '/';
  return currentPath === href || currentPath.startsWith(href + '/');
}

/**
 * Fetch branding, current user, and avatar-probe in parallel. Returns
 * { user, branding, hasOwnPicture } or null if unauthenticated (caller
 * should redirect to /login).
 */
async function loadBarData() {
  const [meRes, brandRes] = await Promise.all([
    fetch('/api/me',        { credentials: 'same-origin' }),
    fetch('/api/branding',  { credentials: 'same-origin' }),
  ]);
  if (meRes.status === 401) return null;
  const user = await meRes.json();
  const branding = brandRes.ok ? await brandRes.json() : { name: null, hasLogo: false };

  // Check if the user has uploaded their own profile picture. The /employees/:id
  // endpoint surfaces hasPicture on the profile payload (M6.1 fix).
  let hasOwnPicture = false;
  try {
    const profRes = await fetch(`/api/employees/${user.id}`, { credentials: 'same-origin' });
    if (profRes.ok) {
      const data = await profRes.json();
      hasOwnPicture = !!data.profile?.hasPicture;
    }
  } catch { /* non-fatal */ }

  return { user, branding, hasOwnPicture };
}

/**
 * Build the DOM. The structure:
 *
 *   <header.topbar>
 *     <div.topbar__inner>
 *       <a.topbar__brand href="/">
 *         <img|div.topbar__logo>
 *         <span.topbar__title>
 *       </a>
 *       <nav.topbar__nav>
 *         <a.topbar__link ...> per role
 *       </nav>
 *       <div.topbar__right>
 *         <button.topbar__hamburger ...>
 *         <button.topbar__avatar ...>
 *       </div>
 *       <div.topbar__menu [open]>   — avatar dropdown (desktop/mobile)
 *         username + role + Sign out
 *       </div>
 *       <div.topbar__drawer [open]> — mobile nav drawer (hamburger)
 *         same nav items, larger
 *       </div>
 *     </div>
 *   </header>
 */
function buildBar({ user, branding, hasOwnPicture }) {
  const items = user.role === 'employer' ? NAV_EMPLOYER : NAV_EMPLOYEE;
  const currentPath = window.location.pathname;

  const name = branding.name || 'Pica';
  const logoHtml = branding.hasLogo
    ? `<img class="topbar__logo" src="/api/branding/logo" alt="">`
    : `<div class="topbar__logo topbar__logo--placeholder" aria-hidden="true">P</div>`;

  const navLinks = items.map((it) => {
    const active = isActive(currentPath, it.href) ? ' topbar__link--active' : '';
    return `<a class="topbar__link${active}" href="${it.href}">${escapeHtml(it.label)}</a>`;
  }).join('');

  const drawerLinks = items.map((it) => {
    const active = isActive(currentPath, it.href) ? ' topbar__drawer-link--active' : '';
    return `<a class="topbar__drawer-link${active}" href="${it.href}">${escapeHtml(it.label)}</a>`;
  }).join('');

  const avatarInner = hasOwnPicture
    ? `<img src="/api/employees/${user.id}/picture" alt="">`
    : `<span>${initialsFor(user.username)}</span>`;

  const header = document.createElement('header');
  header.className = 'topbar';
  header.innerHTML = `
    <div class="topbar__inner">
      <a class="topbar__brand" href="/" aria-label="Dashboard">
        ${logoHtml}
        <span class="topbar__title">${escapeHtml(name)}</span>
      </a>

      <nav class="topbar__nav" aria-label="Primary">
        ${navLinks}
      </nav>

      <div class="topbar__right">
        <button class="topbar__hamburger" type="button" aria-label="Menu" aria-expanded="false">
          <span></span><span></span><span></span>
        </button>
        <button class="topbar__avatar" type="button" aria-label="User menu" aria-expanded="false">
          ${avatarInner}
        </button>
      </div>

      <div class="topbar__menu" role="menu" hidden>
        <div class="topbar__menu-head">
          <div class="topbar__menu-name">${escapeHtml(user.username)}</div>
          <div class="topbar__menu-role">${escapeHtml(user.role)}</div>
        </div>
        <a class="topbar__menu-item" role="menuitem" href="/employees/${user.id}">View my profile</a>
        <button class="topbar__menu-item topbar__menu-item--danger" role="menuitem" type="button" data-action="logout">Sign out</button>
      </div>

      <div class="topbar__drawer" hidden>
        ${drawerLinks}
      </div>
    </div>
  `;

  return header;
}

function wireEvents(header) {
  const avatar    = header.querySelector('.topbar__avatar');
  const menu      = header.querySelector('.topbar__menu');
  const hamburger = header.querySelector('.topbar__hamburger');
  const drawer    = header.querySelector('.topbar__drawer');
  const logoutBtn = header.querySelector('[data-action="logout"]');

  function closeAll() {
    menu.hidden = true;
    drawer.hidden = true;
    avatar.setAttribute('aria-expanded', 'false');
    hamburger.setAttribute('aria-expanded', 'false');
  }

  avatar.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    closeAll();
    if (open) {
      menu.hidden = false;
      avatar.setAttribute('aria-expanded', 'true');
    }
  });

  hamburger.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = drawer.hidden;
    closeAll();
    if (open) {
      drawer.hidden = false;
      hamburger.setAttribute('aria-expanded', 'true');
    }
  });

  // Close on outside click.
  document.addEventListener('click', (e) => {
    if (!header.contains(e.target)) closeAll();
  });

  // Close on escape.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
  });

  logoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {}
    window.location.href = '/login';
  });
}

/**
 * Mount the top bar. Pages that need authentication should call this as
 * early as possible in their module. If the user is unauthenticated,
 * redirects to /login and never resolves.
 */
export async function mountTopBar() {
  const data = await loadBarData();
  if (!data) {
    window.location.href = '/login';
    return;
  }
  const header = buildBar(data);
  document.body.insertBefore(header, document.body.firstChild);
  wireEvents(header);
  return data; // pages can reuse user/branding if they need
}
