/**
 * Blocked-days feature: employer-defined date ranges on which employees
 * may not book leave (every type except sick; employer is never blocked).
 *
 * Three layers exercised:
 *   A. Pure helpers in src/storage/org-settings.js (isValidYmd,
 *      findBlockingRange) — geometry only, no I/O.
 *   B. The org-settings store: default, validation, merge-on-read.
 *   C. POST /api/leaves enforcement — route on a real router with
 *      mocked stores (same pattern as test-employees-summary.mjs).
 *
 * Run:  node tests/test-leaves-blocked.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createOrgSettingsStore,
  isValidYmd,
  findBlockingRange,
} from '../src/storage/org-settings.js';
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
console.log('\nisValidYmd');
// ===========================================================================

await test('accepts a real date', () => {
  assert.equal(isValidYmd('2026-05-15'), true);
});
await test('rejects wrong shape', () => {
  assert.equal(isValidYmd('2026-5-15'), false);
  assert.equal(isValidYmd('not-a-date'), false);
  assert.equal(isValidYmd(20260515), false);
});
await test('rejects impossible month/day', () => {
  assert.equal(isValidYmd('2026-13-01'), false);
  assert.equal(isValidYmd('2026-00-10'), false);
  assert.equal(isValidYmd('2026-04-31'), false);
});
await test('leap-year aware', () => {
  assert.equal(isValidYmd('2024-02-29'), true);  // 2024 is a leap year
  assert.equal(isValidYmd('2025-02-29'), false); // 2025 is not
});

// ===========================================================================
console.log('\nfindBlockingRange (geometry)');
// ===========================================================================

const RANGES = [
  { start: '2026-06-01', end: '2026-06-03', label: 'Offsite' },
  { start: '2026-12-24', end: '2026-12-26', label: '' },
];

await test('empty/absent ranges → null', () => {
  assert.equal(findBlockingRange({ unit: 'days', start: '2026-06-02', end: '2026-06-02' }, []), null);
  assert.equal(findBlockingRange({ unit: 'days', start: '2026-06-02', end: '2026-06-02' }, undefined), null);
});
await test('days leave fully inside a range → hit', () => {
  const r = findBlockingRange({ unit: 'days', start: '2026-06-02', end: '2026-06-02' }, RANGES);
  assert.equal(r?.label, 'Offsite');
});
await test('days leave overlapping only the range edge → hit', () => {
  const r = findBlockingRange({ unit: 'days', start: '2026-05-30', end: '2026-06-01' }, RANGES);
  assert.equal(r?.start, '2026-06-01');
});
await test('days leave entirely outside any range → null', () => {
  assert.equal(findBlockingRange({ unit: 'days', start: '2026-06-04', end: '2026-06-10' }, RANGES), null);
});
await test('hours leave on a blocked day → hit (uses start date)', () => {
  const r = findBlockingRange(
    { unit: 'hours', start: '2026-12-25T09:00:00.000Z', end: '2026-12-25T12:00:00.000Z' },
    RANGES);
  assert.equal(r?.start, '2026-12-24');
});
await test('hours leave on a free day → null', () => {
  assert.equal(findBlockingRange(
    { unit: 'hours', start: '2026-07-01T09:00:00.000Z', end: '2026-07-01T12:00:00.000Z' },
    RANGES), null);
});
await test('a span covering a whole range → hit', () => {
  const r = findBlockingRange({ unit: 'days', start: '2026-05-01', end: '2026-12-31' }, RANGES);
  assert.ok(r); // first match returned
  assert.equal(r.start, '2026-06-01');
});

// ===========================================================================
console.log('\norg-settings store: blockedRanges');
// ===========================================================================

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-blocked-'));

await test('default is an empty array', () => {
  const store = createOrgSettingsStore(tmpDir);
  assert.deepEqual(store.get().leaves.blockedRanges, []);
});

await test('valid ranges are stored and sorted by start', () => {
  const store = createOrgSettingsStore(tmpDir);
  const s = store.update({ leaves: { blockedRanges: [
    { start: '2026-12-24', end: '2026-12-26', label: 'Holidays' },
    { start: '2026-06-01', end: '2026-06-01', label: '  Offsite  ' },
  ] } });
  assert.equal(s.leaves.blockedRanges.length, 2);
  assert.equal(s.leaves.blockedRanges[0].start, '2026-06-01');
  assert.equal(s.leaves.blockedRanges[0].label, 'Offsite'); // trimmed
  assert.equal(s.leaves.blockedRanges[1].start, '2026-12-24');
});

await test('rejects a non-array', () => {
  const store = createOrgSettingsStore(tmpDir);
  assert.throws(() => store.update({ leaves: { blockedRanges: 'nope' } }), /must be an array/);
});
await test('rejects an invalid date', () => {
  const store = createOrgSettingsStore(tmpDir);
  assert.throws(() => store.update({ leaves: { blockedRanges: [
    { start: '2026-02-31', end: '2026-02-31' },
  ] } }), /valid YYYY-MM-DD/);
});
await test('rejects start after end', () => {
  const store = createOrgSettingsStore(tmpDir);
  assert.throws(() => store.update({ leaves: { blockedRanges: [
    { start: '2026-06-10', end: '2026-06-01' },
  ] } }), /on or before end/);
});
await test('label is capped at 80 chars', () => {
  const store = createOrgSettingsStore(tmpDir);
  const s = store.update({ leaves: { blockedRanges: [
    { start: '2026-06-01', end: '2026-06-01', label: 'x'.repeat(200) },
  ] } });
  assert.equal(s.leaves.blockedRanges[0].label.length, 80);
});
await test('rejects more than 200 ranges', () => {
  const store = createOrgSettingsStore(tmpDir);
  const many = Array.from({ length: 201 }, (_, i) => ({
    start: '2026-01-01', end: '2026-01-01', label: String(i),
  }));
  assert.throws(() => store.update({ leaves: { blockedRanges: many } }), /cannot exceed 200/);
});
await test('hand-edited file: malformed entries are dropped on read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-blocked2-'));
  fs.writeFileSync(path.join(dir, 'org-settings.json'), JSON.stringify({
    leaves: { blockedRanges: [
      { start: '2026-06-01', end: '2026-06-02', label: 'Good' },
      { start: 'garbage', end: '2026-06-02' },
      { start: '2026-07-10', end: '2026-07-01' }, // start>end
    ] },
  }));
  const store = createOrgSettingsStore(dir);
  const ranges = store.get().leaves.blockedRanges;
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].label, 'Good');
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
const requireRole = (role) => (handler) => async (req, res) => {
  if (!req.user) return res.unauthorized('Sign in required', { errorCode: 'unauthorized' });
  if (req.user.role !== role) return res.forbidden('forbidden', { errorCode: 'forbidden' });
  return handler(req, res);
};

const BLOCK = [{ start: '2026-06-01', end: '2026-06-03', label: 'All-hands' }];

function buildPostHandler() {
  const router = createRouter();
  registerLeaveRoutes(router, {
    leavesStore: {
      wouldExceedCap: () => ({ exceeds: false }),
      create: (o) => ({ id: 'L1', status: 'pending', createdAt: 'now', ...o }),
      list: () => [],
    },
    usersStore: { list: () => [] },
    employeesStore: { list: () => [] },
    orgSettingsStore: { get: () => ({ leaves: { blockedRanges: BLOCK } }) },
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

const handler = buildPostHandler();

await test('employee vacation on a blocked day → 400 leave_day_blocked', async () => {
  const res = await post(handler, {
    user: { id: 'e1', role: 'employee' },
    body: { type: 'vacation', unit: 'days', start: '2026-06-02', end: '2026-06-02' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errorCode, 'leave_day_blocked');
  assert.match(res.body.error, /All-hands/);
});

await test('employee SICK on a blocked day → allowed (200)', async () => {
  const res = await post(handler, {
    user: { id: 'e1', role: 'employee' },
    body: { type: 'sick', unit: 'days', start: '2026-06-02', end: '2026-06-02' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
});

await test('EMPLOYER vacation on a blocked day → allowed (200)', async () => {
  const res = await post(handler, {
    user: { id: 'boss', role: 'employer' },
    body: { type: 'vacation', unit: 'days', start: '2026-06-02', end: '2026-06-02' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
});

await test('employee vacation OUTSIDE blocked range → allowed (200)', async () => {
  const res = await post(handler, {
    user: { id: 'e1', role: 'employee' },
    body: { type: 'vacation', unit: 'days', start: '2026-06-10', end: '2026-06-12' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
});

await test('employee hours-mode leave on a blocked day → 400', async () => {
  const res = await post(handler, {
    user: { id: 'e1', role: 'employee' },
    body: { type: 'appointment', unit: 'hours',
            start: '2026-06-01T09:00:00.000Z', end: '2026-06-01T11:00:00.000Z', hours: 2 },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errorCode, 'leave_day_blocked');
});

// ===========================================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
