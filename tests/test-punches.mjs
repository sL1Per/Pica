#!/usr/bin/env node
/**
 * M4 smoke tests — punches storage layer.
 * Built-in `assert` only, no test framework.
 *
 * Run:  node tests/test-punches.mjs
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createPunchesStore } from '../src/storage/punches.js';

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-punch-'));
const masterKey = randomBytes(32);

try {
  const store = createPunchesStore(tmpDir, masterKey);
  const aliceId = 'alice-uuid';
  const bobId   = 'bob-uuid';

  // --------------------------------------------------------------------------
  console.log('Construction');
  // --------------------------------------------------------------------------

  await test('requires a 32-byte master key', () => {
    assert.throws(() => createPunchesStore(tmpDir, randomBytes(16)));
  });

  await test('creates punches directory tree', () => {
    assert.ok(fs.existsSync(path.join(tmpDir, 'punches')));
  });

  // --------------------------------------------------------------------------
  console.log('\nAppend and read');
  // --------------------------------------------------------------------------

  await test('append writes a line and returns the record', () => {
    const ts = '2026-04-19T09:00:00.000Z';
    const r = store.append(aliceId, { type: 'in', ts, comment: 'morning shift' });
    assert.equal(r.type, 'in');
    assert.equal(r.ts, ts);
    assert.equal(r.comment, 'morning shift');
    assert.equal(r.geo, null);
  });

  await test('file is partitioned by year/month/employee', () => {
    const filePath = path.join(tmpDir, 'punches', '2026', '04', `${aliceId}.ndjson`);
    assert.ok(fs.existsSync(filePath));
  });

  await test('plaintext fields ts and type are visible on disk', () => {
    const filePath = path.join(tmpDir, 'punches', '2026', '04', `${aliceId}.ndjson`);
    const contents = fs.readFileSync(filePath, 'utf8');
    assert.match(contents, /"ts":"2026-04-19T09:00:00.000Z"/);
    assert.match(contents, /"type":"in"/);
  });

  await test('comment is NOT visible on disk', () => {
    const filePath = path.join(tmpDir, 'punches', '2026', '04', `${aliceId}.ndjson`);
    const contents = fs.readFileSync(filePath, 'utf8');
    assert.equal(contents.includes('morning shift'), false);
  });

  await test('read decrypts comment and returns shape { employeeId, ts, type, comment, geo }', () => {
    const list = store.listDay(aliceId, '2026-04-19');
    assert.equal(list.length, 1);
    const p = list[0];
    assert.equal(p.employeeId, aliceId);
    assert.equal(p.comment, 'morning shift');
    assert.equal(p.geo, null);
  });

  await test('append with geo encrypts and round-trips correctly', () => {
    store.append(aliceId, {
      type: 'out',
      ts: '2026-04-19T17:30:00.000Z',
      comment: 'end of day',
      geo: { lat: 38.7223, lng: -9.1393, accuracy: 20 },
    });
    const list = store.listDay(aliceId, '2026-04-19');
    assert.equal(list.length, 2);
    const out = list[1];
    assert.equal(out.type, 'out');
    assert.equal(out.comment, 'end of day');
    assert.deepEqual(out.geo, { lat: 38.7223, lng: -9.1393, accuracy: 20 });
  });

  await test('append without comment or geo omits enc field', () => {
    store.append(bobId, { type: 'in', ts: '2026-04-19T08:15:00.000Z' });
    const filePath = path.join(tmpDir, 'punches', '2026', '04', `${bobId}.ndjson`);
    const line = fs.readFileSync(filePath, 'utf8').trim();
    const parsed = JSON.parse(line);
    assert.equal(parsed.enc, undefined);
  });

  await test('append rejects invalid type', () => {
    assert.throws(() => store.append(aliceId, { type: 'pause', ts: '2026-04-19T10:00:00.000Z' }));
  });

  await test('append rejects invalid ts', () => {
    assert.throws(() => store.append(aliceId, { type: 'in', ts: 'not-a-date' }));
    assert.throws(() => store.append(aliceId, { type: 'in' }));
  });

  // --------------------------------------------------------------------------
  console.log('\nOpen-punch detection');
  // --------------------------------------------------------------------------

  await test('hasOpenPunch returns true after a clock-in with no following clock-out', () => {
    // bob has: in @ 08:15 (no out yet)
    const at = new Date('2026-04-19T09:00:00.000Z');
    assert.equal(store.hasOpenPunch(bobId, at), true);
  });

  await test('hasOpenPunch returns false after a clock-out', () => {
    // alice has: in @ 09:00, out @ 17:30
    const at = new Date('2026-04-19T18:00:00.000Z');
    assert.equal(store.hasOpenPunch(aliceId, at), false);
  });

  await test('hasOpenPunch returns false for a user with no punches', () => {
    const at = new Date('2026-04-19T09:00:00.000Z');
    assert.equal(store.hasOpenPunch('ghost-id', at), false);
  });

  await test('latest returns the newest record chronologically', () => {
    const at = new Date('2026-04-19T18:00:00.000Z');
    const last = store.latest(aliceId, at);
    assert.equal(last.type, 'out');
    assert.equal(last.ts, '2026-04-19T17:30:00.000Z');
  });

  // --------------------------------------------------------------------------
  console.log('\nMonth boundary');
  // --------------------------------------------------------------------------

  await test('latest peeks into previous month when current month is empty', () => {
    // Carol clocked in on March 31; we check in early April (no April file yet).
    const carolId = 'carol-uuid';
    store.append(carolId, { type: 'in', ts: '2026-03-31T23:55:00.000Z' });
    const at = new Date('2026-04-01T00:10:00.000Z');
    const last = store.latest(carolId, at);
    assert.ok(last);
    assert.equal(last.type, 'in');
    assert.equal(store.hasOpenPunch(carolId, at), true);
  });

  // --------------------------------------------------------------------------
  console.log('\nAAD binding — tamper resistance');
  // --------------------------------------------------------------------------

  await test('swapping lines between employees breaks decryption', () => {
    // Give dave an encrypted record, then read it back through eve's id.
    const daveId = 'dave-uuid';
    const eveId  = 'eve-uuid';
    store.append(daveId, { type: 'in', ts: '2026-04-19T06:00:00.000Z', comment: 'dave secret' });
    store.append(eveId,  { type: 'in', ts: '2026-04-19T07:00:00.000Z', comment: 'eve secret' });

    // Swap the on-disk files.
    const daveFile = path.join(tmpDir, 'punches', '2026', '04', `${daveId}.ndjson`);
    const eveFile  = path.join(tmpDir, 'punches', '2026', '04', `${eveId}.ndjson`);
    const daveContents = fs.readFileSync(daveFile);
    const eveContents  = fs.readFileSync(eveFile);
    fs.writeFileSync(daveFile, eveContents);
    fs.writeFileSync(eveFile, daveContents);

    // Reading either user now produces decryptFailed records.
    const daveRead = store.listDay(daveId, '2026-04-19');
    assert.equal(daveRead.length, 1);
    assert.equal(daveRead[0].decryptFailed, true);
    assert.equal(daveRead[0].comment, null); // leaked comment NOT returned

    // Restore so later tests aren't disturbed.
    fs.writeFileSync(daveFile, daveContents);
    fs.writeFileSync(eveFile, eveContents);
  });

  // --------------------------------------------------------------------------
  console.log('\nCorruption tolerance');
  // --------------------------------------------------------------------------

  await test('corrupt lines are dropped without failing the whole file', () => {
    const filePath = path.join(tmpDir, 'punches', '2026', '04', `${aliceId}.ndjson`);
    const original = fs.readFileSync(filePath, 'utf8');
    const corrupted = original.trimEnd() + '\nnot-valid-json{{{\n';
    fs.writeFileSync(filePath, corrupted);

    const list = store.listDay(aliceId, '2026-04-19');
    // alice still has her two good records.
    assert.equal(list.length, 2);

    // Restore.
    fs.writeFileSync(filePath, original);
  });

  // --------------------------------------------------------------------------
  console.log('\nDay-across-all-employees');
  // --------------------------------------------------------------------------

  await test('listDayAll returns punches from every employee that day', () => {
    const all = store.listDayAll('2026-04-19');
    const ids = new Set(all.map((p) => p.employeeId));
    // alice, bob, dave, eve all have records on 2026-04-19.
    assert.ok(ids.has(aliceId));
    assert.ok(ids.has(bobId));
    assert.ok(ids.has('dave-uuid'));
    assert.ok(ids.has('eve-uuid'));
    // Results are chronological.
    for (let i = 1; i < all.length; i++) {
      assert.ok(all[i - 1].ts <= all[i].ts);
    }
  });

  await test('listDayAll returns empty when the month dir does not exist', () => {
    assert.deepEqual(store.listDayAll('2020-01-15'), []);
  });

  // --------------------------------------------------------------------------
  console.log('\nPersistence across store instances');
  // --------------------------------------------------------------------------

  await test('second store with same key reads existing punches', () => {
    const fresh = createPunchesStore(tmpDir, masterKey);
    const list = fresh.listDay(aliceId, '2026-04-19');
    assert.equal(list.length, 2);
    assert.equal(list[0].comment, 'morning shift');
  });

  await test('second store with different key yields decryptFailed lines', () => {
    const wrong = createPunchesStore(tmpDir, randomBytes(32));
    const list = wrong.listDay(aliceId, '2026-04-19');
    assert.equal(list.length, 2);
    // Plaintext ts/type still readable — this is by design for reporting.
    assert.equal(list[0].ts, '2026-04-19T09:00:00.000Z');
    assert.equal(list[0].type, 'in');
    // But comment is gone.
    assert.equal(list[0].decryptFailed, true);
    assert.equal(list[0].comment, null);
  });

} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
