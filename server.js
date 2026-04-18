#!/usr/bin/env node
/**
 * Pica — Time Management
 * Entry point. Boots the HTTP server, wires the router, serves static assets.
 *
 * Milestone 1 scope: plumbing only. Auth, encryption, and features arrive
 * in later milestones.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ----------------------------------------------------------------------------
// Startup
// ----------------------------------------------------------------------------

const config = loadConfig(path.join(__dirname, 'config.json'));
const log = createLogger(config.logLevel);

// Ensure runtime directories exist (they're gitignored and created lazily).
for (const dir of [config.dataDir, config.backupDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const publicDir = path.join(__dirname, 'public');
const router = createRouter();

// ----------------------------------------------------------------------------
// Sample routes — these verify the plumbing end-to-end and will be replaced
// by real feature routes in Milestone 3 onwards.
// ----------------------------------------------------------------------------

router.get('/api/health', (req, res) => {
  res.json({ ok: true, name: 'pica', version: '0.1.0' });
});

router.post('/api/echo', (req, res) => {
  res.json({ received: req.body, cookies: req.cookies, query: req.query });
});

router.get('/api/params/:id', (req, res) => {
  res.json({ id: req.params.id });
});

// ----------------------------------------------------------------------------
// Request handler
// ----------------------------------------------------------------------------

async function handle(nodeReq, nodeRes) {
  const start = Date.now();
  enhance(nodeRes);

  // Parse URL + query + cookies up front.
  const parsedUrl = new URL(nodeReq.url, `http://${nodeReq.headers.host || 'localhost'}`);
  nodeReq.path = parsedUrl.pathname;
  nodeReq.query = Object.fromEntries(parsedUrl.searchParams);
  nodeReq.cookies = parseCookies(nodeReq.headers.cookie);

  try {
    // Parse body for methods that typically have one.
    if (['POST', 'PUT', 'PATCH'].includes(nodeReq.method)) {
      nodeReq.body = await parseBody(nodeReq, { maxBytes: config.maxBodyBytes });
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
      const served = await serveStatic(nodeReq.path, nodeRes, publicDir);
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
