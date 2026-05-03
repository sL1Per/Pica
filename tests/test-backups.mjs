#!/usr/bin/env node
/**
 * Tests for the backup archive format and storage module.
 *
 * Run:  node tests/test-backups.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import {
  packBackup, unpackBackup, backupId, BACKUP_MAGIC,
} from '../src/crypto/backup-archive.js';
import { createBackupsStore } from '../src/storage/backups.js';

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

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pica-backups-test-'));
}

function rmRf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* */ }
}

// =========================================================================
// Archive format
// =========================================================================

console.log('Backup archive format');

await test('round trip: pack then unpack returns same entries', () => {
  const key = randomBytes(32);
  const entries = [
    { path: 'config.json',                  data: Buffer.from('{"a":1}') },
    { path: 'data/users.json',              data: Buffer.from('[]') },
    { path: 'data/employees/u1/profile.enc', data: Buffer.from([1, 2, 3, 4, 5]) },
  ];
  const blob = packBackup(entries, key);
  const out = unpackBackup(blob, key);
  assert.equal(out.length, 3);
  for (let i = 0; i < entries.length; i++) {
    assert.equal(out[i].path, entries[i].path);
    assert.ok(out[i].data.equals(entries[i].data), `entry ${i} data mismatch`);
  }
});

await test('round trip: empty entries list', () => {
  const key = randomBytes(32);
  const blob = packBackup([], key);
  const out = unpackBackup(blob, key);
  assert.deepEqual(out, []);
});

await test('round trip: large entry (1 MB binary)', () => {
  const key = randomBytes(32);
  const big = randomBytes(1024 * 1024);
  const blob = packBackup([{ path: 'data/big.bin', data: big }], key);
  const out = unpackBackup(blob, key);
  assert.equal(out.length, 1);
  assert.ok(out[0].data.equals(big));
});

await test('round trip: UTF-8 paths with non-ASCII characters', () => {
  const key = randomBytes(32);
  const entries = [
    { path: 'data/emp/Joâo.json',  data: Buffer.from('hi') },
    { path: 'data/emp/北京.json',   data: Buffer.from('hello') },
  ];
  const blob = packBackup(entries, key);
  const out = unpackBackup(blob, key);
  assert.equal(out[0].path, 'data/emp/Joâo.json');
  assert.equal(out[1].path, 'data/emp/北京.json');
});

await test('blob starts with PICA_BACKUP_V1 magic', () => {
  const key = randomBytes(32);
  const blob = packBackup([], key);
  assert.ok(blob.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC));
});

await test('two backups with same key produce different ciphertexts', () => {
  // The HKDF salt + GCM IV are both random per-call, so two backups
  // of the same data should not be byte-identical even with the same
  // master key. Important for confidentiality (no rainbow tables on
  // backup blobs).
  const key = randomBytes(32);
  const entries = [{ path: 'a.json', data: Buffer.from('payload') }];
  const a = packBackup(entries, key);
  const b = packBackup(entries, key);
  assert.notEqual(a.toString('hex'), b.toString('hex'));
});

await test('unpack throws on wrong key', () => {
  const key = randomBytes(32);
  const blob = packBackup([{ path: 'x', data: Buffer.from('y') }], key);
  assert.throws(
    () => unpackBackup(blob, randomBytes(32)),
    /backup decryption failed/,
  );
});

await test('unpack throws on bit-flip in ciphertext', () => {
  const key = randomBytes(32);
  const blob = packBackup([{ path: 'x', data: Buffer.from('y') }], key);
  // Flip a byte deep in the ciphertext (past the magic + salt + IV)
  const tampered = Buffer.from(blob);
  tampered[BACKUP_MAGIC.length + 16 + 12 + 5] ^= 0xFF;
  assert.throws(
    () => unpackBackup(tampered, key),
    /backup decryption failed/,
  );
});

await test('unpack throws on bit-flip in magic header', () => {
  const key = randomBytes(32);
  const blob = packBackup([{ path: 'x', data: Buffer.from('y') }], key);
  const tampered = Buffer.from(blob);
  tampered[0] = 0x00; // mangle magic
  assert.throws(
    () => unpackBackup(tampered, key),
    /bad magic/,
  );
});

