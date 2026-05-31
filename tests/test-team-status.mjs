/**
 * Tests for public/team-status.js — the shared session-pairing + status
 * classification used by the employer home, team list, and employee-detail
 * screens. The module is pure (no DOM, no `/`-absolute imports), so Node
 * imports it directly — unlike most frontend files which the i18n test has
 * to re-implement inline.
 */
import assert from 'node:assert/strict';
import {
  pairSessions, workedMs, breakMs, groupByEmployee, classify,
  BREAK_CUTOFF_HOUR, STATUS_SORT,
} from '../public/team-status.js';

const H = 3600 * 1000;
// Build a punch at a fixed wall-clock hour today.
function at(hour, type, employeeId = 'a') {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return { employeeId, type, ts: d.toISOString() };
}

let passed = 0;
function ok(name, fn) { fn(); passed++; }

// ---- pairSessions ---------------------------------------------------------
ok('pairSessions pairs in/out and leaves a trailing open session', () => {
  const pairs = pairSessions([at(9, 'in'), at(12, 'out'), at(13, 'in')]);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].out !== null, true);
  assert.equal(pairs[1].out, null); // open trailing session
});

ok('pairSessions sorts unordered input by ts', () => {
  const pairs = pairSessions([at(12, 'out'), at(9, 'in')]);
  assert.equal(pairs.length, 1);
  assert.equal(new Date(pairs[0].in.ts).getHours(), 9);
  assert.equal(new Date(pairs[0].out.ts).getHours(), 12);
});

ok('pairSessions of empty list is empty', () => {
  assert.deepEqual(pairSessions([]), []);
});

// ---- workedMs -------------------------------------------------------------
ok('workedMs sums closed pairs', () => {
  assert.equal(workedMs([{ in: at(9, 'in'), out: at(12, 'out') }]), 3 * H);
});

ok('workedMs counts an open pair up to now', () => {
  const now = new Date(); now.setHours(11, 0, 0, 0);
  const ms = workedMs([{ in: at(9, 'in'), out: null }], now.getTime());
  assert.equal(ms, 2 * H);
});

// ---- breakMs --------------------------------------------------------------
ok('breakMs sums the gap between sessions', () => {
  const pairs = [
    { in: at(9, 'in'), out: at(12, 'out') },
    { in: at(13, 'in'), out: at(18, 'out') },
  ];
  assert.equal(breakMs(pairs), 1 * H);
});

ok('breakMs of a single uninterrupted session is zero', () => {
  assert.equal(breakMs([{ in: at(9, 'in'), out: at(17, 'out') }]), 0);
});

// ---- groupByEmployee ------------------------------------------------------
ok('groupByEmployee buckets by employeeId, sorted by ts', () => {
  const m = groupByEmployee([
    at(9, 'in', 'a'), at(10, 'in', 'b'), at(12, 'out', 'a'),
  ]);
  assert.equal(m.size, 2);
  assert.equal(m.get('a').length, 2);
  assert.equal(new Date(m.get('a')[0].ts).getHours(), 9);
});

// ---- classify -------------------------------------------------------------
ok('classify: on leave wins over any punches', () => {
  assert.equal(classify({ pairs: [{ in: at(9, 'in'), out: null }], onLeave: true }), 'leave');
});

ok('classify: open session is working', () => {
  assert.equal(classify({ pairs: [{ in: at(9, 'in'), out: null }], onLeave: false, nowHour: 10 }), 'working');
});

ok('classify: closed sessions before cutoff = break', () => {
  assert.equal(classify({ pairs: [{ in: at(9, 'in'), out: at(12, 'out') }], onLeave: false, nowHour: 10 }), 'break');
});

ok('classify: closed sessions at/after cutoff = done', () => {
  assert.equal(classify({ pairs: [{ in: at(9, 'in'), out: at(12, 'out') }], onLeave: false, nowHour: BREAK_CUTOFF_HOUR }), 'done');
});

ok('classify: no punches and not on leave = off', () => {
  assert.equal(classify({ pairs: [], onLeave: false, nowHour: 10 }), 'off');
});

// ---- STATUS_SORT ----------------------------------------------------------
ok('STATUS_SORT orders working before off', () => {
  assert.ok(STATUS_SORT.working < STATUS_SORT.break);
  assert.ok(STATUS_SORT.break < STATUS_SORT.done);
  assert.ok(STATUS_SORT.done < STATUS_SORT.leave);
  assert.ok(STATUS_SORT.leave < STATUS_SORT.off);
});

ok('STATUS_SORT places deactivated last', () => {
  assert.equal(STATUS_SORT.deactivated, 5);
  assert.ok(STATUS_SORT.off < STATUS_SORT.deactivated);
});

console.log(`test-team-status: ${passed} passed`);
