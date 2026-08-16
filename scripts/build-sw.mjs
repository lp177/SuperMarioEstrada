// ============================================================================
// Post-build service-worker generator (chained into `npm run build`).
// Scans docs/, stamps the precache list + BUILD_ID into src/sw-template.js,
// and writes docs/sw.js. House rules baked in (see the template header):
// - BUILD_ID = sha256 over the shipped bytes AND the template itself, so a
//   byte-identical rebuild produces an identical worker (no phantom updates)
//   while any real change — including worker-logic changes — bumps it.
// - Each placeholder must occur EXACTLY once, and the generated worker must
//   parse (new Function): a worker that fails to evaluate silently costs all
//   offline support while the app looks fine. That breaks the BUILD instead.
// - sw.js itself and source maps are never precached.
// ============================================================================

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const docs = join(root, 'docs');
const templatePath = join(root, 'src', 'sw-template.js');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const files = walk(docs)
  .map((p) => relative(docs, p).replaceAll('\\', '/'))
  // social-card.png is the Open Graph preview: crawlers fetch it, the game
  // never does. Precaching it would add ~600KB to every offline install for
  // a file no player's browser will ever ask for.
  .filter((p) => p !== 'sw.js' && !p.endsWith('.map') && p !== 'social-card.png')
  .sort();

if (!files.includes('index.html')) {
  throw new Error('build-sw: docs/index.html missing — run vite build first');
}

// './' boots the app at the Pages sub-path; explicit entries for everything
// shipped (public/ files never pass through the bundler, list them anyway).
const precache = ['./', ...files.map((f) => `./${f}`)];

const hash = createHash('sha256');
for (const f of files) hash.update(readFileSync(join(docs, f)));
hash.update(readFileSync(templatePath));
const buildId = hash.digest('hex').slice(0, 16);

const template = readFileSync(templatePath, 'utf8');
for (const placeholder of ["'__BUILD_ID__'", '__PRECACHE__']) {
  const count = template.split(placeholder).length - 1;
  if (count !== 1) {
    throw new Error(`build-sw: placeholder ${placeholder} occurs ${count}x (must be exactly 1)`);
  }
}

// replaceAll on the quoted forms — String.replace once hit a doc comment in a
// sibling project; be explicit and idempotent.
const out = template
  .replaceAll("'__BUILD_ID__'", `'${buildId}'`)
  .replaceAll('__PRECACHE__', JSON.stringify(precache));

// The worker MUST evaluate; a syntax error here has to fail the build.
new Function(out);

writeFileSync(join(docs, 'sw.js'), out);
console.log(`build-sw: docs/sw.js written — build ${buildId}, ${precache.length} precache entries`);
