// src/crypto/rotate.js
import fs from 'node:fs';
import path from 'node:path';
import { encryptBlob, decryptBlob, encryptField, decryptField } from './aes.js';

function walk(dir, base = dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    // statSync follows symlinks; acceptable because the storage layer
    // never creates symlinks under data/.
    if (fs.statSync(full).isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full));
  }
  return out;
}

// Returns null for "copy verbatim", or { kind, aad } for a re-encrypt rule.
function classify(rel) {
  // path.sep is '/' on the target platforms (darwin/linux); walk()'s
  // path.relative output uses the same separator.
  const parts = rel.split(path.sep);
  const file = parts[parts.length - 1];

  if (parts[0] === 'employees' && (file.endsWith('.json') || file.endsWith('.picture'))) {
    const id = file.replace(/\.(json|picture)$/, '');
    return { kind: 'blob', aad: `employee:${id}` };
  }
  if (rel === 'company-logo.bin') return { kind: 'blob', aad: 'company:logo' };
  if (parts[0] === 'leaves' && parts[1] === 'attachments') {
    return { kind: 'blob', aad: `leave-attachment:${file}` };
  }
  if (parts[0] === 'audit' && file.endsWith('.ndjson.enc')) {
    return { kind: 'audit-lines', aad: 'pica-audit-v1' };
  }
  if (parts[0] === 'leaves' && file.endsWith('.ndjson')) {
    return { kind: 'field-lines', aadKey: (o) => `leave:${o.id}` };
  }
  if (parts[0] === 'corrections' && file.endsWith('.ndjson')) {
    return { kind: 'field-lines', aadKey: (o) => `correction:${o.id}` };
  }
  if (parts[0] === 'punches' && file.endsWith('.ndjson')) {
    const employeeId = file.replace(/\.ndjson$/, '');
    return { kind: 'field-lines', aadKey: (o) => `punch:${employeeId}:${o.ts}` };
  }
  return null; // plaintext-at-rest — copy verbatim
}

function rekeyBlob(buf, oldKey, newKey, aad) {
  return encryptBlob(decryptBlob(buf, oldKey, aad), newKey, aad);
}

/**
 * Re-encrypt every encrypted artifact under dataDir into stagingDir using
 * newKey. Plaintext files are copied verbatim. Throws (and the caller must
 * discard stagingDir) on any decrypt failure — never partially writes a
 * corrupt tree into place.
 */
export async function rotateData({ dataDir, stagingDir, oldKey, newKey, logger }) {
  fs.mkdirSync(stagingDir, { recursive: true, mode: 0o700 });
  for (const rel of walk(dataDir)) {
    const src = path.join(dataDir, rel);
    const dst = path.join(stagingDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 });
    const rule = classify(rel);

    if (!rule) {
      fs.copyFileSync(src, dst);
    } else if (rule.kind === 'blob') {
      fs.writeFileSync(dst, rekeyBlob(fs.readFileSync(src), oldKey, newKey, rule.aad), { mode: 0o600 });
    } else if (rule.kind === 'audit-lines') {
      const out = fs.readFileSync(src, 'utf8').split('\n').map((line) => {
        // Preserve empty elements (incl. the trailing-\n artifact of split)
        // so the rewritten file is byte-identical in structure. Changing
        // this to `continue`/`filter(Boolean)` would silently drop the
        // trailing newline.
        if (!line) return line;
        return rekeyBlob(Buffer.from(line, 'base64'), oldKey, newKey, rule.aad).toString('base64');
      }).join('\n');
      fs.writeFileSync(dst, out, { mode: 0o600 });
    } else if (rule.kind === 'field-lines') {
      const out = fs.readFileSync(src, 'utf8').split('\n').map((line) => {
        // Preserve empty elements (incl. the trailing-\n artifact of split)
        // so the rewritten file is byte-identical in structure. Changing
        // this to `continue`/`filter(Boolean)` would silently drop the
        // trailing newline.
        if (!line) return line;
        // JSON.parse throwing on a malformed line is intentional: key
        // rotation is all-or-nothing. Silently skipping would drop data
        // from the rotated file. The caller discards stagingDir on throw.
        const obj = JSON.parse(line);
        if (typeof obj.enc === 'string') {
          const aad = rule.aadKey(obj);
          obj.enc = encryptField(decryptField(obj.enc, oldKey, aad), newKey, aad);
        }
        return JSON.stringify(obj);
      }).join('\n');
      fs.writeFileSync(dst, out, { mode: 0o600 });
    }
  }
  logger?.info(`Rotation: re-encrypted data tree into ${stagingDir}`);
}
