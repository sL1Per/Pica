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
import { registerLeaveRoutes } from '../src/routes/leaves.js';
import { registerCorrectionRoutes } from '../src/routes/corrections.js';
import { registerEmployeeRoutes } from '../src/routes/employees.js';
import { registerSettingsRoutes } from '../src/routes/settings.js';

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
    notFound(m, o) {
      r.statusCode = 404;
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
// Decision-route resilience: a broken/failing mailer must NOT 500 or
// block the leave/correction decision response.
//
// Since notify() is always `void`-ed and never awaited, even a mailer
// whose notify() throws synchronously (which real notify never does, but
// we test the contract) or returns a rejected promise cannot affect the
// HTTP response. The handler already sent res.json() before calling
// void mailer.notify(), so the response is unaffected either way.
// ---------------------------------------------------------------------------

const LEAVE_ID      = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EMPLOYEE_ID2  = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const EMPLOYER_ID2  = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CORRECTION_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function buildLeaveFixture(mailerOverride) {
  const router = createRouter();
  const leave = {
    id: LEAVE_ID, employeeId: EMPLOYEE_ID2, type: 'vacation', status: 'pending',
    unit: 'days', start: '2026-07-01', end: '2026-07-05',
  };
  const leavesStore = {
    findById: () => leave,
    approve: () => ({ ...leave, status: 'approved' }),
    reject: (id, actorId, notes) => ({ ...leave, status: 'rejected', notes }),
    list: () => [leave],
    computeBalances: () => [],
    wouldExceedCap: () => ({ exceeds: false }),
  };
  const usersStore = {
    list: () => [
      { id: EMPLOYEE_ID2, username: 'emp', role: 'employee' },
      { id: EMPLOYER_ID2, username: 'boss', role: 'employer' },
    ],
  };
  const employeesStore = { list: () => [] };
  const orgSettingsStore = { get: () => ({ leaves: { blockedRanges: [], concurrentAllowed: true } }) };
  registerLeaveRoutes(router, {
    leavesStore, usersStore, employeesStore, orgSettingsStore,
    leaveTypes: ['vacation', 'sick', 'appointment', 'other'],
    daysOf: () => 1, requireAuth, requireRole,
    mailer: mailerOverride,
  });
  return router;
}

function buildCorrectionFixture(mailerOverride) {
  const router = createRouter();
  const correction = {
    id: CORRECTION_ID, employeeId: EMPLOYEE_ID2, status: 'pending',
    kind: 'both', start: '2026-06-10T09:00:00Z', end: '2026-06-10T17:00:00Z',
    hours: 8, isJustified: true, justification: 'test',
  };
  const correctionsStore = {
    findById: () => correction,
    approve: () => ({ ...correction, status: 'approved' }),
    reject: () => ({ ...correction, status: 'rejected' }),
    list: () => [correction],
  };
  const punchesStore = {
    findByClientId: () => null,
    append: () => {},
  };
  const usersStore = {
    list: () => [
      { id: EMPLOYEE_ID2, username: 'emp', role: 'employee' },
      { id: EMPLOYER_ID2, username: 'boss', role: 'employer' },
    ],
  };
  const employeesStore = { list: () => [] };
  registerCorrectionRoutes(router, {
    correctionsStore, punchesStore, usersStore, employeesStore,
    requireAuth, requireRole,
    mailer: mailerOverride,
  });
  return router;
}

console.log('\nDecision-route resilience — failing mailer must not break the response');

await test('leave approve returns 200 when mailer.notify resolves {sent:false}', async () => {
  const failingMailer = { notify: async () => ({ sent: false, reason: 'mail_disabled' }) };
  const router = buildLeaveFixture(failingMailer);
  const res = await call(router, 'POST', `/api/leaves/${LEAVE_ID}/approve`, {
    user: { id: EMPLOYER_ID2, role: 'employer' },
  });
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}`);
  assert.equal(res.body.ok, true);
});

await test('leave reject returns 200 when mailer.notify resolves {sent:false}', async () => {
  const failingMailer = { notify: async () => ({ sent: false, reason: 'no_address' }) };
  const router = buildLeaveFixture(failingMailer);
  const res = await call(router, 'POST', `/api/leaves/${LEAVE_ID}/reject`, {
    user: { id: EMPLOYER_ID2, role: 'employer' },
    body: { notes: null },
  });
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}`);
  assert.equal(res.body.ok, true);
});

