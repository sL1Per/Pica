#!/usr/bin/env node
/**
 * config.js — mail passthrough contract tests (0.26.0+).
 *
 * Since 0.26.0 the mail block is an opaque AES-GCM blob ({ enc }) written
 * by src/storage/mail-config.js after the master key is available.
 * config.js must NOT parse, normalise, or derive anything from it — the
 * master key does not exist at load time. It simply passes user.mail through
 * unchanged.
 *
 * Run: node tests/test-config-mail.mjs
 */

import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// normalizeMail must NO LONGER be exported from config.js.
import * as configModule from '../src/config.js';
import { loadConfig } from '../src/config.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); failed++; }
}

// ---------------------------------------------------------------------------
// Export contract — normalizeMail must be gone
// ---------------------------------------------------------------------------

console.log('export contract');

test('normalizeMail is NOT exported from config.js', () => {
  assert.equal(configModule.normalizeMail, undefined);
});

// ---------------------------------------------------------------------------
// loadConfig — mail raw passthrough (uses tmpdir; never touches repo files)
// ---------------------------------------------------------------------------

console.log('\nloadConfig — mail raw passthrough');

function tmpCfg(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-cfg-'));
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(content, null, 2));
  return { dir, configPath };
}

test('no mail key → cfg.mail is undefined, mailConfigured property absent', () => {
  const { dir, configPath } = tmpCfg({});
  try {
    const cfg = loadConfig(configPath);
    assert.equal(cfg.mail, undefined);
    assert.equal(!('mailConfigured' in cfg), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mail:{enc:"abc"} → cfg.mail deep-equals {enc:"abc"} (raw passthrough)', () => {
  const { dir, configPath } = tmpCfg({ mail: { enc: 'abc' } });
  try {
    const cfg = loadConfig(configPath);
    assert.deepEqual(cfg.mail, { enc: 'abc' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mail:"garbage" → loadConfig does not throw and cfg.mail === "garbage"', () => {
  const { dir, configPath } = tmpCfg({ mail: 'garbage' });
  try {
    let cfg;
    assert.doesNotThrow(() => { cfg = loadConfig(configPath); });
    assert.equal(cfg.mail, 'garbage');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mail:{} → cfg.mail deep-equals {}', () => {
  const { dir, configPath } = tmpCfg({ mail: {} });
  try {
    const cfg = loadConfig(configPath);
    assert.deepEqual(cfg.mail, {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('other config fields (port, dataDir) still resolve correctly', () => {
  const { dir, configPath } = tmpCfg({ port: 9090 });
  try {
    const cfg = loadConfig(configPath);
    assert.equal(cfg.port, 9090);
    // dataDir is resolved to an absolute path relative to the config file's dir
    assert.equal(path.isAbsolute(cfg.dataDir), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
