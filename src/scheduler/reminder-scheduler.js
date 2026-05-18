/**
 * Reminder scheduler (M14 Email Notifications).
 *
 * Every CHECK_INTERVAL_MS, scans ALL approved leaves (no month pre-filter —
 * a month-window could silently drop a leave due exactly at a month boundary;
 * for ≤50 employees the full scan is negligible per the project's scale
 * guidance). Selects those with no `reminderSentAt`, whose `startInstant`
 * is in the future, and for which `now >= startInstant − 24h`.
 * For each qualifying leave, fires `mailer.notify('leaveReminder', …)` and,
 * on `sent:true`, appends a `reminder_sent` event to the leave's event log.
 *
 * One reminder per leave, ever. The persisted event survives restart —
 * the scheduler will skip a leave as long as `reminderSentAt` is truthy
 * on the projection.
 *
 * The tick() method NEVER throws. Failures are logged best-effort and the
 * scheduler keeps running — mirroring the backup-scheduler convention.
 *
 * Construction pattern mirrors src/scheduler/backup-scheduler.js:
 *   makeReminderScheduler({ leavesStore, mailer, logger })
 *   → { tick, start } where start() returns { stop }
 */

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — same cadence as backup-scheduler

/**
 * Pure selection function. Given a list of leave projections and a `now`
 * Date, returns the subset that needs a reminder sent right now.
 *
 * Selection criteria:
 *   - status === 'approved'
 *   - reminderSentAt is falsy (not yet sent)
 *   - startInstant > now  (start is still in the future)
 *   - now >= startInstant − 24h  (within the 24-hour notification window)
 *
 * startInstant calculation:
 *   - unit === 'days': new Date(y, m-1, d)  →  LOCAL midnight of the date.
 *     LOCAL (not UTC) is deliberate: employees think of "June 10" in their
 *     local timezone, so the reminder window "within 24h of your leave start"
 *     should also be anchored to local midnight, not a UTC midnight that can
 *     be off by hours in negative-UTC zones (e.g. Americas). Using
 *     new Date('YYYY-MM-DD') would parse as UTC midnight — wrong.
 *   - unit === 'hours': new Date(leave.start) → parses the ISO timestamp
 *     as-is. The stored ts includes the offset (or is UTC Z), so this is
 *     already unambiguous.
 *
 * @param {Array}  leaves  - leave projections from leavesStore.list()
 * @param {Date}   now     - current instant (injected for deterministic tests)
 * @returns {Array} subset of leaves to remind
 */
export function selectDueReminders(leaves, now = new Date()) {
  const nowMs = now.getTime();
  const h24 = 24 * 60 * 60 * 1000;
  const result = [];

  for (const leave of leaves) {
    if (leave.status !== 'approved') continue;
    if (leave.reminderSentAt) continue;  // already sent; skip forever

    let startInstant;
    if (leave.unit === 'days') {
      // Parse as LOCAL midnight — see the comment above for why.
      const [y, m, d] = leave.start.split('-').map(Number);
      startInstant = new Date(y, m - 1, d);
    } else {
      // hours-unit: the start field is a full ISO timestamp.
      startInstant = new Date(leave.start);
    }

    const startMs = startInstant.getTime();
    if (!Number.isFinite(startMs)) continue;  // guard against malformed start

    // Must be in the future.
    if (startMs <= nowMs) continue;

    // Must be within the next 24 hours.
    if (nowMs < startMs - h24) continue;

    result.push(leave);
  }

  return result;
}

/**
 * Build a reminder scheduler.
 *
 * @param {object} deps
 * @param {object} deps.leavesStore   - { list(), markReminderSent(id) }
 * @param {object} deps.mailer        - { notify(category, opts) → Promise<{sent, reason}> }
 * @param {object} deps.logger        - { info(msg), error(msg) }
 * @param {number} [deps.checkIntervalMs] - override for tests
 * @param {Function} [deps.now]       - () => Date override for tests (default: () => new Date())
 * @returns {{ tick: Function, start: Function }}
 */
export function makeReminderScheduler({ leavesStore, mailer, logger, checkIntervalMs = CHECK_INTERVAL_MS, now = () => new Date() }) {
  // Re-entry guard: a slow SMTP send could let the interval fire a second
  // tick() before the first completes. Without this, the same due leave
  // could be notified twice in the small window between mailer.notify()
  // returning and markReminderSent() persisting. The on-disk reminderSentAt
  // remains the durable idempotency across restarts; this guard is the
  // in-process defence. Mirrors backup-scheduler.js exactly.
  let running = false;

  /**
   * Execute one reminder scan. Never throws — all errors are caught and
   * logged. Called by the timer (via start()) and directly in tests.
   */
  async function tick() {
    if (running) return;  // re-entry guard: concurrent call returns early
    running = true;
    try {
      let due;
      try {
        const all = leavesStore.list();
        due = selectDueReminders(all, now());
      } catch (err) {
        if (logger) logger.error(`reminder scheduler: list failed — ${err.message}`);
        return;
      }

      for (const leave of due) {
        try {
          const result = await mailer.notify('leaveReminder', {
            recipientUserId: leave.employeeId,
            vars: {
              type:  leave.type,
              start: leave.start,
              end:   leave.end,
              unit:  leave.unit,
            },
          });

          if (result.sent) {
            // Persist the reminder_sent event so this leave is never re-notified,
            // even if the process restarts before the next tick.
            try {
              leavesStore.markReminderSent(leave.id);
              if (logger) logger.info(`reminder sent: leave ${leave.id} (${leave.type} ${leave.start})`);
            } catch (persistErr) {
              // The mailer already sent — log the persist failure but don't retry
              // (would send a duplicate). The next tick will catch it again only
              // if reminderSentAt remains unset. Accept the rare duplicate risk
              // over introducing retry complexity here.
              if (logger) logger.error(`reminder scheduler: failed to persist reminder_sent for leave ${leave.id} — ${persistErr.message}`);
            }
          } else {
            if (logger) logger.error(`reminder scheduler: mailer skipped leave ${leave.id} (reason: ${result.reason})`);
          }
        } catch (err) {
          // Never let one leave failure abort the rest of the batch.
          if (logger) logger.error(`reminder scheduler: error processing leave ${leave.id} — ${err.message}`);
        }
      }
    } finally {
      running = false;  // always reset, even if the body throws unexpectedly
    }
  }

  /**
   * Start the periodic timer. Returns a { stop } handle. Mirrors the shape
   * of backup-scheduler's startBackupScheduler() return value.
   *
   * First check fires after checkIntervalMs (not immediately on start) —
   * same rationale as backup-scheduler: don't surprise the operator on boot.
   */
  function start() {
    let timer = setInterval(() => {
      // tick() is async; fire-and-forget is intentional. Errors are handled
      // inside tick(). We don't await here to avoid blocking the interval.
      tick().catch((err) => {
        if (logger) logger.error(`reminder scheduler: unhandled tick error — ${err.message}`);
      });
    }, checkIntervalMs);

    // Don't keep the process alive solely for the scheduler.
    if (timer.unref) timer.unref();

    if (logger) logger.info(`reminder scheduler started (check every ${checkIntervalMs / 1000}s)`);

    return {
      stop() {
        if (timer) {
          clearInterval(timer);
          timer = null;
          if (logger) logger.info('reminder scheduler stopped');
        }
      },
    };
  }

  return { tick, start };
}