await test('unpack throws on too-short buffer', () => {
  const key = randomBytes(32);
  assert.throws(
    () => unpackBackup(Buffer.from([1, 2, 3]), key),
    /too short/,
  );
});

await test('packBackup rejects non-Buffer data', () => {
  const key = randomBytes(32);
  assert.throws(
    () => packBackup([{ path: 'x', data: 'not-a-buffer' }], key),
    /Buffer/,
  );
});

await test('packBackup rejects empty path', () => {
  const key = randomBytes(32);
  assert.throws(
    () => packBackup([{ path: '', data: Buffer.from('') }], key),
    /non-empty/,
  );
});

await test('packBackup rejects wrong-size key', () => {
  assert.throws(
    () => packBackup([], Buffer.alloc(16)),
    /32-byte/,
  );
});

await test('backupId is stable for identical buffer', () => {
  const buf = Buffer.from([1, 2, 3, 4, 5]);
  assert.equal(backupId(buf), backupId(buf));
});

await test('backupId differs for different buffers', () => {
  assert.notEqual(
    backupId(Buffer.from('a')),
    backupId(Buffer.from('b')),
  );
});

// =========================================================================
// Storage module
// =========================================================================

console.log('');
console.log('Backups storage');

await test('list() returns empty array on empty backups directory', () => {
  const tmp = tmpDir();
  try {
    const store = createBackupsStore({
      dataDir: path.join(tmp, 'data'),
      backupsDir: path.join(tmp, 'backups'),
      configPath: path.join(tmp, 'config.json'),
      masterKey: randomBytes(32),
    });
    assert.deepEqual(store.list(), []);
  } finally {
    rmRf(tmp);
  }
});

await test('create() includes config.json and all data files', () => {
  const tmp = tmpDir();
  try {
    fs.mkdirSync(path.join(tmp, 'data', 'employees', 'u1'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'data', 'users.json'), '[{}]');
    fs.writeFileSync(path.join(tmp, 'data', 'employees', 'u1', 'profile.enc'),
                     Buffer.from([1, 2, 3]));
    fs.writeFileSync(path.join(tmp, 'config.json'), '{}');

    const masterKey = randomBytes(32);
    const store = createBackupsStore({
      dataDir: path.join(tmp, 'data'),
      backupsDir: path.join(tmp, 'backups'),
      configPath: path.join(tmp, 'config.json'),
      masterKey,
    });
    const created = store.create();
    assert.equal(created.entryCount, 3);

    const read = store.read(created.id);
    const entries = unpackBackup(read.bytes, masterKey);
    const paths = entries.map((e) => e.path).sort();
    assert.deepEqual(paths, [
      'config.json',
      'data/employees/u1/profile.enc',
      'data/users.json',
    ]);
  } finally {
    rmRf(tmp);
  }
});

await test('create() produces valid filename format', () => {
  const tmp = tmpDir();
  try {
    fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'data', 'x.json'), '{}');
    fs.writeFileSync(path.join(tmp, 'config.json'), '{}');
    const store = createBackupsStore({
      dataDir: path.join(tmp, 'data'),
      backupsDir: path.join(tmp, 'backups'),
      configPath: path.join(tmp, 'config.json'),
      masterKey: randomBytes(32),
    });
    const created = store.create();
    // pica-backup-YYYY-MM-DDTHHMMSSZ-<id8>.bak
    assert.match(created.filename, /^pica-backup-\d{4}-\d{2}-\d{2}T\d{6}Z-[0-9a-f]{8}\.bak$/);
  } finally {
    rmRf(tmp);
  }
});

await test('create() works when data directory does not exist yet', () => {
  // Edge case: brand-new install, dataDir hasn't been created. Backup
  // should still succeed (just produces a backup with only config.json).
  const tmp = tmpDir();
  try {
    fs.writeFileSync(path.join(tmp, 'config.json'), '{}');
    const store = createBackupsStore({
      dataDir: path.join(tmp, 'data'),  // doesn't exist
      backupsDir: path.join(tmp, 'backups'),
      configPath: path.join(tmp, 'config.json'),
      masterKey: randomBytes(32),
    });
    const created = store.create();
    assert.equal(created.entryCount, 1);
  } finally {
    rmRf(tmp);
  }
});

