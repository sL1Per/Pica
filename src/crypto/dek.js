// src/crypto/dek.js
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const WRAP_AAD_PREFIX = 'pica-dek-wrap-v1:';

function aadFor(slot) {
  return Buffer.from(WRAP_AAD_PREFIX + slot, 'utf8');
}

/** Wrap a 32-byte DEK under a 32-byte KEK. Returns base64(IV‖ct‖tag). */
export function wrapDek(dek, kek, slot) {
  if (!Buffer.isBuffer(dek) || dek.length !== 32) throw new TypeError('dek must be a 32-byte Buffer');
  if (!Buffer.isBuffer(kek) || kek.length !== 32) throw new TypeError('kek must be a 32-byte Buffer');
  const iv = randomBytes(IV_BYTES);
  const c = createCipheriv(ALGO, kek, iv);
  c.setAAD(aadFor(slot));
  const ct = Buffer.concat([c.update(dek), c.final()]);
  const tag = c.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString('base64');
}

/** Unwrap. Throws on wrong KEK or wrong slot (GCM auth failure). */
export function unwrapDek(wrappedB64, kek, slot) {
  if (!Buffer.isBuffer(kek) || kek.length !== 32) throw new TypeError('kek must be a 32-byte Buffer');
  const blob = Buffer.from(String(wrappedB64), 'base64');
  if (blob.length < IV_BYTES + TAG_BYTES + 1) throw new Error('wrapped DEK too short');
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const ct = blob.subarray(IV_BYTES, blob.length - TAG_BYTES);
  const d = createDecipheriv(ALGO, kek, iv);
  d.setAuthTag(tag);
  d.setAAD(aadFor(slot));
  return Buffer.concat([d.update(ct), d.final()]);
}
