#!/usr/bin/env node
/**
 * Pica — Time Management
 * Entry point. Boots the HTTP server, wires the router, serves static assets.
 *
 * Milestone 2b: authentication wired up. The app boots into setup mode
 * until the first employer account is created, then into the login flow.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './src/config.js';
import { createLogger } from './src/logger.js';
import { createRouter } from './src/router.js';
import { parseBody, BodyTooLargeError, BadBodyError } from './src/http/body.js';
import { parseCookies } from './src/http/cookies.js';
import { enhance } from './src/http/responses.js';
import { serveStatic } from './src/http/static.js';
import { createSecurityHeaders } from './src/http/security-headers.js';
import { initMasterKey } from './src/crypto/masterkey.js';
import { deriveSessionKey } from './src/auth/sessions.js';
import { createUsersStore } from './src/auth/users.js';
import { createRBAC } from './src/auth/rbac.js';
import { createRateLimiter } from './src/auth/rate-limit.js';
import { registerAuthRoutes } from './src/routes/auth.js';
import { registerSetupRoutes } from './src/routes/setup.js';
import { registerPageRoutes } from './src/routes/pages.js';
import { registerEmployeeRoutes } from './src/routes/employees.js';
import { registerPunchRoutes } from './src/routes/punches.js';
import { registerLeaveRoutes } from './src/routes/leaves.js';
import { registerCorrectionRoutes } from './src/routes/corrections.js';
import { registerReportRoutes } from './src/routes/reports.js';
import { approxDaysOff } from './src/storage/reports.js';
import { registerSettingsRoutes } from './src/routes/settings.js';
import { registerBackupRoutes } from './src/routes/backups.js';
import { registerSecurityRoutes } from './src/routes/security.js';
import { registerMailRoutes } from './src/routes/mail.js';
import { makeMailer } from './src/mail/mailer.js';
import { startBackupScheduler } from './src/scheduler/backup-scheduler.js';
import { makeReminderScheduler } from './src/scheduler/reminder-scheduler.js';
import { createEmployeesStore } from './src/storage/employees.js';
import { createPunchesStore } from './src/storage/punches.js';
import { createLeavesStore, LEAVE_TYPES_LIST } from './src/storage/leaves.js';
import { createCorrectionsStore } from './src/storage/corrections.js';
import { createUserPrefsStore } from './src/storage/user-prefs.js';
import { createOrgSettingsStore } from './src/storage/org-settings.js';
import { createCompanyLogoStore } from './src/storage/company-logo.js';
import { createBackupsStore } from './src/storage/backups.js';
import { createAuditStore } from './src/storage/audit.js';
import { createMailConfigStore } from './src/storage/mail-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read our own package metadata once at startup. Used by /api/version
// and the footer that every page renders.
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

// ----------------------------------------------------------------------------
// Startup
// ----------------------------------------------------------------------------

const config = loadConfig(path.join(__dirname, 'config.json'));
const log = createLogger(config.logLevel);

for (const dir of [config.dataDir, config.backupDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const publicDir = path.join(__dirname, 'public');
const configPath = path.join(__dirname, 'config.json');

// ----------------------------------------------------------------------------
// Master key — derived before we start accepting requests. Anything that
// touches encrypted storage gets `masterKey` passed in explicitly.
// ----------------------------------------------------------------------------

let masterKey;
let mustResetPassphrase = false;
try {
  ({ masterKey, mustResetPassphrase } = await initMasterKey(config, configPath, log));
} catch (err) {
  log.error(err.message);
  process.exit(1);
}

// Session signing key is deterministic from the master key — no extra state.
const sessionKey = deriveSessionKey(masterKey);

// ----------------------------------------------------------------------------
// Stores, middleware, routes
// ----------------------------------------------------------------------------

const usersStore = createUsersStore(config.dataDir);
const employeesStore = createEmployeesStore(config.dataDir, masterKey);
const punchesStore = createPunchesStore(config.dataDir, masterKey);
const leavesStore = createLeavesStore(config.dataDir, masterKey);
const correctionsStore = createCorrectionsStore(config.dataDir, masterKey);
const userPrefsStore = createUserPrefsStore(config.dataDir);
const orgSettingsStore = createOrgSettingsStore(config.dataDir);
const companyLogoStore = createCompanyLogoStore(config.dataDir, masterKey);
const backupsStore = createBackupsStore({
  dataDir: config.dataDir,
  backupsDir: config.backupDir,
  configPath,
  masterKey,
});
// Audit log: append-only, encrypted NDJSON. Records sensitive
// actions (logins, password ops, employee CRUD, leave/correction
// decisions, backups, restores). Wired into routes that need it.
const auditStore = createAuditStore({
  dataDir: config.dataDir,
  masterKey,
  logger: log,
});

// SMTP config: AES-256-GCM blob in config.json, decrypted with the DEK.
// Lives in config.json (not data/) so it stays out of backups; reads/writes
// atomically via writeConfigAtomic. Never throws on absent/garbage blob.
const mailConfigStore = createMailConfigStore(configPath, masterKey, log);

// Warn once at startup when mail is enabled but the SMTP config is
// incomplete (e.g. operator flipped enabled:true via Settings but left
// host/user/pass/from blank). Mail then stays disabled — non-fatal.
if (mailConfigStore.read().enabled && !mailConfigStore.isConfigured()) {
  log.warn('mail enabled but SMTP config is incomplete; mail disabled');
}

// Email mailer — M14. Constructed after all stores it depends on exist.
// notify() never throws, never rejects. Callers use `void mailer.notify(...)`.
const mailer = makeMailer({
  mailConfigStore,
  logger: log,
  audit: auditStore,
  usersStore,
  employeesStore,
  userPrefsStore,
  orgSettingsStore,
});

// Process-wide lockdown flags.
//   restoreCompleted: flips true after a restore; cleared ONLY by a process
//     restart (the in-memory stores are stale until then).
//   rotateCompleted: flips true after a key rotation; like restoreCompleted
//     it requires a process restart (in-memory stores hold the old key).
//   passphraseResetRequired: true when the server unlocked via the recovery
//     code; the /api/security/passphrase handler clears it in-process once a
//     new passphrase is set, so normal operation resumes without a restart.
const serverState = { restoreCompleted: false, rotateCompleted: false, passphraseResetRequired: mustResetPassphrase };

const loginLimiter = createRateLimiter({ max: 10, windowSeconds: 60 });
// Password operations (self-service change + employer-initiated reset).
// 5 per hour per key — tight enough to slow brute force on the current
// password verification, loose enough not to annoy a legitimate user.
const passwordLimiter = createRateLimiter({ max: 5, windowSeconds: 3600 });
// Security operations (passphrase change, recovery-code add/remove, key rotate).
// Heavy crypto per call (scrypt N=2^17; /rotate re-encrypts the whole tree), so
// cap them even for the trusted employer — 10/hour/actor (M17 S15).
const securityLimiter = createRateLimiter({ max: 10, windowSeconds: 3600 });

// M17 S5: periodically prune the rate-limiter maps so they can't grow unbounded
// under source-IP rotation (each limiter only prunes a key when it's next hit).
// Unref'd so it never holds the process open; 5-minute cadence is ample here.
const limiterSweep = setInterval(() => {
  loginLimiter.sweep();
  passwordLimiter.sweep();
  securityLimiter.sweep();
}, 5 * 60 * 1000);
limiterSweep.unref();

const rbac = createRBAC({ sessionKey, usersStore });
const isProduction = process.env.NODE_ENV === 'production';

// Pre-compute the CSP (and the static security headers it joins). The
// CSP includes a SHA-256 of the canonical inline theme bootstrap; doing
// this at startup means we never have to manually bump the hash when
// editing the bootstrap.
const applySecurityHeaders = createSecurityHeaders({ publicDir, isProduction });

const router = createRouter();

// Liveness probe — unauthenticated, safe to expose.
router.get('/api/health', (req, res) => {
  res.json({ ok: true, name: 'pica', version: pkg.version });
});

// Public version metadata — used by the footer on every page.
router.get('/api/version', (req, res) => {
  res.json({
    version: pkg.version,
    releaseDate: pkg.releaseDate ?? null,
    repository: pkg.repository ?? null,
  });
});

registerSetupRoutes(router, { usersStore, sessionKey, isProduction, auditStore });
registerAuthRoutes(router, {
  usersStore,
  employeesStore,
  sessionKey,
  loginLimiter,
  passwordLimiter,
  requireAuth: rbac.requireAuth,
  isProduction,
  auditStore,
});
registerEmployeeRoutes(router, {
  usersStore,
  employeesStore,
  punchesStore,
  leavesStore,
  correctionsStore,
  orgSettingsStore,
  passwordLimiter,
  requireAuth: rbac.requireAuth,
  requireRole: rbac.requireRole,
  requireOwnerOrEmployer: rbac.requireOwnerOrEmployer,
  auditStore,
  mailer,
});
registerPunchRoutes(router, {
  punchesStore,
  usersStore,
  auditStore,
  requireAuth: rbac.requireAuth,
  requireOwnerOrEmployer: rbac.requireOwnerOrEmployer,
});
registerLeaveRoutes(router, {
  leavesStore,
  usersStore,
  employeesStore,
  orgSettingsStore,
  leaveTypes: LEAVE_TYPES_LIST,
  daysOf: approxDaysOff,
  requireAuth: rbac.requireAuth,
  requireRole: rbac.requireRole,
  auditStore,
  mailer,
});
registerCorrectionRoutes(router, {
  correctionsStore,
  punchesStore,
  usersStore,
  employeesStore,
  requireAuth: rbac.requireAuth,
  requireRole: rbac.requireRole,
  auditStore,
  mailer,
});
registerReportRoutes(router, {
  punchesStore,
  leavesStore,
  usersStore,
  employeesStore,
  orgSettingsStore,
  requireAuth: rbac.requireAuth,
  requireRole: rbac.requireRole,
  requireOwnerOrEmployer: rbac.requireOwnerOrEmployer,
});
registerSettingsRoutes(router, {
  userPrefsStore,
  orgSettingsStore,
  companyLogoStore,
  requireAuth: rbac.requireAuth,
  requireRole: rbac.requireRole,
  auditStore,
  mailConfigStore,
});
registerBackupRoutes(router, {
  backupsStore,
  serverState,
  requireRole: rbac.requireRole,
  auditStore,
  logger: log,
});
registerSecurityRoutes(router, {
  configPath,
  masterKey,
  dataDir: config.dataDir,
  serverState,
  requireAuth: rbac.requireAuth,
  requireRole: rbac.requireRole,
  auditStore,
  logger: log,
  securityLimiter,
});
// Mail routes — employer-only config probe (POST /api/mail/test).
// Registered after all other /api/* routes; before page routes (first-match-wins).
registerMailRoutes(router, {
  mailer,
  requireRole: rbac.requireRole,
});

registerPageRoutes(router, {
  publicDir,
  usersStore,
  userPrefsStore,
  authenticate: rbac.authenticate,
});

// Start the backup scheduler. Reads org-settings.backups every 5
// minutes; if a backup is due, makes one and prunes to retention.
// The handle returned has a stop() method we don't currently use
// (the process doesn't have a clean-shutdown hook beyond SIGINT,
// which terminates the timer naturally).
startBackupScheduler({
  backupsStore,
  orgSettingsStore,
  serverState,
  logger: log,
});

// Start the reminder scheduler — M14. Every 5 minutes, finds approved
// leaves within 24 h of their start and fires a leaveReminder notification.
// One reminder per leave ever (persisted via leavesStore.markReminderSent).
// Like the backup scheduler, the stop() handle is unused — SIGINT is enough.
makeReminderScheduler({ leavesStore, mailer, logger: log }).start();

// ----------------------------------------------------------------------------
// Request handler
// ----------------------------------------------------------------------------

/**
 * True for any path that's an API endpoint (not a page load and not
 * a static asset). Used by the post-restore lockdown to differentiate
 * "user trying to look at the settings page" from "anything that
 * depends on store state".
 */
