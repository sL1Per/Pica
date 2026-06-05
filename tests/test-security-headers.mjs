#!/usr/bin/env node
/**
 * Security headers tests.
 *
 * Two layers:
 *
 *   1. Unit tests on the security-headers module itself —
 *      hash computation, CSP composition, conditional HSTS.
 *
 *   2. Cross-file invariant: every HTML page in public/ must contain
 *      EXACTLY ONE inline <script> with no attributes, and they must
 *      all be byte-identical so a single CSP hash covers all pages.
 *      A future edit that violates this (e.g. a per-page tweak to the
 *      bootstrap, or a forgotten inline <script>) would silently break
 *      the CSP at runtime; this test fails loudly first.
 *
 * Run:  node tests/test-security-headers.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import {
  computeBootstrapHash,
  createSecurityHeaders,
} from '../src/http/security-headers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      // async — caller awaits at the top level
      throw new Error('use async test runner for async tests');
    }
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function mockRes() {
  const headers = {};
  return {
    headers,
    setHeader(name, value) { headers[name] = value; },
  };
}

console.log('Security headers — unit');

test('computeBootstrapHash returns a CSP-style hash', () => {
  const h = computeBootstrapHash(publicDir);
  assert.match(h, /^'sha256-[A-Za-z0-9+/]+=*'$/);
});

test('computeBootstrapHash throws on a file with no inline script', () => {
  // /icon.svg has no <script> — perfect target.
  assert.throws(
    () => computeBootstrapHash(publicDir, 'icon.svg'),
    /No inline <script>/,
  );
});

test('createSecurityHeaders applies CSP + 4 base headers', () => {
  const apply = createSecurityHeaders({ publicDir, isProduction: false });
  const res = mockRes();
  apply({ headers: {} }, res);
  assert.ok(res.headers['Content-Security-Policy'], 'CSP set');
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(res.headers['X-Frame-Options'], 'DENY');
  assert.equal(res.headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.match(res.headers['Permissions-Policy'], /geolocation=\(self\)/);
});

test('M17 S13: cross-origin isolation headers (COOP + CORP)', () => {
  const apply = createSecurityHeaders({ publicDir, isProduction: false });
  const res = mockRes();
  apply({ headers: {} }, res);
  assert.equal(res.headers['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.equal(res.headers['Cross-Origin-Resource-Policy'], 'same-origin');
});

test('CSP includes the bootstrap hash and frame-ancestors none', () => {
  const apply = createSecurityHeaders({ publicDir, isProduction: false });
  const res = mockRes();
  apply({ headers: {} }, res);
  const csp = res.headers['Content-Security-Policy'];
  assert.match(csp, /'sha256-/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  // Verify allowance for blob: in img-src (PWA icons need it)
  assert.match(csp, /img-src [^;]*blob:/);
});

test('CSP forbids eval and inline-style by default', () => {
  const apply = createSecurityHeaders({ publicDir, isProduction: false });
  const res = mockRes();
  apply({ headers: {} }, res);
  const csp = res.headers['Content-Security-Policy'];
  assert.doesNotMatch(csp, /'unsafe-inline'/);
  assert.doesNotMatch(csp, /'unsafe-eval'/);
});

test('HSTS NOT set in dev', () => {
  const apply = createSecurityHeaders({ publicDir, isProduction: false });
  const res = mockRes();
  apply({ headers: { 'x-forwarded-proto': 'https' } }, res);
  assert.equal(res.headers['Strict-Transport-Security'], undefined);
});

test('HSTS NOT set in production without HTTPS proxy header', () => {
  const apply = createSecurityHeaders({ publicDir, isProduction: true });
  const res = mockRes();
  apply({ headers: {} }, res);
  assert.equal(res.headers['Strict-Transport-Security'], undefined);
});

test('HSTS NOT set when X-Forwarded-Proto is "http"', () => {
  const apply = createSecurityHeaders({ publicDir, isProduction: true });
  const res = mockRes();
  apply({ headers: { 'x-forwarded-proto': 'http' } }, res);
  assert.equal(res.headers['Strict-Transport-Security'], undefined);
});

test('HSTS set in production WITH X-Forwarded-Proto: https', () => {
  const apply = createSecurityHeaders({ publicDir, isProduction: true });
  const res = mockRes();
  apply({ headers: { 'x-forwarded-proto': 'https' } }, res);
  assert.equal(
    res.headers['Strict-Transport-Security'],
    'max-age=31536000; includeSubDomains',
  );
});

// -- Cross-file invariants ------------------------------------------------

console.log('');
console.log('Security headers — invariants across all HTML pages');

test('every HTML page has exactly one inline <script>, all byte-identical', () => {
  const htmlFiles = fs.readdirSync(publicDir)
    .filter((f) => f.endsWith('.html'))
    .map((f) => path.join(publicDir, f));

  assert.ok(htmlFiles.length > 0, 'public/ should contain HTML files');

  const hashes = new Map(); // hash -> [files]
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8');
    const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.equal(
      matches.length, 1,
      `${path.basename(file)} should have exactly 1 inline <script> (found ${matches.length})`,
    );
    const sha = createHash('sha256').update(matches[0][1], 'utf8').digest('base64');
    if (!hashes.has(sha)) hashes.set(sha, []);
    hashes.get(sha).push(path.basename(file));
  }

  if (hashes.size !== 1) {
    const summary = [...hashes.entries()].map(([h, files]) => `${h.slice(0, 12)}…: ${files.length} files`).join('; ');
    throw new Error(`Expected one canonical bootstrap, got ${hashes.size}: ${summary}`);
  }
});

test('no HTML page has inline event handlers (onclick=, etc.)', () => {
  const handlerPattern = /\son(click|change|submit|input|load|error|keydown|keyup|focus|blur|mouseover|mouseout)\s*=/;
  const offenders = [];
  for (const f of fs.readdirSync(publicDir).filter((x) => x.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(publicDir, f), 'utf8');
    if (handlerPattern.test(html)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], `Inline event handlers would require unsafe-inline. Files: ${offenders.join(', ')}`);
});

test('no HTML page has style="..." attributes', () => {
  const offenders = [];
  for (const f of fs.readdirSync(publicDir).filter((x) => x.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(publicDir, f), 'utf8');
    if (/\sstyle\s*=\s*["']/.test(html)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], `Inline style attributes would require unsafe-inline for style-src. Files: ${offenders.join(', ')}`);
});

test('no HTML page has a <style> element', () => {
  const offenders = [];
  for (const f of fs.readdirSync(publicDir).filter((x) => x.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(publicDir, f), 'utf8');
    if (/<style[\s>]/i.test(html)) offenders.push(f);
  }
  assert.deepEqual(offenders, []);
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
