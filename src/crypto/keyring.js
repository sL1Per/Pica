// src/crypto/keyring.js
import { scrypt, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import fs from 'node:fs';

const scryptAsync = promisify(scrypt);

// Heavy scrypt params — identical to the original master-key KDF so a
// migrated install's frozen DEK keeps exactly its historical strength.
export const KDF = Object.freeze({
  algorithm: 'scrypt',
  cost: 1 << 17,        // N = 131072
  blockSize: 8,         // r
  parallelization: 1,   // p
  keylen: 32,
  saltBytes: 32,           // controls newKdf() salt length only; not stored per-slot
  maxmem: 512 * 1024 * 1024,
});

/** A new per-slot KDF descriptor with a fresh random salt. */
export function newKdf() {
  return {
    algorithm: 'scrypt',
    salt: randomBytes(KDF.saltBytes).toString('hex'),
    cost: KDF.cost,
    blockSize: KDF.blockSize,
    parallelization: KDF.parallelization,
  };
}

/** Derive a 32-byte KEK from a secret + a stored KDF descriptor. */
export async function deriveKek(secret, kdf) {
  return scryptAsync(secret, Buffer.from(kdf.salt, 'hex'), KDF.keylen, {
    cost: kdf.cost,
    blockSize: kdf.blockSize,
    parallelization: kdf.parallelization,
    maxmem: KDF.maxmem,
  });
}

/** 'none' (no security yet) | 'v1' (legacy verifier) | 'v2' (envelope) | 'unknown'. */
export function detectFormat(security) {
  if (!security || (!security.kdf && !security.wraps)) return 'none';
  if (security.version === 2 && security.wraps) return 'v2';
  if (security.verifier && security.kdf) return 'v1';
  return 'unknown';
}

export function setSlot(security, slot, kdf, wrappedB64, extra = {}) {
  security.version = 2;
  if (!security.wraps) security.wraps = {};
  security.wraps[slot] = { kdf, wrapped: wrappedB64, ...extra };
  delete security.verifier; // legacy v1 field — the GCM tag is the verifier now
  delete security.kdf;      // legacy v1 top-level kdf
}

export function getSlot(security, slot) {
  return security && security.wraps ? security.wraps[slot] : undefined;
}

export function removeSlot(security, slot) {
  if (security && security.wraps) delete security.wraps[slot];
}

/** Atomic config write: .tmp then rename. A crash leaves the original intact. */
export function writeConfigAtomic(configPath, config) {
  const tmp = configPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  // writeFileSync's mode is ignored when tmp already exists (e.g. a stale
  // file from a prior crash); enforce 0600 before the secret-bearing
  // config is renamed into place.
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, configPath);
}
