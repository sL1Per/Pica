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

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