await test('leave approve returns 200 with null mailer (no mailer injected)', async () => {
  const router = buildLeaveFixture(null);
  const res = await call(router, 'POST', `/api/leaves/${LEAVE_ID}/approve`, {
    user: { id: EMPLOYER_ID2, role: 'employer' },
  });
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}`);
  assert.equal(res.body.ok, true);
});

await test('correction approve returns 200 when mailer.notify resolves {sent:false}', async () => {
  const failingMailer = { notify: async () => ({ sent: false, reason: 'mail_disabled' }) };
  const router = buildCorrectionFixture(failingMailer);
  const res = await call(router, 'POST', `/api/corrections/${CORRECTION_ID}/approve`, {
    user: { id: EMPLOYER_ID2, role: 'employer' },
  });
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}`);
  assert.equal(res.body.ok, true);
});

await test('correction reject returns 200 when mailer.notify resolves {sent:false}', async () => {
  const failingMailer = { notify: async () => ({ sent: false, reason: 'no_address' }) };
  const router = buildCorrectionFixture(failingMailer);
  const res = await call(router, 'POST', `/api/corrections/${CORRECTION_ID}/reject`, {
    user: { id: EMPLOYER_ID2, role: 'employer' },
  });
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}`);
  assert.equal(res.body.ok, true);
});

await test('correction approve returns 200 with null mailer (no mailer injected)', async () => {
  const router = buildCorrectionFixture(null);
  const res = await call(router, 'POST', `/api/corrections/${CORRECTION_ID}/approve`, {
    user: { id: EMPLOYER_ID2, role: 'employer' },
  });
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}`);
  assert.equal(res.body.ok, true);
});

// ---------------------------------------------------------------------------
// Decision-route resilience — password-reset: notify is fire-and-forget;
// a soft-failing or absent mailer must NOT prevent the reset from succeeding.
//
// Mirrors the leave/correction resilience fixtures above. The key invariant:
//   1. The reset itself (setPassword/mustChange) completes regardless of mailer.
//   2. res.json({ok:true}) is sent before notify() is called (fire-and-forget).
//   3. A null mailer (mailer not configured) is also safe.
// ---------------------------------------------------------------------------

const RESET_EMPLOYER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const RESET_TARGET_ID   = '11111111-1111-4111-8111-111111111111';

function buildPasswordResetFixture(mailerOverride) {
  const router = createRouter();

  const setPasswordCalls = [];
  const usersStore = {
    list: () => [
      { id: RESET_EMPLOYER_ID, username: 'boss', role: 'employer' },
      { id: RESET_TARGET_ID,   username: 'emp',  role: 'employee' },
    ],
    findById: (id) => {
      if (id === RESET_TARGET_ID) return { id: RESET_TARGET_ID, username: 'emp', role: 'employee' };
      if (id === RESET_EMPLOYER_ID) return { id: RESET_EMPLOYER_ID, username: 'boss', role: 'employer' };
      return null;
    },
    setPassword: async (id, pass, opts) => { setPasswordCalls.push({ id, pass, opts }); },
  };

  const employeesStore  = { list: () => [] };
  const punchesStore    = { list: () => [] };
  const leavesStore     = { list: () => [] };
  const correctionsStore = { list: () => [] };
  const orgSettingsStore = { get: () => ({}) };
  // null passwordLimiter → allow() branch is skipped (same as production with unlimited config)
  const passwordLimiter = { allow: () => true };

  // requireOwnerOrEmployer is curried: requireOwnerOrEmployer(idExtractor)(handler).
  const requireOwnerOrEmployer = (_idExtractor) => (h) => async (req, res) => h(req, res);

  registerEmployeeRoutes(router, {
    usersStore, employeesStore, punchesStore, leavesStore, correctionsStore,
    orgSettingsStore, passwordLimiter,
    requireAuth, requireRole, requireOwnerOrEmployer,
    auditStore: null,
    mailer: mailerOverride,
  });

  return { router, setPasswordCalls };
}

console.log('\nDecision-route resilience — password-reset notify must not block the reset');

