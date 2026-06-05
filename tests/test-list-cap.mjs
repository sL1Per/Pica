// Unit tests for the pure list-cap helper. list-cap.js has no browser-only
// imports, so it is importable directly under Node (same pattern as
// tests/test-calendar-grid.mjs importing ../public/calendar-grid.js).
import assert from 'node:assert/strict';
import { capView, LIST_CAP } from '../public/list-cap.js';

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`  ok - ${name}`); }

check('default cap is 15', () => {
  assert.equal(LIST_CAP, 15);
});

check('total below limit: no toggle, all visible', () => {
  assert.deepEqual(capView(10, 15, false), { visible: 10, showToggle: false, expanded: false });
});

check('total equal to limit: no toggle, all visible', () => {
  assert.deepEqual(capView(15, 15, false), { visible: 15, showToggle: false, expanded: false });
});

check('total just over limit, collapsed: cap to limit, toggle on', () => {
  assert.deepEqual(capView(16, 15, false), { visible: 15, showToggle: true, expanded: false });
});

check('total over limit, expanded: show all, toggle on', () => {
  assert.deepEqual(capView(47, 15, true), { visible: 47, showToggle: true, expanded: true });
});

check('expanded coerced to boolean', () => {
  assert.deepEqual(capView(3, 15, undefined), { visible: 3, showToggle: false, expanded: false });
});

console.log(`\ntest-list-cap: ${passed} checks passed`);
