#!/usr/bin/env node
/**
 * Soft-deactivate — employee routes (deactivate / reactivate / gated delete /
 * list+:id active) and login refusal. Uses the router.match harness from
 * test-security-routes.mjs with real users+employees stores.
 * Run: node tests/test-employee-deactivation.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRouter } from '../src/router.js';
import { createUsersStore } from '../src/auth/users.js';
import { createEmployeesStore } from '../src/storage/employees.js';
import { registerEmployeeRoutes } from '../src/routes/employees.js';
import { registerAuthRoutes } from '../src/routes/auth.js';
import { deriveSessionKey } from '../src/auth/sessions.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.stack}`); failed++; }
}

function mockRes() {
  const r = {
    statusCode: 200, body: null, headers: {},
    json(d, s = 200) { r.statusCode = s; r.body = d; },
    badRequest(m, o) { r.statusCode = 400; r.body = { error: m, ...(o?.errorCode && { errorCode: o.errorCode }) }; },
    forbidden(m, o) { r.statusCode = 403; r.body = { error: m, ...(o?.errorCode && { errorCode: o.errorCode }) }; },
    unauthorized(m, o) { r.statusCode = 401; r.body = { error: m, ...(o?.errorCode && { errorCode: o.errorCode }) }; },
    notFound(m, o) { r.statusCode = 404; r.body = { error: m, ...(o?.errorCode && { errorCode: o.errorCode }) }; },
    setHeader(k, v) { r.headers[k] = v; },
  };
  return r;
}
const requireAuth = (h) => async (req, res) => req.user ? h(req, res) : res.unauthorized('x', { errorCode: 'unauthorized' });
const requireRole = (role) => (h) => async (req, res) => {
  if (!req.user) return res.unauthorized('x', { errorCode: 'unauthorized' });
  if (req.user.role !== role) return res.forbidden('x', { errorCode: 'forbidden' });
  return h(req, res);
};
const requireOwnerOrEmployer = (getOwner) => (h) => async (req, res) => {
  if (!req.user) return res.unauthorized('x', { errorCode: 'unauthorized' });
  if (req.user.role === 'employer' || req.user.id === getOwner(req)) return h(req, res);
  return res.forbidden('x', { errorCode: 'forbidden' });
};

async function call(router, method, urlPath, { user = null, body = {} } = {}) {
  const m = router.match(method, urlPath);
  assert.ok(m && m.handler, `${method} ${urlPath} should be registered`);
  const req = { user, params: m.params || {}, query: {}, body, socket: {}, cookies: {} };
  const res = mockRes();
  await m.handler(req, res);
  return res;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-deact-'));
const masterKey = randomBytes(32);

try {
  const usersStore = createUsersStore(tmp);
  const employeesStore = createEmployeesStore(tmp, masterKey);
  const audited = [];
  const router = createRouter();
  registerEmployeeRoutes(router, {
    usersStore, employeesStore,
    punchesStore: null, leavesStore: null, correctionsStore: null,
    orgSettingsStore: null, passwordLimiter: null,
    requireAuth, requireRole, requireOwnerOrEmployer,
    auditStore: { appendRecord: (r) => audited.push(r) },
  });

  const employer = await usersStore.create({ username: 'boss', password: 'password1', role: 'employer' });
  const emp = await usersStore.create({ username: 'worker', password: 'password1', role: 'employee' });
  employeesStore.create(emp.id, {
    fullName: 'Work Er', dateOfBirth: '1990-01-01', position: 'Baker',
    contactEmail: 'w@x.pt', contactPhone: '900', address: 'Rua 1',
  });
  const employerUser = { id: employer.id, role: 'employer' };
  const empUser = { id: emp.id, role: 'employee' };

  console.log('Employee deactivation routes');

  await test('GET /api/employees includes active', async () => {
    const res = await call(router, 'GET', '/api/employees', { user: employerUser });
    const row = res.body.employees.find((r) => r.id === emp.id);
    assert.equal(row.active, true);
  });

  await test('employee cannot deactivate (employer-only)', async () => {
    const res = await call(router, 'POST', `/api/employees/${emp.id}/deactivate`, { user: empUser });
    assert.equal(res.statusCode, 403);
  });

  await test('employer cannot deactivate self', async () => {
    const res = await call(router, 'POST', `/api/employees/${employer.id}/deactivate`, { user: employerUser });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.errorCode, 'cannot_deactivate_self');
  });

  await test('DELETE refused while active (not_deactivated)', async () => {
    const res = await call(router, 'DELETE', `/api/employees/${emp.id}`, { user: employerUser });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.errorCode, 'not_deactivated');
    assert.ok(usersStore.findById(emp.id), 'still exists');
  });

  await test('employer deactivates employee', async () => {
    const res = await call(router, 'POST', `/api/employees/${emp.id}/deactivate`, { user: employerUser });
    assert.equal(res.statusCode, 200);
    assert.equal(usersStore.findById(emp.id).active, false);
    assert.ok(audited.some((a) => a.event === 'employee.deactivated'));
  });

  await test('GET /api/employees/:id reports active:false', async () => {
    const res = await call(router, 'GET', `/api/employees/${emp.id}`, { user: employerUser });
    assert.equal(res.body.active, false);
  });

  await test('DELETE succeeds once deactivated', async () => {
    const res = await call(router, 'DELETE', `/api/employees/${emp.id}`, { user: employerUser });
    assert.equal(res.statusCode, 200);
    assert.equal(usersStore.findById(emp.id), null);
    assert.ok(audited.some((a) => a.event === 'employee.deleted'));
  });

  await test('reactivate flips active back to true', async () => {
    const e2 = await usersStore.create({ username: 'worker2', password: 'password1', role: 'employee' });
    usersStore.setActive(e2.id, false);
    const res = await call(router, 'POST', `/api/employees/${e2.id}/reactivate`, { user: employerUser });
    assert.equal(res.statusCode, 200);
    assert.equal(usersStore.findById(e2.id).active, true);
    assert.ok(audited.some((a) => a.event === 'employee.reactivated'));
  });

  console.log('\nLogin refusal');
  {
    const sessionKey = deriveSessionKey(randomBytes(32));
    const loginLimiter = { allow: () => true, reset() {} };
    const authRouter = createRouter();
    registerAuthRoutes(authRouter, {
      usersStore, employeesStore, sessionKey, loginLimiter,
      passwordLimiter: null, requireAuth,
      auditStore: { appendRecord() {} },
    });
    const loginUser = await usersStore.create({ username: 'login-test', password: 'password1', role: 'employee' });

    await test('active user logs in', async () => {
      const m = authRouter.match('POST', '/api/login');
      const res = mockRes();
      await m.handler({ body: { username: 'login-test', password: 'password1' }, socket: {}, cookies: {} }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
    });

    await test('deactivated user is refused with account_deactivated', async () => {
      usersStore.setActive(loginUser.id, false);
      const m = authRouter.match('POST', '/api/login');
      const res = mockRes();
      await m.handler({ body: { username: 'login-test', password: 'password1' }, socket: {}, cookies: {} }, res);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.errorCode, 'account_deactivated');
    });
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
