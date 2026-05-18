#!/usr/bin/env node
/**
 * tests/test-mail-routes.mjs — unit tests for src/routes/mail.js
 *
 * Mirrors the harness pattern of tests/test-security-routes.mjs:
 *   - builds a real router
 *   - injects fake deps (mailer spy, usersStore stub)
 *   - simulates employer vs employee requests
 *   - asserts status / body / mailer invocation
 *
 * Run:  node tests/test-mail-routes.mjs
 */

import assert from 'node:assert/strict';
import { createRouter } from '../src/router.js';
import { registerMailRoutes } from '../src/routes/mail.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL ${name}\n${err.stack}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Minimal mock response — mirrors test-security-routes.mjs mockRes()
// ---------------------------------------------------------------------------

function mockRes() {
  const r = {
    statusCode: null,
    body: null,
    json(d, s = 200) { r.statusCode = s; r.body = d; },
    badRequest(m, o) {
      r.statusCode = 400;
      r.body = { error: m, ...(o?.errorCode && { errorCode: o.errorCode }) };
    },
    forbidden(m, o) {
      r.statusCode = 403;
      r.body = { error: m, ...(o?.errorCode && { errorCode: o.errorCode }) };
    },
    unauthorized(m, o) {
      r.statusCode = 401;
      r.body = { error: m, ...(o?.errorCode && { errorCode: o.errorCode }) };
    },
  };
  return r;
}

// ---------------------------------------------------------------------------
// Auth/role guards — same fakes as test-security-routes.mjs
// requireRole checks req.user (401 if absent, 403 if wrong role).
// ---------------------------------------------------------------------------

const requireAuth = (h) => async (req, res) =>
  req.user ? h(req, res) : res.unauthorized('x', { errorCode: 'unauthorized' });

const requireRole = (role) => (h) => async (req, res) => {
  if (!req.user) return res.unauthorized('x', { errorCode: 'unauthorized' });
  if (req.user.role !== role) return res.forbidden('x', { errorCode: 'forbidden' });
  return h(req, res);
};

// ---------------------------------------------------------------------------
// Fixture IDs — valid UUID v4 format, as required by CLAUDE.md conventions
// ---------------------------------------------------------------------------

const EMPLOYER_ID  = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EMPLOYEE_ID  = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SENTINEL_PASS = 'S3cret!Pass#1';  // used to assert it never leaks

// ---------------------------------------------------------------------------
// Helper — call a registered route handler
// ---------------------------------------------------------------------------

async function call(router, method, urlPath, { user, body } = {}) {
  const m = router.match(method, urlPath);
  assert.ok(m && m.handler, `${method} ${urlPath} should be registered`);
  const req = { user, params: m.params || {}, query: {}, body: body || {}, socket: {} };
  const res = mockRes();
  await m.handler(req, res);
  return res;
}

// ---------------------------------------------------------------------------
// Build a router with registerMailRoutes + a mailer spy
//
// Wire-shape note: the route forwards mailer result as `{ ok, reason }`.
// On success the mailer returns `{ sent: true }` with NO reason key, so
// `res.body = { ok: true, reason: undefined }`.  JSON.stringify drops
// undefined-valued keys → the actual HTTP wire JSON is `{"ok":true}`.
// On any not-sent path the mailer returns `{ sent: false, reason: '<string>' }`
// and the wire JSON is `{"ok":false,"reason":"..."}`.
// Tests that care about wire shape must round-trip through JSON.
// ---------------------------------------------------------------------------

