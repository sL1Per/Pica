// src/routes/security.js
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { auditContext } from '../storage/audit.js';
import { wrapDek, unwrapDek, generateRecoveryCode, normalizeRecoveryCode } from '../crypto/dek.js';
import { deriveKek, newKdf, getSlot, setSlot, removeSlot, writeConfigAtomic } from '../crypto/keyring.js';
import { rotateData } from '../crypto/rotate.js';

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
  const { configPath, masterKey, dataDir, serverState, requireAuth, requireRole, auditStore, logger } = deps;
  const rotate = deps.rotate || rotateData;
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
    const config = readConfig(configPath);

    // Two modes:
    //  - Normal: the operator proves the CURRENT passphrase (it unwraps the DEK).
    //  - Recovery-reset: the server booted via the recovery code
    //    (serverState.passphraseResetRequired). Boot already authenticated and
    //    the DEK is in memory (masterKey); the operator does NOT know the old
    //    passphrase, so none is required — re-wrap the in-memory DEK.
    const resetMode = !!(serverState && serverState.passphraseResetRequired);
    let dek;
    if (resetMode) {
      dek = masterKey;
    } else {
      if (typeof currentPassphrase !== 'string' || currentPassphrase.length === 0) {
        return res.badRequest('Current passphrase is required', { errorCode: 'required' });
      }
      dek = await dekFromPassphrase(config.security, currentPassphrase);
      if (!dek) {
        return res.badRequest('Current passphrase is incorrect', { errorCode: 'wrong_passphrase' });
      }
    }

    const kdf = newKdf();
    const kek = await deriveKek(newPassphrase, kdf);
    setSlot(config.security, 'passphrase', kdf, wrapDek(dek, kek, 'passphrase'));
    writeConfigAtomic(configPath, config);

    if (serverState) serverState.passphraseResetRequired = false;
    auditStore?.appendRecord({
      ...auditContext(req), event: 'security.passphrase_changed', outcome: 'success',
      details: resetMode ? { viaRecovery: true } : null,
    });
    logger?.info(resetMode
      ? 'Passphrase set after recovery-code unlock (DEK re-wrapped; data untouched).'
      : 'Passphrase changed (DEK re-wrapped; data untouched).');
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

  router.post('/api/security/rotate', employer(async (req, res) => {
    if (req.body?.confirm !== 'ROTATE') {
      return res.badRequest('Type ROTATE to confirm', { errorCode: 'confirm_required' });
    }
    const { currentPassphrase } = req.body || {};
    if (typeof currentPassphrase !== 'string' || currentPassphrase.length === 0) {
      return res.badRequest('Current passphrase is required', { errorCode: 'required' });
    }
    const config = readConfig(configPath);
    const oldKey = await dekFromPassphrase(config.security, currentPassphrase);
    if (!oldKey) return res.badRequest('Current passphrase is incorrect', { errorCode: 'wrong_passphrase' });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const stagingDir = `${dataDir}.staging-${stamp}`;
    const preRotate = `${dataDir}.pre-rotate-${stamp}`;
    const newKey = randomBytes(32);
    const cleanStaging = () => {
      // stagingDir is a transient scratch sibling — NOT data/ or backups/.
      try { if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true }); } catch { /* */ }
    };

    try {
      await rotate({ dataDir, stagingDir, oldKey, newKey, logger });
    } catch (err) {
      cleanStaging();
      logger?.error(`Rotation aborted before swap: ${err.message}`);
      return res.badRequest('Rotation failed — data left unchanged', { errorCode: 'rotation_failed' });
    }

    // Write the new-DEK config BEFORE swapping data/. writeConfigAtomic is
    // atomic (tmp+rename): a failure here leaves the OLD config AND the OLD
    // data/ intact, so the operator can safely retry. Doing it AFTER the swap
    // would risk data/=newKey while config=oldKey (operator locked out).
    const kdf = newKdf();
    const kek = await deriveKek(currentPassphrase, kdf);
    setSlot(config.security, 'passphrase', kdf, wrapDek(newKey, kek, 'passphrase'));
    removeSlot(config.security, 'recovery'); // old code wrapped the OLD DEK
    try {
      writeConfigAtomic(configPath, config);
    } catch (err) {
      cleanStaging();
      logger?.error(`Rotation aborted: config write failed: ${err.message}`);
      return res.badRequest('Rotation failed — data left unchanged', { errorCode: 'rotation_failed' });
    }

    // Atomic swap, mirroring src/storage/backups.js restore (incl. best-effort
    // rollback if the second rename fails mid-swap). data/ is NEVER deleted.
    const dataExists = fs.existsSync(dataDir);
    try {
      if (dataExists) fs.renameSync(dataDir, preRotate);
      fs.renameSync(stagingDir, dataDir);
    } catch (err) {
      try {
        if (!fs.existsSync(dataDir) && fs.existsSync(preRotate)) {
          fs.renameSync(preRotate, dataDir); // undo: restore original data/
        }
      } catch { /* */ }
      cleanStaging();
      // Residual disclosed window: config now wraps newKey but data/ may hold
      // oldKey data (rollback restored it). Operator must restore from a
      // pre-rotation backup. Surface as 500 — never a silent success.
      logger?.error(`Rotation swap failed: ${err.message}`);
      throw err;
    }

    if (serverState) serverState.rotateCompleted = true;
    auditStore?.appendRecord({
      ...auditContext(req), event: 'security.key_rotated', outcome: 'success',
      details: { preRotate },
    });
    logger?.warn(`Key rotated. Old data preserved at ${preRotate}. Restart Pica and set a new recovery code.`);
    res.json({ ok: true, restartRequired: true, preRotatePath: preRotate });
  }));
}
