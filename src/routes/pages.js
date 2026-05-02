import path from 'node:path';
import fs from 'node:fs';

/**
 * Page routes: the HTML entry points.
 *
 * Responsibilities:
 *   - `GET /setup`    — shown only when no users exist; redirects to /login otherwise.
 *   - `GET /login`    — shown only when setup is done; redirects to /setup otherwise.
 *                       If already authenticated, redirects to /.
 *   - `GET /`         — the home page; redirects to /login or /setup as appropriate.
 *
 * Each handler reads its HTML from disk under /public and responds directly.
 * CSS/JS continue to be served by the static file handler.
 */
export function registerPageRoutes(router, { publicDir, usersStore, userPrefsStore, authenticate }) {

  // Resolve which locale to embed in the served HTML. Falls back to the
  // default if the user is unauthenticated (login/setup) or has no
  // stored preference yet.
  function resolveLocale(req) {
    try {
      const ctx = authenticate?.(req);
      if (!ctx?.user?.id) return 'en-US';
      const prefs = userPrefsStore?.get(ctx.user.id);
      return prefs?.locale ?? 'en-US';
    } catch {
      return 'en-US';
    }
  }

  // Inject the locale into the HTML on its way out:
  //   1. Replace `lang="en"` on <html> with the resolved locale.
  //   2. Add a <meta name="pica-locale" content="..."> tag right before
  //      the existing manifest link (which every page has — see 0.11).
  // Pages already use lang="en" in their static HTML; if a page is
  // missing the lang attribute or the manifest link, we fall back to
  // appending the meta tag right after <head>.
  function injectLocale(html, locale) {
    let out = html;
    // (1) Update <html lang="...">.
    if (/<html\s+lang="[^"]*"/i.test(out)) {
      out = out.replace(/<html\s+lang="[^"]*"/i, `<html lang="${locale}"`);
    } else {
      out = out.replace(/<html\b/i, `<html lang="${locale}"`);
    }
    // (2) Add the pica-locale meta tag (only if not already present).
    if (!/<meta\s+name="pica-locale"/i.test(out)) {
      const tag = `<meta name="pica-locale" content="${locale}">\n  `;
      const m = out.match(/<link\s+rel="manifest"/i);
      if (m) {
        out = out.replace(m[0], tag + m[0]);
      } else {
        out = out.replace(/<head>/i, `<head>\n  ${tag.trimEnd()}`);
      }
    }
    return out;
  }

  async function sendHtml(res, file, req) {
    const abs = path.join(publicDir, file);
    const body = await fs.promises.readFile(abs, 'utf8');
    const locale = req ? resolveLocale(req) : 'en-US';
    res.html(injectLocale(body, locale));
  }

  function authed(req) {
    if (!usersStore.hasAny()) return { redirect: '/setup' };
    const ctx = authenticate(req);
    if (!ctx) return { redirect: '/login' };
    return { ctx };
  }

  router.get('/', async (req, res) => {
    if (!usersStore.hasAny()) return res.redirect('/setup');
    if (!authenticate(req))   return res.redirect('/login');
    await sendHtml(res, 'index.html', req);
  });

  router.get('/setup', async (req, res) => {
    if (usersStore.hasAny()) return res.redirect('/login');
    await sendHtml(res, 'setup.html', req);
  });

  router.get('/login', async (req, res) => {
    if (!usersStore.hasAny()) return res.redirect('/setup');
    if (authenticate(req))    return res.redirect('/');
    await sendHtml(res, 'login.html', req);
  });

  // -- Employee pages -----------------------------------------------------

  router.get('/employees', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    if (a.ctx.user.role !== 'employer') return res.redirect('/profile');
    await sendHtml(res, 'employees.html', req);
  });

  router.get('/employees/new', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    if (a.ctx.user.role !== 'employer') return res.redirect('/profile');
    await sendHtml(res, 'employee-new.html', req);
  });

  router.get('/profile', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    res.redirect(`/employees/${a.ctx.user.id}`);
  });

  // -- Punches ------------------------------------------------------------

  router.get('/punch', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    await sendHtml(res, 'punch.html', req);
  });

  router.get('/punches/today', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    await sendHtml(res, 'punches-today.html', req);
  });

  // -- Leaves -------------------------------------------------------------

  router.get('/leaves', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    await sendHtml(res, 'leaves.html', req);
  });

  router.get('/leaves/calendar', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    await sendHtml(res, 'leaves-calendar.html', req);
  });

  router.get('/leaves/new', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    await sendHtml(res, 'leave-new.html', req);
  });

  router.get('/leaves/:id', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    await sendHtml(res, 'leave.html', req);
  });

  // -- Corrections (manual time entries) ---------------------------------

  router.get('/corrections', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    await sendHtml(res, 'corrections.html', req);
  });

  router.get('/corrections/new', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    await sendHtml(res, 'correction-new.html', req);
  });

  router.get('/corrections/:id', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    await sendHtml(res, 'correction.html', req);
  });

  // -- Reports ------------------------------------------------------------

  router.get('/reports', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    await sendHtml(res, 'reports.html', req);
  });

  // -- Preferences (any authenticated user) -------------------------------

  router.get('/preferences', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    await sendHtml(res, 'preferences.html', req);
  });

  // -- Settings (employer only — employees use /preferences) --------------

  router.get('/settings', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    if (a.ctx.user.role !== 'employer') return res.redirect('/preferences');
    await sendHtml(res, 'settings.html', req);
  });

  // /employees/:id/profile — full profile editor (was the old /employees/:id).
  // Must be registered BEFORE /employees/:id so the more-specific path wins.
  router.get('/employees/:id/profile', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    await sendHtml(res, 'employee-profile.html', req);
  });

  // /employees/:id — employer's summary page for an employee. RBAC is
  // enforced by the API: the page renders for everyone, but the underlying
  // /api/employees/:id/summary endpoint is employer-only and the JS
  // handles the 403 redirect to /.
  router.get('/employees/:id', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    await sendHtml(res, 'employee.html', req);
  });
}
