// src/routes/security.js
import fs from 'node:fs';
import { auditContext } from '../storage/audit.js';
import { wrapDek, unwrapDek, generateRecoveryCode, normalizeRecoveryCode } from '../crypto/dek.js';
import { deriveKek, newKdf, getSlot, setSlot, removeSlot, writeConfigAtomic } from '../crypto/keyring.js';

const MIN_PASSPHRASE = 8;

// A wrong passphrase manifests ONLY as an AES-GCM authentication failure.
// Structural errors (corrupt slot, malformed kdf, truncated wrapped value)
// must propagate as a 500, not be masked as a 400 "wrong passphrase".
// Mirrors the same-named guard in src/crypto/masterkey.js by design.
function isAuthFailure(err) {
  return /authenticate|bad decrypt/i.test((err && err.message) || '');
}

// Read the config fresh from disk on every call: another security op
// (recovery-code add, rotate) may have rewritten the security block since
// startup, and writeConfigAtomic's rename makes a torn read impossible.
function readConfig(configPath) {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

export function registerSecurityRoutes(router, deps) {
  const { configPath, masterKey, serverState, requireAuth, requireRole, auditStore, logger } = deps;
  const employer = (h) => requireRole('employer')(requireAuth(h));

  // Unwrap the DEK with a supplied passphrase; returns Buffer or null.
  async function dekFromPassphrase(security, passphrase) {
    const slot = getSlot(security, 'passphrase');
    if (!slot) return null;
    try {
      const kek = await deriveKek(passphrase, slot.kdf);
      return unwrapDek(slot.wrapped, kek, 'passphrase');
    } catch (err) {
      if (isAuthFailure(err)) return null; // wrong passphrase
      throw err; // structural corruption — surface as 500, don't mask
    }
  }

  router.post('/api/security/passphrase', employer(async (req, res) => {
    const { currentPassphrase, newPassphrase } = req.body || {};
    if (typeof newPassphrase !== 'string' || newPassphrase.length < MIN_PASSPHRASE) {
      return res.badRequest(`Passphrase must be at least ${MIN_PASSPHRASE} characters`,
        { errorCode: 'passphrase_too_short' });
    }
    if (typeof currentPassphrase !== 'string' || currentPassphrase.length === 0) {
      return res.badRequest('Current passphrase is required', { errorCode: 'required' });
    }
    const config = readConfig(configPath);
    const dek = await dekFromPassphrase(config.security, currentPassphrase);
    if (!dek) {
      return res.badRequest('Current passphrase is incorrect',
        { errorCode: 'wrong_passphrase' });
    }
    const kdf = newKdf();
    const kek = await deriveKek(newPassphrase, kdf);
    setSlot(config.security, 'passphrase', kdf, wrapDek(dek, kek, 'passphrase'));
    writeConfigAtomic(configPath, config);

    // If the operator reached here via a recovery-code unlock (server in the
    // passphrase-reset lockdown), setting a proper passphrase satisfies that
    // obligation — clear the lock so normal operation resumes without a restart.
    if (serverState) serverState.passphraseResetRequired = false;

    auditStore?.appendRecord({
      ...auditContext(req), event: 'security.passphrase_changed', outcome: 'success',
    });
    logger?.info('Passphrase changed (DEK re-wrapped; data untouched).');
    res.json({ ok: true });
  }));

  router.post('/api/security/recovery-code', employer(async (req, res) => {
    const { currentPassphrase } = req.body || {};
    if (typeof currentPassphrase !== 'string' || currentPassphrase.length === 0) {
      return res.badRequest('Current passphrase is required', { errorCode: 'required' });
    }
    const config = readConfig(configPath);
    const dek = await dekFromPassphrase(config.security, currentPassphrase);
    if (!dek) return res.badRequest('Current passphrase is incorrect', { errorCode: 'wrong_passphrase' });

    const code = generateRecoveryCode();
    const kdf = newKdf();
    const kek = await deriveKek(normalizeRecoveryCode(code), kdf);
    setSlot(config.security, 'recovery', kdf, wrapDek(dek, kek, 'recovery'),
      { createdAt: new Date().toISOString() });
    writeConfigAtomic(configPath, config);

    auditStore?.appendRecord({
      ...auditContext(req), event: 'security.recovery_code_set', outcome: 'success',
    });
    logger?.info('Recovery code (re)generated.');
    res.json({ code }); // shown to the operator exactly once — never logged
  }));

  router.delete('/api/security/recovery-code', employer(async (req, res) => {
    const { currentPassphrase } = req.body || {};
    if (typeof currentPassphrase !== 'string' || currentPassphrase.length === 0) {
      return res.badRequest('Current passphrase is required', { errorCode: 'required' });
    }
    const config = readConfig(configPath);
    const dek = await dekFromPassphrase(config.security, currentPassphrase);
    if (!dek) return res.badRequest('Current passphrase is incorrect', { errorCode: 'wrong_passphrase' });
    removeSlot(config.security, 'recovery');
    writeConfigAtomic(configPath, config);
    auditStore?.appendRecord({
      ...auditContext(req), event: 'security.recovery_code_removed', outcome: 'success',
    });
    logger?.info('Recovery code removed.');
    res.json({ ok: true });
  }));
}
