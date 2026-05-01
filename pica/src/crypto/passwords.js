import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

/**
 * Password hashing via scrypt.
 *
 * Cost is lower than the master key's KDF because logins happen often.
 * N=32768 gives ~100–200ms on modern hardware — enough to slow brute force,
 * fast enough that login doesn't feel sluggish.
 *
 * Hash format: "scrypt$N$r$p$salt_b64$hash_b64"
 * Encoding everything inline means the verifier never needs separate state.
 */

const PARAMS = Object.freeze({
  cost: 1 << 15, // 32768
  blockSize: 8,
  parallelization: 1,
  keylen: 64,
  saltBytes: 16,
  // scrypt at N=2^15, r=8 needs ~32 MiB. Double that for headroom.
  maxmem: 64 * 1024 * 1024,
});

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new TypeError('Password must be a non-empty string');
  }
  const salt = randomBytes(PARAMS.saltBytes);
  const hash = await scryptAsync(password, salt, PARAMS.keylen, {
    cost: PARAMS.cost,
    blockSize: PARAMS.blockSize,
    parallelization: PARAMS.parallelization,
    maxmem: PARAMS.maxmem,
  });
  return [
    'scrypt',
    PARAMS.cost,
    PARAMS.blockSize,
    PARAMS.parallelization,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

/**
 * Verify a password against a stored hash string.
 * Returns true / false. Never throws for mismatches — only for malformed hashes.
 */
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, costStr, rStr, pStr, saltB64, hashB64] = parts;
  const cost = Number(costStr);
  const blockSize = Number(rStr);
  const parallelization = Number(pStr);
  if (!Number.isInteger(cost) || !Number.isInteger(blockSize) || !Number.isInteger(parallelization)) {
    return false;
  }

  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  if (expected.length === 0) return false;

  const actual = await scryptAsync(password, salt, expected.length, {
    cost,
    blockSize,
    parallelization,
    maxmem: PARAMS.maxmem,
  });

  // timingSafeEqual requires identical-length buffers; we just allocated `actual`
  // to match `expected.length`, so this is safe.
  return timingSafeEqual(actual, expected);
}
