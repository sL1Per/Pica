#!/usr/bin/env node
/**
 * Backup scheduler tests.
 *
 * Most of the value is in `shouldMakeBackup()` — a pure function that
 * tells us whether a backup is due given current settings + the
 * timestamp of the most recent backup. The lifecycle wrapper is
 * smoke-tested via `tickNow()` to avoid wall-clock waits.
 *
 * Run:  node tests/test-backup-scheduler.mjs
 */

import assert from 'node:assert/strict';

import {
  startBackupScheduler,
  shouldMakeBackup,
} from '../src/scheduler/backup-scheduler.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

console.log('Backup scheduler — shouldMakeBackup decisions');

const NOW = new Date('2026-05-04T12:00:00Z').getTime();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('returns false when settings missing', () => {
  const r = shouldMakeBackup({ settings: null, mostRecent: null, nowMs: NOW });
  assert.equal(r.make, false);
  assert.match(r.reason, /disabled/);
});

test('returns false when enabled=false', () => {
  const r = shouldMakeBackup({
    settings: { enabled: false, schedule: 'daily', retention: 7 },
    mostRecent: null,
    nowMs: NOW,
  });
  assert.equal(r.make, false);
  assert.match(r.reason, /disabled/);
});

test('returns false when schedule is "off" even with enabled=true', () => {
  const r = shouldMakeBackup({
    settings: { enabled: true, schedule: 'off', retention: 7 },
    mostRecent: null,
    nowMs: NOW,
  });
  assert.equal(r.make, false);
});

test('returns false on unknown schedule values', () => {
  const r = shouldMakeBackup({
    settings: { enabled: true, schedule: 'fortnightly', retention: 7 },
    mostRecent: null,
    nowMs: NOW,
  });
  assert.equal(r.make, false);
  assert.match(r.reason, /unknown schedule/);
});

test('returns true on first run (no prior backup)', () => {
  const r = shouldMakeBackup({
    settings: { enabled: true, schedule: 'daily', retention: 7 },
    mostRecent: null,
    nowMs: NOW,
  });
  assert.equal(r.make, true);
});

test('hourly: not due 30 min after last backup', () => {
  const last = new Date(NOW - 30 * MIN).toISOString();
  const r = shouldMakeBackup({
    settings: { enabled: true, schedule: 'hourly', retention: 7 },
    mostRecent: { createdAt: last },
    nowMs: NOW,
  });
  assert.equal(r.make, false);
});

test('hourly: due exactly 1 hour after last backup', () => {
  const last = new Date(NOW - HOUR).toISOString();
  const r = shouldMakeBackup({
    settings: { enabled: true, schedule: 'hourly', retention: 7 },
    mostRecent: { createdAt: last },
    nowMs: NOW,
  });
  assert.equal(r.make, true);
});

test('hourly: due 2 hours after (not making 2 catch-up backups)', () => {
  const last = new Date(NOW - 2 * HOUR).toISOString();
  const r = shouldMakeBackup({
    settings: { enabled: true, schedule: 'hourly', retention: 7 },
    mostRecent: { createdAt: last },
    nowMs: NOW,
  });
  // Returns just `make: true` — caller makes ONE backup, not 2.
  assert.equal(r.make, true);
});

test('daily: not due 12 hours after last', () => {
  const last = new Date(NOW - 12 * HOUR).toISOString();
  const r = shouldMakeBackup({
    settings: { enabled: true, schedule: 'daily', retention: 7 },
    mostRecent: { createdAt: last },
    nowMs: NOW,
  });
  assert.equal(r.make, false);
});

test('daily: due 24 hours after last', () => {
  const last = new Date(NOW - DAY).toISOString();
  const r = shouldMakeBackup({
    settings: { enabled: true, schedule: 'daily', retention: 7 },
    mostRecent: { createdAt: last },
    nowMs: NOW,
  });
  assert.equal(r.make, true);
});

test('weekly: not due 6 days after last', () => {
  const last = new Date(NOW - 6 * DAY).toISOString();
  const r = shouldMakeBackup({
    settings: { enabled: true, schedule: 'weekly', retention: 7 },
    mostRecent: { createdAt: last },
    nowMs: NOW,
  });
  assert.equal(r.make, false);
});

test('weekly: due 7 days after last', () => {
  const last = new Date(NOW - 7 * DAY).toISOString();
  const r = shouldMakeBackup({
    settings: { enabled: true, schedule: 'weekly', retention: 7 },
    mostRecent: { createdAt: last },
    nowMs: NOW,
  });
  assert.equal(r.make, true);
});

