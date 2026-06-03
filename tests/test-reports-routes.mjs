#!/usr/bin/env node
/**
 * Tests for the scope-aware reports endpoints introduced in the
 * "reports revamp":
 *
 *   GET /api/reports/timesheets?scope=me|all&id&type&anchor[&format=csv]
 *   GET /api/reports/leaves?scope=me|all&id&type&anchor[&format=csv]
 *
 * Security focus: the server, never the client, decides scope. An
 * employer sees everyone; an employee only ever sees themselves —
 * passing `?scope=all` or `?id=<someone-else>` must NOT leak another
 * user's data.
 *
 * Approach mirrors tests/test-security-routes.mjs: register the routes
 * on a real router, fake the auth wrappers (they trust req.user), and a
 * minimal Response stand-in captures status / json / writeHead+end.
 *
 * Run:  node tests/test-reports-routes.mjs
 */

import assert from 'node:assert/strict';

import { createRouter } from '../src/router.js';
import { registerReportRoutes } from '../src/routes/reports.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); passed++; }
  catch (e) { console.error(`  FAIL ${name}\n${e.stack}`); failed++; }
}

// ---- Fixture ids (valid v4 UUIDs) ---------------------------------------

const EMPLOYER_ID = 'a1111111-1111-4111-8111-111111111111';
const EMPLOYEE_ID = 'e1111111-1111-4111-8111-111111111111';
const OTHER_ID    = 'b1111111-1111-4111-8111-111111111111';
const UNKNOWN_ID  = 'c1111111-1111-4111-8111-111111111111';

// ---- Minimal Response stand-in -----------------------------------------
// Captures both the JSON helper path and the raw writeHead/end path used
// for CSV downloads.
function mockRes() {
  const r = {
    statusCode: null,
    body: null,
    headers: null,
    rawBody: null,
    json(data, status = 200) { r.statusCode = status; r.body = data; },
    badRequest(m, o) { r.statusCode = 400; r.body = { error: m, ...(o?.errorCode ? { errorCode: o.errorCode } : {}) }; },
    forbidden(m, o) { r.statusCode = 403; r.body = { error: m, ...(o?.errorCode ? { errorCode: o.errorCode } : {}) }; },
    notFound(m, o) { r.statusCode = 404; r.body = { error: m, ...(o?.errorCode ? { errorCode: o.errorCode } : {}) }; },
    unauthorized(m, o) { r.statusCode = 401; r.body = { error: m, ...(o?.errorCode ? { errorCode: o.errorCode } : {}) }; },
    writeHead(status, headers) { r.statusCode = status; r.headers = headers; },
    end(buf) { r.rawBody = buf != null ? Buffer.from(buf).toString('utf8') : ''; },
  };
  return r;
}

// ---- Fake auth wrappers (trust req.user) --------------------------------
const requireAuth = (h) => async (req, res) =>
  req.user ? h(req, res) : res.unauthorized('x', { errorCode: 'unauthorized' });
const requireRole = (role) => (h) => async (req, res) => {
  if (!req.user) return res.unauthorized('x', { errorCode: 'unauthorized' });
  if (req.user.role !== role) return res.forbidden('x', { errorCode: 'forbidden' });
  return h(req, res);
};
const requireOwnerOrEmployer = () => (h) => h;

// ---- In-memory stores ---------------------------------------------------
const USERS = [
  { id: EMPLOYER_ID, username: 'boss',  role: 'employer' },
  { id: EMPLOYEE_ID, username: 'alice', role: 'employee' },
  { id: OTHER_ID,    username: 'bob',   role: 'employee' },
];

function buildStores() {
  return {
    usersStore: {
      list: () => USERS,
      findById: (id) => USERS.find((u) => u.id === id) || null,
    },
    employeesStore: {
      list: () => [
        { id: EMPLOYEE_ID, fullName: 'Alice Example' },
        { id: OTHER_ID,    fullName: 'Bob Example' },
      ],
    },
    // hoursReport walks listMonth; empty data is enough for shape tests.
    punchesStore: { listMonth: () => [] },
    // leavesRangeReport / leavesMatrix call list({ employeeId }).
    leavesStore: { list: () => [] },
    orgSettingsStore: {
      get: () => ({ leaves: {}, workingTime: { dailyHours: 8, weeklyHours: 40, expectedStart: '09:00', graceMinutes: 10 } }),
      resolveWorkingTimeFor: () => ({ dailyHours: 8, weeklyHours: 40, expectedStart: '09:00', graceMinutes: 10 }),
    },
  };
}

