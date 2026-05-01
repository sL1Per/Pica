// Importing app.js for its color-mode bootstrap side effect — applies
// the saved theme on every page that uses this module.
import '/app.js';
import { t, getLocale } from '/i18n.js';

// Shared top navigation bar. Every authenticated page imports mountTopBar().
//
// The bar is injected as the first child of <body>. Pages do NOT need to
// include any HTML for it — this module controls the markup, styles, and
// behavior. Adding a new page means just calling mountTopBar() from its
// module and the bar appears.

// Nav items use translation keys for labels. The key is resolved at
// build-time (i.e. when this module is imported on each page load). If
// a new locale ever lacks a key, the t() function shows "[key]" so the
// gap is obvious in the UI.
const NAV_EMPLOYEE = [
  { href: '/punch',            labelKey: 'nav.punches' },
  { href: '/leaves/calendar',  labelKey: 'nav.calendar' },
  { href: '/leaves',           labelKey: 'nav.leaves' },
  { href: '/reports',          labelKey: 'nav.reports' },
];

const NAV_EMPLOYER = [
  { href: '/employees',        labelKey: 'nav.employees' },
  { href: '/leaves/calendar',  labelKey: 'nav.calendar' },
  { href: '/leaves',           labelKey: 'nav.leaves' },
  { href: '/punch',            labelKey: 'nav.punches' },
  { href: '/reports',          labelKey: 'nav.reports' },
  { href: '/settings',         labelKey: 'nav.settings' },
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
/**
 * Is `href` the active nav entry for the current path?
 *
 * Exact equality always wins. Otherwise, prefix-match (`/leaves` should
 * highlight while on `/leaves/abc-123`) — UNLESS some OTHER nav entry is
 * a more-specific prefix match. That sibling rule prevents `/leaves` from
 * lighting up while on `/leaves/calendar`, which is its own nav item.
 */
function isActive(currentPath, href, allHrefs = []) {
  if (href === '/') return currentPath === '/';
  if (currentPath === href) return true;
  if (!currentPath.startsWith(href + '/')) return false;

  // Path is a sub-route of `href`. Check whether a different nav entry
  // covers it more specifically — if so, that one wins, not this one.
  for (const other of allHrefs) {
    if (other === href) continue;
    if (other.length <= href.length) continue;
    if (currentPath === other || currentPath.startsWith(other + '/')) {
      return false;
    }
  }
  return true;
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
 *   <header.appshell__header>           ← full-width across the top
 *     <div.appshell__header-inner>      ← grid: logo | title | controls
 *       <a.appshell__brand href="/">
 *         <img|div.appshell__logo>
 *       </a>
 *       <h1.appshell__title>
 *         <span.appshell__title-name>   {company name}
 *         <span.appshell__title-sep>    " — "
 *         <span.appshell__title-app>    "Time management"
 *       </h1>
 *       <div.appshell__header-right>
 *         <button.appshell__hamburger>  ← mobile only
 *         <button.appshell__avatar>     ← always, opens user menu
 *       </div>
 *       <div.appshell__menu [hidden]>   ← user menu dropdown
 *     </div>
 *   </header>
 *
 *   <aside.appshell__sidebar>           ← left rail (desktop) / drawer (mobile)
 *     <nav.appshell__nav>
 *       <a.appshell__nav-link>{label}   per nav item
 *     </nav>
 *   </aside>
 *
 *   <div.appshell__scrim [hidden]>      ← backdrop for mobile drawer
 *
 * The header goes at the top of <body>. The sidebar + scrim are inserted
 * into a new <div.appshell__body> wrapper alongside <main> so they can
 * lay out as a row. mountTopBar() handles the wrapping; pages' HTML
 * stays unchanged.
 */
function buildBar({ user, branding, hasOwnPicture }) {
  const items = user.role === 'employer' ? NAV_EMPLOYER : NAV_EMPLOYEE;
  const currentPath = window.location.pathname;
  const allHrefs = items.map((x) => x.href);

  const name = branding.name || 'Pica';
  const logoHtml = branding.hasLogo
    ? `<img class="appshell__logo" src="/api/branding/logo" alt="">`
    : `<div class="appshell__logo appshell__logo--placeholder" aria-hidden="true">P</div>`;

  // Sidebar links (desktop) — vertical list, active state visually distinct.
  const sidebarLinks = items.map((it) => {
    const active = isActive(currentPath, it.href, allHrefs) ? ' appshell__nav-link--active' : '';
    return `<a class="appshell__nav-link${active}" href="${it.href}">${escapeHtml(t(it.labelKey))}</a>`;
  }).join('');

  // Drawer links (mobile) — same set, distinct CSS so they can grow taller.
  const drawerLinks = items.map((it) => {
    const active = isActive(currentPath, it.href, allHrefs) ? ' appshell__drawer-link--active' : '';
    return `<a class="appshell__drawer-link${active}" href="${it.href}">${escapeHtml(t(it.labelKey))}</a>`;
  }).join('');

  const avatarInner = hasOwnPicture
    ? `<img src="/api/employees/${user.id}/picture" alt="">`
    : `<span>${initialsFor(user.fullName || user.username)}</span>`;

  // -- Header (full-width, top of viewport) -------------------------------
  // Layout: logo (left) — title (center, brand name + " — Time management") — controls (right).
  // Mobile: hamburger to open the sidebar drawer; avatar always present.
  const header = document.createElement('header');
  header.className = 'appshell__header';
  header.innerHTML = `
    <div class="appshell__header-inner">
      <a class="appshell__brand" href="/" aria-label="Dashboard">
        ${logoHtml}
      </a>

      <h1 class="appshell__title">
        <span class="appshell__title-name">${escapeHtml(name)}</span>
        <span class="appshell__title-sep"> — </span>
        <span class="appshell__title-app">${escapeHtml(t('app.suffix'))}</span>
      </h1>

      <div class="appshell__header-right">
        <button class="appshell__hamburger" type="button" aria-label="Menu" aria-expanded="false" aria-controls="appshell-sidebar">
          <span></span><span></span><span></span>
        </button>
        <button class="appshell__avatar" type="button" aria-label="User menu" aria-expanded="false">
          ${avatarInner}
        </button>
      </div>

      <div class="appshell__menu" role="menu" hidden>
        <div class="appshell__menu-head">
          <div class="appshell__menu-name">${escapeHtml(user.fullName || user.username)}</div>
          <div class="appshell__menu-role">${escapeHtml(user.role)}</div>
        </div>
        <a class="appshell__menu-item" role="menuitem" href="/employees/${user.id}">${escapeHtml(t('menu.profile'))}</a>
        <a class="appshell__menu-item" role="menuitem" href="/preferences">${escapeHtml(t('menu.preferences'))}</a>
        <button class="appshell__menu-item appshell__menu-item--danger" role="menuitem" type="button" data-action="logout">${escapeHtml(t('menu.signOut'))}</button>
      </div>
    </div>
  `;

  // -- Sidebar (left, vertical nav, full content height) -------------------
  // Desktop: always visible, fixed width.
  // Mobile (≤900px): hidden by default, slides in as a drawer when the
  // hamburger is tapped (controlled by .appshell__sidebar--open).
  const sidebar = document.createElement('aside');
  sidebar.className = 'appshell__sidebar';
  sidebar.id = 'appshell-sidebar';
  sidebar.innerHTML = `
    <nav class="appshell__nav" aria-label="Primary">
      ${sidebarLinks}
    </nav>
  `;

  // -- Drawer scrim (only visible when the sidebar is open on mobile) ----
  // Tapping the scrim closes the drawer. Separate element so it can sit
  // *under* the sidebar in z-index but above the main content.
  const scrim = document.createElement('div');
  scrim.className = 'appshell__scrim';
  scrim.setAttribute('hidden', '');

  return { header, sidebar, scrim };
}

function wireEvents({ header, sidebar, scrim }) {
  const avatar    = header.querySelector('.appshell__avatar');
  const menu      = header.querySelector('.appshell__menu');
  const hamburger = header.querySelector('.appshell__hamburger');
  const logoutBtn = header.querySelector('[data-action="logout"]');

  function closeMenu() {
    menu.hidden = true;
    avatar.setAttribute('aria-expanded', 'false');
  }
  function closeSidebar() {
    sidebar.classList.remove('appshell__sidebar--open');
    scrim.hidden = true;
    hamburger.setAttribute('aria-expanded', 'false');
  }
  function closeAll() {
    closeMenu();
    closeSidebar();
  }

  avatar.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = menu.hidden;
    closeAll();
    if (willOpen) {
      menu.hidden = false;
      avatar.setAttribute('aria-expanded', 'true');
    }
  });

  // Hamburger toggles the sidebar drawer (mobile only — at desktop sizes
  // the sidebar is always visible and the hamburger is hidden by CSS, so
  // this event won't fire from a desktop click).
  hamburger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = sidebar.classList.contains('appshell__sidebar--open');
    closeAll();
    if (!isOpen) {
      sidebar.classList.add('appshell__sidebar--open');
      scrim.hidden = false;
      hamburger.setAttribute('aria-expanded', 'true');
    }
  });

  // Tap on scrim closes the drawer.
  scrim.addEventListener('click', () => closeSidebar());

  // Tap on a sidebar link closes the drawer too (so navigation feels
  // snappy on mobile — the new page loads, the drawer doesn't linger).
  sidebar.querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', () => closeSidebar());
  });

  // Click outside the menu closes it. Note: clicks inside the sidebar
  // are NOT "outside" — so opening the avatar menu and then clicking a
  // sidebar link works without the menu intercepting.
  document.addEventListener('click', (e) => {
    if (!header.contains(e.target) && !sidebar.contains(e.target)) closeAll();
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
 * Mount the top bar AND the sidebar. Pages that need authentication
 * should call this as early as possible. Unauthenticated users are
 * redirected to /login.
 *
 * The header goes at the top of <body>. The sidebar + scrim sit just
 * before <main> so the flex container in CSS can lay them out as a row.
 */
export async function mountTopBar() {
  const data = await loadBarData();
  if (!data) {
    window.location.href = '/login';
    return;
  }
  const { header, sidebar, scrim } = buildBar(data);

  // Insert the header as the first child.
  document.body.insertBefore(header, document.body.firstChild);

  // Find where main lives and wrap main + sidebar in a flex container.
  // The wrapper (`appshell__body`) is created here so pages don't need
  // to wrap their <main> manually — keeps each page's HTML simple.
  const main = document.querySelector('main');
  if (main) {
    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'appshell__body';
    main.parentNode.insertBefore(bodyWrap, main);
    bodyWrap.appendChild(sidebar);
    bodyWrap.appendChild(main);
    bodyWrap.appendChild(scrim);
  } else {
    // No <main> on this page — just append the sidebar to body so
    // the CSS still has something to lay out (rare; e.g. login page
    // doesn't call mountTopBar).
    document.body.appendChild(sidebar);
    document.body.appendChild(scrim);
  }

  wireEvents({ header, sidebar, scrim });
  return data;
}


// =====================================================================
// mountFooter() — appended to <body> on every page.
// Fetches /api/version once per session and caches the result.
// =====================================================================

let _footerMounted = false;
let _versionCache = null;

async function getVersion() {
  if (_versionCache) return _versionCache;
  try {
    const res = await fetch('/api/version', { credentials: 'same-origin' });
    if (!res.ok) return null;
    _versionCache = await res.json();
    return _versionCache;
  } catch {
    return null;
  }
}

function formatReleaseDate(d) {
  if (!d) return '';
  // d is YYYY-MM-DD. Use Intl with the resolved locale so the month name
  // and ordering match user expectations (e.g. "30 de abr. de 2026" in PT
  // vs "Apr 30, 2026" in en-US). Fall back to the raw date on any error.
  try {
    const [y, m, day] = d.split('-').map(Number);
    if (!y || !m || !day) return d;
    const date = new Date(Date.UTC(y, m - 1, day));
    return new Intl.DateTimeFormat(getLocale(), {
      year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
    }).format(date);
  } catch {
    return d;
  }
}

export async function mountFooter() {
  if (_footerMounted) return;
  _footerMounted = true;

  const v = await getVersion();
  const footer = document.createElement('footer');
  footer.className = 'app-footer';
  if (v) {
    const date = formatReleaseDate(v.releaseDate);
    // Version label links to the changelog. Repo link stays separate so users
    // can still get to the source root in one click.
    const releasesUrl = v.repository ? `${v.repository.replace(/\/+$/, '')}/blob/main/RELEASES.md` : null;
    const versionEl = releasesUrl
      ? `<a href="${releasesUrl}" target="_blank" rel="noopener">Pica v${v.version}</a>`
      : `Pica v${v.version}`;
    const repoEl = v.repository
      ? `<a href="${v.repository}" target="_blank" rel="noopener">GitHub</a>`
      : '';
    const parts = [versionEl];
    if (date)   parts.push(date);
    if (repoEl) parts.push(repoEl);
    footer.innerHTML = parts.join(' · ');
  } else {
    footer.textContent = 'Pica';
  }
  document.body.appendChild(footer);
}

// Register the service worker so the app is installable + offline-capable.
// Idempotent: if a previous registration exists, browser quietly updates.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Registration may fail in private/incognito or on http (non-localhost).
      // Not fatal — site continues to work without offline support.
    });
  });
}
