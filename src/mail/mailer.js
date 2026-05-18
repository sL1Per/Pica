/**
 * src/mail/mailer.js — M14 email notification boundary.
 *
 * Provides a single `notify(category, { recipientUserId, vars })` surface
 * that enforces all gating layers (§3.3) and then delegates to sendMail.
 *
 * Design goals:
 *   - NEVER throws, NEVER rejects.  Callers may `void mailer.notify(...)`.
 *   - `sendMail` is constructor-injected for testability (defaults to the
 *     real ./smtp.js export so production wiring needs no change).
 *   - No password / email address / body ever enters logger or audit records.
 *
 * Gating order (§3.3):
 *   1. config.mail.enabled !== true  → 'mail_disabled'
 *   2. org notifications.<category> off → 'org_disabled'
 *      (passwordResetNotice skips this layer)
 *   3. user per-category switch off  → 'user_opted_out'
 *      (passwordResetNotice skips this layer)
 *   4. recipient contactEmail absent → 'no_address'
 *
 * Per-user toggle map (§4 truth table):
 *   leaveDecision / correctionDecision → email.notifications
 *   leaveReminder                      → email.reminders
 *   passwordResetNotice                → no user gate
 *
 * Any store accessor or renderEmail failure propagates to the outer
 * try/catch and resolves as {sent:false, reason:'send_error'}.  The
 * sendMail failure path is handled separately (to capture smtpCode).
 */

import { sendMail as defaultSendMail } from './smtp.js';
import { renderEmail } from './templates.js';

// Categories that bypass the org + user gating layers entirely.
// passwordResetNotice: a security action that must reach the user regardless of their prefs.
// testEmail: a config probe sent to the employer's own address — not a user notification,
//   so org/user toggles are irrelevant; only mail.enabled and a valid address are required.
const BYPASS_ORG_USER = new Set(['passwordResetNotice', 'testEmail']);

// Maps category → org notifications key (for the org-layer check).
const ORG_KEY = {
  leaveDecision:      'leaveDecision',
  correctionDecision: 'correctionDecision',
  leaveReminder:      'leaveReminder',
};

// Maps category → user prefs key inside email.{} (for the user-layer check).
const USER_KEY = {
  leaveDecision:      'notifications',
  correctionDecision: 'notifications',
  leaveReminder:      'reminders',
};

