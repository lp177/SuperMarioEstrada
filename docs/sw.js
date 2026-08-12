/* eslint-disable no-undef */
// ============================================================================
// Service worker TEMPLATE — never ships as-is. scripts/build-sw.mjs stamps
// the build id and precache-list placeholders (spelled out only in the code
// below: their literal names may appear EXACTLY once in this file, or the
// generator's own count-gate refuses to build) and writes docs/sw.js.
// GENERATED docs/sw.js is never hand-edited (house rule).
//
// House doctrine (portalbreakout/tribble/davos memories, distilled):
// - Version = sha256 of shipped bytes (+ this template): byte-identical
//   rebuilds must never nag players with an update prompt.
// - NO skipWaiting() on install — never swap assets mid-play. The new worker
//   parks in `waiting`; the page offers a toast; accepting posts SKIP_WAITING.
// - Precache fetches happen INDIVIDUALLY ({cache:'reload'}) via allSettled:
//   cache.addAll is all-or-nothing and one hiccup silently kills install.
//   Install fails only if a SHELL file (./ or ./index.html) is missing.
// - Navigations are NETWORK-FIRST with cache fallback: GitHub Pages owns
//   index.html's cache headers, and a cached HTML pointing at old hashed
//   assets was the original stale-build bug. Online refresh = newest HTML;
//   offline refresh = the cached shell. THE fix.
// - /assets/* is cache-first (content-hashed URLs are immutable);
//   other same-origin GETs are stale-while-revalidate;
//   cross-origin is never intercepted.
// - sw.js and source maps are excluded from the precache: a cached worker
//   could resurrect a stale version of itself.
// ============================================================================

const BUILD_ID = '5e8f7743430b3615';
const PRECACHE = ["./","./.nojekyll","./assets/index-uukBUVjR.js","./favicon.svg","./index.html","./manifest.webmanifest"];
const CACHE = `sme-${BUILD_ID}`;
const SHELL = ['./', './index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const results = await Promise.allSettled(
        PRECACHE.map(async (url) => {
          const res = await fetch(new Request(url, { cache: 'reload' }));
          if (!res.ok) throw new Error(`${url}: ${res.status}`);
          await cache.put(url, res);
          return url;
        }),
      );
      const failed = [];
      results.forEach((r, i) => {
        if (r.status === 'rejected') failed.push(PRECACHE[i]);
      });
      // Only missing SHELL files abort the install; a hiccup on a decorative
      // entry must not silently cost all offline support.
      if (failed.some((url) => SHELL.includes(url))) {
        throw new Error(`shell precache failed: ${failed.join(', ')}`);
      }
      // Deliberately NO self.skipWaiting(): the new build parks in `waiting`
      // until the player accepts the update toast.
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith('sme-') && n !== CACHE).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (data === 'VERSION') {
    // The page (and the pwa smoke test) asks which build is in control.
    const reply = { type: 'VERSION', buildId: BUILD_ID };
    if (event.ports && event.ports[0]) event.ports[0].postMessage(reply);
    else if (event.source) event.source.postMessage(reply);
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cross-origin: hands off

  if (req.mode === 'navigate') {
    // Network-first: an online refresh always gets the newest HTML.
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put('./index.html', fresh.clone());
          return fresh;
        } catch {
          const cached =
            (await caches.match('./index.html')) ?? (await caches.match('./'));
          if (cached) return cached;
          throw new Error('offline with no cached shell');
        }
      })(),
    );
    return;
  }

  if (url.pathname.includes('/assets/')) {
    // Content-hashed: immutable, cache-first.
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      })(),
    );
    return;
  }

  // Everything else same-origin: stale-while-revalidate.
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      const refresh = fetch(req)
        .then(async (fresh) => {
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone());
          return fresh;
        })
        .catch(() => undefined);
      return cached ?? (await refresh) ?? Response.error();
    })(),
  );
});