await test('list() returns newest first', async () => {
  const tmp = tmpDir();
  try {
    fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'data', 'x.json'), '{}');
    fs.writeFileSync(path.join(tmp, 'config.json'), '{}');
    const store = createBackupsStore({
      dataDir: path.join(tmp, 'data'),
      backupsDir: path.join(tmp, 'backups'),
      configPath: path.join(tmp, 'config.json'),
      masterKey: randomBytes(32),
    });
    const a = store.create();
    // Wait a full second so the second timestamp differs (filename
    // resolution is 1s).
    await new Promise((r) => setTimeout(r, 1100));
    fs.writeFileSync(path.join(tmp, 'data', 'x.json'), '{"changed":true}');
    const b = store.create();

    const list = store.list();
    assert.equal(list.length, 2);
    assert.equal(list[0].id, b.id, 'newest should be first');
    assert.equal(list[1].id, a.id);
  } finally {
    rmRf(tmp);
  }
});

await test('list() ignores files without the backup naming convention', () => {
  const tmp = tmpDir();
  try {
    fs.mkdirSync(path.join(tmp, 'backups'), { recursive: true });
    // Drop a stray file in the backups directory
    fs.writeFileSync(path.join(tmp, 'backups', 'README.txt'), 'not a backup');
    fs.writeFileSync(path.join(tmp, 'backups', 'random.bak'), Buffer.from([0]));
    fs.writeFileSync(path.join(tmp, 'config.json'), '{}');
    const store = createBackupsStore({
      dataDir: path.join(tmp, 'data'),
      backupsDir: path.join(tmp, 'backups'),
      configPath: path.join(tmp, 'config.json'),
      masterKey: randomBytes(32),
    });
    assert.deepEqual(store.list(), []);  // strays ignored

    store.create();
    const list = store.list();
    assert.equal(list.length, 1);  // only the real one
  } finally {
    rmRf(tmp);
  }
});

await test('read(id) returns null for unknown id', () => {
  const tmp = tmpDir();
  try {
    fs.writeFileSync(path.join(tmp, 'config.json'), '{}');
    const store = createBackupsStore({
      dataDir: path.join(tmp, 'data'),
      backupsDir: path.join(tmp, 'backups'),
      configPath: path.join(tmp, 'config.json'),
      masterKey: randomBytes(32),
    });
    assert.equal(store.read('00000000'), null);
  } finally {
    rmRf(tmp);
  }
});

await test('read(id) returns null for malformed id', () => {
  const tmp = tmpDir();
  try {
    fs.writeFileSync(path.join(tmp, 'config.json'), '{}');
    const store = createBackupsStore({
      dataDir: path.join(tmp, 'data'),
      backupsDir: path.join(tmp, 'backups'),
      configPath: path.join(tmp, 'config.json'),
      masterKey: randomBytes(32),
    });
    assert.equal(store.read('not-hex'), null);
    assert.equal(store.read('../../etc/passwd'), null);
    assert.equal(store.read(''), null);
  } finally {
    rmRf(tmp);
  }
});

