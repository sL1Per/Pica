import { scrypt, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

import { readPassphrase } from './prompt.js';
import { encryptBlob, decryptBlob } from './aes.js';

const scryptAsync = promisify(scrypt);

/**
 * Master key derivation.
 *
 * Heavy scrypt parameters — this is a one-time cost at server startup,
 * so we spend ~1–2 seconds to make a stolen config.json+passphrase-guess
 * attack expensive.
 *
 * Memory required by scrypt at N=2^17, r=8 is 128 * N * r bytes ≈ 128 MiB.
 * We set maxmem generously to give the runtime headroom.
 */
const MASTER_KDF = Object.freeze({
  cost: 1 << 17,            // N = 131072
  blockSize: 8,             // r
  parallelization: 1,       // p
  keylen: 32,               // bytes → AES-256
  saltBytes: 32,
  maxmem: 512 * 1024 * 1024,
});

const VERIFIER_PLAINTEXT = 'pica-verifier-v1';

async function deriveKey(passphrase, salt, params) {
  return scryptAsync(passphrase, salt, params.keylen, {
    cost: params.cost,
    blockSize: params.blockSize,
    parallelization: params.parallelization,
    maxmem: params.maxmem,
  });
}

function readPassphraseFromSource(prompt) {
  if (process.env.PICA_PASSPHRASE) {
    return Promise.resolve(process.env.PICA_PASSPHRASE);
  }
  return readPassphrase(prompt);
}

/**
 * Atomic config write: write to .tmp, rename. A crash mid-write leaves
 * the original config.json intact.
 */
function writeConfigAtomic(configPath, config) {
  const tmp = configPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, configPath);
}

/**
 * Initialize the master key for this server process.
 *
 * First run (no security section in config):
 *   - Prompt for a new passphrase (twice, for confirmation).
 *   - Generate random salt.
 *   - Derive key.
 *   - Encrypt a known verifier plaintext with that key.
 *   - Persist { salt, kdf params, verifier } to config.json atomically.
 *
 * Subsequent runs:
 *   - Prompt once for the passphrase.
 *   - Derive key using the stored salt + kdf params.
 *   - Attempt to decrypt the verifier — GCM auth failure means wrong passphrase.
 *
 * Returns the 32-byte master key. The key lives only in RAM for the
 * lifetime of the process.
 */
export async function initMasterKey(config, configPath, logger) {
  if (config.security && config.security.kdf && config.security.verifier) {
    return verifyExisting(config, logger);
  }
  return firstRun(config, configPath, logger);
}

async function verifyExisting(config, logger) {
  const { salt: saltHex, cost, blockSize, parallelization } = config.security.kdf;
  const salt = Buffer.from(saltHex, 'hex');
  const verifier = Buffer.from(config.security.verifier, 'base64');

  const passphrase = await readPassphraseFromSource('Passphrase: ');
  const key = await deriveKey(passphrase, salt, {
    cost, blockSize, parallelization,
    keylen: MASTER_KDF.keylen,
    maxmem: MASTER_KDF.maxmem,
  });

  try {
    const decrypted = decryptBlob(verifier, key);
    if (decrypted.toString('utf8') !== VERIFIER_PLAINTEXT) {
      throw new Error('Verifier mismatch');
    }
  } catch {
    throw new Error('Incorrect passphrase');
  }

  logger?.info('Master key unlocked.');
  return key;
}

async function firstRun(config, configPath, logger) {
  logger?.info('First run detected — no master key yet.');
  logger?.info('You are about to choose a passphrase that protects all employee data.');
  logger?.info('Store it somewhere safe. If you lose it, the data cannot be recovered.');

  const pass1 = await readPassphraseFromSource('Choose a passphrase: ');
  if (pass1.length < 8) {
    throw new Error('Passphrase must be at least 8 characters');
  }

  // Skip confirmation when reading from the env var — no way to mis-type.
  if (!process.env.PICA_PASSPHRASE) {
    const pass2 = await readPassphrase('Confirm passphrase: ');
    if (pass1 !== pass2) {
      throw new Error('Passphrases do not match');
    }
  }

  const salt = randomBytes(MASTER_KDF.saltBytes);
  const key = await deriveKey(pass1, salt, MASTER_KDF);
  const verifier = encryptBlob(Buffer.from(VERIFIER_PLAINTEXT, 'utf8'), key);

  config.security = {
    kdf: {
      algorithm: 'scrypt',
      salt: salt.toString('hex'),
      cost: MASTER_KDF.cost,
      blockSize: MASTER_KDF.blockSize,
      parallelization: MASTER_KDF.parallelization,
    },
    verifier: verifier.toString('base64'),
  };

  // Ensure the directory exists (server.js usually handles this, but be safe).
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  writeConfigAtomic(configPath, config);

  logger?.info(`Master key created. Security state written to ${configPath}`);
  return key;
}
