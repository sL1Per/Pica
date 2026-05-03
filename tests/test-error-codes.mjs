#!/usr/bin/env node
/**
 * Static analysis: every error response in route + auth modules must
 * include `errorCode`. Without it, the frontend's `translateError(code,
 * fallback)` can only fall back to the English error string, defeating
 * M9's localization plumbing.
 *
 * Detects calls of these forms:
 *   res.notFound(...), res.forbidden(...), res.unauthorized(...),
 *   res.badRequest(...), res.serverError(...)
 *   res.json({ error: '...', ... }, 4xx)
 *
 * For each call, asserts the body contains `errorCode` (either the
 * helper's options object, or the raw json body).
 *
 * Run:  node tests/test-error-codes.mjs
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot   = join(__dirname, '..', 'src');

const HELPERS = ['notFound', 'forbidden', 'unauthorized', 'badRequest', 'serverError'];

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

/**
 * Strip JS comments (line + block) from source so that JSDoc examples
 * and inline notes don't trigger false positives. Naive but adequate
 * for our codebase — we don't have comment-like patterns inside
 * strings (like an HTML data:// URL with `//` inside).
 */
function stripComments(source) {
  let out = '';
  let i = 0;
  let inString = null;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') { out += next; i += 2; continue; }
      if (c === inString) inString = null;
      i++;
    } else if (c === '"' || c === "'" || c === '`') {
      inString = c;
      out += c;
      i++;
    } else if (c === '/' && next === '/') {
      // Skip until end of line (preserve newline so line numbers match)
      while (i < source.length && source[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      // Skip until */, but preserve any newlines so line numbers match
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * Walk a directory recursively, collecting all .js files.
 */
function walkJs(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJs(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * Extract every `res.<helper>(...)` call from source, balancing parens
 * and respecting string literals. Returns [{ line, call }, ...] where
 * `call` is the full text from `res.` through the matching `)`.
 */
function extractHelperCalls(source) {
  const pattern = new RegExp(`res\\.(${HELPERS.join('|')})\\(`, 'g');
  const out = [];
  let m;
  while ((m = pattern.exec(source))) {
    const startIdx = m.index;
    const openParen = m.index + m[0].length - 1;
    let depth = 1;
    let i = openParen + 1;
    let inString = null;
    while (i < source.length && depth > 0) {
      const c = source[i];
      if (inString) {
        if (c === '\\') { i += 2; continue; }
        if (c === inString) inString = null;
      } else if (c === '"' || c === "'" || c === '`') {
        inString = c;
      } else if (c === '(') {
        depth++;
      } else if (c === ')') {
        depth--;
      }
      i++;
    }
    const line = source.slice(0, startIdx).split('\n').length;
    out.push({ line, call: source.slice(startIdx, i) });
  }
  return out;
}

/**
 * Extract `res.json({...}, NNN)` calls where NNN is a 4xx/5xx status —
 * these are raw error responses bypassing the helpers and must also
 * carry errorCode.
 */
function extractRawErrorJsonCalls(source) {
  const out = [];
  // Light-touch: find `res.json(` and walk balanced parens, then check
  // status was an error code.
  const pattern = /res\.json\(/g;
  let m;
  while ((m = pattern.exec(source))) {
    const startIdx = m.index;
    const openParen = m.index + m[0].length - 1;
    let depth = 1;
    let i = openParen + 1;
    let inString = null;
    while (i < source.length && depth > 0) {
      const c = source[i];
      if (inString) {
        if (c === '\\') { i += 2; continue; }
        if (c === inString) inString = null;
      } else if (c === '"' || c === "'" || c === '`') {
        inString = c;
      } else if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    const call = source.slice(startIdx, i);
    // Only flag if the call has a status arg in the 4xx-5xx range.
    if (/,\s*[45]\d\d\s*\)\s*$/.test(call)) {
      const line = source.slice(0, startIdx).split('\n').length;
      out.push({ line, call });
    }
  }
  return out;
}

console.log('Error-code audit');

const files = walkJs(srcRoot)
  .filter((f) => /\/(routes|auth)\//.test(f));

for (const file of files) {
  const rel = file.slice(file.indexOf('/src/') + 1);
  const src = stripComments(readFileSync(file, 'utf8'));

  const helperCalls = extractHelperCalls(src);
  const rawCalls    = extractRawErrorJsonCalls(src);

  // Group by file → one test per file describing the count.
  const allCalls = [...helperCalls, ...rawCalls];
  if (allCalls.length === 0) continue;

  test(`${rel}: every error response carries errorCode`, () => {
    const missing = allCalls.filter(({ call }) => !call.includes('errorCode'));
    if (missing.length > 0) {
      const detail = missing
        .map(({ line, call }) => `    line ${line}: ${call.replace(/\s+/g, ' ').slice(0, 100)}`)
        .join('\n');
      throw new Error(
        `${missing.length} error response(s) missing errorCode in ${rel}:\n${detail}`,
      );
    }
  });
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
