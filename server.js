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
import { startBackupScheduler } from './src/scheduler/backup-scheduler.js';
import { createEmployeesStore } from './src/storage/employees.js';
import { createPunchesStore } from './src/storage/punches.js';
import { createLeavesStore, LEAVE_TYPES_LIST } from './src/storage/leaves.js';
import { createCorrectionsStore } from './src/storage/corrections.js';
import { createUserPrefsStore } from './src/storage/user-prefs.js';
import { createOrgSettingsStore } from './src/storage/org-settings.js';
import { createCompanyLogoStore } from './src/storage/company-logo.js';
import { createBackupsStore } from './src/storage/backups.js';

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
try {
  masterKey = await initMasterKey(config, configPath, log);
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

// Process-wide flags. After a restore, `restoreCompleted` flips true
// and the request handler short-circuits all routes (except a small
// allowlist) with 503. Cleared only by restarting the process — which
// is the point: the in-memory stores need to be reconstructed.
const serverState = { restoreCompleted: false };

const loginLimiter = createRateLimiter({ max: 10, windowSeconds: 60 });
const rbac = createRBAC({ sessionKey, usersStore });
const isProduction = process.env.NODE_ENV === 'production';

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

registerSetupRoutes(router, { usersStore, sessionKey, isProduction });
registerAuthRoutes(router, {
  usersStore,
  employeesStore,
  sessionKey,
  loginLimiter,
  requireAuth: rbac.requireAuth,
  isProduction,
});
registerEmployeeRoutes(router, {
  usersStore,
  employeesStore,
  punchesStore,
  leavesStore,
  correctionsStore,
  orgSettingsStore,
  requireAuth: rbac.requireAuth,
  requireRole: rbac.requireRole,
  requireOwnerOrEmployer: rbac.requireOwnerOrEmployer,
});
registerPunchRoutes(router, {
  punchesStore,
  usersStore,
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
});
registerCorrectionRoutes(router, {
  correctionsStore,
  punchesStore,
  usersStore,
  employeesStore,
  requireAuth: rbac.requireAuth,
  requireRole: rbac.requireRole,
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
});
registerBackupRoutes(router, {
  backupsStore,
  serverState,
  requireRole: rbac.requireRole,
  logger: log,
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

// ----------------------------------------------------------------------------
// Request handler
// ----------------------------------------------------------------------------

/**
 * True for any path that's an API endpoint (not a page load and not
 * a static asset). Used by the post-restore lockdown to differentiate
 * "user trying to look at the settings page" from "anything that
 * depends on store state".
 */
function isApiEndpoint(path) {
  return path.startsWith('/api/');
}

async function handle(nodeReq, nodeRes) {
  const start = Date.now();
  enhance(nodeRes);

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

  try {
    // Parse body for methods that typically have one. The restore
    // endpoint accepts uploads up to backupMaxBytes (200 MB by
    // default); everything else stays under maxBodyBytes (5 MB).
    if (['POST', 'PUT', 'PATCH'].includes(nodeReq.method)) {
      const cap = nodeReq.path === '/api/backups/restore'
        ? config.backupMaxBytes
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
