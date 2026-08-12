// ============================================================================
// Service-worker client: registration, update detection, and the update
// toast. House doctrine (portalbreakout offline-and-updates memory):
// - Register relative to document.baseURI (NEVER import.meta.url — a sibling
//   project's worker resolved into assets/ and never controlled the page).
// - updateViaCache: 'none' — GitHub Pages serves sw.js with max-age=600.
// - Triple-guarded, PROD only; a failed register warns, never throws.
// - The toast appears only when a NEW worker reaches 'installed' while one
//   already controls the page: a first-ever install must never prompt.
// - controllerchange reloads ONLY behind the explicit swapRequested flag:
//   clients.claim() fires controllerchange on the FIRST install too, and an
//   unconditional reload bounces every first visit.
// - Update checks: load, tab-visibility (throttled 60s), 'online', every 15m.
// ============================================================================

const VISIBILITY_THROTTLE_MS = 60_000;
const PERIODIC_CHECK_MS = 15 * 60_000;

let swapRequested = false;
let toastEl: HTMLDivElement | null = null;

function showUpdateToast(reg: ServiceWorkerRegistration): void {
  if (toastEl) return; // one toast is plenty
  const toast = document.createElement('div');
  toast.setAttribute('role', 'status');
  toast.style.cssText = [
    'position:fixed', 'right:16px', 'bottom:16px', 'z-index:1000',
    'background:#1e1e1e', 'color:#e0e0e0', 'border:1px solid #000',
    'border-left:3px solid #ffca28', 'border-radius:6px', 'padding:12px 14px',
    'font:13px/1.4 monospace', 'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
    'display:flex', 'gap:12px', 'align-items:center',
  ].join(';');
  const label = document.createElement('span');
  label.textContent = 'A new version is ready.';
  const update = document.createElement('button');
  update.textContent = 'UPDATE';
  const later = document.createElement('button');
  later.textContent = 'LATER';
  for (const b of [update, later]) {
    b.style.cssText =
      'background:#2a2a2a;color:#ffca28;border:1px solid #000;border-radius:4px;' +
      'padding:6px 10px;font:bold 12px monospace;cursor:pointer';
  }
  update.addEventListener('click', () => {
    // The worker never skipWaiting()s itself — the player just accepted.
    swapRequested = true;
    reg.waiting?.postMessage('SKIP_WAITING');
  });
  later.addEventListener('click', () => {
    toast.remove();
    toastEl = null;
  });
  toast.append(label, update, later);
  document.body.append(toast);
  toastEl = toast;
  update.focus();
}

function noteWaiting(reg: ServiceWorkerRegistration): void {
  // First-ever install: nothing to replace, never prompt.
  if (reg.waiting && navigator.serviceWorker.controller) showUpdateToast(reg);
}

export function initPwa(): void {
  // Triple guard: PROD build, SW support, secure context (localhost counts).
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;
  if (!window.isSecureContext) return;

  const swUrl = new URL('sw.js', document.baseURI).href;
  navigator.serviceWorker
    .register(swUrl, { updateViaCache: 'none' })
    .then((reg) => {
      noteWaiting(reg);
      reg.addEventListener('updatefound', () => {
        const incoming = reg.installing;
        incoming?.addEventListener('statechange', () => {
          if (incoming.state === 'installed') noteWaiting(reg);
        });
      });

      // Update checks — quietly, in the background.
      let lastCheck = Date.now();
      const check = (): void => {
        lastCheck = Date.now();
        void reg.update().catch(() => undefined);
      };
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && Date.now() - lastCheck > VISIBILITY_THROTTLE_MS) check();
      });
      window.addEventListener('online', check);
      setInterval(check, PERIODIC_CHECK_MS);
    })
    .catch((err: unknown) => {
      // Offline support is a bonus, never a blocker.
      console.warn('sw register failed:', err);
    });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only the accepted swap reloads; the first install's claim() does not.
    if (swapRequested) {
      swapRequested = false;
      window.location.reload();
    }
  });
}

/** Settings-panel readout: is the game ready to play offline? */
export function offlineReady(): boolean {
  return 'serviceWorker' in navigator && navigator.serviceWorker.controller !== null;
}