test('returns false on malformed createdAt', () => {
  const r = shouldMakeBackup({
    settings: { enabled: true, schedule: 'daily', retention: 7 },
    mostRecent: { createdAt: 'not a date' },
    nowMs: NOW,
  });
  assert.equal(r.make, false);
  assert.match(r.reason, /invalid createdAt/);
});

// ---- Lifecycle wrapper --------------------------------------------------

console.log('');
console.log('Backup scheduler — lifecycle');

test('startBackupScheduler returns stop() and tickNow()', () => {
  const handle = startBackupScheduler({
    backupsStore: { list: () => [], create: () => ({}), pruneToKeep: () => [] },
    orgSettingsStore: { get: () => ({ backups: { enabled: false, schedule: 'off', retention: 7 } }) },
    serverState: { restoreCompleted: false },
    logger: null,
    checkIntervalMs: 1_000_000_000, // never actually fires during the test
  });
  assert.equal(typeof handle.stop, 'function');
  assert.equal(typeof handle.tickNow, 'function');
  handle.stop();
});

test('tickNow does nothing when scheduling is disabled', () => {
  let createCalls = 0;
  const handle = startBackupScheduler({
    backupsStore: { list: () => [], create: () => { createCalls++; return {}; }, pruneToKeep: () => [] },
    orgSettingsStore: { get: () => ({ backups: { enabled: false, schedule: 'off', retention: 7 } }) },
    serverState: { restoreCompleted: false },
    logger: null,
    checkIntervalMs: 1_000_000_000,
  });
  handle.tickNow();
  assert.equal(createCalls, 0);
  handle.stop();
});

test('tickNow calls create() and pruneToKeep() when a backup is due', () => {
  let createCalls = 0;
  let pruneCalls = [];
  const handle = startBackupScheduler({
    backupsStore: {
      list: () => [],
      create: () => { createCalls++; return { id: 'x', filename: 'x.bak' }; },
      pruneToKeep: (n) => { pruneCalls.push(n); return []; },
    },
    orgSettingsStore: { get: () => ({ backups: { enabled: true, schedule: 'daily', retention: 5 } }) },
    serverState: { restoreCompleted: false },
    logger: null,
    checkIntervalMs: 1_000_000_000,
  });
  handle.tickNow();
  assert.equal(createCalls, 1, 'should make exactly one backup');
  assert.deepEqual(pruneCalls, [5], 'should prune to retention');
  handle.stop();
});

test('tickNow skips when serverState.restoreCompleted is true', () => {
  let createCalls = 0;
  const handle = startBackupScheduler({
    backupsStore: { list: () => [], create: () => { createCalls++; return {}; }, pruneToKeep: () => [] },
    orgSettingsStore: { get: () => ({ backups: { enabled: true, schedule: 'hourly', retention: 7 } }) },
    serverState: { restoreCompleted: true },
    logger: null,
    checkIntervalMs: 1_000_000_000,
  });
  handle.tickNow();
  assert.equal(createCalls, 0, 'restore lockdown should suppress scheduled backups');
  handle.stop();
});

test('tickNow swallows errors from backupsStore.create() (does not throw)', () => {
  const handle = startBackupScheduler({
    backupsStore: {
      list: () => [],
      create: () => { throw new Error('disk full'); },
      pruneToKeep: () => [],
    },
    orgSettingsStore: { get: () => ({ backups: { enabled: true, schedule: 'daily', retention: 7 } }) },
    serverState: { restoreCompleted: false },
    logger: null,
    checkIntervalMs: 1_000_000_000,
  });
  // Should not throw — scheduler is best-effort.
  handle.tickNow();
  handle.stop();
});

test('falls back to retention=7 when settings.retention is missing', () => {
  let pruneCalls = [];
  const handle = startBackupScheduler({
    backupsStore: {
      list: () => [],
      create: () => ({ id: 'x', filename: 'x.bak' }),
      pruneToKeep: (n) => { pruneCalls.push(n); return []; },
    },
    orgSettingsStore: { get: () => ({ backups: { enabled: true, schedule: 'daily' } }) },
    serverState: { restoreCompleted: false },
    logger: null,
    checkIntervalMs: 1_000_000_000,
  });
  handle.tickNow();
  assert.deepEqual(pruneCalls, [7]);
  handle.stop();
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
