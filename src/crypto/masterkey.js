// src/crypto/masterkey.js
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { readPassphrase } from './prompt.js';
import { decryptBlob } from './aes.js';
import { wrapDek, unwrapDek, normalizeRecoveryCode } from './dek.js';
import {
  newKdf, deriveKek, detectFormat, setSlot, getSlot, writeConfigAtomic,
} from './keyring.js';

const VERIFIER_PLAINTEXT = 'pica-verifier-v1';

// utcStamp granularity is ISO milliseconds. wipeReset is a one-shot boot
// operation so a same-millisecond collision cannot occur in practice; if
// it ever did, renameSync onto a non-empty dir throws ENOTEMPTY and the
// error surfaces rather than silently overwriting an aside directory.
function utcStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// Treat an empty PICA_PASSPHRASE the same as unset so a stray
// `PICA_PASSPHRASE=` in a unit file doesn't silently skip the passphrase
// path. Returns the env passphrase or undefined.
function envPassphrase() {
  const v = process.env.PICA_PASSPHRASE;
  return v ? v : undefined;
}

function readPassphraseFromSource(prompt) {
  const ev = envPassphrase();
  if (ev) return Promise.resolve(ev);
  return readPassphrase(prompt);
}

// A wrong passphrase / recovery code manifests ONLY as an AES-GCM
// authentication failure. Any other error (corrupt slot, malformed kdf,
// truncated ciphertext) is structural and must propagate so the operator
// gets a real diagnostic instead of a misleading "wrong passphrase".
function isAuthFailure(err) {
  return /authenticate|bad decrypt/i.test((err && err.message) || '');
}

/**
 * @returns {Promise<{ masterKey: Buffer, mustResetPassphrase: boolean }>}
 */
export async function initMasterKey(config, configPath, logger) {
  const fmt = detectFormat(config.security);

  if (fmt === 'none') return firstRun(config, configPath, logger);
  if (fmt === 'v1')   return migrateV1(config, configPath, logger);
  if (fmt === 'v2') {
    if (process.env.PICA_RESET === '1') {
      wipeReset(config, configPath, logger);
      return firstRun(config, configPath, logger);
    }
    return unlockV2(config, configPath, logger);
  }
  throw new Error('Unrecognized security section in config.json');
}

async function firstRun(config, configPath, logger) {
  logger?.info('First run — choosing a passphrase that protects all data.');
  logger?.info('Store it safely. If lost, use the recovery code (if set) or the data is unrecoverable.');

  const pass1 = await readPassphraseFromSource('Choose a passphrase: ');
  if (pass1.length < 8) throw new Error('Passphrase must be at least 8 characters');
  if (!envPassphrase()) {
    const pass2 = await readPassphrase('Confirm passphrase: ');
    if (pass1 !== pass2) throw new Error('Passphrases do not match');
  }

  const dek = randomBytes(32);
  const kdf = newKdf();
  const kek = await deriveKek(pass1, kdf);
  if (!config.security) config.security = {};
  setSlot(config.security, 'passphrase', kdf, wrapDek(dek, kek, 'passphrase'));

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  writeConfigAtomic(configPath, config);
  logger?.info(`Master key created. Security state written to ${configPath}`);
  logger?.info('No recovery code set — generate one in Settings → Security.');
  return { masterKey: dek, mustResetPassphrase: false };
}

async function migrateV1(config, configPath, logger) {
  logger?.info('Legacy security format detected — migrating to envelope encryption.');
  const { salt, cost, blockSize, parallelization } = config.security.kdf;
  const verifier = Buffer.from(config.security.verifier ?? '', 'base64');
  // 12-byte IV + 16-byte GCM tag is the minimum valid ciphertext.
  if (verifier.length < 28) {
    throw new Error('config.json security.verifier is missing or truncated');
  }

  const passphrase = await readPassphraseFromSource('Passphrase: ');
  const oldKey = await deriveKek(passphrase, { salt, cost, blockSize, parallelization });
  let plain;
  try {
    plain = decryptBlob(verifier, oldKey);
  } catch (err) {
    if (isAuthFailure(err)) throw new Error('Incorrect passphrase');
    throw err; // structural corruption — surface it, don't mask as wrong passphrase
  }
  if (plain.toString('utf8') !== VERIFIER_PLAINTEXT) {
    throw new Error('Incorrect passphrase');
  }

  // The historical derived key becomes the frozen DEK — data is NOT touched.
  const dek = oldKey;
  const kdf = newKdf();
  const kek = await deriveKek(passphrase, kdf);
  setSlot(config.security, 'passphrase', kdf, wrapDek(dek, kek, 'passphrase'));
  writeConfigAtomic(configPath, config);
  logger?.info('Migration complete — data was not re-encrypted (zero-data-touch).');
  logger?.info('No recovery code set — generate one in Settings → Security.');
  return { masterKey: dek, mustResetPassphrase: false };
}

async function unlockV2(config, configPath, logger) {
  const sec = config.security;
  const pSlot = getSlot(sec, 'passphrase');
  if (!pSlot) throw new Error('config.json security.wraps.passphrase is missing');

  // Only attempt the passphrase slot if we can actually obtain a passphrase:
  // PICA_PASSPHRASE is set, or there is a TTY to prompt. In a non-TTY process
  // with only PICA_RECOVERY_CODE set, blocking on readPassphrase() would hang —
  // fall through to the recovery-code path instead.
  const hasPassphraseSource = envPassphrase() || process.stdin.isTTY;
  if (hasPassphraseSource) {
    const passphrase = await readPassphraseFromSource('Passphrase: ');
    try {
      const kek = await deriveKek(passphrase, pSlot.kdf);
      const dek = unwrapDek(pSlot.wrapped, kek, 'passphrase');
      logger?.info('Master key unlocked.');
      return { masterKey: dek, mustResetPassphrase: false };
    } catch (err) {
      if (!isAuthFailure(err)) throw err;
      logger?.warn('Passphrase did not unlock the master key.');
    }
  }

  const recSlot = getSlot(sec, 'recovery');
  const code = process.env.PICA_RECOVERY_CODE
    ?? (recSlot && process.stdin.isTTY ? await readPassphrase('Recovery code (blank to abort): ') : '');
  if (recSlot && code) {
    try {
      const kek = await deriveKek(normalizeRecoveryCode(code), recSlot.kdf);
      const dek = unwrapDek(recSlot.wrapped, kek, 'recovery');
      logger?.warn('Unlocked with the recovery code — set a new passphrase immediately.');
      return { masterKey: dek, mustResetPassphrase: true };
    } catch (err) {
      if (!isAuthFailure(err)) throw err;
      logger?.error('Recovery code did not unlock the master key.');
    }
  }

  const why = hasPassphraseSource
    ? 'Incorrect passphrase'
    : 'No passphrase available (non-interactive)';
  throw new Error(`${why} and no valid recovery code. `
    + 'Set PICA_RESET=1 to wipe and start over (old data is preserved aside).');
}

function wipeReset(config, configPath, logger) {
  const dataDir = config.dataDir;
  if (dataDir && fs.existsSync(dataDir)) {
    const aside = `${dataDir}.pre-reset-${utcStamp()}`;
    fs.renameSync(dataDir, aside); // NEVER delete — preserve the bytes
    logger?.warn(`Wipe-reset: existing data moved to ${aside} (not deleted).`);
  }
  delete config.security;
  writeConfigAtomic(configPath, config);
}
