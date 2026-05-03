#!/usr/bin/env node
/**
 * Tests for /api/reports/team-hours — the cross-employee at-a-glance
 * table introduced in 0.16.2.
 *
 * Approach: register the route on a real router instance with mocked
 * stores. Call the handler directly. This exercises the composition
 * logic (period selection, scheduled-hours math, sorting, per-employee
 * override resolution) without needing a live HTTP server.
 *
 * Run:  node tests/test-reports-team.mjs
 */

import assert from 'node:assert/strict';

import { createRouter } from '../src/router.js';
import { registerReportRoutes } from '../src/routes/reports.js';

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

// ---- Mock helpers --------------------------------------------------------

/**
 * Build a minimal Response stand-in that captures the JSON body and status.
 * Mirrors the surface of Pica's `enhance(res)` (see src/http/responses.js).
 */
function mockRes() {
  const r = {
    statusCode: null,
    body: null,
    json(data, status = 200) {
      r.statusCode = status;
      r.body = data;
    },
    badRequest(msg, opts) {
      r.statusCode = 400;
      r.body = { error: msg, ...(opts?.errorCode ? { errorCode: opts.errorCode } : {}) };
    },
    notFound(msg, opts) {
      r.statusCode = 404;
      r.body = { error: msg, ...(opts?.errorCode ? { errorCode: opts.errorCode } : {}) };
    },
    forbidden(msg, opts) {
      r.statusCode = 403;
      r.body = { error: msg, ...(opts?.errorCode ? { errorCode: opts.errorCode } : {}) };
    },
    unauthorized(msg, opts) {
      r.statusCode = 401;
      r.body = { error: msg, ...(opts?.errorCode ? { errorCode: opts.errorCode } : {}) };
    },
  };
  return r;
}

/**
 * Stand-ins for the RBAC middleware. These mimic the real ones but
 * trust the `req.user` we build in each test.
 */
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
 * Build a minimal store set. Each test customizes by passing overrides.
 */
function buildStores({ users = [], profiles = {}, workingTime = {}, punches = [] } = {}) {
  return {
    usersStore: {
      list: () => users,
      findById: (id) => users.find((u) => u.id === id) || null,
    },
    employeesStore: {
      list: () => users.map((u) => ({
        id: u.id,
        username: u.username,
        role: u.role,
        fullName: profiles[u.id]?.fullName ?? null,
        position: profiles[u.id]?.position ?? null,
        hasPicture: !!profiles[u.id]?.hasPicture,
      })),
    },
    orgSettingsStore: {
      resolveWorkingTimeFor: (userId) => workingTime[userId] || { dailyHours: 8, weeklyHours: 40 },
    },
    // hoursReport is called by the route via `hoursReport(punchesStore, ...)`.
    // The simplest punchesStore stand-in for our purposes is one whose
    // listInRange returns the supplied punches; hoursReport handles the rest.
    // But because hoursReport is imported from storage/reports.js directly,
    // we don't need to mock it — we just need to provide a punchesStore that
    // hoursReport can read. Easier: pass an in-memory store whose listInRange
    // returns the right shape.
    punchesStore: {
      listInRange: (employeeId, fromMs, toMs) => punches
        .filter((p) => p.employeeId === employeeId)
        .filter((p) => {
          const t = new Date(p.ts).getTime();
          return t >= fromMs && t <= toMs;
        }),
    },
    leavesStore: {
      list: () => [],
    },
  };
}

/** Register the team-hours route on a fresh router and return a callable. */
function buildHandler(stores) {
  const router = createRouter();
  registerReportRoutes(router, {
    ...stores,
    requireAuth,
    requireRole,
    requireOwnerOrEmployer,
  });
  // Pull the team-hours handler out by matching its path
  const match = router.match('GET', '/api/reports/team-hours');
  assert.ok(match && match.handler, 'team-hours route should be registered');
  return match.handler;
}

/**
 * Invoke the handler with a request shape and return the captured response.
 */
async function call(handler, { user, query = {} } = {}) {
  const req = {
    user,
    query,
    params: {},
    headers: {},
  };
  const res = mockRes();
  await handler(req, res);
  return res;
}

// ---- Tests ---------------------------------------------------------------

console.log('Reports / team-hours route');

await test('rejects requests without authentication', async () => {
  const handler = buildHandler(buildStores());
  const res = await call(handler, { user: null });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.errorCode, 'unauthorized');
});