await test('full pipeline: create, list, read, unpack matches original files', () => {
  const tmp = tmpDir();
  try {
    fs.mkdirSync(path.join(tmp, 'data', 'punches', '2026'), { recursive: true });
    const usersJson = '[{"id":"u1","username":"alice"}]';
    const punches = '{"id":"p1","ts":"2026-05-01T08:00:00Z"}\n{"id":"p2","ts":"2026-05-01T17:00:00Z"}';
    const config = '{"security":{"verifier":"abc"}}';
    fs.writeFileSync(path.join(tmp, 'data', 'users.json'), usersJson);
    fs.writeFileSync(path.join(tmp, 'data', 'punches', '2026', '05.ndjson'), punches);
    fs.writeFileSync(path.join(tmp, 'config.json'), config);

    const masterKey = randomBytes(32);
    const store = createBackupsStore({
      dataDir: path.join(tmp, 'data'),
      backupsDir: path.join(tmp, 'backups'),
      configPath: path.join(tmp, 'config.json'),
      masterKey,
    });
    const created = store.create();
    const found = store.list().find((b) => b.id === created.id);
    assert.ok(found, 'created backup must appear in list');

    const read = store.read(created.id);
    const entries = unpackBackup(read.bytes, masterKey);
    const map = Object.fromEntries(entries.map((e) => [e.path, e.data.toString('utf8')]));
    assert.equal(map['config.json'], config);
    assert.equal(map['data/users.json'], usersJson);
    assert.equal(map['data/punches/2026/05.ndjson'], punches);
  } finally {
    rmRf(tmp);
  }
});

// =========================================================================
// Drop 2: delete, restore, pruneToKeep
// =========================================================================

console.log('');
console.log('Backups storage — Drop 2');

await test('delete(id) removes the file and returns true', () => {
  const tmp = tmpDir();
  try {
    fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'data', 'x.json'), '{}');
    fs.writeFileSync(path.join(tmp, 'config.json'), '{}');
    const store = createBackupsStore({
      dataDir: path.join(tmp, 'data'),
      backupsDir: path.join(tmp, 'backups'),
      configPath: path.join(tmp, 'config.json'),
      masterKey: randomBytes(32),
    });
    const created = store.create();
    assert.equal(store.list().length, 1);
    assert.equal(store.delete(created.id), true);
    assert.equal(store.list().length, 0);
  } finally {
    rmRf(tmp);
  }
});

await test('delete(id) returns false for unknown id', () => {
  const tmp = tmpDir();
  try {
    fs.writeFileSync(path.join(tmp, 'config.json'), '{}');
    const store = createBackupsStore({
      dataDir: path.join(tmp, 'data'),
      backupsDir: path.join(tmp, 'backups'),
      configPath: path.join(tmp, 'config.json'),
      masterKey: randomBytes(32),
    });
    assert.equal(store.delete('00000000'), false);
  } finally {
    rmRf(tmp);
  }
});

await test('delete(id) refuses non-hex id (no path traversal)', () => {
  const tmp = tmpDir();
  try {
    fs.writeFileSync(path.join(tmp, 'config.json'), '{}');
    const store = createBackupsStore({
      dataDir: path.join(tmp, 'data'),
      backupsDir: path.join(tmp, 'backups'),
      configPath: path.join(tmp, 'config.json'),
      masterKey: randomBytes(32),
    });
    assert.equal(store.delete('../etc/passwd'), false);
    assert.equal(store.delete('not-hex'), false);
    assert.equal(store.delete(''), false);
  } finally {
    rmRf(tmp);
  }
});

await test('pruneToKeep(N) keeps the newest N backups', async () => {
  const tmp = tmpDir();
  try {
    fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'config.json'), '{}');
    const store = createBackupsStore({
      dataDir: path.join(tmp, 'data'),
      backupsDir: path.join(tmp, 'backups'),
      configPath: path.join(tmp, 'config.json'),
      masterKey: randomBytes(32),
    });
    // Create 4 backups, with a small wait so timestamps differ.
    const created = [];
    for (let i = 0; i < 4; i++) {
      fs.writeFileSync(path.join(tmp, 'data', 'mark.json'), JSON.stringify({ i }));
      created.push(store.create());
      await new Promise((r) => setTimeout(r, 1100));
    }
    const deleted = store.pruneToKeep(2);
    assert.equal(deleted.length, 2);
    const remaining = store.list();
    assert.equal(remaining.length, 2);
    // The two kept should be the newest two (last two created).
    const remainingIds = new Set(remaining.map((b) => b.id));
    assert.ok(remainingIds.has(created[3].id), 'newest kept');
    assert.ok(remainingIds.has(created[2].id), 'second-newest kept');
  } finally {
    rmRf(tmp);
  }
});

