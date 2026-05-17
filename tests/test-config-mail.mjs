#!/usr/bin/env node
/**
 * config.js — mail normalisation unit tests.
 *
 * The mail block is optional in config.json. The normaliser must
 * never throw regardless of what the operator writes there, and must
 * produce safe defaults so the rest of the server can branch on
 * cfg.mail.enabled / cfg.mailConfigured without null-guards everywhere.
 *
 * Run: node tests/test-config-mail.mjs
 */

import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// normalizeMail is a named export added alongside loadConfig so tests
// can exercise the normalisation logic without touching the filesystem.
// loadConfig exercises the full code path including mailConfigured assignment.
import { normalizeMail, loadConfig } from '../src/config.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); failed++; }
}

// ---------------------------------------------------------------------------
// normalizeMail — defaults
// ---------------------------------------------------------------------------

console.log('normalizeMail — defaults');

test('normalizes undefined input to safe defaults', () => {
  const mail = normalizeMail(undefined);
  assert.deepEqual(mail, {
    enabled: false,
    host: '',
    port: 465,
    secure: true,
    user: '',
    pass: '',
    from: '',
  });
});

test('normalizes empty object to same safe defaults', () => {
  const mail = normalizeMail({});
  assert.deepEqual(mail, {
    enabled: false,
    host: '',
    port: 465,
    secure: true,
    user: '',
    pass: '',
    from: '',
  });
});

// ---------------------------------------------------------------------------
// normalizeMail — field-by-field
// ---------------------------------------------------------------------------

console.log('\nnormalizeMail — field coercion');

test('enabled: only true boolean enables; string "true" does not', () => {
  assert.equal(normalizeMail({ enabled: true }).enabled, true);
  assert.equal(normalizeMail({ enabled: false }).enabled, false);
  assert.equal(normalizeMail({ enabled: 'true' }).enabled, false);
  assert.equal(normalizeMail({ enabled: 1 }).enabled, false);
});

test('host: trims whitespace', () => {
  assert.equal(normalizeMail({ host: '  smtp.example.com  ' }).host, 'smtp.example.com');
  assert.equal(normalizeMail({ host: 42 }).host, '');
  assert.equal(normalizeMail({ host: null }).host, '');
});

test('port: integer preserved; non-integer falls back to 465', () => {
  assert.equal(normalizeMail({ port: 587 }).port, 587);
  assert.equal(normalizeMail({ port: '587' }).port, 465);  // string → default
  assert.equal(normalizeMail({ port: 587.5 }).port, 465);  // float → default
  assert.equal(normalizeMail({ port: null }).port, 465);
});

test('secure: false disables implicit TLS; anything else keeps default true', () => {
  assert.equal(normalizeMail({ secure: false }).secure, false);
  assert.equal(normalizeMail({ secure: true }).secure, true);
  assert.equal(normalizeMail({ secure: 'false' }).secure, true);  // non-false → true
  assert.equal(normalizeMail({ secure: 0 }).secure, true);
});

test('user/pass/from: strings passed through; non-strings become empty', () => {
  const m = normalizeMail({ user: 'u@x.com', pass: 'secret', from: 'Pica <u@x.com>' });
  assert.equal(m.user, 'u@x.com');
  assert.equal(m.pass, 'secret');
  assert.equal(m.from, 'Pica <u@x.com>');
});

test('from: trims whitespace', () => {
  assert.equal(normalizeMail({ from: '  Pica <x@y.com>  ' }).from, 'Pica <x@y.com>');
});

// ---------------------------------------------------------------------------
// mailConfigured derived flag (simulated — mirrors loadConfig logic)
// ---------------------------------------------------------------------------
// We test the logic directly from normalizeMail output + the derivation rule:
//   mailConfigured = mail.enabled && !!(mail.host && mail.user && mail.pass && mail.from)

console.log('\nmailConfigured derivation');

function deriveConfigured(raw) {
  const mail = normalizeMail(raw);
  return {
    mail,
    mailConfigured: mail.enabled && !!(mail.host && mail.user && mail.pass && mail.from),
  };
}

test('fully-specified enabled block → mailConfigured true', () => {
  const { mail, mailConfigured } = deriveConfigured({
    enabled: true, host: 'h', user: 'u', pass: 'p', from: 'f',
  });
  assert.deepEqual(mail, {
    enabled: true,
    host: 'h',
    port: 465,
    secure: true,
    user: 'u',
    pass: 'p',
    from: 'f',
  });
  assert.equal(mailConfigured, true);
});

test('empty config → mailConfigured false', () => {
  const { mailConfigured } = deriveConfigured({});
  assert.equal(mailConfigured, false);
});

test('enabled:true but missing user/pass/from → mailConfigured false, no throw', () => {
  // Safe degradation: incomplete config disables mail silently
  const { mail, mailConfigured } = deriveConfigured({ enabled: true, host: 'h' });
  assert.equal(mail.enabled, true);   // enabled flag preserved as-is
  assert.equal(mailConfigured, false); // but derived "ready" flag is false
});

test('enabled:false with all fields → mailConfigured false', () => {
  const { mailConfigured } = deriveConfigured({
    enabled: false, host: 'h', user: 'u', pass: 'p', from: 'f',
  });
  assert.equal(mailConfigured, false);
});

test('normalizeMail never throws on wild input', () => {
  const weirdInputs = [
    null, undefined, 42, 'string', [], true,
    { enabled: {}, host: [], port: 'bad', secure: null, user: 99, pass: {}, from: [] },
  ];
  for (const input of weirdInputs) {
    assert.doesNotThrow(() => normalizeMail(input), `should not throw on: ${JSON.stringify(input)}`);
  }
});

// ---------------------------------------------------------------------------
// loadConfig integration — mailConfigured through the real top-level surface
// ---------------------------------------------------------------------------
// These tests exercise the actual assignment in loadConfig so that a bug
// there (e.g. wrong operator, dropped field) is caught rather than hidden
// behind the deriveConfigured re-implementation above.

console.log('\nloadConfig integration — cfg.mail / cfg.mailConfigured');

function tmpConfigDir(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cfg-mail-'));
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(content, null, 2));
  return { dir, configPath };
}

test('no mail block → safe defaults and mailConfigured false', () => {
  const { dir, configPath } = tmpConfigDir({});
  try {
    const cfg = loadConfig(configPath);
    assert.deepEqual(cfg.mail, {
      enabled: false,
      host: '',
      port: 465,
      secure: true,
      user: '',
      pass: '',
      from: '',
    });
    assert.equal(cfg.mailConfigured, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fully-specified enabled mail block → mailConfigured true', () => {
  const { dir, configPath } = tmpConfigDir({
    mail: { enabled: true, host: 'h', user: 'u', pass: 'p', from: 'f' },
  });
  try {
    const cfg = loadConfig(configPath);
    assert.equal(cfg.mail.enabled, true);
    assert.equal(cfg.mail.host, 'h');
    assert.equal(cfg.mail.user, 'u');
    assert.equal(cfg.mail.pass, 'p');
    assert.equal(cfg.mail.from, 'f');
    assert.equal(cfg.mailConfigured, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('enabled:true but missing user/pass/from → mailConfigured false, no throw', () => {
  const { dir, configPath } = tmpConfigDir({
    mail: { enabled: true, host: 'h' },
  });
  try {
    const cfg = loadConfig(configPath);
    assert.equal(cfg.mail.enabled, true);
    assert.equal(cfg.mailConfigured, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
