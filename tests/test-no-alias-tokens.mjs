// Static guard: after the M15 alias-bridge removal (0.41.0) no stylesheet may
// reference a pre-M15 alias token, and the alias bridge block in app.css must
// be gone. Prevents silent re-introduction of the bridge.
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// The removed aliases. NOTE: --accent-ring is intentionally KEPT as a real
// per-theme token, so it is excluded here. The canonical type scale
// (--text-xs..--text-3xl) is NOT an alias and is also excluded.
const ALIASES = [
  'accent', 'accent-hover', 'accent-soft',
  'surface', 'surface-2', 'border', 'border-strong',
  'text', 'text-muted', 'text-subtle',
  'success', 'success-soft', 'warning', 'warning-soft',
  'danger', 'danger-soft', 'info', 'info-soft',
];
// Match var(--alias) but not var(--text-xs) etc. and not var(--accent-ring).
const aliasRe = new RegExp(`var\\(--(${ALIASES.join('|')})\\)`, 'g');

const cssFiles = readdirSync(PUBLIC).filter((f) => f.endsWith('.css'));

const offenders = [];
for (const f of cssFiles) {
  const src = readFileSync(join(PUBLIC, f), 'utf8');
  const hits = src.match(aliasRe);
  if (hits) offenders.push(`${f}: ${[...new Set(hits)].join(', ')}`);
}
assert.equal(offenders.length, 0,
  `Alias tokens still referenced:\n${offenders.join('\n')}`);

// The bridge block must be gone from app.css.
const appCss = readFileSync(join(PUBLIC, 'app.css'), 'utf8');
assert.ok(!/Alias bridge/i.test(appCss),
  'app.css still contains the "Alias bridge" comment block');
assert.ok(!/--surface:\s*var\(--paper\)/.test(appCss),
  'app.css still defines the alias --surface');

console.log(`test-no-alias-tokens: scanned ${cssFiles.length} files, no aliases, bridge removed`);
