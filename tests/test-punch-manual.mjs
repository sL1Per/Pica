import assert from 'node:assert/strict';

// Inline re-implementation of isManual() from public/punch-sessions.js — the
// browser module uses an absolute /-path Node can't import (project pattern).
function isManual(clientId) {
  return typeof clientId === 'string' && clientId.startsWith('correction:');
}

assert.equal(isManual('correction:abc-123:in'), true);
assert.equal(isManual('correction:abc-123:out'), true);
assert.equal(isManual('a1b2c3d4-e5f6-4789-8abc-def012345678'), false, 'auto punch clientId is not manual');
assert.equal(isManual(null), false);
assert.equal(isManual(undefined), false);
assert.equal(isManual(''), false);
console.log('test-punch-manual: OK');