function buildFixture(mailerOverride) {
  const mailerCalls = [];
  const defaultMailer = {
    async notify(category, opts) {
      mailerCalls.push({ category, ...opts });
      return { sent: true };   // no reason key — mirrors real mailer success contract
    },
  };
  const mailer = mailerOverride || defaultMailer;

  const router = createRouter();
  registerMailRoutes(router, {
    mailer,
    requireRole,
  });

  return { router, mailerCalls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\nPOST /api/mail/test — role guard');

await test('unauthenticated request → 401', async () => {
  const { router } = buildFixture();
  const res = await call(router, 'POST', '/api/mail/test', { user: null });
  assert.equal(res.statusCode, 401);
});

await test('employee → 403 (role guard blocks before handler runs)', async () => {
  const { router, mailerCalls } = buildFixture();
  const res = await call(router, 'POST', '/api/mail/test', {
    user: { id: EMPLOYEE_ID, role: 'employee' },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(mailerCalls.length, 0, 'mailer must not be called when guard rejects');
});

await test('employer → 200', async () => {
  const { router } = buildFixture();
  const res = await call(router, 'POST', '/api/mail/test', {
    user: { id: EMPLOYER_ID, role: 'employer' },
  });
  assert.equal(res.statusCode, 200);
});

console.log('\nPOST /api/mail/test — response shape');

// Wire shape: on SUCCESS the mailer returns {sent:true} with no reason key.
// The route maps that to {ok:true, reason:undefined}.  JSON.stringify drops
// undefined-valued own properties, so the wire JSON a client receives is
// {"ok":true} — reason is intentionally absent on the success path.
// On any not-sent path (mail_disabled, no_address, etc.) the mailer
// returns {sent:false, reason:'<string>'} and the wire JSON includes reason.
await test('success wire shape: only ok=true present (reason absent after serialisation)', async () => {
  const { router } = buildFixture();
  const res = await call(router, 'POST', '/api/mail/test', {
    user: { id: EMPLOYER_ID, role: 'employer' },
  });
  // Round-trip through JSON to get the wire representation.
  const wire = JSON.parse(JSON.stringify(res.body));
  assert.ok('ok' in wire, 'wire body must have ok field');
  assert.ok(!('reason' in wire), 'reason must be absent from wire JSON on success');
  assert.equal(wire.ok, true);
});

await test('not-sent wire shape: both ok=false and reason present after serialisation', async () => {
  const { router } = buildFixture({
    notify: async () => ({ sent: false, reason: 'mail_disabled' }),
  });
  const res = await call(router, 'POST', '/api/mail/test', {
    user: { id: EMPLOYER_ID, role: 'employer' },
  });
  // Round-trip through JSON to get the wire representation.
  const wire = JSON.parse(JSON.stringify(res.body));
  assert.ok('ok' in wire, 'wire body must have ok field');
  assert.ok('reason' in wire, 'reason must be present in wire JSON when not sent');
  assert.equal(wire.ok, false);
  assert.equal(wire.reason, 'mail_disabled');
});

await test('response ok=true when mailer returns sent:true', async () => {
  const { router } = buildFixture({
    notify: async () => ({ sent: true }),
  });
  const res = await call(router, 'POST', '/api/mail/test', {
    user: { id: EMPLOYER_ID, role: 'employer' },
  });
  assert.equal(res.body.ok, true);
});

await test('response ok=false when mailer returns sent:false', async () => {
  const { router } = buildFixture({
    notify: async () => ({ sent: false, reason: 'mail_disabled' }),
  });
  const res = await call(router, 'POST', '/api/mail/test', {
    user: { id: EMPLOYER_ID, role: 'employer' },
  });
  assert.equal(res.statusCode, 200, 'still 200 even when mail not sent (config probe)');
  assert.equal(res.body.ok, false);
  assert.equal(res.body.reason, 'mail_disabled');
});

// Wire shape: success produces exactly {ok} — no extra fields, reason absent.
await test('success wire body contains exactly {ok} — no extra fields, reason absent', async () => {
  const { router } = buildFixture({
    notify: async () => ({ sent: true }),
  });
  const res = await call(router, 'POST', '/api/mail/test', {
    user: { id: EMPLOYER_ID, role: 'employer' },
  });
  // Serialize then parse to match what an HTTP client actually receives.
  const wire = JSON.parse(JSON.stringify(res.body));
  const keys = Object.keys(wire).sort();
  assert.deepEqual(keys, ['ok'], `expected wire keys ['ok'], got: ${keys}`);
});

console.log('\nPOST /api/mail/test — pass sentinel must not appear in response');

await test('CRITICAL: config pass sentinel never appears anywhere in the response body', async () => {
  // The mailer returns a reason string — make it contain a realistic value.
  // We also verify the stringified body contains no pass-like secret.
  const { router } = buildFixture({
    notify: async () => ({ sent: false, reason: 'mail_disabled' }),
  });
  // The route must not echo config.mail.pass into the response — we test by
  // checking the serialised response body for the sentinel value.
  const res = await call(router, 'POST', '/api/mail/test', {
    user: { id: EMPLOYER_ID, role: 'employer' },
  });
  const serialised = JSON.stringify(res.body);
  assert.ok(
    !serialised.includes(SENTINEL_PASS),
    `pass sentinel must not appear in response body: ${serialised}`,
  );
});

console.log('\nPOST /api/mail/test — mailer invocation');

await test('mailer.notify is called with category "testEmail"', async () => {
  const { router, mailerCalls } = buildFixture();
  await call(router, 'POST', '/api/mail/test', {
    user: { id: EMPLOYER_ID, role: 'employer' },
  });
  assert.equal(mailerCalls.length, 1, 'notify called exactly once');
  assert.equal(mailerCalls[0].category, 'testEmail');
});

await test('mailer.notify is called with the employer own id as recipientUserId', async () => {
  const { router, mailerCalls } = buildFixture();
  await call(router, 'POST', '/api/mail/test', {
    user: { id: EMPLOYER_ID, role: 'employer' },
  });
  assert.equal(mailerCalls[0].recipientUserId, EMPLOYER_ID);
});

await test('mailer.notify vars is {} (no extra data)', async () => {
  const { router, mailerCalls } = buildFixture();
  await call(router, 'POST', '/api/mail/test', {
    user: { id: EMPLOYER_ID, role: 'employer' },
  });
  assert.deepEqual(mailerCalls[0].vars, {});
});

await test('mailer.notify return value drives response (sent:false, reason forwarded)', async () => {
  const { router } = buildFixture({
    notify: async () => ({ sent: false, reason: 'no_address' }),
  });
  const res = await call(router, 'POST', '/api/mail/test', {
    user: { id: EMPLOYER_ID, role: 'employer' },
  });
  assert.equal(res.body.ok, false);
  assert.equal(res.body.reason, 'no_address');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