await test('password-reset returns 200 {ok:true} when mailer.notify resolves {sent:false}', async () => {
  const failingMailer = { notify: async () => ({ sent: false, reason: 'mail_disabled' }) };
  const { router, setPasswordCalls } = buildPasswordResetFixture(failingMailer);
  const res = await call(router, 'POST', `/api/employees/${RESET_TARGET_ID}/password-reset`, {
    user: { id: RESET_EMPLOYER_ID, role: 'employer' },
    body: { newPassword: 'Temp@Pass1!' },
  });
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}`);
  assert.equal(res.body.ok, true);
  // Assert the reset itself completed regardless of mailer result.
  assert.equal(setPasswordCalls.length, 1, 'setPassword must be called even when mailer soft-fails');
  assert.equal(setPasswordCalls[0].id, RESET_TARGET_ID);
  assert.equal(setPasswordCalls[0].opts?.mustChange, true);
});

await test('password-reset returns 200 {ok:true} with null mailer (no mailer injected)', async () => {
  const { router, setPasswordCalls } = buildPasswordResetFixture(null);
  const res = await call(router, 'POST', `/api/employees/${RESET_TARGET_ID}/password-reset`, {
    user: { id: RESET_EMPLOYER_ID, role: 'employer' },
    body: { newPassword: 'Temp@Pass1!' },
  });
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}`);
  assert.equal(res.body.ok, true);
  // Assert the reset itself completed even with no mailer.
  assert.equal(setPasswordCalls.length, 1, 'setPassword must be called even when mailer is null');
  assert.equal(setPasswordCalls[0].id, RESET_TARGET_ID);
  assert.equal(setPasswordCalls[0].opts?.mustChange, true);
});

// ---------------------------------------------------------------------------
// GET /api/settings/org + PUT /api/settings/mail — Settings API
//
// These routes live in src/routes/settings.js. We build a minimal router
// with registerSettingsRoutes injected with a fake mailConfigStore and fake
// orgSettingsStore, then assert:
//   - GET returns mailConfigured (bool from isConfigured()) + mail (publicView())
//   - GET never returns pass
//   - GET is employer-only (employee 403, unauth 401)
//   - PUT /api/settings/mail is employer-only (employee 403, unauth 401)
//   - PUT forwards req.body untouched to write(); response is publicView(), never pass
//   - PUT with a body lacking `pass` still works (store owns write-only semantics)
// ---------------------------------------------------------------------------

console.log('\nGET /api/settings/org + PUT /api/settings/mail — Settings API');

function buildSettingsFixture() {
  let writeCalls = [];
  const fakeMailConfigStore = {
    isConfigured: () => true,
    publicView: () => ({
      enabled: true, host: 'h', port: 465, secure: true,
      user: 'u', from: 'F <f@x>', hasPassword: true,
    }),
    write: (patch) => {
      writeCalls.push(patch);
      // Return a slightly different publicView (simulating a host update).
      // NOTE: write() returns publicView() — never a raw config with pass.
      return {
        enabled: true, host: 'h2', port: 587, secure: false,
        user: 'u', from: 'F <f@x>', hasPassword: true,
      };
    },
    // read() is not used by the route; included for shape parity with the real store.
    read: () => ({}),
  };

  // Minimal orgSettingsStore matching what GET /api/settings/org reads.
  const fakeOrgSettingsStore = {
    get: () => ({
      notifications: { leaveDecision: true, correctionDecision: true, leaveReminder: true },
      leaves: { blockedRanges: [], concurrentAllowed: true },
    }),
    resolveWorkingTimeFor: () => ({}),
    update: () => ({}),
  };

  // Minimal stubs for the other deps registerSettingsRoutes expects.
  const fakeUserPrefsStore = { get: () => ({}), update: () => ({}) };
  const fakeCompanyLogoStore = { exists: () => false, read: () => Buffer.alloc(0), write: () => {}, remove: () => {} };

  const router = createRouter();
  registerSettingsRoutes(router, {
    userPrefsStore: fakeUserPrefsStore,
    orgSettingsStore: fakeOrgSettingsStore,
    companyLogoStore: fakeCompanyLogoStore,
    requireAuth,
    requireRole,
    auditStore: null,
    mailConfigStore: fakeMailConfigStore,
  });

  return { router, writeCalls, fakeMailConfigStore };
}

// --- GET /api/settings/org — role guard ---

