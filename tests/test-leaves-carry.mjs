#!/usr/bin/env node
/**
 * Tests for vacation carry-forward logic in computeBalances() and the
 * MM-DD expiry semantics introduced in 0.22.5.
 *
 * Approach: drive the leaves storage directly with a tiny daysOf stub
 * that returns the leave's `_days` field. Anchor the expiry check by
 * passing a frozen `now` so the tests are deterministic.
 *
 * Coverage:
 *   - Vacation carries unused approved days from year N-1 into year N
 *   - Pending year-N-1 leaves do NOT count as used (per design Q3)
 *   - Sick / appointment / other never carry
 *   - allowance===0 (unlimited) types never carry
 *   - Carry drops to 0 once `now > carryForwardExpiresAt` of year N
 *   - Carry survives at end-of-day on the expiry date
 *   - carryForward: false disables carry entirely
 *   - effectiveAllowance = allowance + carryIn
 *   - remaining factors in carry
 *   - wouldExceedCap uses effectiveAllowance
 *
 * Run:  node tests/test-leaves-carry.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createLeavesStore, LEAVE_TYPES_LIST } from '../src/storage/leaves.js';

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

const masterKey = Buffer.alloc(32, 1);
const ALICE = '11111111-1111-4111-8111-111111111111';

// daysOf stub — leaves carry a `_days` field for test arithmetic.
const daysOf = (leave) => leave._days ?? 0;

function withTempStore(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-carry-'));
  try {
    const store = createLeavesStore(dir, masterKey);
    return fn(store, dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Append a leave directly via store.create + (optionally) approve. */
function seed(store, { employeeId, type, status, year, days }) {
  const start = `${year}-06-01`;
  const end   = `${year}-06-${String(days).padStart(2, '0')}`;
  const leave = store.create({
    employeeId, type, unit: 'days',
    start, end, reason: null,
  });
  // Stash days for daysOf to read.
  leave._days = days;
  // Replay path: `list` reads from disk and won't see _days. But the
  // computeBalances loop calls daysOf on the loaded record, which will
  // not have _days. We sidestep by patching list().
  if (status === 'approved') store.approve(leave.id, employeeId);
  return leave;
}

/** Build a settings object. */
function settings({ vacation = 22, carryForward = true, expiresAt = '03-31', overrides = {} } = {}) {
  return {
    leaves: {
      defaultAllowances: { vacation, sick: 0, appointment: 0, other: 0 },
      perEmployeeOverrides: overrides,
      carryForward,
      carryForwardExpiresAt: expiresAt,
    },
  };
}

/**
 * computeBalances reads `leave.start.slice(0,4)` for year and calls
 * daysOf(leave). Since `_days` doesn't survive disk reload, we wrap
 * daysOf to derive days from the start/end YMD difference + 1.
 */
const daysOfFromRange = (leave) => {
  const s = new Date(leave.start);
  const e = new Date(leave.end);
  return Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
};

console.log('Vacation carry-forward — basic accumulation');

await test('unused approved year-N-1 vacation carries into year N', () => {
  withTempStore((store) => {
    // Year 2025 allowance 22 days, used 17 (one approved 17-day vacation).
    const leave = store.create({
      employeeId: ALICE, type: 'vacation', unit: 'days',
      start: '2025-06-01', end: '2025-06-17', reason: null,
    });
    store.approve(leave.id, ALICE);

    const balances = store.computeBalances({
      userId: ALICE, year: 2026,
      orgSettings: settings(),
      leaveTypes: ['vacation'],
      daysOf: daysOfFromRange,
      now: new Date('2026-02-15T12:00:00Z'),
    });
    const v = balances[0];
    assert.equal(v.allowance, 22);
    assert.equal(v.carryIn, 5, 'carry = 22 - 17');
    assert.equal(v.effectiveAllowance, 27);
    assert.equal(v.remaining, 27, 'no year-2026 booked yet');
    assert.equal(v.carryExpiresAt, '2026-03-31');
  });
});