await test('rejects requests from non-employer users', async () => {
  const handler = buildHandler(buildStores());
  const res = await call(handler, {
    user: { id: 'u1', role: 'employee' },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.errorCode, 'forbidden');
});

await test('rejects unknown period values with errorCode invalid_value', async () => {
  const handler = buildHandler(buildStores());
  const res = await call(handler, {
    user: { id: 'u1', role: 'employer' },
    query: { period: 'quarter' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errorCode, 'invalid_value');
  assert.match(res.body.error, /period/);
});

await test('defaults period to month when not provided', async () => {
  const handler = buildHandler(buildStores({
    users: [{ id: 'u1', username: 'alice', role: 'employee' }],
  }));
  const res = await call(handler, {
    user: { id: 'u1', role: 'employer' },
    query: {},
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.period, 'month');
});

await test('today period: scheduled = dailyHours per user', async () => {
  const handler = buildHandler(buildStores({
    users: [
      { id: 'u1', username: 'alice', role: 'employee' },
      { id: 'u2', username: 'bob',   role: 'employee' },
    ],
    workingTime: {
      u1: { dailyHours: 8,   weeklyHours: 40 },
      u2: { dailyHours: 7.5, weeklyHours: 37.5 },
    },
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    query: { period: 'today' },
  });
  assert.equal(res.statusCode, 200);
  const byUser = Object.fromEntries(res.body.rows.map((r) => [r.username, r]));
  assert.equal(byUser.alice.scheduled, 8);
  assert.equal(byUser.bob.scheduled,   7.5);
});

await test('week period: scheduled = weeklyHours per user', async () => {
  const handler = buildHandler(buildStores({
    users: [
      { id: 'u1', username: 'alice', role: 'employee' },
      { id: 'u2', username: 'bob',   role: 'employee' },
    ],
    workingTime: {
      u1: { dailyHours: 8,   weeklyHours: 40 },
      u2: { dailyHours: 6,   weeklyHours: 30 },
    },
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    query: { period: 'week' },
  });
  const byUser = Object.fromEntries(res.body.rows.map((r) => [r.username, r]));
  assert.equal(byUser.alice.scheduled, 40);
  assert.equal(byUser.bob.scheduled,   30);
});

await test('month period: scheduled = dailyHours × weekdays-in-month', async () => {
  // Hard to make this assertion month-agnostic without freezing time.
  // Instead: for any month, the alice scheduled MUST equal
  // bob.scheduled × (alice.dailyHours / bob.dailyHours).
  const handler = buildHandler(buildStores({
    users: [
      { id: 'u1', username: 'alice', role: 'employee' },
      { id: 'u2', username: 'bob',   role: 'employee' },
    ],
    workingTime: {
      u1: { dailyHours: 8, weeklyHours: 40 },
      u2: { dailyHours: 4, weeklyHours: 20 }, // half-time
    },
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    query: { period: 'month' },
  });
  const byUser = Object.fromEntries(res.body.rows.map((r) => [r.username, r]));
  // Half-time bob's scheduled should be exactly half alice's.
  assert.equal(byUser.bob.scheduled * 2, byUser.alice.scheduled);
  // And both should be > 0 (every month has at least one weekday).
  assert.ok(byUser.alice.scheduled > 0);
});

await test('rows are sorted alphabetically by full name (with username fallback)', async () => {
  const handler = buildHandler(buildStores({
    users: [
      { id: 'u1', username: 'zoe',     role: 'employee' },
      { id: 'u2', username: 'amelia',  role: 'employee' },
      { id: 'u3', username: 'admin',   role: 'employer' },
    ],
    profiles: {
      u1: { fullName: 'Zoe Zenith' },
      u2: { fullName: 'Amelia Aardvark' },
      // u3 has no profile → uses username for sort
    },
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    query: { period: 'today' },
  });
  const order = res.body.rows.map((r) => r.fullName || r.username);
  assert.deepEqual(order, ['admin', 'Amelia Aardvark', 'Zoe Zenith']);
});

await test('rows include id, username, role, fullName, hasPicture', async () => {
  const handler = buildHandler(buildStores({
    users: [{ id: 'u1', username: 'alice', role: 'employee' }],
    profiles: { u1: { fullName: 'Alice', hasPicture: true } },
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    query: { period: 'today' },
  });
  const row = res.body.rows[0];
  assert.equal(row.id, 'u1');
  assert.equal(row.username, 'alice');
  assert.equal(row.role, 'employee');
  assert.equal(row.fullName, 'Alice');
  assert.equal(row.hasPicture, true);
});

await test('response body includes period, label, from, to', async () => {
  const handler = buildHandler(buildStores({
    users: [{ id: 'u1', username: 'alice', role: 'employee' }],
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    query: { period: 'today' },
  });
  assert.equal(res.body.period, 'today');
  assert.equal(typeof res.body.label, 'string');
  assert.match(res.body.from, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(res.body.to,   /^\d{4}-\d{2}-\d{2}$/);
});

await test('handles employees with no profile (uses username, no picture)', async () => {
  const handler = buildHandler(buildStores({
    users: [{ id: 'u1', username: 'alice', role: 'employee' }],
    // no profiles entry for u1
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    query: { period: 'today' },
  });
  const row = res.body.rows[0];
  assert.equal(row.fullName, null);
  assert.equal(row.hasPicture, false);
});

await test('handles empty user list (no employees yet)', async () => {
  const handler = buildHandler(buildStores({ users: [] }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    query: { period: 'today' },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.rows, []);
});

await test('worked hours field is a number for every row', async () => {
  const handler = buildHandler(buildStores({
    users: [{ id: 'u1', username: 'alice', role: 'employee' }],
  }));
  const res = await call(handler, {
    user: { id: 'admin', role: 'employer' },
    query: { period: 'today' },
  });
  const row = res.body.rows[0];
  assert.equal(typeof row.worked, 'number');
  assert.ok(row.worked >= 0);
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