await test('pruneToKeep(0) deletes all backups', () => {
  const tmp = tmpDir();
  try {
    fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'config.json'), '{}');
    const store = createBackupsStore({
      dataDir: path.join(tmp, 'data'),
      backupsDir: path.join(tmp, 'backups'),
      configPath: path.join(tmp, 'config.json'),
      masterKey: randomBytes(32),
    });
    store.create();
    store.create();
    const deleted = store.pruneToKeep(0);
    assert.equal(deleted.length, 2);
    assert.equal(store.list().length, 0);
  } finally {
    rmRf(tmp);
  }
});

await test('pruneToKeep with N >= count is a no-op', () => {
  const tmp = tmpDir();
  try {
    fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'config.json'), '{}');
    const store = createBackupsStore({
      dataDir: path.join(tmp, 'data'),
      backupsDir: path.join(tmp, 'backups'),
      configPath: path.join(tmp, 'config.json'),
      masterKey: randomBytes(32),
    });
    store.create();
    const deleted = store.pruneToKeep(99);
    assert.equal(deleted.length, 0);
    assert.equal(store.list().length, 1);
  } finally {
    rmRf(tmp);
  }
});

await test('pruneToKeep treats negative/NaN as 0 (deletes everything)', () => {
  const tmp = tmpDir();
  try {
    fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'config.json'), '{}');
    const store = createBackupsStore({
      dataDir: path.join(tmp, 'data'),
      backupsDir: path.join(tmp, 'backups'),
      configPath: path.join(tmp, 'config.json'),
      masterKey: randomBytes(32),
    });
    store.create();
    assert.equal(store.pruneToKeep(-5).length, 1);
    assert.equal(store.list().length, 0);
  } finally {
    rmRf(tmp);
  }
});

await test('restore: round-trip restores the data dir to backup state', () => {
  const tmp = tmpDir();
  try {
    fs.mkdirSync(path.join(tmp, 'data', 'employees', 'u1'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'data', 'users.json'), '[{"id":"u1"}]');
    fs.writeFileSync(path.join(tmp, 'data', 'employees', 'u1', 'profile.enc'),
                     Buffer.from([10, 20, 30]));
    fs.writeFileSync(path.join(tmp, 'config.json'), '{"orig":true}');

    const masterKey = randomBytes(32);
    const store = createBackupsStore({
      dataDir: path.join(tmp, 'data'),
      backupsDir: path.join(tmp, 'backups'),
      configPath: path.join(tmp, 'config.json'),
      masterKey,
    });
    const created = store.create();

    // Mutate
    fs.writeFileSync(path.join(tmp, 'data', 'users.json'), '[{"id":"u999"}]');
    fs.unlinkSync(path.join(tmp, 'data', 'employees', 'u1', 'profile.enc'));

    // Restore
    const blob = store.read(created.id).bytes;
    const result = store.restore(blob);

    assert.equal(result.restoredEntries, 2);  // users.json + profile.enc
    assert.equal(result.configRestored, false);

    // Verify
    const usersBack = fs.readFileSync(path.join(tmp, 'data', 'users.json'), 'utf8');
    const profileBack = fs.readFileSync(path.join(tmp, 'data', 'employees', 'u1', 'profile.enc'));
    assert.equal(usersBack, '[{"id":"u1"}]');
    assert.deepEqual(Array.from(profileBack), [10, 20, 30]);

    // config.json untouched
    const configContents = fs.readFileSync(path.join(tmp, 'config.json'), 'utf8');
    assert.equal(configContents, '{"orig":true}');

    // Pre-restore folder kept
    assert.ok(fs.existsSync(result.preRestorePath), 'pre-restore folder should exist');
  } finally {
    // Clean up the staging/pre-restore folders
    rmRf(tmp);
  }
});

