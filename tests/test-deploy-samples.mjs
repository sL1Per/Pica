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

// Proxy samples must ACTIVELY proxy to the loopback upstream — assert on the
// directive line, not a mere mention (the upstream also appears in comments).
const up = upstream.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
assert.ok(new RegExp(`reverse_proxy\\s+${up}`).test(read('deploy/Caddyfile')),
  `Caddyfile must have an active reverse_proxy to ${upstream}`);
assert.ok(new RegExp(`proxy_pass\\s+http://${up}`).test(read('deploy/nginx/pica.conf')),
  `nginx sample must proxy_pass to http://${upstream}`);

// nginx must forward the proto header Pica's Secure-cookie / HSTS logic needs.
assert.ok(/X-Forwarded-Proto\s+\$scheme/.test(read('deploy/nginx/pica.conf')),
  'nginx sample missing: proxy_set_header X-Forwarded-Proto $scheme');

// The systemd unit must load the passphrase from an EnvironmentFile (so it can
// restart unattended) and must NOT hard-code it inline.
const unit = read('deploy/systemd/pica.service');
assert.ok(/EnvironmentFile=/.test(unit),
  'systemd unit must use EnvironmentFile to load PICA_PASSPHRASE');
assert.ok(!/^PICA_PASSPHRASE\s*=/m.test(unit),
  'systemd unit must not hard-code PICA_PASSPHRASE inline');

// The WinSW service must inject the passphrase via an <env> entry.
assert.ok(/<env\s+name="PICA_PASSPHRASE"/.test(read('deploy/windows/pica-service.xml')),
  'WinSW XML must set PICA_PASSPHRASE via an <env> entry');

console.log('test-deploy-samples: OK');
