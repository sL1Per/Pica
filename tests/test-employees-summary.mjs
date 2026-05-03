#!/usr/bin/env node
/**
 * Tests for /api/employees/:id/summary — the per-employee summary
 * endpoint introduced in 0.16.4.
 *
 * Approach: register the route on a real router with mocked stores.
 * Tests cover:
 *   - Employer-only enforcement
 *   - 404 on unknown id
 *   - Profile shape
 *   - Week boundary computation
 *   - Bank balance reading
 *   - Upcoming-vs-pending leave classification (the 30-day horizon
 *     rule)
 *   - Pending corrections inclusion
 *
 * Run:  node tests/test-employees-summary.mjs
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

// ---- Mocks ---------------------------------------------------------------

function mockRes() {
  const r = {
    statusCode: null,
    body: null,
    json(data, status = 200) {
      r.statusCode = status;
      r.body = data;
    },
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
const requireRole = (role) => (handler) => async (req, res) => {
  if (!req.user) return res.unauthorized('Sign in required', { errorCode: 'unauthorized' });
  if (req.user.role !== role) return res.forbidden(`Requires role: ${role}`, { errorCode: 'forbidden' });
  return handler(req, res);
};
const requireOwnerOrEmployer = () => (handler) => handler;

/**
 * Build a minimal store set. Each test customizes via overrides.
 *
 *   users:   [{id, username, role, createdAt}]
 *   profiles: { [id]: { fullName, position, hasPicture } }
 *   leaves:  [{id, employeeId, type, status, start, end, unit}]
 *   corrections: [{id, employeeId, kind, status, start, end, hours}]
 *   bank: { [userId]: hours }
 *   workingTime: { [userId]: { dailyHours, weeklyHours } }
 */
function buildStores({
  users = [],
  profiles = {},
  leaves = [],
  corrections = [],
  bank = {},
  workingTime = {},
} = {}) {
  return {
    usersStore: {
      list: () => users,
      findById: (id) => users.find((u) => u.id === id) || null,
    },
    employeesStore: {
      readProfile: (id) => profiles[id] || null,
      hasPicture:  (id) => !!profiles[id]?.hasPicture,
    },
    orgSettingsStore: {
      resolveWorkingTimeFor: (id) => workingTime[id] || { dailyHours: 8, weeklyHours: 40 },
    },
    punchesStore: {
      // Empty — we don't exercise hoursReport here. The summary endpoint
      // catches errors from hoursReport and falls back to 0, so an
      // empty store is fine for these tests; a separate test-reports.mjs
      // already covers the heavy lifting.
      listInRange: () => [],
    },
    leavesStore: {
      list: ({ employeeId } = {}) =>
        employeeId
          ? leaves.filter((l) => l.employeeId === employeeId)
          : leaves.slice(),
    },
    correctionsStore: {
      list: ({ employeeId, status } = {}) => {
        let out = corrections.slice();
        if (employeeId) out = out.filter((c) => c.employeeId === employeeId);
        if (status)     out = out.filter((c) => c.status === status);
        return out;
      },
      computeBank: ({ userId }) => bank[userId] ?? 0,
    },
  };
}

function buildHandler(stores) {
  const router = createRouter();
  registerEmployeeRoutes(router, {
    ...stores,
    requireAuth,
    requireRole,
    requireOwnerOrEmployer,
  });
  const match = router.match('GET', '/api/employees/u1/summary');
  assert.ok(match && match.handler, 'summary route should be registered');
  return match.handler;
}

async function call(handler, { user, params } = {}) {
  const req = { user, params: params || {}, query: {}, headers: {} };
  const res = mockRes();
  await handler(req, res);
  return res;
}

/**
 * Build a YYYY-MM-DD string for `daysFromToday` days from now (positive
 * = future, negative = past). Used to build leave/correction dates that
 * stay relative to the test runtime.
 */
function daysFromToday(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0); // noon — avoid DST edge cases
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- Tests ---------------------------------------------------------------