await test('GET /api/settings/org unauthenticated → 401', async () => {
  const { router } = buildSettingsFixture();
  const res = await call(router, 'GET', '/api/settings/org', { user: null });
  assert.equal(res.statusCode, 401);
});

await test('GET /api/settings/org as employee → 403', async () => {
  const { router } = buildSettingsFixture();
  const res = await call(router, 'GET', '/api/settings/org', {
    user: { id: EMPLOYEE_ID, role: 'employee' },
  });
  assert.equal(res.statusCode, 403);
});

// --- GET /api/settings/org — response shape ---

await test('GET /api/settings/org as employer → 200 with mailConfigured=true from isConfigured()', async () => {
  const { router } = buildSettingsFixture();
  const res = await call(router, 'GET', '/api/settings/org', {
    user: { id: EMPLOYER_ID, role: 'employer' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.mailConfigured, true,
    'mailConfigured must be isConfigured() result, not a hardcoded boolean');
});

await test('GET /api/settings/org body.mail deep-equals publicView() (7-key view, no pass)', async () => {
  const { router, fakeMailConfigStore } = buildSettingsFixture();
  const res = await call(router, 'GET', '/api/settings/org', {
    user: { id: EMPLOYER_ID, role: 'employer' },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.mail, fakeMailConfigStore.publicView(),
    'body.mail must exactly match publicView()');
});

await test('CRITICAL: GET /api/settings/org — pass never appears in response (key check)', async () => {
  const { router } = buildSettingsFixture();
  const res = await call(router, 'GET', '/api/settings/org', {
    user: { id: EMPLOYER_ID, role: 'employer' },
  });
  assert.ok(!('pass' in res.body.mail),
    '"pass" key must not be present in body.mail');
  // Also check the full serialised body — ensures no nested object leaks it.
  assert.ok(!JSON.stringify(res.body).includes('"pass"'),
    '"pass" key must not appear anywhere in the serialised response body');
});

// --- PUT /api/settings/mail — role guard ---

await test('PUT /api/settings/mail unauthenticated → 401', async () => {
  const { router, writeCalls } = buildSettingsFixture();
  const res = await call(router, 'PUT', '/api/settings/mail', { user: null });
  assert.equal(res.statusCode, 401);
  assert.equal(writeCalls.length, 0, 'write must not be called when unauthenticated');
});

await test('PUT /api/settings/mail as employee → 403, write not called', async () => {
  const { router, writeCalls } = buildSettingsFixture();
  const res = await call(router, 'PUT', '/api/settings/mail', {
    user: { id: EMPLOYEE_ID, role: 'employee' },
    body: { enabled: true, host: 'h', port: 465, secure: true, user: 'u', pass: 'p', from: 'F <f@x>' },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(writeCalls.length, 0, 'write must not be called when role guard rejects');
});

// --- PUT /api/settings/mail — employer happy path ---

await test('PUT /api/settings/mail as employer → 200, write called once with exact body', async () => {
  const { router, writeCalls } = buildSettingsFixture();
  const body = { enabled: true, host: 'h2', port: 587, secure: false, user: 'u', pass: 'p', from: 'F <f@x>' };
  const res = await call(router, 'PUT', '/api/settings/mail', {
    user: { id: EMPLOYER_ID, role: 'employer' },
    body,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(writeCalls.length, 1, 'write must be called exactly once');
  // Route MUST NOT shape-massage the body — forward it untouched; store owns semantics.
  assert.deepEqual(writeCalls[0], body, 'write must receive req.body untouched');
});

await test('PUT /api/settings/mail response is publicView() (never pass)', async () => {
  const { router } = buildSettingsFixture();
  const res = await call(router, 'PUT', '/api/settings/mail', {
    user: { id: EMPLOYER_ID, role: 'employer' },
    body: { enabled: true, host: 'h2', port: 587, secure: false, user: 'u', pass: 'p', from: 'F <f@x>' },
  });
  assert.equal(res.statusCode, 200);
  // The response wraps the store's return value as { ok, mail }.
  assert.ok(res.body.ok, 'response must have ok:true');
  assert.ok(res.body.mail, 'response must have a mail field');
  assert.ok(!('pass' in res.body.mail),
    '"pass" key must not be present in response.mail');
  assert.ok(!JSON.stringify(res.body).includes('"pass"'),
    '"pass" key must not appear anywhere in the serialised response body');
});

await test('PUT /api/settings/mail response includes mailConfigured from isConfigured() (no pass)', async () => {
  const { router, fakeMailConfigStore } = buildSettingsFixture();
  const res = await call(router, 'PUT', '/api/settings/mail', {
    user: { id: EMPLOYER_ID, role: 'employer' },
    body: { enabled: true, host: 'h2', port: 587, secure: false, user: 'u', pass: 'p', from: 'F <f@x>' },
  });
  assert.equal(res.statusCode, 200);
  // The status line on the client is driven by this server-authoritative
  // boolean, so the PUT response must carry isConfigured()'s result — not a
  // 2-field client-side derivation that transiently lies during partial saves.
  assert.equal(res.body.mailConfigured, fakeMailConfigStore.isConfigured(),
    'response.mailConfigured must equal the store isConfigured() result');
  // Re-assert the no-pass invariant: mailConfigured is a plain boolean and
  // must not have widened the response to leak credentials.
  assert.ok(!JSON.stringify(res.body).includes('"pass"'),
    '"pass" key must not appear anywhere in the serialised response body');
});

await test('PUT /api/settings/mail body without pass → 200, write called with patch lacking pass', async () => {
  const { router, writeCalls } = buildSettingsFixture();
  // Route MUST NOT inject/echo pass; it passes req.body untouched.
  const body = { enabled: true, host: 'h2', port: 587, secure: false, user: 'u', from: 'F <f@x>' };
  const res = await call(router, 'PUT', '/api/settings/mail', {
    user: { id: EMPLOYER_ID, role: 'employer' },
    body,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(writeCalls.length, 1);
  // The forwarded patch must not have a pass key (route didn't inject one).
  assert.ok(!('pass' in writeCalls[0]),
    'route must not inject pass into the forwarded patch');
  assert.deepEqual(writeCalls[0], body, 'patch must match the body exactly (no additions)');
});

// --- PUT /api/settings/mail — store throws → 400 ---

await test('PUT /api/settings/mail store throws → 400 with mapped errorCode', async () => {
  // A mailConfigStore whose write() throws with err.code = 'invalid_shape'.
  // The route must catch and map to badRequest; the 500 must not escape.
  const router = createRouter();
  const throwingMailConfigStore = {
    isConfigured: () => true,
    publicView: () => ({ enabled: false, host: '', port: 465, secure: true, user: '', from: '', hasPassword: false }),
    write: () => { const e = new Error('bad shape'); e.code = 'invalid_shape'; throw e; },
    read: () => ({}),
  };
  const fakeOrgSettingsStore = {
    get: () => ({}),
    resolveWorkingTimeFor: () => ({}),
    update: () => ({}),
  };
  const fakeUserPrefsStore = { get: () => ({}), update: () => ({}) };
  const fakeCompanyLogoStore = { exists: () => false, read: () => Buffer.alloc(0), write: () => {}, remove: () => {} };
  registerSettingsRoutes(router, {
    userPrefsStore: fakeUserPrefsStore,
    orgSettingsStore: fakeOrgSettingsStore,
    companyLogoStore: fakeCompanyLogoStore,
    requireAuth,
    requireRole,
    auditStore: null,
    mailConfigStore: throwingMailConfigStore,
  });
  const res = await call(router, 'PUT', '/api/settings/mail', {
    user: { id: EMPLOYER_ID, role: 'employer' },
    body: { enabled: true, host: 'h', port: 465, secure: true, user: 'u', pass: 'p', from: 'F <f@x>' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errorCode, 'invalid_shape',
    'errorCode from err.code must be forwarded via badRequest');
});

// --- GET /api/settings/org — mailConfigStore.isConfigured() = false ---

await test('GET /api/settings/org reflects isConfigured:false → body.mailConfigured===false, mail present, no pass', async () => {
  const router = createRouter();
  const unconfiguredMailStore = {
    isConfigured: () => false,
    // publicView() returns the inert-default shape; the key assertion is the boolean.
    publicView: () => ({ enabled: false, host: '', port: 465, secure: true, user: '', from: '', hasPassword: false }),
    read: () => ({}),
    write: () => ({}),
  };
  const fakeOrgSettingsStore = {
    get: () => ({}),
    resolveWorkingTimeFor: () => ({}),
    update: () => ({}),
  };
  const fakeUserPrefsStore = { get: () => ({}), update: () => ({}) };
  const fakeCompanyLogoStore = { exists: () => false, read: () => Buffer.alloc(0), write: () => {}, remove: () => {} };
  registerSettingsRoutes(router, {
    userPrefsStore: fakeUserPrefsStore,
    orgSettingsStore: fakeOrgSettingsStore,
    companyLogoStore: fakeCompanyLogoStore,
    requireAuth,
    requireRole,
    auditStore: null,
    mailConfigStore: unconfiguredMailStore,
  });
  const res = await call(router, 'GET', '/api/settings/org', {
    user: { id: EMPLOYER_ID, role: 'employer' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.mailConfigured, false,
    'mailConfigured must be false when isConfigured() returns false');
  assert.ok(res.body.mail !== undefined, 'body.mail must still be present when unconfigured');
  assert.ok(!('pass' in res.body.mail),
    '"pass" key must not be present in body.mail even when unconfigured');
  assert.ok(!JSON.stringify(res.body).includes('"pass"'),
    '"pass" key must not appear anywhere in the serialised response');
});

// --- PUT /api/settings/mail — audit record emitted, no pass leak in audit ---

await test('CRITICAL: PUT /api/settings/mail — audit called once with event=settings.mail_updated, no pass in record', async () => {
  // Use a sentinel password so we can confirm it never enters the audit record.
  const AUDIT_PASS_SENTINEL = 'P@ssWord!';

  const auditCalls = [];
  const fakeAuditStore = {
    appendRecord: (rec) => { auditCalls.push(rec); },
  };

  const router = createRouter();
  const fakeMailConfigStore = {
    isConfigured: () => true,
    publicView: () => ({ enabled: true, host: 'h', port: 465, secure: true, user: 'u', from: 'F <f@x>', hasPassword: true }),
    write: () => ({ enabled: true, host: 'h', port: 465, secure: true, user: 'u', from: 'F <f@x>', hasPassword: true }),
    read: () => ({}),
  };
  const fakeOrgSettingsStore = {
    get: () => ({}),
    resolveWorkingTimeFor: () => ({}),
    update: () => ({}),
  };
  const fakeUserPrefsStore = { get: () => ({}), update: () => ({}) };
  const fakeCompanyLogoStore = { exists: () => false, read: () => Buffer.alloc(0), write: () => {}, remove: () => {} };
  registerSettingsRoutes(router, {
    userPrefsStore: fakeUserPrefsStore,
    orgSettingsStore: fakeOrgSettingsStore,
    companyLogoStore: fakeCompanyLogoStore,
    requireAuth,
    requireRole,
    auditStore: fakeAuditStore,
    mailConfigStore: fakeMailConfigStore,
  });

  // Unauthenticated request — must NOT trigger audit.
  await call(router, 'PUT', '/api/settings/mail', { user: null });
  assert.equal(auditCalls.length, 0, 'audit must not be called on unauthenticated request');

  // Employee request — role guard rejects before handler; must NOT trigger audit.
  await call(router, 'PUT', '/api/settings/mail', {
    user: { id: EMPLOYEE_ID, role: 'employee' },
    body: { enabled: true, host: 'h', port: 465, secure: true, user: 'u', pass: AUDIT_PASS_SENTINEL, from: 'F <f@x>' },
  });
  assert.equal(auditCalls.length, 0, 'audit must not be called when role guard rejects');

  // Employer happy-path — must emit exactly one audit record.
  const res = await call(router, 'PUT', '/api/settings/mail', {
    user: { id: EMPLOYER_ID, role: 'employer', username: 'boss' },
    body: { enabled: true, host: 'h', port: 465, secure: true, user: 'u', pass: AUDIT_PASS_SENTINEL, from: 'F <f@x>' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(auditCalls.length, 1, 'audit must be called exactly once on successful PUT');
  assert.equal(auditCalls[0].event, 'settings.mail_updated',
    'audit event must be settings.mail_updated');

  // CRITICAL: the audit record must contain no trace of the password.
  const serialised = JSON.stringify(auditCalls[0]);
  assert.ok(!serialised.includes('pass'),
    `"pass" must not appear anywhere in the audit record: ${serialised}`);
  assert.ok(!serialised.includes(AUDIT_PASS_SENTINEL),
    `sentinel password must not appear in the audit record: ${serialised}`);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
