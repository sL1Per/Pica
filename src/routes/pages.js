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
}