await test('pending year-N-1 leaves do NOT count as used', () => {
  withTempStore((store) => {
    // Approved 10 days, pending 5 — only the 10 should reduce carry.
    const a = store.create({ employeeId: ALICE, type: 'vacation', unit: 'days',
      start: '2025-06-01', end: '2025-06-10', reason: null });
    store.approve(a.id, ALICE);
    store.create({ employeeId: ALICE, type: 'vacation', unit: 'days',
      start: '2025-08-01', end: '2025-08-05', reason: null });

    const v = store.computeBalances({
      userId: ALICE, year: 2026,
      orgSettings: settings(),
      leaveTypes: ['vacation'],
      daysOf: daysOfFromRange,
      now: new Date('2026-02-15T12:00:00Z'),
    })[0];
    assert.equal(v.carryIn, 12, 'carry = 22 - 10 approved (pending ignored)');
  });
});

await test('over-used year-N-1 yields carryIn = 0 (no negative)', () => {
  withTempStore((store) => {
    // 25 approved days against a 22-day allowance — happens with overrides.
    const a = store.create({ employeeId: ALICE, type: 'vacation', unit: 'days',
      start: '2025-06-01', end: '2025-06-25', reason: null });
    store.approve(a.id, ALICE);
    const v = store.computeBalances({
      userId: ALICE, year: 2026,
      orgSettings: settings(),
      leaveTypes: ['vacation'],
      daysOf: daysOfFromRange,
      now: new Date('2026-02-15T12:00:00Z'),
    })[0];
    assert.equal(v.carryIn, 0);
  });
});

console.log('\nExpiry — MM-DD applied each year');

await test('carry survives end-of-day on the expiry date', () => {
  withTempStore((store) => {
    const a = store.create({ employeeId: ALICE, type: 'vacation', unit: 'days',
      start: '2025-06-01', end: '2025-06-15', reason: null });
    store.approve(a.id, ALICE);
    const v = store.computeBalances({
      userId: ALICE, year: 2026,
      orgSettings: settings({ expiresAt: '03-31' }),
      leaveTypes: ['vacation'],
      daysOf: daysOfFromRange,
      // Just before midnight on 31 March
      now: new Date('2026-03-31T23:00:00'),
    })[0];
    assert.equal(v.carryIn, 7, 'carry still active at 23:00 on expiry day');
  });
});

await test('carry drops to 0 the day after expiry', () => {
  withTempStore((store) => {
    const a = store.create({ employeeId: ALICE, type: 'vacation', unit: 'days',
      start: '2025-06-01', end: '2025-06-15', reason: null });
    store.approve(a.id, ALICE);
    const v = store.computeBalances({
      userId: ALICE, year: 2026,
      orgSettings: settings({ expiresAt: '03-31' }),
      leaveTypes: ['vacation'],
      daysOf: daysOfFromRange,
      now: new Date('2026-04-01T00:00:01'),
    })[0];
    assert.equal(v.carryIn, 0);
    assert.equal(v.carryExpiresAt, null);
  });
});

await test('different MM-DD expiry honored', () => {
  withTempStore((store) => {
    const a = store.create({ employeeId: ALICE, type: 'vacation', unit: 'days',
      start: '2025-06-01', end: '2025-06-15', reason: null });
    store.approve(a.id, ALICE);
    // 30 June expiry
    const v = store.computeBalances({
      userId: ALICE, year: 2026,
      orgSettings: settings({ expiresAt: '06-30' }),
      leaveTypes: ['vacation'],
      daysOf: daysOfFromRange,
      now: new Date('2026-06-30T12:00:00'),
    })[0];
    assert.equal(v.carryIn, 7);
    assert.equal(v.carryExpiresAt, '2026-06-30');
  });
});

console.log('\nScope — only vacation, only when allowance > 0');

