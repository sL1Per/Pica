// Static guard: the deploy/ sample configs must exist and stay in sync with
// the server's default loopback listener (src/config.js). If the default
// host/port changes, the proxy samples must be updated too — this test fails
// until they agree. It does NOT validate live TLS (impossible offline).
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const has = (p) => existsSync(path.join(root, p));

// Derive the expected upstream from the server defaults.
const cfg = read('src/config.js');
const host = cfg.match(/host:\s*'([^']+)'/)?.[1];
const port = cfg.match(/port:\s*(\d+)/)?.[1];
assert.equal(host, '127.0.0.1', 'config default host changed — update deploy/ proxy samples');
assert.equal(port, '8080', 'config default port changed — update deploy/ proxy samples');
const upstream = `${host}:${port}`;

// All sample files exist.
const files = [
  'deploy/README.md',
  'deploy/Caddyfile',
  'deploy/nginx/pica.conf',
  'deploy/systemd/pica.service',
  'deploy/windows/pica-service.xml',
  'deploy/windows/README.md',
];
for (const f of files) assert.ok(has(f), `missing deploy sample: ${f}`);

// Proxy samples point at the loopback upstream.
assert.ok(read('deploy/Caddyfile').includes(upstream), `Caddyfile must proxy to ${upstream}`);
assert.ok(read('deploy/nginx/pica.conf').includes(upstream), `nginx sample must proxy to ${upstream}`);

// nginx must forward the proto header Pica's Secure-cookie / HSTS logic needs.
assert.ok(/X-Forwarded-Proto\s+\$scheme/.test(read('deploy/nginx/pica.conf')),
  'nginx sample missing: proxy_set_header X-Forwarded-Proto $scheme');

// The service samples must reference the non-interactive passphrase env var
// (a service cannot answer the interactive Passphrase: prompt).
assert.ok(read('deploy/systemd/pica.service').includes('PICA_PASSPHRASE'),
  'systemd unit must reference PICA_PASSPHRASE');
assert.ok(read('deploy/windows/pica-service.xml').includes('PICA_PASSPHRASE'),
  'WinSW XML must reference PICA_PASSPHRASE');

console.log('test-deploy-samples: OK');
