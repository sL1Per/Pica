/**
 * Concurrent-leave enforcement: when the org setting "allow multiple
 * employees on leave at the same time" is OFF, an employee may not
 * book a leave that shares a calendar day with another employee's
 * APPROVED leave. Employer and sick leave are exempt (same rationale
 * as blocked-days). Before this fix the setting was advisory only
 * (a warning at approval); employees could still book freely.
 *
 *   A. Pure helpers (leavesShareADay, findConcurrentApprovedLeave).
 *   B. POST /api/leaves enforcement via a mocked router (same
 *      pattern as test-leaves-blocked.mjs).
 *
 * Run:  node tests/test-leaves-concurrent.mjs
 */
import assert from 'node:assert/strict';

import {
  leavesShareADay,
  findConcurrentApprovedLeave,
} from '../src/storage/leaves.js';
import { createRouter } from '../src/router.js';
import { registerLeaveRoutes } from '../src/routes/leaves.js';

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

// ===========================================================================
console.log('\nleavesShareADay (geometry)');
// ===========================================================================

await test('days ranges that overlap', () => {
  assert.equal(leavesShareADay(
    { start: '2026-06-01', end: '2026-06-05' },
    { start: '2026-06-04', end: '2026-06-10' }), true);
});
await test('days ranges that do not overlap', () => {
  assert.equal(leavesShareADay(
    { start: '2026-06-01', end: '2026-06-03' },
    { start: '2026-06-04', end: '2026-06-06' }), false);
});
await test('edge-touching day counts as overlap (inclusive)', () => {
  assert.equal(leavesShareADay(
    { start: '2026-06-01', end: '2026-06-04' },
    { start: '2026-06-04', end: '2026-06-09' }), true);
});
await test('single-day leave (end omitted)', () => {
  assert.equal(leavesShareADay(
    { start: '2026-06-04' },
    { start: '2026-06-01', end: '2026-06-10' }), true);
});
await test('days vs hours on the same calendar day', () => {
  assert.equal(leavesShareADay(
    { start: '2026-06-04', end: '2026-06-04' },
    { start: '2026-06-04T09:00:00.000Z', end: '2026-06-04T11:00:00.000Z' }), true);
});
await test('days vs hours on a different day', () => {
  assert.equal(leavesShareADay(
    { start: '2026-06-04', end: '2026-06-04' },
    { start: '2026-06-05T09:00:00.000Z', end: '2026-06-05T11:00:00.000Z' }), false);
});

// ===========================================================================
console.log('\nfindConcurrentApprovedLeave (status/identity filter)');
// ===========================================================================

const POOL = [
  { id: 'a', employeeId: 'alice', status: 'approved', start: '2026-06-02', end: '2026-06-02' },
  { id: 'b', employeeId: 'bob',   status: 'pending',  start: '2026-06-02', end: '2026-06-02' },
  { id: 'c', employeeId: 'carol', status: 'approved', start: '2026-07-01', end: '2026-07-01' },
];

await test('finds another employee approved overlap', () => {
  const hit = findConcurrentApprovedLeave({ start: '2026-06-02', end: '2026-06-02' }, 'dave', POOL);
  assert.equal(hit?.id, 'a');
});
await test('ignores pending leaves', () => {
  const hit = findConcurrentApprovedLeave({ start: '2026-06-02', end: '2026-06-02' }, 'alice', POOL);
  // alice's own 'a' excluded; 'b' is pending → no clash
  assert.equal(hit, null);
});
await test('ignores the requester\'s own approved leave', () => {
  const hit = findConcurrentApprovedLeave({ start: '2026-06-02', end: '2026-06-02' }, 'alice',
    [{ id: 'x', employeeId: 'alice', status: 'approved', start: '2026-06-02', end: '2026-06-02' }]);
  assert.equal(hit, null);
});
await test('null when no overlap', () => {
  assert.equal(findConcurrentApprovedLeave({ start: '2026-09-01', end: '2026-09-02' }, 'dave', POOL), null);
});
await test('null for a non-array pool', () => {
  assert.equal(findConcurrentApprovedLeave({ start: '2026-06-02', end: '2026-06-02' }, 'dave', undefined), null);
});

// ===========================================================================
console.log('\nPOST /api/leaves enforcement');
// ===========================================================================

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

// An existing APPROVED leave for "alice" on 2026-06-02.
const EXISTING = [{ id: 'L0', employeeId: 'alice', status: 'approved',
                    type: 'vacation', unit: 'days', start: '2026-06-02', end: '2026-06-02' }];

function buildHandler(concurrentAllowed) {
  const router = createRouter();
  registerLeaveRoutes(router, {
    leavesStore: {
      wouldExceedCap: () => ({ exceeds: false }),
      create: (o) => ({ id: 'NEW', status: 'pending', ...o }),
      list: () => EXISTING,
    },
    usersStore: { list: () => [] },
    employeesStore: { list: () => [] },
    orgSettingsStore: { get: () => ({ leaves: { concurrentAllowed, blockedRanges: [] } }) },
    leaveTypes: ['vacation', 'sick', 'appointment', 'other'],
    daysOf: () => 1,
    requireAuth,
    requireRole,
    auditStore: null,
  });
  const m = router.match('POST', '/api/leaves');
  assert.ok(m && m.handler, 'POST /api/leaves should be registered');
  return m.handler;
}

async function post(handler, { user, body }) {
  const req = { user, params: {}, query: {}, body };
  const res = mockRes();
  await handler(req, res);
  return res;
}

await test('setting OFF: employee vacation overlapping another\'s approved → 400 leave_overlaps', async () => {
  const res = await post(buildHandler(false), {
    user: { id: 'bob', role: 'employee' },
    body: { type: 'vacation', unit: 'days', start: '2026-06-02', end: '2026-06-02' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errorCode, 'leave_overlaps');
});

await test('setting ON: same booking is allowed (200)', async () => {
  const res = await post(buildHandler(true), {
    user: { id: 'bob', role: 'employee' },
    body: { type: 'vacation', unit: 'days', start: '2026-06-02', end: '2026-06-02' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
});

await test('setting OFF: EMPLOYER overlapping booking is allowed (200)', async () => {
  const res = await post(buildHandler(false), {
    user: { id: 'boss', role: 'employer' },
    body: { type: 'vacation', unit: 'days', start: '2026-06-02', end: '2026-06-02' },
  });
  assert.equal(res.statusCode, 200);
});

await test('setting OFF: SICK overlapping booking is allowed (200)', async () => {
  const res = await post(buildHandler(false), {
    user: { id: 'bob', role: 'employee' },
    body: { type: 'sick', unit: 'days', start: '2026-06-02', end: '2026-06-02' },
  });
  assert.equal(res.statusCode, 200);
});

await test('setting OFF: own approved leave does not block re-booking the same day', async () => {
  const res = await post(buildHandler(false), {
    user: { id: 'alice', role: 'employee' },
    body: { type: 'vacation', unit: 'days', start: '2026-06-02', end: '2026-06-02' },
  });
  assert.equal(res.statusCode, 200); // 'alice' is the owner of L0 → excluded
});

await test('setting OFF: non-overlapping day is allowed (200)', async () => {
  const res = await post(buildHandler(false), {
    user: { id: 'bob', role: 'employee' },
    body: { type: 'vacation', unit: 'days', start: '2026-09-01', end: '2026-09-02' },
  });
  assert.equal(res.statusCode, 200);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
