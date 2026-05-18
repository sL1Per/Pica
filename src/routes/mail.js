/**
 * src/routes/mail.js — M14 mail management routes.
 *
 *   POST /api/mail/test   employer-only config probe
 *
 * Mirrors the registerXRoutes(router, deps) idiom used throughout src/routes/.
 * Auth/role: requireRole('employer') alone — it checks req.user (returns 401
 * if absent, 403 if wrong role), matching the backups.js pattern for
 * employer-only endpoints.
 *
 * Not registered in server.js until Task 9 — this module only exports the
 * registration function.
 */

export function registerMailRoutes(router, { mailer, requireRole }) {
  /**
   * POST /api/mail/test
   *
   * Sends a fixed test message to the employer's own contactEmail and returns
   * the mailer result as { ok, reason }.  Never 4xx on a mailer failure —
   * the point is to surface the SMTP outcome to the UI as a config probe.
   *
   * The 'testEmail' category bypasses org and user notification toggles
   * (it's a config probe, not a user-facing notification) but still requires
   * mail.enabled and a non-empty contactEmail on the employer's profile.
   *
   * Response: { ok: boolean, reason: string | undefined } — never echoes
   * config.mail.pass or the recipient address.
   */
  router.post('/api/mail/test', requireRole('employer')(async (req, res) => {
    const r = await mailer.notify('testEmail', {
      recipientUserId: req.user.id,
      vars: {},
    });
    res.json({ ok: r.sent, reason: r.reason });
  }));
}
