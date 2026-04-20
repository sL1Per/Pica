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
export function registerPageRoutes(router, { publicDir, usersStore, authenticate }) {
  async function sendHtml(res, file) {
    const abs = path.join(publicDir, file);
    const body = await fs.promises.readFile(abs, 'utf8');
    res.html(body);
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
    await sendHtml(res, 'index.html');
  });

  router.get('/setup', async (req, res) => {
    if (usersStore.hasAny()) return res.redirect('/login');
    await sendHtml(res, 'setup.html');
  });

  router.get('/login', async (req, res) => {
    if (!usersStore.hasAny()) return res.redirect('/setup');
    if (authenticate(req))    return res.redirect('/');
    await sendHtml(res, 'login.html');
  });

  // -- Employee pages -----------------------------------------------------

  router.get('/employees', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    if (a.ctx.user.role !== 'employer') return res.redirect('/profile');
    await sendHtml(res, 'employees.html');
  });

  router.get('/employees/new', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    if (a.ctx.user.role !== 'employer') return res.redirect('/profile');
    await sendHtml(res, 'employee-new.html');
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
    await sendHtml(res, 'punch.html');
  });

  router.get('/punches/today', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    await sendHtml(res, 'punches-today.html');
  });

  // -- Leaves -------------------------------------------------------------

  router.get('/leaves', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    await sendHtml(res, 'leaves.html');
  });

  router.get('/leaves/calendar', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    await sendHtml(res, 'leaves-calendar.html');
  });

  router.get('/leaves/new', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    await sendHtml(res, 'leave-new.html');
  });

  router.get('/leaves/:id', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    await sendHtml(res, 'leave.html');
  });

  // -- Reports ------------------------------------------------------------

  router.get('/reports', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    await sendHtml(res, 'reports.html');
  });

  // Matches /employees/:id where :id is not "new" (caught by the route above).
  router.get('/employees/:id', async (req, res) => {
    const a = authed(req);
    if (a.redirect) return res.redirect(a.redirect);
    // RBAC is enforced by the API; the page just renders. Non-owners who
    // aren't employers will see empty data and 403s on the API calls.
    await sendHtml(res, 'employee.html');
  });
}
