import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM at rest.
 *
 * Blob format (binary):   IV(12) || ciphertext || TAG(16)
 * Field format (string):  base64( IV(12) || ciphertext || TAG(16) )
 *
 * Each call uses a fresh random 12-byte IV. The 16-byte auth tag is
 * verified on decrypt; tampering or key mismatch throws.
 *
 * AAD (additional authenticated data) is optional and binds a ciphertext
 * to some context — e.g., an employee ID — so an attacker with file
 * access can't swap ciphertexts between records. When used, the same
 * AAD must be supplied on decrypt.
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALGO = 'aes-256-gcm';

function asAAD(aad) {
  if (aad == null) return null;
  if (Buffer.isBuffer(aad)) return aad;
  if (typeof aad === 'string') return Buffer.from(aad, 'utf8');
  throw new TypeError('AAD must be a Buffer, string, or nullish');
}

function requireKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new TypeError('Encryption key must be a 32-byte Buffer');
  }
}

/**
 * Encrypt a Buffer. Returns IV || ciphertext || TAG.
 */
export function encryptBlob(plaintext, key, aad = null) {
  requireKey(key);
  if (!Buffer.isBuffer(plaintext)) {
    throw new TypeError('encryptBlob expects a Buffer');
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const aadBuf = asAAD(aad);
  if (aadBuf) cipher.setAAD(aadBuf);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]);
}

/**
 * Decrypt a Buffer produced by encryptBlob. Throws on auth failure.
 */
export function decryptBlob(blob, key, aad = null) {
  requireKey(key);
  if (!Buffer.isBuffer(blob) || blob.length < IV_BYTES + TAG_BYTES) {
    throw new Error('Invalid ciphertext: too short');
  }
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const ct = blob.subarray(IV_BYTES, blob.length - TAG_BYTES);

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const aadBuf = asAAD(aad);
  if (aadBuf) decipher.setAAD(aadBuf);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/**
 * Encrypt a UTF-8 string to a base64 string suitable for JSON.
 */
export function encryptField(plaintext, key, aad = null) {
  if (typeof plaintext !== 'string') {
    throw new TypeError('encryptField expects a string');
  }
  return encryptBlob(Buffer.from(plaintext, 'utf8'), key, aad).toString('base64');
}

/**
 * Decrypt a base64 string produced by encryptField. Returns UTF-8 text.
 */
export function decryptField(ciphertext, key, aad = null) {
  if (typeof ciphertext !== 'string') {
    throw new TypeError('decryptField expects a base64 string');
  }
  const blob = Buffer.from(ciphertext, 'base64');
  return decryptBlob(blob, key, aad).toString('utf8');
}
