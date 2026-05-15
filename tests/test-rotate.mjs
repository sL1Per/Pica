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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