await test('restore: throws on wrong key', () => {
  const tmp = tmpDir();
  try {
    fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'data', 'x.json'), '{}');
    fs.writeFileSync(path.join(tmp, 'config.json'), '{}');
    const realKey = randomBytes(32);
    const wrongKey = randomBytes(32);
    const store = createBackupsStore({
      dataDir: path.join(tmp, 'data'),
      backupsDir: path.join(tmp, 'backups'),
      configPath: path.join(tmp, 'config.json'),
      masterKey: realKey,
    });
    const created = store.create();
    const blob = store.read(created.id).bytes;
    const wrongKeyStore = createBackupsStore({
      dataDir: path.join(tmp, 'data'),
      backupsDir: path.join(tmp, 'backups'),
      configPath: path.join(tmp, 'config.json'),
      masterKey: wrongKey,
    });
    assert.throws(
      () => wrongKeyStore.restore(blob),
      /decryption failed/,
    );
  } finally {
    rmRf(tmp);
  }
});

await test('restore: rejects malicious paths (../, absolute, backslash)', () => {
  const tmp = tmpDir();
  try {
    fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'config.json'), '{}');
    const masterKey = randomBytes(32);
    const store = createBackupsStore({
      dataDir: path.join(tmp, 'data'),
      backupsDir: path.join(tmp, 'backups'),
      configPath: path.join(tmp, 'config.json'),
      masterKey,
    });

    const malicious = [
      [{ path: '../etc/passwd',       data: Buffer.from('x') }, /parent-directory/],
      [{ path: '/etc/passwd',         data: Buffer.from('x') }, /absolute path/],
      [{ path: 'data/../etc/passwd',  data: Buffer.from('x') }, /parent-directory/],
      [{ path: 'data\\evil.txt',      data: Buffer.from('x') }, /backslash/],
      [{ path: 'unrelated/foo.json',  data: Buffer.from('x') }, /not config\.json and is not under data/],
    ];
    for (const [entry, pattern] of malicious) {
      const blob = packBackup([entry], masterKey);
      assert.throws(
        () => store.restore(blob),
        pattern,
        `expected rejection for path: ${entry.path}`,
      );
    }
  } finally {
    rmRf(tmp);
  }
});

await test('restore: skips config.json (Drop 2 design)', () => {
  const tmp = tmpDir();
  try {
    fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'config.json'), '{"original":true}');
    const masterKey = randomBytes(32);

    // Build a backup that has BOTH config.json and data/x.json
    const blob = packBackup([
      { path: 'config.json',  data: Buffer.from('{"from-backup":true}') },
      { path: 'data/x.json',  data: Buffer.from('{"from-backup":true}') },
    ], masterKey);

    const store = createBackupsStore({
      dataDir: path.join(tmp, 'data'),
      backupsDir: path.join(tmp, 'backups'),
      configPath: path.join(tmp, 'config.json'),
      masterKey,
    });
    const result = store.restore(blob);

    // config.json on disk should still be the original
    assert.equal(
      fs.readFileSync(path.join(tmp, 'config.json'), 'utf8'),
      '{"original":true}',
    );
    // data/x.json should be from the backup
    assert.equal(
      fs.readFileSync(path.join(tmp, 'data', 'x.json'), 'utf8'),
      '{"from-backup":true}',
    );
    assert.equal(result.configRestored, false);
    assert.equal(result.restoredEntries, 1); // only data/x.json counted
  } finally {
    rmRf(tmp);
  }
});

await test('restore: works when data dir does not exist yet (fresh restore)', () => {
  const tmp = tmpDir();
  try {
    fs.writeFileSync(path.join(tmp, 'config.json'), '{}');
    const masterKey = randomBytes(32);
    // No data dir created.
    const blob = packBackup([
      { path: 'data/users.json', data: Buffer.from('[]') },
    ], masterKey);
    const store = createBackupsStore({
      dataDir: path.join(tmp, 'data'),
      backupsDir: path.join(tmp, 'backups'),
      configPath: path.join(tmp, 'config.json'),
      masterKey,
    });
    const result = store.restore(blob);
    assert.equal(result.restoredEntries, 1);
    assert.equal(result.preRestorePath, null, 'no pre-restore path when nothing existed');
    assert.equal(fs.readFileSync(path.join(tmp, 'data', 'users.json'), 'utf8'), '[]');
  } finally {
    rmRf(tmp);
  }
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
