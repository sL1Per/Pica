/**
 * Settings routes.
 *
 *   GET  /api/settings/me    — current user's personal prefs
 *   PUT  /api/settings/me    — update own prefs (language, colorMode)
 *   GET  /api/settings/org   — employer only
 *   PUT  /api/settings/org   — employer only
 *
 *   GET    /api/branding      — company name + hasLogo flag (any authenticated user)
 *   GET    /api/branding/logo — decrypted image bytes (any authenticated user)
 *   PUT    /api/branding/logo — upload, employer only
 *   DELETE /api/branding/logo — remove, employer only
 *
 * Branding is separate from /api/settings/org because every page needs to
 * read the company name and logo for the top bar — including from employees
 * who must not see the full org settings.
 */

const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB

export function registerSettingsRoutes(router, {
  userPrefsStore,
  orgSettingsStore,
  companyLogoStore,
  requireAuth,
  requireRole,
}) {

  // --- Per-user preferences ------------------------------------------------

  router.get('/api/settings/me', requireAuth((req, res) => {
    res.json({ prefs: userPrefsStore.get(req.user.id) });
  }));

  router.put('/api/settings/me', requireAuth((req, res) => {
    const patch = req.body ?? {};
    try {
      const prefs = userPrefsStore.update(req.user.id, patch);
      res.json({ ok: true, prefs });
    } catch (err) {
      return res.badRequest(err.message, { errorCode: err.code || 'invalid_value' });
    }
  }));

  // --- Organization settings (employer only) -------------------------------

  router.get('/api/settings/org', requireRole('employer')((req, res) => {
    res.json({ settings: orgSettingsStore.get() });
  }));

  // Working-time targets are needed on the punch page for both roles, so
  // expose just that slice to authenticated users (avoid leaking the full
  // org settings, which include per-employee leave overrides, backups, etc.).
  // The values returned are RESOLVED for the calling user — i.e. their
  // per-employee override if present, else the org default.
  router.get('/api/settings/working-time', requireAuth((req, res) => {
    const workingTime = orgSettingsStore.resolveWorkingTimeFor(req.user.id);
    res.json({ workingTime });
  }));

  router.put('/api/settings/org', requireRole('employer')((req, res) => {
    try {
      const settings = orgSettingsStore.update(req.body ?? {});
      res.json({ ok: true, settings });
    } catch (err) {
      return res.badRequest(err.message, { errorCode: err.code || 'invalid_value' });
    }
  }));

  // --- Branding — company name + logo, shared across all users -------------

  /**
   * Return the public-facing branding bits: company name (null means "use
   * fallback") and whether a logo exists. Cheap; called on every page load
   * by the top bar bootstrap.
   */
  router.get('/api/branding', requireAuth((req, res) => {
    const settings = orgSettingsStore.get();
    res.json({
      name: settings.company?.name ?? null,
      hasLogo: companyLogoStore.exists(),
    });
  }));

  /**
   * Stream the decrypted logo bytes. 404 if no logo. Any authenticated
   * user can fetch this — employees need it to render their nav bar.
   */
  router.get('/api/branding/logo', requireAuth((req, res) => {
    if (!companyLogoStore.exists()) return res.notFound('No logo uploaded', { errorCode: 'not_found' });
    let bytes;
    try {
      bytes = companyLogoStore.read();
    } catch (err) {
      return res.serverError('Failed to read logo', { errorCode: 'internal_error' });
    }
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': bytes.length,
      'Cache-Control': 'private, no-store',
    });
    res.end(bytes);
  }));

  /**
   * Upload via multipart. Employer only. Client resizes to a reasonable
   * size before upload; server caps at 2 MB.
   */
  router.put('/api/branding/logo', requireRole('employer')((req, res) => {
    const files = req.body?.files;
    if (!Array.isArray(files) || files.length === 0) {
      return res.badRequest('No logo uploaded', { errorCode: 'required' });
    }
    const file = files[0];
    if (file.data.length > MAX_LOGO_BYTES) {
      return res.badRequest(`Logo exceeds ${MAX_LOGO_BYTES} bytes`, { errorCode: 'invalid_value' });
    }
    companyLogoStore.write(file.data);
    res.json({ ok: true });
  }));

  router.delete('/api/branding/logo', requireRole('employer')((req, res) => {
    companyLogoStore.remove();
    res.json({ ok: true });
  }));
}