await test('sick / appointment / other never carry', () => {
  withTempStore((store) => {
    // Approved sick days from year-1 — should NOT carry even with carryForward on.
    const a = store.create({ employeeId: ALICE, type: 'sick', unit: 'days',
      start: '2025-06-01', end: '2025-06-05', reason: null });
    store.approve(a.id, ALICE);
    const balances = store.computeBalances({
      userId: ALICE, year: 2026,
      orgSettings: {
        leaves: {
          defaultAllowances: { vacation: 22, sick: 10, appointment: 0, other: 0 },
          perEmployeeOverrides: {},
          carryForward: true,
          carryForwardExpiresAt: '03-31',
        },
      },
      daysOf: daysOfFromRange,
      now: new Date('2026-02-15T12:00:00Z'),
    });
    const sick = balances.find((b) => b.type === 'sick');
    assert.equal(sick.carryIn, 0, 'sick never carries');
  });
});

await test('vacation with allowance=0 (unlimited) does not carry', () => {
  withTempStore((store) => {
    const v = store.computeBalances({
      userId: ALICE, year: 2026,
      orgSettings: settings({ vacation: 0 }),
      leaveTypes: ['vacation'],
      daysOf: daysOfFromRange,
      now: new Date('2026-02-15T12:00:00Z'),
    })[0];
    assert.equal(v.carryIn, 0);
    assert.equal(v.effectiveAllowance, 0);
  });
});

await test('carryForward: false disables carry entirely', () => {
  withTempStore((store) => {
    const a = store.create({ employeeId: ALICE, type: 'vacation', unit: 'days',
      start: '2025-06-01', end: '2025-06-15', reason: null });
    store.approve(a.id, ALICE);
    const v = store.computeBalances({
      userId: ALICE, year: 2026,
      orgSettings: settings({ carryForward: false }),
      leaveTypes: ['vacation'],
      daysOf: daysOfFromRange,
      now: new Date('2026-02-15T12:00:00Z'),
    })[0];
    assert.equal(v.carryIn, 0);
  });
});

console.log('\nRemaining + cap-exceeded use effective allowance');

await test('remaining counts effective allowance minus pending+booked', () => {
  withTempStore((store) => {
    // 5 days carry from 2025; 3 days approved in 2026.
    const a = store.create({ employeeId: ALICE, type: 'vacation', unit: 'days',
      start: '2025-06-01', end: '2025-06-17', reason: null });
    store.approve(a.id, ALICE);
    const b = store.create({ employeeId: ALICE, type: 'vacation', unit: 'days',
      start: '2026-04-01', end: '2026-04-03', reason: null });
    store.approve(b.id, ALICE);

    const v = store.computeBalances({
      userId: ALICE, year: 2026,
      orgSettings: settings(),
      leaveTypes: ['vacation'],
      daysOf: daysOfFromRange,
      now: new Date('2026-02-15T12:00:00Z'),
    })[0];
    assert.equal(v.allowance, 22);
    assert.equal(v.carryIn, 5);
    assert.equal(v.effectiveAllowance, 27);
    assert.equal(v.booked, 3);
    assert.equal(v.remaining, 24, '27 effective - 3 booked');
  });
});

await test('wouldExceedCap uses effective allowance', () => {
  withTempStore((store) => {
    // 5 days carry, 22 base = 27 effective. 25 booked → can book 2 more.
    const a = store.create({ employeeId: ALICE, type: 'vacation', unit: 'days',
      start: '2025-06-01', end: '2025-06-17', reason: null });
    store.approve(a.id, ALICE);
    const b = store.create({ employeeId: ALICE, type: 'vacation', unit: 'days',
      start: '2026-04-01', end: '2026-04-25', reason: null });
    store.approve(b.id, ALICE);

    const orgSettings = settings();
    const now = new Date('2026-02-15T12:00:00Z');

    const within = store.wouldExceedCap({
      userId: ALICE, type: 'vacation', additionalDays: 2,
      year: 2026, orgSettings, daysOf: daysOfFromRange, now,
    });
    assert.equal(within.exceeds, false, '25 + 2 = 27 ≤ 27');

    const over = store.wouldExceedCap({
      userId: ALICE, type: 'vacation', additionalDays: 3,
      year: 2026, orgSettings, daysOf: daysOfFromRange, now,
    });
    assert.equal(over.exceeds, true, '25 + 3 = 28 > 27');
    assert.equal(over.allowance, 27, 'response reports effective cap');
  });
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
