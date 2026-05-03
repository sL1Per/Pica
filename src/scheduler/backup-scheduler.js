/**
 * Backup scheduler.
 *
 * Periodically (every CHECK_INTERVAL_MS) checks the org-settings
 * `backups` config and makes a backup if one is due. After each
 * successful backup, prunes to the configured retention count.
 *
 * "Due" is defined as: there is no most-recent backup at all, OR the
 * most-recent backup's `createdAt` was more than the schedule's
 * interval ago. So:
 *
 *   schedule=hourly  → backup if last was > 1 hour ago
 *   schedule=daily   → backup if last was > 24 hours ago
 *   schedule=weekly  → backup if last was > 7 days ago
 *
 * This is intentionally "duration since last", not "wall-clock at 3am
 * every day". That's simpler, doesn't drift on restart, and is good
 * enough for the use case. A user who wants nightly backups at a
 * specific hour can run `cron` against the `POST /api/backups`
 * endpoint instead.
 *
 * Catch-up after downtime: on resume, if the last backup is much
 * older than the interval, we make ONE backup, not N. The user can
 * see the gap in the list and create more by hand if they care.
 */

const CHECK_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes

const SCHEDULE_INTERVAL_MS = {
  off:    null,                  // disabled
  hourly: 60 * 60 * 1000,
  daily:  24 * 60 * 60 * 1000,
  weekly:  7 * 24 * 60 * 60 * 1000,
};

/**
 * Start the scheduler. Returns a `stop()` function that clears the
 * timer. Calling stop() is important for tests so they don't leak
 * timers and keep the process alive.
 *
 * @param {object} deps
 * @param {object} deps.backupsStore
 * @param {object} deps.orgSettingsStore
 * @param {object} deps.serverState     - { restoreCompleted: boolean }
 * @param {object} deps.logger
 * @param {number} [deps.checkIntervalMs]   override for tests
 * @param {function} [deps.now]             override for tests, returns ms
 */
export function startBackupScheduler({
  backupsStore,
  orgSettingsStore,
  serverState,
  logger,
  checkIntervalMs = CHECK_INTERVAL_MS,
  now = () => Date.now(),
}) {
  let timer = null;
  let running = false;

  function tick() {
    if (running) return;       // re-entry guard if a tick takes a while
    if (serverState?.restoreCompleted) return; // post-restore lockdown
    running = true;
    try {
      maybeMakeBackup({ backupsStore, orgSettingsStore, logger, now });
    } catch (err) {
      if (logger) logger.error(`scheduler tick failed: ${err.message}`);
    } finally {
      running = false;
    }
  }

  // First check happens after `checkIntervalMs`. We don't run on
  // startup — that would surprise users who just turned the server on.
  timer = setInterval(tick, checkIntervalMs);
  // Don't keep the event loop alive solely for the scheduler.
  if (timer.unref) timer.unref();

  if (logger) logger.info(`backup scheduler started (check every ${checkIntervalMs / 1000}s)`);

  return {
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        if (logger) logger.info('backup scheduler stopped');
      }
    },
    /** Force a check immediately. Used by tests. */
    tickNow: tick,
  };
}

/**
 * Pure decision function (also exported for testing): given the
 * current settings + the most-recent backup, return either
 * `{ make: false, reason }` or `{ make: true }`.
 */
export function shouldMakeBackup({ settings, mostRecent, nowMs }) {
  if (!settings || settings.enabled !== true) {
    return { make: false, reason: 'disabled' };
  }
  const interval = SCHEDULE_INTERVAL_MS[settings.schedule];
  if (!interval) {
    return { make: false, reason: `unknown schedule '${settings.schedule}'` };
  }
  if (!mostRecent) {
    return { make: true };
  }
  const lastMs = new Date(mostRecent.createdAt).getTime();
  if (!Number.isFinite(lastMs)) {
    return { make: false, reason: 'last backup has invalid createdAt' };
  }
  if (nowMs - lastMs >= interval) {
    return { make: true };
  }
  return { make: false, reason: `next backup in ${Math.round((interval - (nowMs - lastMs)) / 60000)}min` };
}

function maybeMakeBackup({ backupsStore, orgSettingsStore, logger, now }) {
  const settings = orgSettingsStore?.get?.()?.backups;
  const list = backupsStore.list();
  const decision = shouldMakeBackup({
    settings,
    mostRecent: list[0] || null,
    nowMs: now(),
  });

  if (!decision.make) {
    // Quiet: this fires every 5 minutes when disabled or not due.
    return;
  }

  if (logger) logger.info('scheduled backup: making one now');
  const created = backupsStore.create();
  if (logger) logger.info(`scheduled backup created: ${created.filename}`);

  // Apply retention.
  const keep = Number.isInteger(settings.retention) && settings.retention > 0
    ? settings.retention
    : 7; // sensible default if missing
  const deleted = backupsStore.pruneToKeep(keep);
  if (deleted.length > 0 && logger) {
    logger.info(`retention: pruned ${deleted.length} old backup(s) (keep=${keep})`);
  }
}
