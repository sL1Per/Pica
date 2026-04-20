/**
 * Settings routes.
 *
 *   GET  /api/settings/me    — current user's personal prefs
 *   PUT  /api/settings/me    — update own prefs (language, colorMode)
 *   GET  /api/settings/org   — employer only
 *   PUT  /api/settings/org   — employer only
 */

export function registerSettingsRoutes(router, {
  userPrefsStore,
  orgSettingsStore,
  requireAuth,
  requireRole,
}) {

  router.get('/api/settings/me', requireAuth((req, res) => {
    res.json({ prefs: userPrefsStore.get(req.user.id) });
  }));

  router.put('/api/settings/me', requireAuth((req, res) => {
    const patch = req.body ?? {};
    try {
      const prefs = userPrefsStore.update(req.user.id, patch);
      res.json({ ok: true, prefs });
    } catch (err) {
      return res.badRequest(err.message);
    }
  }));

  router.get('/api/settings/org', requireRole('employer')((req, res) => {
    res.json({ settings: orgSettingsStore.get() });
  }));

  router.put('/api/settings/org', requireRole('employer')((req, res) => {
    try {
      const settings = orgSettingsStore.update(req.body ?? {});
      res.json({ ok: true, settings });
    } catch (err) {
      return res.badRequest(err.message);
    }
  }));
}
