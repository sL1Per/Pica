/**
 * Pica backup archive format.
 *
 *   File layout (bytes):
 *     +------------------------------------------------+
 *     | 16  PICA_BACKUP_V1  (UTF-8 magic + version)    |
 *     | 16  HKDF salt                                  |
 *     | 12  AES-GCM IV                                 |
 *     |  N  Encrypted payload (chunked entries)        |
 *     | 16  GCM auth tag                               |
 *     +------------------------------------------------+
 *
 *   Encrypted payload (after decryption):
 *     +------------------------------------------------+
 *     |  4  entry count (uint32 BE)                    |
 *     | For each entry:                                |
 *     |   2  path length (uint16 BE)                   |
 *     |   N  path (UTF-8)                              |
 *     |   4  data length (uint32 BE)                   |
 *     |   N  data bytes                                |
 *     +------------------------------------------------+
 *
 * Encryption: AES-256-GCM with a key derived from the master key
 * via HKDF using a fresh per-backup salt. AAD is the magic header
 * (16 bytes) so the ciphertext is bound to its declared version.
 *
 * Format is intentionally simple — no compression, no streaming.
 * Pica's data sizes (megabytes for typical orgs) don't justify either.
 */

import { createHash, hkdfSync, randomBytes } from 'node:crypto';

import { encryptBlob, decryptBlob } from './aes.js';

const MAGIC          = Buffer.from('PICA_BACKUP_V1\0\0', 'utf8'); // 16 bytes
const HKDF_SALT_LEN  = 16;
const HKDF_INFO      = Buffer.from('pica-backup-v1', 'utf8');
const HKDF_KEY_LEN   = 32;
const PATH_MAX_BYTES = 65535;             // uint16 limit
const FILE_MAX_BYTES = 200 * 1024 * 1024; // 200 MiB safety cap per entry

/**
 * Derive a backup encryption key from the master key.
 * HKDF with a fresh per-backup salt — two backups made with the same
 * master key produce different encryption keys.
 */
function deriveBackupKey(masterKey, salt) {
  const buf = hkdfSync('sha256', masterKey, salt, HKDF_INFO, HKDF_KEY_LEN);
  return Buffer.from(buf);
}

/**
 * Pack an array of { path, data } entries into a single backup buffer.
 *
 * @param {Array<{path: string, data: Buffer}>} entries
 * @param {Buffer} masterKey 32-byte master key
 * @returns {Buffer} The full backup file contents
 */
export function packBackup(entries, masterKey) {
  if (!Array.isArray(entries)) {
    throw new TypeError('entries must be an array');
  }
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new TypeError('masterKey must be a 32-byte Buffer');
  }

  // Build the plaintext payload.
  const parts = [];
  const count = Buffer.alloc(4);
  count.writeUInt32BE(entries.length, 0);
  parts.push(count);

  for (const entry of entries) {
    if (typeof entry.path !== 'string' || !entry.path) {
      throw new TypeError('each entry must have a non-empty string path');
    }
    if (!Buffer.isBuffer(entry.data)) {
      throw new TypeError(`entry data must be a Buffer (path: ${entry.path})`);
    }

    const pathBuf = Buffer.from(entry.path, 'utf8');
    if (pathBuf.length > PATH_MAX_BYTES) {
      throw new RangeError(`path exceeds ${PATH_MAX_BYTES} bytes: ${entry.path}`);
    }
    if (entry.data.length > FILE_MAX_BYTES) {
      throw new RangeError(`entry exceeds ${FILE_MAX_BYTES} bytes: ${entry.path}`);
    }

    const pathLen = Buffer.alloc(2);
    pathLen.writeUInt16BE(pathBuf.length, 0);
    parts.push(pathLen, pathBuf);

    const dataLen = Buffer.alloc(4);
    dataLen.writeUInt32BE(entry.data.length, 0);
    parts.push(dataLen, entry.data);
  }

  const payload = Buffer.concat(parts);

  // Encrypt with a freshly derived key.
  const salt = randomBytes(HKDF_SALT_LEN);
  const key = deriveBackupKey(masterKey, salt);

  // encryptBlob produces IV || ciphertext || TAG.
  const blob = encryptBlob(payload, key, MAGIC);

  // Final file: MAGIC || SALT || (IV || ciphertext || TAG)
  return Buffer.concat([MAGIC, salt, blob]);
}

/**
 * Unpack a backup buffer back into entries. Throws on:
 *   - invalid/missing magic
 *   - GCM auth failure (wrong key or tampered file)
 *   - structural corruption (bad lengths, truncation)
 *
 * @param {Buffer} buf Full backup file contents
 * @param {Buffer} masterKey 32-byte master key
 * @returns {Array<{path: string, data: Buffer}>}
 */
export function unpackBackup(buf, masterKey) {
  if (!Buffer.isBuffer(buf)) {
    throw new TypeError('backup must be a Buffer');
  }
  if (buf.length < MAGIC.length + HKDF_SALT_LEN + 12 + 16) {
    throw new Error('backup is too short to be valid');
  }
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('not a Pica backup (bad magic)');
  }
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new TypeError('masterKey must be a 32-byte Buffer');
  }

  const salt = buf.subarray(MAGIC.length, MAGIC.length + HKDF_SALT_LEN);
  const blob = buf.subarray(MAGIC.length + HKDF_SALT_LEN);
  const key = deriveBackupKey(masterKey, salt);

  // decryptBlob throws on auth failure. We let it propagate but
  // re-wrap the message so callers see something user-friendly.
  let payload;
  try {
    payload = decryptBlob(blob, key, MAGIC);
  } catch (err) {
    const e = new Error('backup decryption failed (wrong passphrase or corrupted file)');
    e.cause = err;
    throw e;
  }

  // Walk the payload.
  const entries = [];
  let offset = 0;

  if (payload.length < 4) throw new Error('backup payload truncated');
  const count = payload.readUInt32BE(offset);
  offset += 4;

  for (let i = 0; i < count; i++) {
    if (offset + 2 > payload.length) throw new Error(`entry ${i}: path length truncated`);
    const pathLen = payload.readUInt16BE(offset);
    offset += 2;

    if (offset + pathLen > payload.length) throw new Error(`entry ${i}: path truncated`);
    const path = payload.subarray(offset, offset + pathLen).toString('utf8');
    offset += pathLen;

    if (offset + 4 > payload.length) throw new Error(`entry ${i}: data length truncated`);
    const dataLen = payload.readUInt32BE(offset);
    offset += 4;

    if (offset + dataLen > payload.length) throw new Error(`entry ${i}: data truncated`);
    const data = Buffer.from(payload.subarray(offset, offset + dataLen)); // copy out
    offset += dataLen;

    entries.push({ path, data });
  }

  if (offset !== payload.length) {
    throw new Error(`backup payload has ${payload.length - offset} trailing bytes`);
  }

  return entries;
}

/**
 * Compute a SHA-256 hex digest of a backup buffer. Used for integrity
 * display in the UI ("backup ID is the first 8 hex chars of the hash").
 */
export function backupId(buf) {
  return createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

export const BACKUP_MAGIC = MAGIC;
