/**
 * Regression: PUT /api/employees/:id/picture must NOT 500 when the
 * employee has no profile yet.
 *
 * History: the route used to auto-create an empty profile so the
 * picture had "something to attach to". When profile fields became
 * mandatory (0.22.6), create({}) started throwing
 * missing_required_field → an unhandled 500 on every picture upload
 * for a profile-less user. The route now returns a translated 400
 * (`profile_required`) instead, and wraps writePicture so a storage
 * throw can never become a 500 either.
 *
 * Approach: register the route on a real router with mocked stores
 * (same pattern as test-employees-summary.mjs).
 *
 * Run:  node tests/test-employee-picture-route.mjs
 */
import assert from 'node:assert/strict';

import { createRouter } from '../src/router.js';
import { registerEmployeeRoutes } from '../src/routes/employees.js';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function mockRes() {
  const r = {
    statusCode: null,
    body: null,
    json(data, status = 200) { r.statusCode = status; r.body = data; },
    badRequest(msg, opts) { r.statusCode = 400; r.body = { error: msg, ...(opts?.errorCode && { errorCode: opts.errorCode }) }; },
    notFound(msg, opts)   { r.statusCode = 404; r.body = { error: msg, ...(opts?.errorCode && { errorCode: opts.errorCode }) }; },
    forbidden(msg, opts)  { r.statusCode = 403; r.body = { error: msg, ...(opts?.errorCode && { errorCode: opts.errorCode }) }; },
    unauthorized(msg, opts) { r.statusCode = 401; r.body = { error: msg, ...(opts?.errorCode && { errorCode: opts.errorCode }) }; },
  };
  return r;
}
const requireAuth = (handler) => async (req, res) => {
  if (!req.user) return res.unauthorized('Sign in required', { errorCode: 'unauthorized' });
  return handler(req, res);
};
const requireRole = (role) => (handler) => async (req, res) => handler(req, res);
const requireOwnerOrEmployer = () => (handler) => handler;

const VALID_ID = '7b52483a-e99a-4ff3-93f1-570b5f1c8f2b';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // not a real image — bytes only

function buildHandler({ exists, writePicture } = {}) {
  const router = createRouter();
  let wrote = null;
  registerEmployeeRoutes(router, {
    usersStore: { list: () => [] },
    employeesStore: {
      list: () => [],
      exists: exists ?? (() => false),
      writePicture: writePicture ?? ((id, buf) => { wrote = { id, len: buf.length }; }),
    },
    punchesStore: {}, leavesStore: {}, correctionsStore: {},
    orgSettingsStore: {}, passwordLimiter: {},
    requireAuth, requireRole, requireOwnerOrEmployer,
    auditStore: null,
  });
  const m = router.match('PUT', `/api/employees/${VALID_ID}/picture`);
  assert.ok(m && m.handler, 'PUT picture route should be registered');
  return { handler: m.handler, params: m.params, getWrote: () => wrote };
}

async function call(handler, { params, body }) {
  const req = { user: { id: VALID_ID, role: 'employee' }, params, query: {}, headers: {}, body };
  const res = mockRes();
  await handler(req, res);
  return res;
}

console.log('\nPUT /api/employees/:id/picture');

await test('no profile → 400 profile_required (NOT 500)', async () => {
  const { handler, params } = buildHandler({ exists: () => false });
  const res = await call(handler, { params, body: { files: [{ data: PNG }] } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errorCode, 'profile_required');
});

await test('profile exists → 200 ok, picture written', async () => {
  const { handler, params, getWrote } = buildHandler({ exists: () => true });
  const res = await call(handler, { params, body: { files: [{ data: PNG }] } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(getWrote().len, PNG.length);
});

await test('writePicture throws → 400, never 500', async () => {
  const { handler, params } = buildHandler({
    exists: () => true,
    writePicture: () => { const e = new Error('disk gone'); e.code = 'invalid_value'; throw e; },
  });
  const res = await call(handler, { params, body: { files: [{ data: PNG }] } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errorCode, 'invalid_value');
});

await test('no file uploaded → 400 required', async () => {
  const { handler, params } = buildHandler({ exists: () => true });
  const res = await call(handler, { params, body: { files: [] } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errorCode, 'required');
});

await test('bad id → 400 invalid_id', async () => {
  const router = createRouter();
  registerEmployeeRoutes(router, {
    usersStore: { list: () => [] },
    employeesStore: { list: () => [], exists: () => true, writePicture: () => {} },
    punchesStore: {}, leavesStore: {}, correctionsStore: {},
    orgSettingsStore: {}, passwordLimiter: {},
    requireAuth, requireRole, requireOwnerOrEmployer, auditStore: null,
  });
  const m = router.match('PUT', '/api/employees/not-a-uuid/picture');
  const res = mockRes();
  await m.handler({ user: { id: 'x', role: 'employee' }, params: m.params, query: {}, headers: {}, body: { files: [{ data: PNG }] } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errorCode, 'invalid_id');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
