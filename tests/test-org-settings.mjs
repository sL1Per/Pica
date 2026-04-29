#!/usr/bin/env node
/**
 * M7 tests — org-settings storage.
 * Built-in `assert` only.
 *
 * Run:  node tests/test-org-settings.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createOrgSettingsStore,
  DEFAULT_ORG_SETTINGS,
  LEAVE_TYPES,
  BACKUP_SCHEDULES,
} from '../src/storage/org-settings.js';

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-org-'));

try {
  const store = createOrgSettingsStore(tmpDir);

  // ---------------------------------------------------------------------------
  console.log('Exports + defaults');
  // ---------------------------------------------------------------------------

  await test('exposes LEAVE_TYPES and BACKUP_SCHEDULES', () => {
    assert.deepEqual([...LEAVE_TYPES], ['vacation', 'sick', 'appointment', 'other']);
    assert.deepEqual([...BACKUP_SCHEDULES], ['off', 'hourly', 'daily', 'weekly']);
  });

  await test('get() returns defaults on first access', () => {
    const s = store.get();
    assert.deepEqual(s.leaves.defaultAllowances, DEFAULT_ORG_SETTINGS.leaves.defaultAllowances);
    assert.equal(s.leaves.carryForward, true);
    assert.equal(s.leaves.concurrentAllowed, true);
    assert.deepEqual(s.leaves.perEmployeeOverrides, {});
    assert.equal(s.backups.enabled, false);
    assert.equal(s.backups.schedule, 'daily');
    assert.equal(s.backups.retention, 7);
  });

  await test('get() returns a fresh copy each time (no aliasing)', () => {
    const a = store.get();
    a.leaves.defaultAllowances.vacation = 999;
    const b = store.get();
    assert.notEqual(b.leaves.defaultAllowances.vacation, 999);
  });

  await test('file is not created until first write', () => {
    assert.equal(fs.existsSync(store.path), false);
  });

  // ---------------------------------------------------------------------------
  console.log('\nLeaves — defaultAllowances');
  // ---------------------------------------------------------------------------

  await test('update() persists new default allowances', () => {
    const s = store.update({
      leaves: { defaultAllowances: { vacation: 25, sick: 10 } },
    });
    assert.equal(s.leaves.defaultAllowances.vacation, 25);
    assert.equal(s.leaves.defaultAllowances.sick, 10);
    // Untouched types keep their previous (default) value.
    assert.equal(s.leaves.defaultAllowances.appointment, 0);
  });

  await test('update() accepts half-day precision (0.5 step)', () => {
    const s = store.update({ leaves: { defaultAllowances: { appointment: 2.5 } } });
    assert.equal(s.leaves.defaultAllowances.appointment, 2.5);
  });

  await test('rejects negative allowance', () => {
    assert.throws(() => store.update({
      leaves: { defaultAllowances: { vacation: -1 } },
    }), /between 0 and 365/);
  });

  await test('rejects absurdly large allowance (> 365)', () => {
    assert.throws(() => store.update({
      leaves: { defaultAllowances: { vacation: 400 } },
    }), /between 0 and 365/);
  });

  await test('empty string coerces to 0', () => {
    const s = store.update({ leaves: { defaultAllowances: { other: '' } } });
    assert.equal(s.leaves.defaultAllowances.other, 0);
  });

  await test('unknown leave types are silently ignored', () => {
    const s = store.update({
      leaves: { defaultAllowances: { vacation: 25, sabbatical: 100 } },
    });
    assert.equal(s.leaves.defaultAllowances.vacation, 25);
    assert.equal(s.leaves.defaultAllowances.sabbatical, undefined);
  });

  // ---------------------------------------------------------------------------
  console.log('\nLeaves — perEmployeeOverrides');
  // ---------------------------------------------------------------------------

  await test('per-employee override persists', () => {
    const s = store.update({
      leaves: {
        perEmployeeOverrides: {
          'alice-uuid': { vacation: 30, sick: 15 },
        },
      },
    });
    assert.equal(s.leaves.perEmployeeOverrides['alice-uuid'].vacation, 30);
    assert.equal(s.leaves.perEmployeeOverrides['alice-uuid'].sick, 15);
  });

  await test('per-employee override validates numbers too', () => {
    assert.throws(() => store.update({
      leaves: {
        perEmployeeOverrides: {
          'alice-uuid': { vacation: -5 },
        },
      },
    }), /between 0 and 365/);
  });

  await test('per-employee override replaces full map (not merged)', () => {
    // This is by design: sending the whole perEmployeeOverrides object
    // replaces it wholesale — mirrors how the UI actually sends data.
    store.update({
      leaves: {
        perEmployeeOverrides: {
          'bob-uuid': { vacation: 20 },
        },
      },
    });
    const s = store.get();
    // Alice's override is now gone because bob's patch replaced the whole map.
    assert.equal(s.leaves.perEmployeeOverrides['alice-uuid'], undefined);
    assert.equal(s.leaves.perEmployeeOverrides['bob-uuid'].vacation, 20);
  });

  await test('empty overrides object clears all per-employee caps', () => {
    store.update({ leaves: { perEmployeeOverrides: {} } });
    const s = store.get();
    assert.deepEqual(s.leaves.perEmployeeOverrides, {});
  });

  // ---------------------------------------------------------------------------
  console.log('\nLeaves — flags');
  // ---------------------------------------------------------------------------

  await test('carryForward and concurrentAllowed flip cleanly', () => {
    let s = store.update({ leaves: { carryForward: false, concurrentAllowed: false } });
    assert.equal(s.leaves.carryForward, false);
    assert.equal(s.leaves.concurrentAllowed, false);

    s = store.update({ leaves: { carryForward: true } });
    assert.equal(s.leaves.carryForward, true);
    assert.equal(s.leaves.concurrentAllowed, false); // preserved
  });

  await test('truthy non-boolean values coerce to boolean', () => {
    const s = store.update({ leaves: { carryForward: 'yes' } });
    assert.equal(s.leaves.carryForward, true);
  });

  // ---------------------------------------------------------------------------
  console.log('\nBackups section');
  // ---------------------------------------------------------------------------

  await test('backups patch persists schedule, enabled, retention', () => {
    const s = store.update({ backups: { enabled: true, schedule: 'hourly', retention: 30 } });
    assert.equal(s.backups.enabled, true);
    assert.equal(s.backups.schedule, 'hourly');
    assert.equal(s.backups.retention, 30);
  });

  await test('rejects unknown schedule', () => {
    assert.throws(() => store.update({ backups: { schedule: 'monthly' } }),
      /schedule must be one of/);
  });

  await test('rejects non-integer retention', () => {
    assert.throws(() => store.update({ backups: { retention: 2.5 } }),
      /integer between 1 and 365/);
  });

  await test('rejects retention out of range', () => {
    assert.throws(() => store.update({ backups: { retention: 0 } }), /between 1 and 365/);
    assert.throws(() => store.update({ backups: { retention: 400 } }), /between 1 and 365/);
  });

  // ---------------------------------------------------------------------------
  console.log('\nPersistence + invalidate');
  // ---------------------------------------------------------------------------

  await test('second store instance reads existing data', () => {
    const s2 = createOrgSettingsStore(tmpDir);
    const s = s2.get();
    assert.equal(s.leaves.defaultAllowances.vacation, 25);
    assert.equal(s.backups.schedule, 'hourly');
  });

  await test('partial updates preserve untouched sections', () => {
    store.update({ leaves: { defaultAllowances: { vacation: 27 } } });
    const s = store.get();
    // Backups section wasn't in the patch — its previous values hold.
    assert.equal(s.backups.schedule, 'hourly');
    assert.equal(s.backups.retention, 30);
  });

  await test('file on disk has mode 0600', () => {
    const stat = fs.statSync(store.path);
    assert.equal(stat.mode & 0o777, 0o600);
  });

  await test('invalidate() forces re-read from disk', () => {
    // Externally corrupt, then invalidate.
    const raw = JSON.parse(fs.readFileSync(store.path, 'utf8'));
    raw.leaves.defaultAllowances.vacation = 99;
    fs.writeFileSync(store.path, JSON.stringify(raw));
    const cached = store.get();
    assert.equal(cached.leaves.defaultAllowances.vacation, 27); // cached
    store.invalidate();
    const fresh = store.get();
    assert.equal(fresh.leaves.defaultAllowances.vacation, 99);
  });

  // ---------------------------------------------------------------------------
  console.log('\nCompany section');
  // ---------------------------------------------------------------------------

  await test('defaults include company.name = null', () => {
    store.invalidate();
    // Use a clean subdir so we don't pick up state from the earlier tests.
    const subdir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-org-clean-'));
    try {
      const fresh = createOrgSettingsStore(subdir);
      const s = fresh.get();
      assert.equal(s.company.name, null);
    } finally {
      fs.rmSync(subdir, { recursive: true, force: true });
    }
  });

  await test('setting company.name persists', () => {
    const s = store.update({ company: { name: 'Acme Corp' } });
    assert.equal(s.company.name, 'Acme Corp');
    store.invalidate();
    assert.equal(store.get().company.name, 'Acme Corp');
  });

  await test('company.name is trimmed', () => {
    const s = store.update({ company: { name: '   Acme   ' } });
    assert.equal(s.company.name, 'Acme');
  });

  await test('empty string becomes null', () => {
    const s = store.update({ company: { name: '' } });
    assert.equal(s.company.name, null);
  });

  await test('explicit null resets to null', () => {
    store.update({ company: { name: 'Acme' } });
    const s = store.update({ company: { name: null } });
    assert.equal(s.company.name, null);
  });

  await test('non-string, non-null name is rejected', () => {
    assert.throws(() => store.update({ company: { name: 42 } }),
      /must be a string or null/);
  });

  await test('name over 80 chars is rejected', () => {
    const tooLong = 'a'.repeat(81);
    assert.throws(() => store.update({ company: { name: tooLong } }),
      /80 characters or fewer/);
  });

  await test('name of exactly 80 chars is accepted', () => {
    const ok = 'a'.repeat(80);
    const s = store.update({ company: { name: ok } });
    assert.equal(s.company.name, ok);
  });

  await test('company patch does not disturb other sections', () => {
    store.update({ leaves: { defaultAllowances: { vacation: 21 } } });
    store.update({ company: { name: 'New Name' } });
    const s = store.get();
    assert.equal(s.company.name, 'New Name');
    assert.equal(s.leaves.defaultAllowances.vacation, 21);
  });

  // ---------------------------------------------------------------------------
  console.log('\nPatch validation');
  // ---------------------------------------------------------------------------

  await test('rejects non-object patch', () => {
    assert.throws(() => store.update(null), /patch must be an object/);
    assert.throws(() => store.update('string'), /patch must be an object/);
  });

  await test('empty patch is a no-op, returns current state', () => {
    const before = store.get();
    const after = store.update({});
    assert.deepEqual(after, before);
  });

  // ---------------------------------------------------------------------------
  console.log('\nworkingTime');
  // ---------------------------------------------------------------------------

  await test('workingTime defaults to 8h daily / 40h weekly', () => {
    const fresh = createOrgSettingsStore(fs.mkdtempSync(path.join(os.tmpdir(), 'pica-os-wt1-')));
    assert.equal(fresh.get().workingTime.dailyHours, 8);
    assert.equal(fresh.get().workingTime.weeklyHours, 40);
  });

  await test('workingTime accepts fractional hours (7.5 / 37.5)', () => {
    store.update({ workingTime: { dailyHours: 7.5, weeklyHours: 37.5 } });
    const after = store.get().workingTime;
    assert.equal(after.dailyHours, 7.5);
    assert.equal(after.weeklyHours, 37.5);
  });

  await test('workingTime rejects daily hours over 24', () => {
    assert.throws(() => store.update({ workingTime: { dailyHours: 25 } }), /between 0 and 24/);
  });

  await test('workingTime rejects negative hours', () => {
    assert.throws(() => store.update({ workingTime: { dailyHours: -1 } }), /between 0 and 24/);
    assert.throws(() => store.update({ workingTime: { weeklyHours: -1 } }), /between 0 and 168/);
  });

  await test('workingTime rejects non-numeric values', () => {
    assert.throws(() => store.update({ workingTime: { dailyHours: 'eight' } }), /between 0 and 24/);
  });

  await test('workingTime patch is independent of leaves/backups patches', () => {
    const before = store.get();
    store.update({ workingTime: { dailyHours: 6 } });
    const after = store.get();
    assert.equal(after.workingTime.dailyHours, 6);
    // Other sections must still be present unchanged.
    assert.deepEqual(after.leaves, before.leaves);
    assert.deepEqual(after.backups, before.backups);
  });

} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