function isApiEndpoint(pathname) {
  return pathname.startsWith('/api/');
}

async function handle(nodeReq, nodeRes) {
  const start = Date.now();
  enhance(nodeRes);

  // Apply security headers to EVERY response. Done here rather than
  // per-route so we can't forget. Headers must be set before the body
  // is sent — which is fine: routes haven't run yet at this point.
  applySecurityHeaders(nodeReq, nodeRes);

  // Parse URL + query + cookies up front.
  const parsedUrl = new URL(nodeReq.url, `http://${nodeReq.headers.host || 'localhost'}`);
  nodeReq.path = parsedUrl.pathname;
  nodeReq.query = Object.fromEntries(parsedUrl.searchParams);
  nodeReq.cookies = parseCookies(nodeReq.headers.cookie);

  // Post-restore lockdown. Once a restore completes, the in-memory
  // stores are stale and we don't want to serve anything that depends
  // on them. The allowlist below lets the user see the settings page
  // (with its "restart Pica" banner) and call /api/backups/status to
  // detect the state, but every other API call gets 503.
  if (serverState.restoreCompleted && isApiEndpoint(nodeReq.path)) {
    const allowed = nodeReq.path === '/api/backups/status'
                 || nodeReq.path === '/api/logout';
    if (!allowed) {
      return nodeRes.serviceUnavailable(
        'Restore is complete — please restart Pica to use the restored data.',
        { errorCode: 'restore_pending_restart' },
      );
    }
  }

  if (serverState.rotateCompleted && isApiEndpoint(nodeReq.path)) {
    const allowed = nodeReq.path === '/api/logout';
    if (!allowed) {
      return nodeRes.serviceUnavailable(
        'Key rotation complete — restart Pica, then set a new recovery code.',
        { errorCode: 'rotate_pending_restart' },
      );
    }
  }

  // Recovery-code unlock lockdown: the master key is live but the passphrase
  // slot is no longer trusted. Force the operator to set a new passphrase
  // before anything else runs. Allowlist includes /api/login so the operator
  // can authenticate first (they have no session on a fresh boot), /api/me
  // so the frontend can identify the session, /api/logout, and the passphrase-
  // set endpoint itself. Cleared in-process by /api/security/passphrase on
  // success — no restart needed.
  if (serverState.passphraseResetRequired && isApiEndpoint(nodeReq.path)) {
    const allowed = nodeReq.path === '/api/login'
                 || nodeReq.path === '/api/security/passphrase'
                 || nodeReq.path === '/api/logout'
                 || nodeReq.path === '/api/me';
    if (!allowed) {
      return nodeRes.serviceUnavailable(
        'Unlocked via recovery code — set a new passphrase to continue.',
        { errorCode: 'passphrase_reset_required' },
      );
    }
  }

  try {
    // Parse body for methods that typically have one. The restore
    // endpoint accepts uploads up to backupMaxBytes (200 MB by
    // default); everything else stays under maxBodyBytes (5 MB).
    // DELETE is included because some endpoints (e.g. recovery-code removal)
    // require a credential in the body. Existing DELETE routes ignore req.body,
    // so parsing one is harmless; the per-path size cap still applies.
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(nodeReq.method)) {
      const isLeaveUpload = nodeReq.path === '/api/leaves'
        || nodeReq.path.endsWith('/attachment');
      const cap = nodeReq.path === '/api/backups/restore'
        ? config.backupMaxBytes
        : isLeaveUpload
          ? config.attachmentMaxBytes
          : config.maxBodyBytes;
      nodeReq.body = await parseBody(nodeReq, { maxBytes: cap });
    } else {
      nodeReq.body = {};
    }

    const match = router.match(nodeReq.method, nodeReq.path);

    if (match && match.handler) {
      nodeReq.params = match.params;
      await match.handler(nodeReq, nodeRes);
      return;
    }

    if (match && match.methodNotAllowed) {
      nodeRes.writeHead(405, { 'Content-Type': 'application/json' });
      nodeRes.end(JSON.stringify({ error: 'Method Not Allowed' }));
      return;
    }

    // Fall back to static files on GET only.
    if (nodeReq.method === 'GET') {
      const served = await serveStatic(nodeReq.path, nodeRes, publicDir, nodeReq);
      if (served) return;
    }

    nodeRes.notFound();
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      nodeRes.writeHead(413, { 'Content-Type': 'application/json' });
      nodeRes.end(JSON.stringify({ error: err.message }));
      return;
    }
    if (err instanceof BadBodyError) {
      nodeRes.badRequest(err.message);
      return;
    }

    log.error(`Unhandled error on ${nodeReq.method} ${nodeReq.url}:`, err);
    if (!nodeRes.headersSent) nodeRes.serverError();
  } finally {
    const ms = Date.now() - start;
    const status = nodeRes.statusCode;
    // 4xx/5xx go through warn so they stand out.
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    log[level](`${nodeReq.method} ${nodeReq.url} ${status} ${ms}ms`);
  }
}

// ----------------------------------------------------------------------------
// Server lifecycle
// ----------------------------------------------------------------------------

const server = http.createServer(handle);

server.listen(config.port, config.host, () => {
  log.info(`Pica listening on http://${config.host}:${config.port}`);
  log.info(`Data dir:   ${config.dataDir}`);
  log.info(`Backup dir: ${config.backupDir}`);
});

// Graceful shutdown on Ctrl-C / kill.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log.info(`Received ${signal}, shutting down…`);
    server.close(() => process.exit(0));
    // Force-exit if shutdown stalls (e.g., long-running request).
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
