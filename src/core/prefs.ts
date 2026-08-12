// ============================================================================
// Settings persistence — versioned localStorage key STORAGE_KEYS.settings.
//
// All storage access is optional-chained and try/caught: headless Node,
// private browsing and quota errors all degrade to in-memory defaults, never
// to a throw. Loaded data is deep-merged over defaults field by field — a
// corrupt or partial save can never produce an invalid SettingsData.
// ============================================================================

import type { ActionId, SettingsData } from './types.ts';
import { STORAGE_KEYS } from './constants.ts';

/** Default bindings, by PHYSICAL position (KeyboardEvent.code).
 *  PRIMARY = the WASD position block, which IS ZQSD on an AZERTY keyboard
 *  (bindings follow positions; labels follow core/keyboardLayout.ts).
 *  SECONDARY = the arrow keys, so both hands work out of the box. */
export const DEFAULT_BINDINGS: Record<ActionId, string[]> = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  jump: ['Space', 'KeyW', 'ArrowUp'],
  run: ['ShiftLeft', 'KeyF'],
  pause: ['Escape', 'Enter'],
  // Solo hero swap (Mangiani <-> Estrada). ONE default code on purpose: in
  // co-op, slot [0] belongs to P1 and slots [1..] to P2, so a lone code keeps
  // the action P1-side; users may add a second in the rebind menu. Gamepad
  // button 3 is hard-mapped to swap in input.ts (not stored here).
  swap: ['Tab'],
};

function cloneBindings(b: Record<ActionId, string[]>): Record<ActionId, string[]> {
  const out = {} as Record<ActionId, string[]>;
  for (const a of Object.keys(b) as ActionId[]) out[a] = [...b[a]];
  return out;
}

function defaultSettings(): SettingsData {
  return {
    musicVol: 0.7,
    sfxVol: 0.8,
    reducedMotion: null,
    bindings: cloneBindings(DEFAULT_BINDINGS),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Load settings, deep-merging any saved values over the defaults. Corrupt
 *  JSON, wrong shapes or absent storage all yield fresh defaults. */
export function loadSettings(): SettingsData {
  const d = defaultSettings();
  let raw: string | null | undefined;
  try {
    raw = globalThis.localStorage?.getItem(STORAGE_KEYS.settings);
  } catch {
    return d;
  }
  if (typeof raw !== 'string') return d;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return d;
  }
  if (!isRecord(parsed)) return d;

  if (typeof parsed['musicVol'] === 'number' && Number.isFinite(parsed['musicVol'])) {
    d.musicVol = clamp01(parsed['musicVol']);
  }
  if (typeof parsed['sfxVol'] === 'number' && Number.isFinite(parsed['sfxVol'])) {
    d.sfxVol = clamp01(parsed['sfxVol']);
  }
  const rm = parsed['reducedMotion'];
  if (rm === null || typeof rm === 'boolean') d.reducedMotion = rm;

  const savedBindings = parsed['bindings'];
  if (isRecord(savedBindings)) {
    // Iterating DEFAULT_BINDINGS' keys over a defaults-clone is also the
    // BACKFILL path: an action absent from an older save (e.g. 'swap', which
    // postdates the first release) keeps its default codes, so the returned
    // Record<ActionId, string[]> is never incomplete.
    for (const a of Object.keys(DEFAULT_BINDINGS) as ActionId[]) {
      const codes = savedBindings[a];
      if (
        Array.isArray(codes) &&
        codes.length > 0 &&
        codes.every((c): c is string => typeof c === 'string')
      ) {
        d.bindings[a] = [...codes];
      }
    }
  }
  return d;
}

export function saveSettings(s: SettingsData): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEYS.settings, JSON.stringify(s));
  } catch {
    // Private mode / quota: settings just live for the session.
  }
}

/** Explicit override wins; otherwise follow prefers-reduced-motion; headless
 *  (no matchMedia) means false. */
export function effectiveReducedMotion(s: SettingsData): boolean {
  if (s.reducedMotion !== null) return s.reducedMotion;
  if (typeof globalThis.matchMedia !== 'function') return false;
  return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