console.log('Employees / summary route');

await test('rejects requests from non-employer users', async () => {
  const handler = buildHandler(buildStores({
    users: [{ id: 'u1', username: 'alice', role: 'employee' }],
  }));
  const res = await call(handler, {
    user: { id: 'u1', role: 'employee' },
    params: { id: 'u1' },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.errorCode, 'forbidden');
});

await test('returns 404 for unknown employee id', async () => {
  const handler = buildHandler(buildStores({ users: [] }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    params: { id: 'no-such-id' },
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.errorCode, 'not_found');
});

await test('returns the basic shape: id, username, role, profile, week, bank, upcomingLeaves, pending', async () => {
  const handler = buildHandler(buildStores({
    users: [{ id: 'u1', username: 'alice', role: 'employee', createdAt: '2026-01-01' }],
    profiles: { u1: { fullName: 'Alice', position: 'Designer', hasPicture: false } },
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    params: { id: 'u1' },
  });
  assert.equal(res.statusCode, 200);
  for (const k of ['id', 'username', 'role', 'profile', 'week', 'bankHours', 'upcomingLeaves', 'pending']) {
    assert.ok(k in res.body, `missing field: ${k}`);
  }
  assert.equal(res.body.id, 'u1');
  assert.equal(res.body.username, 'alice');
  assert.equal(res.body.role, 'employee');
});

await test('week object contains from, to, hours, scheduled', async () => {
  const handler = buildHandler(buildStores({
    users: [{ id: 'u1', username: 'alice', role: 'employee' }],
    workingTime: { u1: { dailyHours: 8, weeklyHours: 40 } },
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    params: { id: 'u1' },
  });
  for (const k of ['from', 'to', 'hours', 'scheduled']) {
    assert.ok(k in res.body.week, `missing week.${k}`);
  }
  assert.match(res.body.week.from, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(res.body.week.to,   /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(res.body.week.scheduled, 40);
});

await test('week.scheduled honors per-employee override', async () => {
  const handler = buildHandler(buildStores({
    users: [{ id: 'u1', username: 'alice', role: 'employee' }],
    workingTime: { u1: { dailyHours: 6, weeklyHours: 30 } }, // part-time
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    params: { id: 'u1' },
  });
  assert.equal(res.body.week.scheduled, 30);
});

await test('bankHours reads from correctionsStore.computeBank', async () => {
  const handler = buildHandler(buildStores({
    users: [{ id: 'u1', username: 'alice', role: 'employee' }],
    bank: { u1: 4.5 },
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    params: { id: 'u1' },
  });
  assert.equal(res.body.bankHours, 4.5);
});

await test('bankHours defaults to 0 when no bank entry exists', async () => {
  const handler = buildHandler(buildStores({
    users: [{ id: 'u1', username: 'alice', role: 'employee' }],
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    params: { id: 'u1' },
  });
  assert.equal(res.body.bankHours, 0);
});

// ---- Upcoming leaves -----------------------------------------------------

await test('upcomingLeaves: includes approved leaves starting in next 30 days', async () => {
  const handler = buildHandler(buildStores({
    users: [{ id: 'u1', username: 'alice', role: 'employee' }],
    leaves: [
      { id: 'L1', employeeId: 'u1', type: 'vacation', unit: 'days',
        status: 'approved', start: daysFromToday(7), end: daysFromToday(11) },
    ],
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    params: { id: 'u1' },
  });
  assert.equal(res.body.upcomingLeaves.length, 1);
  assert.equal(res.body.upcomingLeaves[0].id, 'L1');
  // Only the safe fields are exposed (no reason/notes).
  assert.equal(res.body.upcomingLeaves[0].type, 'vacation');
  assert.equal('reason' in res.body.upcomingLeaves[0], false);
});

await test('upcomingLeaves: includes leaves currently in progress (started yesterday)', async () => {
  const handler = buildHandler(buildStores({
    users: [{ id: 'u1', username: 'alice', role: 'employee' }],
    leaves: [
      { id: 'L1', employeeId: 'u1', type: 'sick', unit: 'days',
        status: 'approved', start: daysFromToday(-1), end: daysFromToday(2) },
    ],
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    params: { id: 'u1' },
  });
  assert.equal(res.body.upcomingLeaves.length, 1);
});

await test('upcomingLeaves: excludes leaves more than 30 days out', async () => {
  const handler = buildHandler(buildStores({
    users: [{ id: 'u1', username: 'alice', role: 'employee' }],
    leaves: [
      { id: 'L1', employeeId: 'u1', type: 'vacation', unit: 'days',
        status: 'approved', start: daysFromToday(45), end: daysFromToday(50) },
    ],
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    params: { id: 'u1' },
  });
  assert.equal(res.body.upcomingLeaves.length, 0);
});

await test('upcomingLeaves: excludes already-finished leaves', async () => {
  const handler = buildHandler(buildStores({
    users: [{ id: 'u1', username: 'alice', role: 'employee' }],
    leaves: [
      { id: 'L1', employeeId: 'u1', type: 'vacation', unit: 'days',
        status: 'approved', start: daysFromToday(-30), end: daysFromToday(-20) },
    ],
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    params: { id: 'u1' },
  });
  assert.equal(res.body.upcomingLeaves.length, 0);
});

await test('upcomingLeaves: excludes pending leaves (only approved show as upcoming)', async () => {
  const handler = buildHandler(buildStores({
    users: [{ id: 'u1', username: 'alice', role: 'employee' }],
    leaves: [
      { id: 'L1', employeeId: 'u1', type: 'vacation', unit: 'days',
        status: 'pending', start: daysFromToday(7), end: daysFromToday(11) },
    ],
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    params: { id: 'u1' },
  });
  assert.equal(res.body.upcomingLeaves.length, 0);
  // But the same leave SHOULD appear in pending.leaves
  assert.equal(res.body.pending.leaves.length, 1);
  assert.equal(res.body.pending.leaves[0].id, 'L1');
});

await test('upcomingLeaves: excludes rejected/cancelled leaves', async () => {
  const handler = buildHandler(buildStores({
    users: [{ id: 'u1', username: 'alice', role: 'employee' }],
    leaves: [
      { id: 'L1', employeeId: 'u1', type: 'vacation', unit: 'days',
        status: 'rejected',  start: daysFromToday(7),  end: daysFromToday(11) },
      { id: 'L2', employeeId: 'u1', type: 'vacation', unit: 'days',
        status: 'cancelled', start: daysFromToday(14), end: daysFromToday(18) },
    ],
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    params: { id: 'u1' },
  });
  assert.equal(res.body.upcomingLeaves.length, 0);
});

await test('upcomingLeaves: sorted by start date ascending', async () => {
  const handler = buildHandler(buildStores({
    users: [{ id: 'u1', username: 'alice', role: 'employee' }],
    leaves: [
      { id: 'B', employeeId: 'u1', type: 'vacation', unit: 'days',
        status: 'approved', start: daysFromToday(20), end: daysFromToday(22) },
      { id: 'A', employeeId: 'u1', type: 'sick', unit: 'days',
        status: 'approved', start: daysFromToday(5), end: daysFromToday(7) },
      { id: 'C', employeeId: 'u1', type: 'appointment', unit: 'days',
        status: 'approved', start: daysFromToday(15), end: daysFromToday(15) },
    ],
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    params: { id: 'u1' },
  });
  assert.deepEqual(res.body.upcomingLeaves.map((l) => l.id), ['A', 'C', 'B']);
});

await test('upcomingLeaves: scoped to this employee only', async () => {
  // The summary endpoint asks leavesStore for employeeId-scoped leaves.
  // If our mock leaks other users' leaves, the endpoint would too.
  const handler = buildHandler(buildStores({
    users: [
      { id: 'u1', username: 'alice', role: 'employee' },
      { id: 'u2', username: 'bob',   role: 'employee' },
    ],
    leaves: [
      { id: 'A', employeeId: 'u1', type: 'vacation', unit: 'days',
        status: 'approved', start: daysFromToday(7), end: daysFromToday(8) },
      { id: 'B', employeeId: 'u2', type: 'vacation', unit: 'days',
        status: 'approved', start: daysFromToday(7), end: daysFromToday(8) },
    ],
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    params: { id: 'u1' },
  });
  // Should see alice's leave A, not bob's leave B
  assert.equal(res.body.upcomingLeaves.length, 1);
  assert.equal(res.body.upcomingLeaves[0].id, 'A');
});

// ---- Pending corrections -------------------------------------------------

await test('pending.corrections: includes only pending status', async () => {
  const handler = buildHandler(buildStores({
    users: [{ id: 'u1', username: 'alice', role: 'employee' }],
    corrections: [
      { id: 'C1', employeeId: 'u1', kind: 'both',
        status: 'pending',  start: daysFromToday(-1), end: daysFromToday(-1), hours: 8 },
      { id: 'C2', employeeId: 'u1', kind: 'in',
        status: 'approved', start: daysFromToday(-2), end: daysFromToday(-2), hours: 4 },
      { id: 'C3', employeeId: 'u1', kind: 'out',
        status: 'rejected', start: daysFromToday(-3), end: daysFromToday(-3), hours: 4 },
    ],
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    params: { id: 'u1' },
  });
  assert.equal(res.body.pending.corrections.length, 1);
  assert.equal(res.body.pending.corrections[0].id, 'C1');
});

await test('pending.corrections: scoped to this employee only', async () => {
  const handler = buildHandler(buildStores({
    users: [
      { id: 'u1', username: 'alice', role: 'employee' },
      { id: 'u2', username: 'bob',   role: 'employee' },
    ],
    corrections: [
      { id: 'A', employeeId: 'u1', kind: 'both', status: 'pending',
        start: daysFromToday(-1), end: daysFromToday(-1), hours: 8 },
      { id: 'B', employeeId: 'u2', kind: 'both', status: 'pending',
        start: daysFromToday(-1), end: daysFromToday(-1), hours: 8 },
    ],
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    params: { id: 'u1' },
  });
  assert.equal(res.body.pending.corrections.length, 1);
  assert.equal(res.body.pending.corrections[0].id, 'A');
});

await test('pending.corrections: shape is { id, kind, start, end, hours }', async () => {
  const handler = buildHandler(buildStores({
    users: [{ id: 'u1', username: 'alice', role: 'employee' }],
    corrections: [
      { id: 'C1', employeeId: 'u1', kind: 'both', status: 'pending',
        start: '2026-04-30T08:00:00Z', end: '2026-04-30T17:00:00Z',
        hours: 9, justification: 'forgot phone' /* NOT in response */ },
    ],
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    params: { id: 'u1' },
  });
  const c = res.body.pending.corrections[0];
  for (const k of ['id', 'kind', 'start', 'end', 'hours']) {
    assert.ok(k in c, `missing pending correction field: ${k}`);
  }
  // Sensitive fields excluded
  assert.equal('justification' in c, false);
});

// ---- Profile shape -------------------------------------------------------

await test('profile is null when no profile or picture exists', async () => {
  const handler = buildHandler(buildStores({
    users: [{ id: 'u1', username: 'alice', role: 'employee' }],
    // no profiles entry
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    params: { id: 'u1' },
  });
  assert.equal(res.body.profile, null);
});

await test('profile carries hasPicture even when profile fields are missing', async () => {
  const handler = buildHandler(buildStores({
    users: [{ id: 'u1', username: 'alice', role: 'employee' }],
    profiles: { u1: { hasPicture: true } }, // picture only, no fullName
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    params: { id: 'u1' },
  });
  assert.equal(res.body.profile.hasPicture, true);
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
