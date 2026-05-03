/**
 * Backup endpoints.
 *
 * All employer-only.
 *
 *   GET    /api/backups               — list existing backups
 *   POST   /api/backups               — create a new backup
 *   GET    /api/backups/status        — query the post-restore lockdown
 *   GET    /api/backups/:id/download  — download a backup as octet-stream
 *   DELETE /api/backups/:id           — delete a backup file
 *   POST   /api/backups/restore       — restore from an uploaded backup
 *
 * Restore is the dangerous operation. It requires:
 *   - employer role (RBAC)
 *   - HTTP method POST with body Content-Type: application/octet-stream
 *   - Header X-Pica-Confirm-Restore: RESTORE  (typed-confirmation gate)
 *
 * After a successful restore, the server sets a process-wide
 * `restoreCompleted` flag. While that flag is set, every subsequent
 * request (except GET /api/backups/status and the logout endpoint)
 * returns 503 with errorCode=restore_pending_restart. The flag clears
 * only when the process is restarted — at which point all stores
 * re-read from disk and pick up the restored data.
 */
export function registerBackupRoutes(router, {
  backupsStore,
  serverState,
  requireRole,
  logger,
}) {
  router.get('/api/backups', requireRole('employer')((req, res) => {
    const backups = backupsStore.list();
    res.json({ backups });
  }));

  router.post('/api/backups', requireRole('employer')((req, res) => {
    let entry;
    try {
      entry = backupsStore.create();
    } catch (err) {
      if (logger) logger.error('backup creation failed', err);
      return res.serverError('Failed to create backup', { errorCode: 'internal_error' });
    }
    if (logger) logger.info(`backup created: ${entry.filename} (${entry.sizeBytes} bytes)`);
    res.json({ backup: entry }, 201);
  }));

  router.get('/api/backups/status', requireRole('employer')((req, res) => {
    res.json({
      restoreCompleted: serverState?.restoreCompleted === true,
    });
  }));

  router.get('/api/backups/:id/download', requireRole('employer')((req, res) => {
    const id = req.params.id;
    const result = backupsStore.read(id);
    if (!result) return res.notFound('Backup not found', { errorCode: 'not_found' });

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Content-Length', String(result.bytes.length));
    // Cache control: backups are sensitive and immutable; never cache.
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 200;
    res.end(result.bytes);
  }));

  router.delete('/api/backups/:id', requireRole('employer')((req, res) => {
    const id = req.params.id;
    const ok = backupsStore.delete(id);
    if (!ok) return res.notFound('Backup not found', { errorCode: 'not_found' });
    if (logger) logger.info(`backup deleted: ${id}`);
    res.noContent();
  }));

  router.post('/api/backups/restore', requireRole('employer')(async (req, res) => {
    // Confirmation gate: header must contain the literal "RESTORE".
    // The UI requires the user to type this; the absence here means
    // either a programmatic call or a mistake.
    const confirm = req.headers['x-pica-confirm-restore'];
    if (confirm !== 'RESTORE') {
      return res.badRequest(
        'Restore requires X-Pica-Confirm-Restore: RESTORE header',
        { errorCode: 'restore_confirmation_required' },
      );
    }

    // Body shape: raw bytes via application/octet-stream → req.body._raw
    const blob = req.body && req.body._raw;
    if (!Buffer.isBuffer(blob) || blob.length === 0) {
      return res.badRequest(
        'Restore body must be the raw backup bytes (Content-Type: application/octet-stream)',
        { errorCode: 'required' },
      );
    }

    let result;
    try {
      result = backupsStore.restore(blob);
    } catch (err) {
      if (logger) logger.warn(`restore failed: ${err.message}`);
      // Map known failure modes to distinct errorCodes so the UI can
      // localize each.
      let errorCode = 'restore_failed';
      if (/decryption failed/.test(err.message))     errorCode = 'restore_wrong_key';
      else if (/bad magic/.test(err.message))        errorCode = 'restore_not_a_backup';
      else if (/too short/.test(err.message))        errorCode = 'restore_not_a_backup';
      else if (/refused to restore unsafe/.test(err.message)) errorCode = 'restore_unsafe_path';
      return res.badRequest(err.message, { errorCode });
    }

    // Flip the lockdown flag. Subsequent requests will be rejected
    // until the process restarts.
    if (serverState) serverState.restoreCompleted = true;

    if (logger) {
      logger.info(`restore complete: ${result.restoredEntries} files restored, ` +
                  `previous data moved to ${result.preRestorePath}`);
    }
    res.json({
      ok: true,
      restoredEntries: result.restoredEntries,
      preRestorePath: result.preRestorePath,
    });
  }));
}