function buildRouter() {
  const router = createRouter();
  registerReportRoutes(router, {
    ...buildStores(),
    requireAuth,
    requireRole,
    requireOwnerOrEmployer,
  });
  return router;
}

// Parse the path's query string into a flat object, like the real server.
function call(router, method, urlPath, user) {
  const [p, qs] = urlPath.split('?');
  const m = router.match(method, p);
  assert.ok(m && m.handler, `${method} ${p} should be registered`);
  const query = {};
  if (qs) for (const [k, v] of new URLSearchParams(qs)) query[k] = v;
  const req = { user, params: m.params || {}, query, body: {}, socket: {} };
  const res = mockRes();
  return Promise.resolve(m.handler(req, res)).then(() => res);
}

// ---- Tests --------------------------------------------------------------

console.log('Reports / scope-aware routes');

await test('employee ?scope=all → 403, no data', async () => {
  const router = buildRouter();
  const res = await call(router, 'GET',
    '/api/reports/timesheets?scope=all&type=month',
    { id: EMPLOYEE_ID, role: 'employee' });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.errorCode, 'forbidden');
  assert.equal(res.body.rows, undefined);
});

await test('employee ?id=<OTHER> is coerced to self (scope me, own id)', async () => {
  const router = buildRouter();
  const res = await call(router, 'GET',
    `/api/reports/timesheets?id=${OTHER_ID}&type=month`,
    { id: EMPLOYEE_ID, role: 'employee' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.scope, 'me');
  assert.equal(res.body.employeeId, EMPLOYEE_ID);
  assert.notEqual(res.body.employeeId, OTHER_ID);
  assert.equal(res.body.name, 'Alice Example');
});

await test('employer ?scope=all&type=year → 200 with rows + buckets arrays', async () => {
  const router = buildRouter();
  const res = await call(router, 'GET',
    '/api/reports/timesheets?scope=all&type=year&anchor=2026-06-01',
    { id: EMPLOYER_ID, role: 'employer' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.scope, 'all');
  assert.ok(Array.isArray(res.body.rows), 'rows should be an array');
  assert.ok(Array.isArray(res.body.buckets), 'buckets should be an array');
  // Three users in the fixture → three matrix rows.
  assert.equal(res.body.rows.length, 3);
});

await test('invalid type → 400 invalid_value', async () => {
  const router = buildRouter();
  const res = await call(router, 'GET',
    '/api/reports/timesheets?type=fortnight',
    { id: EMPLOYER_ID, role: 'employer' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errorCode, 'invalid_value');
});

await test('leaves ?scope=me&format=csv → 200 csv download headers', async () => {
  const router = buildRouter();
  const res = await call(router, 'GET',
    '/api/reports/leaves?scope=me&type=month&format=csv',
    { id: EMPLOYEE_ID, role: 'employee' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /text\/csv/);
  assert.match(res.headers['Content-Disposition'], /attachment; filename=/);
  assert.ok(typeof res.rawBody === 'string' && res.rawBody.length > 0);
});

await test('employer unknown but valid id → 404', async () => {
  const router = buildRouter();
  const res = await call(router, 'GET',
    `/api/reports/timesheets?id=${UNKNOWN_ID}&type=month`,
    { id: EMPLOYER_ID, role: 'employer' });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.errorCode, 'not_found');
});

await test('overview: scope=all forbidden for non-employer', async () => {
  const router = buildRouter();
  const res = await call(router, 'GET',
    '/api/reports/overview?scope=all&type=month',
    { id: EMPLOYEE_ID, role: 'employee' });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.errorCode, 'forbidden');
});

await test('overview: employee gets own data, scope coerced to me', async () => {
  const router = buildRouter();
  const res = await call(router, 'GET',
    '/api/reports/overview?type=month',
    { id: EMPLOYEE_ID, role: 'employee' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.scope, 'me');
  assert.ok(res.body.kpis, 'kpis should be present');
  assert.ok(Array.isArray(res.body.people), 'people should be an array');
  // Scope coercion: only the requesting employee's own record.
  assert.equal(res.body.people.length, 1);
  assert.equal(res.body.people[0].id, EMPLOYEE_ID);
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
