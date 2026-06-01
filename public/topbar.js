// Importing app.js for its color-mode bootstrap side effect — applies
// the saved theme on every page that uses this module.
import '/app.js';
import { t, getLocale, fmtDate } from '/i18n.js';

// Sentinel returned by loadBarData() when it has already triggered a
// redirect (e.g. mustChangePassword → /preferences). mountTopBar() uses
// this to avoid a fallback /login redirect that would race the first.
const REDIRECTING = Symbol('redirecting');

// Shared app shell. Every authenticated page imports mountTopBar().
//
// mountTopBar() wraps the page's <main> in a <div.appshell> grid (sidebar +
// content column with its own top bar); the mobile top app-bar, bottom nav,
// user-menu popover, and drawer scrim are appended at the body level. Pages
// do NOT include any shell HTML — this module controls the markup and
// behavior (styles live in topbar.css). Adding a new page means just calling
// mountTopBar() from its module and the shell appears.

// Nav items use translation keys for labels. The key is resolved at
// build-time (i.e. when this module is imported on each page load). If
// a new locale ever lacks a key, the t() function shows "[key]" so the
// gap is obvious in the UI.
// Inline stroke icons (path data ported from the design's icons.jsx). Returns an
// SVG string for innerHTML; stroke uses currentColor so CSS controls the color.
const ICON_PATHS = {
  home: '<path d="M4 11l8-6 8 6v9a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3 2.8-5 6-5s6 2 6 5"/><path d="M16 4.5a3 3 0 0 1 0 6"/><path d="M21 20c0-2.4-1.6-4.3-4-4.8"/>',
  calendar: '<rect x="3.5" y="4.5" width="17" height="16" rx="2"/><path d="M3.5 9h17M8 3v3M16 3v3"/>',
  leaf: '<path d="M20 4c0 9-6 15-15 16 1-9 7-15 15-16z"/><path d="M5 20c4-6 8-10 14-14"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  chart: '<path d="M4 20h16"/><path d="M7 16v-4M12 16V8M17 16v-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h0a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v0a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  bell: '<path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4 20c0-3.6 3.6-6 8-6s8 2.4 8 6"/>',
  chevron: '<path d="M8 9l4-4 4 4M16 15l-4 4-4-4"/>',
  signout: '<path d="M15 17l5-5-5-5M20 12H9M12 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h7"/>',
  burger: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  // Chevron-left; CSS rotates it 180° in the collapsed state to point right.
  collapse: '<path d="M14 7l-5 5 5 5"/>',
};
function icon(name, size = 18, sw = 1.7) {
  return `<svg class="appshell__svg" width="${size}" height="${size}" viewBox="0 0 24 24" `
    + `fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" `
    + `stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

// Nav models. hrefs map to real Pica routes; `icon` keys index ICON_PATHS.
// Mobile bottom nav shows `primary`; employer overflow (Punches/Reports) lives
// behind "More" (the drawer).
const NAV_EMPLOYEE = [
  { href: '/',                 labelKey: 'nav.home',     icon: 'home' },
  { href: '/punch',            labelKey: 'nav.clock',    icon: 'clock' },
  { href: '/leaves/calendar',  labelKey: 'nav.calendar', icon: 'calendar' },
  { href: '/leaves',           labelKey: 'nav.myLeaves', icon: 'leaf' },
  { href: '/reports',          labelKey: 'nav.reports',  icon: 'chart' },
];
const NAV_EMPLOYER = [
  { href: '/',                 labelKey: 'nav.home',     icon: 'home' },
  { href: '/employees',        labelKey: 'nav.team',     icon: 'users' },
  { href: '/leaves/calendar',  labelKey: 'nav.calendar', icon: 'calendar' },
  { href: '/leaves',           labelKey: 'nav.leaves',   icon: 'leaf' },
  { href: '/punch',            labelKey: 'nav.punches',  icon: 'clock' },
  { href: '/reports',          labelKey: 'nav.reports',  icon: 'chart' },
];
// Deterministic avatar hue (oklch) from a string. The additive (h + charCode)
// algorithm is shared verbatim with employees.js / employee.js / index.js /
// leaves.js / leaves-calendar.js / employee-profile.js so a given person gets
// the same avatar colour on every page (user-tile, notifications, team list,
// dashboard, leaves, calendar, profile). Keep these copies identical.
function hueFor(s) {
  let h = 0; const str = String(s || '');
  for (const ch of str) h = (h + ch.charCodeAt(0)) % 360;
  return h;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Initials for a fallback avatar — first letter of the first two words, to
// match the shared scheme in employees.js / index.js / leaves.js / etc.
function initialsFor(name) {
  return (String(name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('')) || '?';
}

// HH:MM:SS for the top-bar crumb clock. Mirrors index.js's fmtClock (the
// home-hero clock it replaces) so the time reads identically — local 24h,
// zero-padded. The crumb shows this on every authenticated page.
function fmtClock(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Avatar HTML for a notification row: uploaded picture, else hue-tinted
 * initials. The hue rides on `data-hue` (not an inline `style` attribute,
 * which CSP `style-src 'self'` blocks) and is applied in `renderNotifs`.
 */
function notifAvatar(name, id, hasPicture) {
  const ini = escapeHtml(initialsFor(name));
  const hue = hueFor(name);
  // Picture wins; initials are the fallback. `data-hue`/`data-initials` ride on
  // the span (inline `style` attrs are CSP-blocked) so renderNotifs can tint it
  // and rebuild the initials if the picture fails to load.
  if (hasPicture && id) {
    return `<span class="appshell__notif-av" data-hue="${hue}" data-initials="${ini}"><img src="/api/employees/${encodeURIComponent(id)}/picture" alt=""></span>`;
  }
  return `<span class="appshell__notif-av" data-hue="${hue}">${ini}</span>`;
}

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

  // If the user's password was reset by an employer, push them to
  // /preferences where the change-password form lives. Skip the
  // redirect if we're already on /preferences (infinite-loop guard)
  // or on the logout endpoint.
  if (user.mustChangePassword
      && window.location.pathname !== '/preferences'
      && window.location.pathname !== '/logout') {
    window.location.href = '/preferences';
    // Return a sentinel that mountTopBar() recognizes as "redirect
    // already in progress, don't override with /login".
    return REDIRECTING;
  }

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
 * Build the DOM. The structure (M15 shell):
 *
 *   <aside.appshell__sidebar>           ← left rail (desktop) / drawer (mobile)
 *     <div.appshell__brand>             brand mark + name/sub + drawer-close
 *     <nav.appshell__nav>               primary nav links (icon + label)
 *     <div.appshell__spacer>
 *     <nav.appshell__nav--footer>       Settings link (employer only)
 *     <button.appshell__usertile>       avatar + name/role, opens user menu
 *   </aside>
 *
 *   <header.appshell__topbar>           ← desktop content top bar: crumb + bell
 *   <header.appshell__mobilebar>        ← mobile top app bar: burger/brand/avatar
 *   <nav.appshell__bottomnav>           ← mobile bottom nav (+ "More" for employer)
 *   <div.appshell__usermenu [hidden]>   ← shared popover (desktop tile + mobile avatar)
 *   <div.appshell__scrim [hidden]>      ← backdrop for the mobile drawer
 *
 * mountTopBar() wires the layout: the sidebar + a <div.appshell__content>
 * (holding the topbar and the page's <main>) sit inside a <div.appshell>
 * grid; the mobile chrome, popover, and scrim live at the body level.
 * Pages' HTML stays unchanged.
 */
function navLinks(items, currentPath, allHrefs, cls) {
  return items.map((it) => {
    const active = isActive(currentPath, it.href, allHrefs) ? ` ${cls}--active` : '';
    return `<a class="${cls}${active}" href="${it.href}">`
      + `<span class="appshell__nav-icon">${icon(it.icon, 18, active ? 2 : 1.7)}</span>`
      + `<span class="appshell__nav-label">${escapeHtml(t(it.labelKey))}</span>`
      + (active ? `<span class="appshell__nav-bar" aria-hidden="true"></span>` : '')
      + `</a>`;
  }).join('');
}

function buildBar({ user, branding, hasOwnPicture }) {
  const items = user.role === 'employer' ? NAV_EMPLOYER : NAV_EMPLOYEE;
  const currentPath = window.location.pathname;
  const allHrefs = items.map((x) => x.href).concat(user.role === 'employer' ? ['/settings'] : []);
  const name = branding.name || 'Pica';
  const sub = escapeHtml(t('app.suffix'));
  // Seed from the display name (not the id) so the user-tile avatar colour
  // matches this same person's avatar in the team list / dashboard / etc.
  const hue = hueFor(user.fullName || user.username);
  const displayName = escapeHtml(user.fullName || user.username);
  const role = escapeHtml(user.role);

  const brandMark = branding.hasLogo
    ? `<img class="appshell__brand-mark appshell__brand-mark--img" src="/api/branding/logo" alt="">`
    : `<span class="appshell__brand-mark" aria-hidden="true">${escapeHtml(name[0] || 'P')}</span>`;
  const avatarInner = hasOwnPicture
    ? `<img src="/api/employees/${user.id}/picture" alt="">`
    : `<span>${escapeHtml(initialsFor(user.fullName || user.username))}</span>`;

  // -- Sidebar (desktop rail / mobile drawer) -----------------------------
  const sidebar = document.createElement('aside');
  sidebar.className = 'appshell__sidebar';
  sidebar.id = 'appshell-sidebar';
  sidebar.innerHTML = `
    <div class="appshell__brand">
      <a class="appshell__brand-link" href="/" aria-label="Home">${brandMark}</a>
      <div class="appshell__brand-text">
        <div class="appshell__brand-name">${escapeHtml(name)}</div>
        <div class="appshell__brand-sub">${sub}</div>
      </div>
      <button class="appshell__drawer-close" type="button" aria-label="Close menu">&times;</button>
    </div>
    <nav class="appshell__nav" aria-label="Primary">
      ${navLinks(items, currentPath, allHrefs, 'appshell__nav-link')}
    </nav>
    <div class="appshell__spacer"></div>
    ${user.role === 'employer' ? `<nav class="appshell__nav appshell__nav--footer" aria-label="Settings">
      ${navLinks([{ href: '/settings', labelKey: 'nav.settings', icon: 'settings' }], currentPath, allHrefs, 'appshell__nav-link')}
    </nav>` : ''}
    <button class="appshell__usertile" type="button" aria-haspopup="menu" aria-expanded="false">
      <span class="appshell__avatar">${avatarInner}</span>
      <span class="appshell__usertile-info">
        <span class="appshell__usertile-name">${displayName}</span>
        <span class="appshell__usertile-role">${role}</span>
      </span>
      <span class="appshell__usertile-chev">${icon('chevron', 14, 1.8)}</span>
    </button>
    <button class="appshell__collapse" type="button" aria-label="${escapeHtml(t('nav.collapse'))}" title="${escapeHtml(t('nav.collapse'))}">
      <span class="appshell__collapse-icon">${icon('collapse', 18, 1.8)}</span>
      <span class="appshell__collapse-label">${escapeHtml(t('nav.collapse'))}</span>
    </button>`;

  // -- Desktop content top bar (crumb + bell) -----------------------------
  const topbar = document.createElement('header');
  topbar.className = 'appshell__topbar';
  let dateLabel = '';
  try { dateLabel = fmtDate(new Date()); } catch { dateLabel = ''; }
  topbar.innerHTML = `
    <div class="appshell__crumb">
      <span class="appshell__crumb-clock mono">
        <span class="appshell__crumb-dot" aria-hidden="true"></span>
        <span data-live-clock>${escapeHtml(fmtClock(new Date()))}</span>
      </span>
      <span class="appshell__crumb-sep">&middot;</span>
      <span class="appshell__crumb-date mono">${escapeHtml(dateLabel)}</span>
    </div>
    <div class="appshell__topactions">
      <button class="appshell__iconbtn appshell__bell" type="button" aria-label="${escapeHtml(t('nav.notifications'))}" aria-haspopup="menu" aria-expanded="false">
        ${icon('bell', 17, 1.6)}
      </button>
    </div>`;

  // Tick the crumb clock every second. The shell lives for the whole page
  // lifetime, so this interval is intentionally never cleared (same pattern
  // as the home-hero clock this replaces). textContent only — no re-render.
  const liveClock = topbar.querySelector('[data-live-clock]');
  if (liveClock) setInterval(() => { liveClock.textContent = fmtClock(new Date()); }, 1000);

  // -- Mobile top app bar -------------------------------------------------
  const mobilebar = document.createElement('header');
  mobilebar.className = 'appshell__mobilebar';
  mobilebar.innerHTML = `
    <button class="appshell__burger" type="button" aria-label="Menu" aria-controls="appshell-sidebar" aria-expanded="false">${icon('burger', 18, 1.8)}</button>
    <a class="appshell__mobilebrand" href="/">
      ${brandMark}
      <span class="appshell__mobilebrand-name">${escapeHtml(name)}</span>
    </a>
    <button class="appshell__iconbtn appshell__bell" type="button" aria-label="${escapeHtml(t('nav.notifications'))}" aria-haspopup="menu" aria-expanded="false">${icon('bell', 17, 1.6)}</button>
    <button class="appshell__mobile-avatar" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="${escapeHtml(t('menu.account'))}">
      <span class="appshell__avatar">${avatarInner}</span>
    </button>`;

  // -- Mobile bottom nav --------------------------------------------------
  const bottomnav = document.createElement('nav');
  bottomnav.className = 'appshell__bottomnav';
  bottomnav.setAttribute('aria-label', 'Primary');
  const primary = user.role === 'employer' ? items.slice(0, 4) : items;
  const bottomItems = primary.map((it) => {
    const active = isActive(currentPath, it.href, allHrefs) ? ' appshell__bottom-item--active' : '';
    return `<a class="appshell__bottom-item${active}" href="${it.href}">`
      + `${icon(it.icon, 22, active ? 2 : 1.6)}`
      + `<span class="appshell__bottom-label">${escapeHtml(t(it.labelKey))}</span></a>`;
  }).join('');
  const more = user.role === 'employer'
    ? `<button class="appshell__bottom-item" type="button" data-action="more">${icon('more', 22, 1.7)}<span class="appshell__bottom-label">${escapeHtml(t('nav.more'))}</span></button>`
    : '';
  bottomnav.innerHTML = bottomItems + more;

  // -- User menu popover (shared by desktop usertile + mobile avatar) ------
  const menu = document.createElement('div');
  menu.className = 'appshell__usermenu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  menu.innerHTML = `
    <div class="appshell__usermenu-head">
      <div class="appshell__usermenu-name">${displayName}</div>
      <div class="appshell__usermenu-role">${role}</div>
    </div>
    <a class="appshell__usermenu-item" role="menuitem" href="/employees/${user.id}/profile">
      ${icon('user', 16, 1.7)}<span>${escapeHtml(t('menu.profile'))}</span></a>
    <a class="appshell__usermenu-item" role="menuitem" href="/preferences">
      ${icon('settings', 16, 1.7)}<span>${escapeHtml(t('menu.preferences'))}</span></a>
    <div class="appshell__usermenu-sep"></div>
    <button class="appshell__usermenu-item appshell__usermenu-item--danger" role="menuitem" type="button" data-action="logout">
      ${icon('signout', 16, 1.7)}<span>${escapeHtml(t('menu.signOut'))}</span></button>`;

  // -- Notifications panel (shared by desktop + mobile bell) --------------
  const notif = document.createElement('div');
  notif.className = 'appshell__notif';
  notif.setAttribute('role', 'menu');
  notif.hidden = true;
  notif.innerHTML = `
    <div class="appshell__notif-head">${escapeHtml(t('notifications.title'))}</div>
    <div class="appshell__notif-list" aria-busy="true"></div>`;

  // -- Drawer scrim -------------------------------------------------------
  const scrim = document.createElement('div');
  scrim.className = 'appshell__scrim';
  scrim.setAttribute('hidden', '');

  // Per-user avatar hue: set via CSSOM (not an inline style= attribute, which
  // CSP style-src 'self' would block when parsed from the markup above).
  for (const host of [sidebar, mobilebar]) {
    host.querySelectorAll('.appshell__avatar').forEach((a) => a.style.setProperty('--hue', hue));
  }

  return { sidebar, topbar, mobilebar, bottomnav, menu, notif, scrim, user };
}

function wireEvents({ sidebar, mobilebar, bottomnav, menu, notif, scrim, user }) {
  const usertile  = sidebar.querySelector('.appshell__usertile');
  const drawerX   = sidebar.querySelector('.appshell__drawer-close');
  const burger    = mobilebar.querySelector('.appshell__burger');
  const mAvatar   = mobilebar.querySelector('.appshell__mobile-avatar');
  const moreBtn   = bottomnav.querySelector('[data-action="more"]');
  const logoutBtn = menu.querySelector('[data-action="logout"]');
  const bells     = document.querySelectorAll('.appshell__bell');
  const notifList = notif.querySelector('.appshell__notif-list');

  function closeMenu() { menu.hidden = true; usertile?.setAttribute('aria-expanded', 'false'); mAvatar?.setAttribute('aria-expanded', 'false'); }
  function closeNotif() { notif.hidden = true; bells.forEach((b) => b.setAttribute('aria-expanded', 'false')); }
  function openDrawer() { sidebar.classList.add('appshell__sidebar--open'); scrim.hidden = false; burger?.setAttribute('aria-expanded', 'true'); }
  function closeDrawer() { sidebar.classList.remove('appshell__sidebar--open'); scrim.hidden = true; burger?.setAttribute('aria-expanded', 'false'); }
  function closeAll() { closeMenu(); closeNotif(); closeDrawer(); }

  // Position a popover (user menu or notifications) near its trigger, clamped
  // to the viewport. Inline top/left via CSSOM (not a style= attribute, which
  // CSP style-src 'self' would block from parsed markup).
  function positionPopover(el, trigger) {
    const a = trigger.getBoundingClientRect();
    const m = el.getBoundingClientRect();
    const gap = 8, margin = 12;
    let top = a.bottom + gap;
    if (top + m.height + margin > window.innerHeight && a.top - m.height - gap > margin) top = a.top - m.height - gap;
    top = Math.max(margin, Math.min(top, window.innerHeight - m.height - margin));
    let left = a.right - m.width;
    if (left < margin) left = a.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - m.width - margin));
    el.style.top = `${Math.round(top)}px`;
    el.style.left = `${Math.round(left)}px`;
  }
  function openMenu(trigger) {
    closeDrawer(); closeNotif();
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    positionPopover(menu, trigger);
  }
  function toggleMenu(trigger) { if (menu.hidden) openMenu(trigger); else closeMenu(); }
  function openNotif(trigger) {
    closeDrawer(); closeMenu();
    notif.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    positionPopover(notif, trigger);
  }
  function toggleNotif(trigger) { if (notif.hidden) openNotif(trigger); else closeNotif(); }

  // -- Notifications: aggregate the viewer's pending items (employer: awaiting
  // their decision; employee: their own pending requests). Best-effort; refresh
  // on mount + tab focus. No new backend — reuses /api/leaves + /api/corrections.
  function renderNotifs(leaves, corrs) {
    const count = leaves.length + corrs.length;
    bells.forEach((b) => b.classList.toggle('appshell__bell--dot', count > 0));
    notifList.removeAttribute('aria-busy');
    if (count === 0) {
      notifList.innerHTML = `<div class="appshell__notif-empty">${escapeHtml(t('notifications.empty'))}</div>`;
      return;
    }
    const isEmployer = user.role === 'employer';
    const rows = [];
    for (const l of leaves) {
      const name = l.fullName || l.username || '';
      const label = isEmployer
        ? t('notifications.leavePending', { name, type: t('leaves.type.' + l.type), when: l.start })
        : t('notifications.leaveMine', { type: t('leaves.type.' + l.type), when: l.start });
      rows.push(`<a class="appshell__notif-item" role="menuitem" href="/leaves/${encodeURIComponent(l.id)}">${notifAvatar(name, l.employeeId, l.hasPicture)}<span class="appshell__notif-text">${escapeHtml(label)}</span></a>`);
    }
    for (const c of corrs) {
      // c.start is an ISO datetime; slice to YYYY-MM-DD to match the leave
      // format and avoid new Date() UTC-midnight day-shift.
      const when = (c.date || c.start || '').slice(0, 10);
      const name = c.fullName || c.username || '';
      const label = isEmployer
        ? t('notifications.correctionPending', { name, when })
        : t('notifications.correctionMine', { when });
      rows.push(`<a class="appshell__notif-item" role="menuitem" href="/corrections/${encodeURIComponent(c.id)}">${notifAvatar(name, c.employeeId, c.hasPicture)}<span class="appshell__notif-text">${escapeHtml(label)}</span></a>`);
    }
    notifList.innerHTML = rows.join('');
    // Apply hue via DOM property — CSP `style-src 'self'` blocks inline
    // `style` attributes, so we can't set it in the innerHTML string.
    notifList.querySelectorAll('.appshell__notif-av[data-hue]').forEach((av) => {
      av.style.setProperty('--hue', av.dataset.hue);
    });
    // Picture fails to load → fall back to the tinted initials.
    notifList.querySelectorAll('.appshell__notif-av img').forEach((img) => {
      img.addEventListener('error', () => { img.parentElement.textContent = img.parentElement.dataset.initials || '?'; });
    });
  }
  async function loadNotifs() {
    let leaves = [], corrs = [];
    try {
      const [lr, cr] = await Promise.all([
        fetch('/api/leaves', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : { leaves: [] })),
        fetch('/api/corrections?status=pending', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : { corrections: [] })),
      ]);
      leaves = (lr.leaves || []).filter((l) => l.status === 'pending');
      corrs = cr.corrections || [];
    } catch { /* best-effort; render whatever we have (likely empty) */ }
    renderNotifs(leaves, corrs);
  }

  usertile?.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(usertile); });
  mAvatar?.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(mAvatar); });
  bells.forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); toggleNotif(b); }));
  burger?.addEventListener('click', (e) => { e.stopPropagation(); sidebar.classList.contains('appshell__sidebar--open') ? closeDrawer() : openDrawer(); });
  moreBtn?.addEventListener('click', (e) => { e.stopPropagation(); openDrawer(); });
  drawerX?.addEventListener('click', () => closeDrawer());
  scrim.addEventListener('click', () => closeDrawer());
  sidebar.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => closeDrawer()));

  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && !sidebar.contains(e.target) && !mobilebar.contains(e.target)) closeMenu();
    if (!notif.contains(e.target) && ![...bells].some((b) => b.contains(e.target))) closeNotif();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });

  logoutBtn.addEventListener('click', async () => {
    try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
    window.location.href = '/login';
  });

  loadNotifs();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadNotifs(); });
}

/**
 * Mount the shell (sidebar + content top bar + mobile chrome). Pages that
 * need authentication should call this as early as possible. Unauthenticated
 * users are redirected to /login.
 *
 * The sidebar and a <div.appshell__content> (which receives the top bar and
 * the page's <main>) are placed inside a <div.appshell> grid so CSS can lay
 * them out as a row. The mobile bar, bottom nav, user-menu popover, and
 * drawer scrim are appended at the body level. Pages' HTML stays unchanged.
 */
export async function mountTopBar() {
  const data = await loadBarData();
  if (data === REDIRECTING) return;
  if (!data) { window.location.href = '/login'; return; }

  const { sidebar, topbar, mobilebar, bottomnav, menu, notif, scrim, user } = buildBar(data);
  const main = document.querySelector('main');

  // Desktop grid: <div.appshell> [ sidebar | <div.appshell__content> [topbar, main, footer] ].
  const appshell = document.createElement('div');
  appshell.className = 'appshell';

  // Restore the persisted collapsed (icon-only rail) state before the sidebar
  // is laid out, so it never flashes expanded first. Desktop-only behaviour;
  // the CSS scopes the collapsed rules to ≥761px so the mobile drawer is
  // unaffected even when the flag is set.
  let collapsed = false;
  try { collapsed = localStorage.getItem('pica-sidebar-collapsed') === '1'; } catch {}
  if (collapsed) appshell.classList.add('appshell--collapsed');
  const content = document.createElement('div');
  content.className = 'appshell__content';

  if (main) {
    main.parentNode.insertBefore(appshell, main);
    appshell.appendChild(sidebar);
    appshell.appendChild(content);
    content.appendChild(topbar);
    content.appendChild(main);   // moves <main> into the content column
  } else {
    document.body.appendChild(appshell);
    appshell.appendChild(sidebar);
    appshell.appendChild(content);
  }

  // Mobile chrome + shared popover/scrim live at the body level.
  document.body.insertBefore(mobilebar, document.body.firstChild);
  document.body.appendChild(scrim);
  document.body.appendChild(bottomnav);
  document.body.appendChild(menu);
  document.body.appendChild(notif);

  wireEvents({ sidebar, mobilebar, bottomnav, menu, notif, scrim, user });

  // Collapse toggle: shrink the sidebar to an icon-only rail and back, persisting
  // the choice across pages. Labels/brand-text/user-tile text are hidden by CSS
  // (.appshell--collapsed); here we only flip the class + the stored flag + a11y.
  const collapseBtn = sidebar.querySelector('.appshell__collapse');
  collapseBtn?.addEventListener('click', () => {
    const isCol = appshell.classList.toggle('appshell--collapsed');
    try { localStorage.setItem('pica-sidebar-collapsed', isCol ? '1' : '0'); } catch {}
    const label = isCol ? t('nav.expand') : t('nav.collapse');
    collapseBtn.setAttribute('aria-label', label);
    collapseBtn.setAttribute('title', label);
  });
  if (collapsed && collapseBtn) {
    collapseBtn.setAttribute('aria-label', t('nav.expand'));
    collapseBtn.setAttribute('title', t('nav.expand'));
  }

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
  (document.querySelector('.appshell__content') || document.body).appendChild(footer);
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
