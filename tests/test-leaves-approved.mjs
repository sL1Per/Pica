#!/usr/bin/env node
/**
 * Tests for the privacy model on GET /api/leaves/approved (tightened in
 * 0.22.4).
 *
 * Approach: register the leave routes on a real router with mocked
 * stores. Hit the handler with two distinct callers — an employee and
 * an employer — and verify what each can see.
 *
 * Coverage:
 *   - Employer sees full data (name, type, dates) for everyone
 *   - Employee sees full data for their OWN leaves
 *   - Employee sees others' leaves anonymized: id+start+end+unit only,
 *     no employeeId / username / fullName / type / reason / notes
 *   - reason and notes are always null for everyone (existing rule)
 *   - Pending and rejected leaves never appear (existing rule)
 *
 * Run:  node tests/test-leaves-approved.mjs
 */

import assert from 'node:assert/strict';

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
const requireRole = (role) => (handler) => async (req, res) => {
  if (!req.user) return res.unauthorized('Sign in required', { errorCode: 'unauthorized' });
  if (req.user.role !== role) return res.forbidden(`Requires role: ${role}`, { errorCode: 'forbidden' });
  return handler(req, res);
};

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB   = '22222222-2222-4222-8222-222222222222';
const BOSS  = '33333333-3333-4333-8333-333333333333';

function buildLeavesStore(leaves) {
  return {
    list: () => leaves,
    computeBalances: () => [],
  };
}

function buildUsersStore() {
  return {
    list: () => [
      { id: ALICE, username: 'alice', role: 'employee' },
      { id: BOB,   username: 'bob',   role: 'employee' },
      { id: BOSS,  username: 'boss',  role: 'employer' },
    ],
  };
}

function buildEmployeesStore() {
  return {
    list: () => [
      { id: ALICE, fullName: 'Alice Anderson' },
      { id: BOB,   fullName: 'Bob Brown' },
      { id: BOSS,  fullName: 'Boss Boss' },
    ],
  };
}

/** Build a router and return a function that invokes GET /api/leaves/approved as the given user. */
function buildHandler(leaves) {
  const router = createRouter();
  registerLeaveRoutes(router, {
    leavesStore: buildLeavesStore(leaves),
    usersStore: buildUsersStore(),
    employeesStore: buildEmployeesStore(),
    orgSettingsStore: { get: () => ({ leaves: { blockedRanges: [] } }) },
    leaveTypes: ['vacation', 'sick', 'appointment', 'other'],
    daysOf: () => 1,
    requireAuth,
    requireRole,
  });

  return async function asUser(user) {
    const match = router.match('GET', '/api/leaves/approved');
    assert.ok(match, '/api/leaves/approved is registered');
    const req = { user, params: match.params, query: {} };
    const res = mockRes();
    await match.handler(req, res);
    return res;
  };
}

console.log('GET /api/leaves/approved — privacy model');

const fixtureLeaves = [
  // Alice's approved vacation
  { id: 'leave-alice-1', employeeId: ALICE, type: 'vacation', status: 'approved',
    unit: 'days', start: '2026-06-01', end: '2026-06-05', reason: 'beach', notes: null },
  // Bob's approved sick leave
  { id: 'leave-bob-1', employeeId: BOB, type: 'sick', status: 'approved',
    unit: 'days', start: '2026-06-03', end: '2026-06-03', reason: 'flu', notes: 'doc note' },
  // Bob's pending leave (must NOT appear in /approved for anyone)
  { id: 'leave-bob-pending', employeeId: BOB, type: 'vacation', status: 'pending',
    unit: 'days', start: '2026-07-01', end: '2026-07-10', reason: null, notes: null },
];

await test('employer sees full data for every approved leave', async () => {
  const call = buildHandler(fixtureLeaves);
  const res = await call({ id: BOSS, role: 'employer' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.leaves.length, 2, 'pending leave excluded');
  for (const l of res.body.leaves) {
    assert.ok(l.employeeId, 'employeeId present for employer');
    assert.ok(l.fullName,   'fullName present for employer');
    assert.ok(l.type,       'type present for employer');
    assert.equal(l.reason, null, 'reason stripped for everyone');
    assert.equal(l.notes,  null, 'notes stripped for everyone');
    assert.equal(l.anonymized, undefined, 'anonymized flag absent for employer');
  }
});

await test('employee sees own leave with full data', async () => {
  const call = buildHandler(fixtureLeaves);
  const res = await call({ id: ALICE, role: 'employee' });
  assert.equal(res.statusCode, 200);
  const own = res.body.leaves.find((l) => l.id === 'leave-alice-1');
  assert.ok(own, 'own leave present');
  assert.equal(own.employeeId, ALICE);
  assert.equal(own.fullName, 'Alice Anderson');
  assert.equal(own.type, 'vacation');
  assert.equal(own.reason, null);
  assert.equal(own.notes, null);
  assert.equal(own.anonymized, undefined);
});

await test('employee sees others\' leaves anonymized', async () => {
  const call = buildHandler(fixtureLeaves);
  const res = await call({ id: ALICE, role: 'employee' });
  assert.equal(res.statusCode, 200);
  const other = res.body.leaves.find((l) => l.id === 'leave-bob-1');
  assert.ok(other, 'other employee\'s leave still present (capacity block)');
  assert.equal(other.anonymized, true, 'anonymized flag set');
  assert.equal(other.employeeId, undefined, 'no employeeId leak');
  assert.equal(other.username,   undefined, 'no username leak');
  assert.equal(other.fullName,   undefined, 'no fullName leak');
  assert.equal(other.type,       undefined, 'no type leak');
  assert.equal(other.reason,     undefined, 'no reason leak');
  assert.equal(other.notes,      undefined, 'no notes leak');
  // What IS preserved: dates + unit + id (for stable React-style keys).
  assert.equal(other.start, '2026-06-03');
  assert.equal(other.end,   '2026-06-03');
  assert.equal(other.unit,  'days');
});

await test('pending and rejected leaves never appear', async () => {
  const leaves = [
    { id: 'p', employeeId: ALICE, type: 'vacation', status: 'pending',  unit: 'days', start: '2026-08-01', end: '2026-08-05' },
    { id: 'r', employeeId: ALICE, type: 'vacation', status: 'rejected', unit: 'days', start: '2026-09-01', end: '2026-09-05' },
  ];
  const call = buildHandler(leaves);
  const employer = await call({ id: BOSS, role: 'employer' });
  const employee = await call({ id: ALICE, role: 'employee' });
  assert.equal(employer.body.leaves.length, 0);
  assert.equal(employee.body.leaves.length, 0);
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