export function makeMailer({
  config,
  logger,
  audit,
  usersStore,      // reserved for Task 9 if needed; not used in this layer
  employeesStore,
  userPrefsStore,
  orgSettingsStore,
  sendMail = defaultSendMail,
}) {
  /**
   * Append an audit record best-effort: never throws, never exposes pass.
   * Only safe fields: event, category, recipientId, smtpCode (optional).
   */
  function auditBestEffort(record) {
    try { audit.appendRecord(record); } catch { /* best-effort */ }
  }

  return {
    /**
     * notify(category, { recipientUserId, vars })
     *   → Promise<{ sent: true } | { sent: false, reason: string }>
     *
     * Always resolves.  Never rejects.  Outer try/catch contains ALL
     * internal failures (store errors, renderEmail unknown-category throw,
     * etc.) and converts them to {sent:false, reason:'send_error'}.
     * The sendMail failure path is a nested try/catch so smtpCode can be
     * forwarded to audit without re-throwing.
     */
    async notify(category, { recipientUserId, vars } = {}) {
      try {
        // ----------------------------------------------------------------
        // Layer 1: mail must be explicitly enabled in config.
        // Optional-chain so a missing config.mail object yields
        // mail_disabled instead of a TypeError bubbling to send_error.
        // ----------------------------------------------------------------
        if (config.mail?.enabled !== true) {
          return { sent: false, reason: 'mail_disabled' };
        }

        const bypass = BYPASS_ORG_USER.has(category);

        // ----------------------------------------------------------------
        // Layer 2: org-level switch for this category.
        // Missing notifications key or missing sub-key defaults to true
        // (Task 5 hasn't added these yet; defensive default = on).
        // orgSettingsStore.get() may throw on I/O error — let it bubble
        // to the outer catch which resolves {sent:false, reason:'send_error'}.
        // ----------------------------------------------------------------
        if (!bypass) {
          const orgKey = ORG_KEY[category];
          if (orgKey !== undefined) {
            const orgSettings = orgSettingsStore.get();
            const orgNotifications = orgSettings?.notifications ?? {};
            // Only block if the key is explicitly false; missing = on.
            if (orgNotifications[orgKey] === false) {
              return { sent: false, reason: 'org_disabled' };
            }
          }
        }

        // ----------------------------------------------------------------
        // Resolve user prefs once — used for both the user-layer gate
        // and locale resolution.  userPrefsStore.get() may throw on I/O
        // error — let it bubble to the outer catch.
        // If the email sub-object is absent (Task 6 not done), treat all
        // toggles as true (default on).
        // ----------------------------------------------------------------
        const prefs = userPrefsStore.get(recipientUserId);

        // ----------------------------------------------------------------
        // Layer 3: per-user switch.
        // ----------------------------------------------------------------
        if (!bypass) {
          const userPrefKey = USER_KEY[category];
          if (userPrefKey !== undefined) {
            const emailPrefs = prefs?.email ?? {};
            // Only block if the key is explicitly false; missing = on.
            if (emailPrefs[userPrefKey] === false) {
              return { sent: false, reason: 'user_opted_out' };
            }
          }
        }

        // ----------------------------------------------------------------
        // Layer 4: recipient must have a non-empty contactEmail.
        // Read ONLY that recipient's encrypted profile — never the list.
        // employeesStore.readProfile() may throw — let it bubble.
        // ----------------------------------------------------------------
        const profile = employeesStore.readProfile(recipientUserId);
        const to = profile?.contactEmail;
        if (!to || (typeof to === 'string' && to.trim() === '')) {
          return { sent: false, reason: 'no_address' };
        }

        // ----------------------------------------------------------------
        // Render — resolve recipient's locale.
        // renderEmail falls back to en-US on unknown locale (no throw).
        // An unknown category throws from renderEmail; the outer catch
        // handles it as {sent:false, reason:'send_error'}.
        // ----------------------------------------------------------------
        const locale = prefs?.locale || 'en-US';
        const { subject, text } = renderEmail(category, locale, vars);

        // ----------------------------------------------------------------
        // Send — nested try/catch so we can capture smtpCode for audit
        // without rethrowing.  NEVER log pass/address/body.
        // ----------------------------------------------------------------
        try {
          await sendMail({
            host:   config.mail.host,
            port:   config.mail.port,
            secure: config.mail.secure,
            user:   config.mail.user,
            pass:   config.mail.pass,
            from:   config.mail.from,
            to,
            subject,
            text,
          });
        } catch (err) {
          // Log at warn — message only; no pass, no address, no body.
          logger.warn('mail.send_failed', {
            category,
            recipientId: recipientUserId,
            smtpCode: err.smtpCode,
          });
          auditBestEffort({
            event: 'mail.send_failed',
            category,
            recipientId: recipientUserId,
            ...(err.smtpCode !== undefined ? { smtpCode: err.smtpCode } : {}),
          });
          return { sent: false, reason: 'send_error' };
        }

        // ----------------------------------------------------------------
        // Success — audit best-effort.  No address, no body, no pass.
        // ----------------------------------------------------------------
        auditBestEffort({
          event: 'mail.sent',
          category,
          recipientId: recipientUserId,
        });

        return { sent: true };

      } catch (unexpectedErr) {
        // Outer catch: store I/O errors, renderEmail unknown-category throw,
        // or anything else not covered by the sendMail nested catch above.
        // The sendMail inner catch always `return`s before this point is
        // reachable, so no sentinel guard is needed — every error here is
        // genuinely unexpected.  Never propagate; never log pass or address.
        logger.warn('mail.notify_error', {
          category,
          recipientId: recipientUserId,
          error: unexpectedErr.message,
        });
        auditBestEffort({
          event: 'mail.send_failed',
          category,
          recipientId: recipientUserId,
        });
        return { sent: false, reason: 'send_error' };
      }
    },
  };
}
