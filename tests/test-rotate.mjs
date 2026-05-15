// tests/test-rotate.mjs
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { encryptBlob, decryptBlob, encryptField, decryptField } from '../src/crypto/aes.js';
import { rotateData } from '../src/crypto/rotate.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n${e.stack}`); failed++; }
}

function buildTree(root, oldKey) {
  fs.mkdirSync(path.join(root, 'employees'), { recursive: true });
  fs.mkdirSync(path.join(root, 'leaves', 'attachments'), { recursive: true });
  fs.mkdirSync(path.join(root, 'leaves', '2026'), { recursive: true });
  fs.mkdirSync(path.join(root, 'punches', '2026', '04'), { recursive: true });
  fs.mkdirSync(path.join(root, 'audit', '2026'), { recursive: true });

  const eid = '11111111-1111-4111-8111-111111111111';
  fs.writeFileSync(path.join(root, 'employees', `${eid}.json`),
    encryptBlob(Buffer.from('{"name":"A"}'), oldKey, `employee:${eid}`));
  fs.writeFileSync(path.join(root, 'company-logo.bin'),
    encryptBlob(Buffer.from('PNGDATA'), oldKey, 'company:logo'));

  const lid = '22222222-2222-4222-8222-222222222222';
  fs.writeFileSync(path.join(root, 'leaves', 'attachments', lid),
    encryptBlob(Buffer.from('PDFDATA'), oldKey, `leave-attachment:${lid}`));
  fs.writeFileSync(path.join(root, 'leaves', '2026', '05.ndjson'),
    JSON.stringify({ id: lid, type: 'leave.created' }) + '\n' +
    JSON.stringify({ id: lid, type: 'leave.reason_set',
      enc: encryptField(JSON.stringify({ reason: 'flu' }), oldKey, `leave:${lid}`) }) + '\n');

  fs.writeFileSync(path.join(root, 'punches', '2026', '04', `${eid}.ndjson`),
    JSON.stringify({ ts: '2026-04-19T14:07:32.490Z', type: 'in',
      enc: encryptField(JSON.stringify({ comment: 'hi' }), oldKey, `punch:${eid}:2026-04-19T14:07:32.490Z`) }) + '\n');

  fs.writeFileSync(path.join(root, 'audit', '2026', '05.ndjson.enc'),
    encryptBlob(Buffer.from('{"event":"x"}'), oldKey, 'pica-audit-v1').toString('base64') + '\n');

  fs.writeFileSync(path.join(root, 'users.json'), '{"plaintext":true}');
  return { eid, lid };
}

