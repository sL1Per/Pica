/**
 * M17 S1 regression: GET /api/punches/by-employee/:id must reject a non-UUID
 * id (path-traversal class) with a clean 400, BEFORE it reaches the store —
 * mirroring the employees-route guard. The router decodes the :id segment
 * after matching, so a %2F-encoded traversal arrives at the handler as a
 * decoded '../...' string; that is exactly what we feed here.
 *
 * Run:  node tests/test-punches-route.mjs
 */
import assert from 'node:assert/strict';

import { createRouter } from '../src/router.js';
import { registerPunchRoutes } from '../src/routes/punches.js';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); failed++; }
}

function mockRes() {
  const r = {
    statusCode: null,
    body: null,
    json(data, status = 200) { r.statusCode = status; r.body = data; },
    badRequest(msg, opts) { r.statusCode = 400; r.body = { error: msg, ...(opts?.errorCode && { errorCode: opts.errorCode }) }; },
  };
  return r;
}

// Pass-through auth wrappers (access control is tested elsewhere; here we
// only care that the id-shape guard fires).
const requireOwnerOrEmployer = () => (handler) => handler;
const requireAuth = (handler) => handler;

let storeCalls = 0;
const punchesStore = {
  listDay: () => { storeCalls++; return []; },
  listMonth: () => { storeCalls++; return []; },
  hasOpenPunch: () => false,
  latest: () => null,
};

const router = createRouter();
registerPunchRoutes(router, { punchesStore, usersStore: { list: () => [] }, requireAuth, requireOwnerOrEmployer });

async function call(rawIdSegment) {
  const m = router.match('GET', `/api/punches/by-employee/${rawIdSegment}`);
  assert.ok(m && m.handler, `route should match for segment ${rawIdSegment}`);
  const req = { user: { id: 'x', role: 'employer' }, params: m.params, query: {}, headers: {} };
  const res = mockRes();
  await m.handler(req, res);
  return res;
}

console.log('GET /api/punches/by-employee/:id — id-shape guard (M17 S1)');

await test('encoded path-traversal id → 400 invalid_id, store NOT called', async () => {
  storeCalls = 0;
  // encodeURIComponent keeps the segment slash-free so the router matches,
  // then decodeURIComponent restores '../../../etc/passwd' for the handler.
  const res = await call(encodeURIComponent('../../../etc/passwd'));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errorCode, 'invalid_id');
  assert.equal(storeCalls, 0);
});

await test('plain non-UUID id → 400 invalid_id', async () => {
  storeCalls = 0;
  const res = await call('alice');
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errorCode, 'invalid_id');
  assert.equal(storeCalls, 0);
});

await test('valid UUID id → passes the guard, store IS called', async () => {
  storeCalls = 0;
  const res = await call('11111111-1111-4111-8111-111111111111');
  assert.notEqual(res.statusCode, 400);
  assert.ok(storeCalls > 0, 'store should be queried for a valid id');
});

// ---------------------------------------------------------------------------
// M17 S3: clock-in/out records the server-receipt time and AUDITS a backdated
// (honored clientTs that diverges from receipt) punch. Live punches stay silent.
// ---------------------------------------------------------------------------
console.log('\nclock-in/out — server-receipt + backdated audit (M17 S3)');

const UID = '11111111-1111-4111-8111-111111111111';

function clockHarness() {
  const events = [];
  const appended = [];
  const cStore = {
    hasOpenPunch: () => clockHarness._open,
    findByClientId: () => null,
    append: (id, rec) => { appended.push({ id, rec }); return { employeeId: id, ...rec }; },
  };
  const auditStore = { appendRecord: (e) => events.push(e) };
  const r = createRouter();
  registerPunchRoutes(r, {
    punchesStore: cStore, usersStore: { list: () => [] }, auditStore,
    requireAuth, requireOwnerOrEmployer,
  });
  return { r, events, appended };
}

async function clock(h, path, body, open) {
  clockHarness._open = open;
  const m = h.r.match('POST', path);
  const req = { user: { id: UID, username: 'alice', role: 'employee' }, params: m.params, query: {}, body, headers: {}, socket: {} };
  const res = mockRes();
  await m.handler(req, res);
  return res;
}

await test('clock-in passes a recvTs to the store', async () => {
  const h = clockHarness();
  await clock(h, '/api/punches/clock-in', {}, false);
  assert.equal(h.appended.length, 1);
  assert.ok(h.appended[0].rec.recvTs, 'append payload should carry recvTs');
});

await test('a live clock-in (no clientTs) emits NO audit event', async () => {
  const h = clockHarness();
  await clock(h, '/api/punches/clock-in', {}, false);
  assert.equal(h.events.length, 0);
});

await test('small jitter (<120s) clientTs emits NO audit event', async () => {
  const h = clockHarness();
  const ts = new Date(Date.now() - 30 * 1000).toISOString(); // 30s ago
  await clock(h, '/api/punches/clock-in', { clientTs: ts }, false);
  assert.equal(h.events.length, 0, 'within-threshold skew should not be flagged');
});

await test('backdated clientTs (>120s) emits punch.backdated with the delta', async () => {
  const h = clockHarness();
  const claimed = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(); // 3h ago
  await clock(h, '/api/punches/clock-in', { clientTs: claimed }, false);
  assert.equal(h.events.length, 1);
  const e = h.events[0];
  assert.equal(e.event, 'punch.backdated');
  assert.equal(e.target.employeeId, UID);
  assert.equal(e.target.type, 'in');
  assert.equal(e.details.claimedTs, claimed);
  assert.ok(e.details.recvTs, 'event carries the receipt time');
  assert.ok(e.details.deltaSeconds >= 3 * 60 * 60 - 5, 'delta ~ 3h in seconds');
});

await test('backdated clock-OUT is audited too', async () => {
  const h = clockHarness();
  const claimed = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
  await clock(h, '/api/punches/clock-out', { clientTs: claimed }, true);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].event, 'punch.backdated');
  assert.equal(h.events[0].target.type, 'out');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
