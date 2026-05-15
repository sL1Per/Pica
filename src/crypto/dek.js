// src/crypto/dek.js
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const DEK_BYTES = 32;
const TAG_BYTES = 16;
// Prefix prevents AAD collisions if the same slot name is reused in a
// different wrapping context (e.g. a future wrap-format version).
const WRAP_AAD_PREFIX = 'pica-dek-wrap-v1:';

function aadFor(slot) {
  return Buffer.from(WRAP_AAD_PREFIX + slot, 'utf8');
}

/** Wrap a 32-byte DEK under a 32-byte KEK. Returns base64(IV‖ct‖tag). */
export function wrapDek(dek, kek, slot) {
  if (typeof slot !== 'string' || slot === '') throw new TypeError('slot must be a non-empty string');
  if (!Buffer.isBuffer(dek) || dek.length !== DEK_BYTES) throw new TypeError('dek must be a 32-byte Buffer');
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
  if (typeof slot !== 'string' || slot === '') throw new TypeError('slot must be a non-empty string');
  if (!Buffer.isBuffer(kek) || kek.length !== 32) throw new TypeError('kek must be a 32-byte Buffer');
  const blob = Buffer.from(String(wrappedB64), 'base64');
  const WRAPPED_BYTES = IV_BYTES + DEK_BYTES + TAG_BYTES;
  if (blob.length !== WRAPPED_BYTES) throw new Error(`wrapped DEK must be ${WRAPPED_BYTES} bytes`);
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const ct = blob.subarray(IV_BYTES, blob.length - TAG_BYTES);
  const d = createDecipheriv(ALGO, kek, iv);
  d.setAuthTag(tag);
  d.setAAD(aadFor(slot));
  return Buffer.concat([d.update(ct), d.final()]);
}

// Crockford base32 — excludes I L O U to avoid transcription ambiguity.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function toCrockford(bytes) {
  // Private: only called with randomBytes(20). 160 bits = 32×5 with no
  // remainder, so the trailing partial-symbol branch never fires here;
  // the guard makes a future misuse fail loudly instead of silently.
  if (bytes.length !== 20) throw new RangeError('toCrockford expects exactly 20 bytes');
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = ((value << 8) | b) >>> 0;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out;
}

/** 160-bit recovery code, grouped XXXX-…-XXXX (8 groups of 4). */
export function generateRecoveryCode() {
  return toCrockford(randomBytes(20)).match(/.{1,4}/g).join('-');
}

/** Canonical form fed to scrypt: uppercase, no separators, Crockford-folded (I/L→1, O→0, U→V). */
export function normalizeRecoveryCode(input) {
  return String(input)
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[ILOU]/g, (c) => (c === 'O' ? '0' : c === 'U' ? 'V' : '1'));
}
