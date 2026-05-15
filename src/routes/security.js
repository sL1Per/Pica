// src/routes/security.js
import fs from 'node:fs';
import { auditContext } from '../storage/audit.js';
import { wrapDek, unwrapDek } from '../crypto/dek.js';
import { deriveKek, newKdf, getSlot, setSlot, writeConfigAtomic } from '../crypto/keyring.js';

const MIN_PASSPHRASE = 8;

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
    } catch { return null; }
  }

  router.post('/api/security/passphrase', employer(async (req, res) => {
    const { currentPassphrase, newPassphrase } = req.body || {};
    if (typeof newPassphrase !== 'string' || newPassphrase.length < MIN_PASSPHRASE) {
      return res.badRequest(`Passphrase must be at least ${MIN_PASSPHRASE} characters`,
        { errorCode: 'passphrase_too_short' });
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

    // Clearing the recovery-reset lock (this endpoint is allowed during it).
    if (serverState) serverState.passphraseResetRequired = false;

    auditStore?.appendRecord({
      ...auditContext(req), event: 'security.passphrase_changed', outcome: 'success',
    });
    logger?.info('Passphrase changed (DEK re-wrapped; data untouched).');
    res.json({ ok: true });
  }));
}