await test('rotate: new key decrypts everything, old key no longer does', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-rot-'));
  const dataDir = path.join(tmp, 'data');
  const staging = path.join(tmp, 'data.staging');
  fs.mkdirSync(dataDir, { recursive: true });
  const oldKey = randomBytes(32);
  const newKey = randomBytes(32);
  const { eid, lid } = buildTree(dataDir, oldKey);

  await rotateData({ dataDir, stagingDir: staging, oldKey, newKey });

  const emp = fs.readFileSync(path.join(staging, 'employees', `${eid}.json`));
  assert.equal(decryptBlob(emp, newKey, `employee:${eid}`).toString(), '{"name":"A"}');
  assert.throws(() => decryptBlob(emp, oldKey, `employee:${eid}`));

  const logo = fs.readFileSync(path.join(staging, 'company-logo.bin'));
  assert.equal(decryptBlob(logo, newKey, 'company:logo').toString(), 'PNGDATA');

  const att = fs.readFileSync(path.join(staging, 'leaves', 'attachments', lid));
  assert.equal(decryptBlob(att, newKey, `leave-attachment:${lid}`).toString(), 'PDFDATA');

  const leaveLines = fs.readFileSync(path.join(staging, 'leaves', '2026', '05.ndjson'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(JSON.parse(decryptField(leaveLines[1].enc, newKey, `leave:${lid}`)).reason, 'flu');

  const punch = JSON.parse(fs.readFileSync(
    path.join(staging, 'punches', '2026', '04', `${eid}.ndjson`), 'utf8').trim());
  assert.equal(JSON.parse(decryptField(punch.enc, newKey,
    `punch:${eid}:2026-04-19T14:07:32.490Z`)).comment, 'hi');

  const auditLine = fs.readFileSync(path.join(staging, 'audit', '2026', '05.ndjson.enc'), 'utf8').trim();
  assert.equal(decryptBlob(Buffer.from(auditLine, 'base64'), newKey, 'pica-audit-v1').toString(),
    '{"event":"x"}');

  assert.equal(fs.readFileSync(path.join(staging, 'users.json'), 'utf8'), '{"plaintext":true}');
  fs.rmSync(tmp, { recursive: true, force: true });
});

await test('rotate preserves structure byte-exactly (no-enc line, 2 audit lines, blank files)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-rot2-'));
  const dataDir = path.join(tmp, 'data');
  const staging = path.join(tmp, 'data.staging');
  fs.mkdirSync(path.join(dataDir, 'leaves', '2026'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'corrections', '2026'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'audit', '2026'), { recursive: true });
  const oldKey = randomBytes(32);
  const newKey = randomBytes(32);

  const lid = '22222222-2222-4222-8222-222222222222';
  const cid = '33333333-3333-4333-8333-333333333333';
  const noEncLine = JSON.stringify({ id: lid, type: 'leave.created' });
  const encLine = JSON.stringify({ id: lid, type: 'leave.reason_set',
    enc: encryptField(JSON.stringify({ reason: 'flu' }), oldKey, `leave:${lid}`) });
  fs.writeFileSync(path.join(dataDir, 'leaves', '2026', '05.ndjson'),
    noEncLine + '\n' + encLine + '\n');

  fs.writeFileSync(path.join(dataDir, 'corrections', '2026', '05.ndjson'),
    JSON.stringify({ id: cid, type: 'correction.created',
      enc: encryptField(JSON.stringify({ justification: 'typo' }), oldKey, `correction:${cid}`) }) + '\n');

  fs.writeFileSync(path.join(dataDir, 'audit', '2026', '05.ndjson.enc'),
    encryptBlob(Buffer.from('{"event":"a"}'), oldKey, 'pica-audit-v1').toString('base64') + '\n' +
    encryptBlob(Buffer.from('{"event":"b"}'), oldKey, 'pica-audit-v1').toString('base64') + '\n');

  fs.writeFileSync(path.join(dataDir, 'newline-only'), '\n');
  fs.writeFileSync(path.join(dataDir, 'empty-file'), '');

  await rotateData({ dataDir, stagingDir: staging, oldKey, newKey });

  const rawLeaves = fs.readFileSync(path.join(staging, 'leaves', '2026', '05.ndjson'), 'utf8');
  const lparts = rawLeaves.split('\n');
  assert.equal(lparts.length, 3);
  assert.equal(lparts[2], '');
  assert.equal(lparts[0], noEncLine);
  const l1 = JSON.parse(lparts[1]);
  assert.equal(l1.id, lid);
  assert.equal(l1.type, 'leave.reason_set');
  assert.equal(JSON.parse(decryptField(l1.enc, newKey, `leave:${lid}`)).reason, 'flu');

  const c = JSON.parse(fs.readFileSync(
    path.join(staging, 'corrections', '2026', '05.ndjson'), 'utf8').split('\n')[0]);
  assert.equal(JSON.parse(decryptField(c.enc, newKey, `correction:${cid}`)).justification, 'typo');

  const rawAudit = fs.readFileSync(path.join(staging, 'audit', '2026', '05.ndjson.enc'), 'utf8');
  const aparts = rawAudit.split('\n');
  assert.equal(aparts.length, 3);
  assert.equal(aparts[2], '');
  assert.equal(decryptBlob(Buffer.from(aparts[0], 'base64'), newKey, 'pica-audit-v1').toString(), '{"event":"a"}');
  assert.equal(decryptBlob(Buffer.from(aparts[1], 'base64'), newKey, 'pica-audit-v1').toString(), '{"event":"b"}');

  assert.equal(fs.readFileSync(path.join(staging, 'newline-only'), 'utf8'), '\n');
  assert.equal(fs.readFileSync(path.join(staging, 'empty-file'), 'utf8'), '');

  fs.rmSync(tmp, { recursive: true, force: true });
});

await test('rotate is fail-safe: corrupt ciphertext aborts, dataDir untouched', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-rot3-'));
  const dataDir = path.join(tmp, 'data');
  const staging = path.join(tmp, 'data.staging');
  fs.mkdirSync(path.join(dataDir, 'employees'), { recursive: true });
  const oldKey = randomBytes(32);
  const newKey = randomBytes(32);
  const eid = '11111111-1111-4111-8111-111111111111';
  const good = encryptBlob(Buffer.from('{"name":"A"}'), oldKey, `employee:${eid}`);
  good[good.length - 1] ^= 0x01; // corrupt the GCM tag
  fs.writeFileSync(path.join(dataDir, 'employees', `${eid}.json`), good);

  const before = fs.readFileSync(path.join(dataDir, 'employees', `${eid}.json`));
  await assert.rejects(() => rotateData({ dataDir, stagingDir: staging, oldKey, newKey }));
  const after = fs.readFileSync(path.join(dataDir, 'employees', `${eid}.json`));
  assert.deepEqual(after, before); // rotateData only ever writes under stagingDir
  fs.rmSync(tmp, { recursive: true, force: true });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
