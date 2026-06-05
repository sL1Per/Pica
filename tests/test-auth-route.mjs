/**
 * M17 S7 regression: the session cookie must get `Secure` whenever TLS is in
 * play — either NODE_ENV=production OR the request arrived over HTTPS via a
 * TLS-terminating proxy (X-Forwarded-Proto: https). Previously the flag was
 * gated on isProduction alone, so an operator behind TLS who forgot to set
 * NODE_ENV shipped a non-Secure cookie.
 *
 * Run:  node tests/test-auth-route.mjs
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createRouter } from '../src/router.js';
import { registerAuthRoutes } from '../src/routes/auth.js';
import { createUsersStore } from '../src/auth/users.js';
import { deriveSessionKey } from '../src/auth/sessions.js';
import { createRateLimiter } from '../src/auth/rate-limit.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}

function mockRes() {
  const r = {
    statusCode: 200, body: null, headers: {},
    setHeader(k, v) { r.headers[k] = v; },
    json(d, s = 200) { r.statusCode = s; r.body = d; },
    badRequest(m, o) { r.statusCode = 400; r.body = { error: m, ...(o?.errorCode && { errorCode: o.errorCode }) }; },
  };
  return r;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-authroute-'));
try {
  const usersStore = createUsersStore(tmp);
  await usersStore.create({ username: 'boss', password: 'correct horse', role: 'employer' });
  const sessionKey = deriveSessionKey(randomBytes(32));

  function buildRouter({ isProduction }) {
    const router = createRouter();
    registerAuthRoutes(router, {
      usersStore,
      sessionKey,
      loginLimiter: createRateLimiter({ max: 100, windowSeconds: 60 }),
      passwordLimiter: createRateLimiter({ max: 100, windowSeconds: 60 }),
      requireAuth: (h) => h,
      isProduction,
    });
    return router;
  }

  async function login(router, headers) {
    const m = router.match('POST', '/api/login');
    const req = { headers, socket: {}, body: { username: 'boss', password: 'correct horse' } };
    const res = mockRes();
    await m.handler(req, res);
    return res;
  }

  await test('X-Forwarded-Proto: https → Secure cookie even when not production', async () => {
    const res = await login(buildRouter({ isProduction: false }), { 'x-forwarded-proto': 'https' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['Set-Cookie'], /;\s*Secure/);
  });

  await test('plain HTTP + non-production → no Secure flag', async () => {
    const res = await login(buildRouter({ isProduction: false }), {});
    assert.equal(res.statusCode, 200);
    assert.doesNotMatch(res.headers['Set-Cookie'], /;\s*Secure/);
  });

  await test('production → Secure cookie regardless of proxy header', async () => {
    const res = await login(buildRouter({ isProduction: true }), {});
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['Set-Cookie'], /;\s*Secure/);
  });

} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
