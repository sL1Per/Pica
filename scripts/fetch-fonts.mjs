#!/usr/bin/env node
// One-shot self-host downloader. Run LOCALLY (needs network):
//   node scripts/fetch-fonts.mjs
// Writes woff2 into public/fonts/ with the stable filenames app.css references.
// Zero deps — uses global fetch (Node 18+). Re-runnable / idempotent.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fonts');
// A modern desktop UA makes the CSS2 API return woff2 (not ttf).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// [outputFilename, css2 query]
const FONTS = [
  ['instrument-serif-400.woff2',        'Instrument+Serif:ital,wght@0,400'],
  ['instrument-serif-400-italic.woff2', 'Instrument+Serif:ital,wght@1,400'],
  ['dm-sans-400.woff2', 'DM+Sans:wght@400'],
  ['dm-sans-500.woff2', 'DM+Sans:wght@500'],
  ['dm-sans-600.woff2', 'DM+Sans:wght@600'],
  ['dm-sans-700.woff2', 'DM+Sans:wght@700'],
  ['jetbrains-mono-400.woff2', 'JetBrains+Mono:wght@400'],
  ['jetbrains-mono-500.woff2', 'JetBrains+Mono:wght@500'],
];

async function cssFor(query) {
  const url = `https://fonts.googleapis.com/css2?family=${query}&display=swap`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`CSS fetch failed (${res.status}) for ${query}`);
  return res.text();
}

// Pull the woff2 URL from the `/* latin */` @font-face block (covers en + pt-PT
// accented chars). Falls back to the first woff2 URL if the comment is absent.
function latinWoff2(css) {
  const block = css.split(/\/\*\s*latin\s*\*\//)[1] || css;
  const m = block.match(/url\((https:[^)]+\.woff2)\)/);
  if (!m) throw new Error('no woff2 url in CSS');
  return m[1];
}

const main = async () => {
  await mkdir(OUT, { recursive: true });
  for (const [file, query] of FONTS) {
    const css = await cssFor(query);
    const woff2Url = latinWoff2(css);
    // Check the binary fetch too: a non-2xx response still yields an
    // arrayBuffer (an error-page body) that would be written as a "font"
    // with a misleading ✓. Fail loudly instead of a silent corrupt write.
    const fontRes = await fetch(woff2Url, { headers: { 'User-Agent': UA } });
    if (!fontRes.ok) throw new Error(`woff2 fetch failed (${fontRes.status}) for ${file}`);
    const bin = Buffer.from(await fontRes.arrayBuffer());
    await writeFile(path.join(OUT, file), bin);
    console.log(`✓ ${file}  (${bin.length} bytes)`);
  }
  console.log('\nDone. Commit public/fonts/*.woff2.');
};
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
