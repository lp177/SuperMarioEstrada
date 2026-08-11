// ============================================================================
// Campaign progress — versioned localStorage key STORAGE_KEYS.progress.
//
// Progress is keyed by stable STRING LevelId ('w1a2'), NEVER by array index:
// reordering or inserting acts must never corrupt a save. All storage access
// is optional-chained and try/caught; corrupt JSON yields fresh defaults,
// never a throw. Mutating helpers return NEW objects (callers persist them).
// ============================================================================

import type { ActBest, CutsceneId, LevelId, ProgressData } from '../core/types.ts';
import { STORAGE_KEYS } from '../core/constants.ts';

// Must accept EVERY id the ActNo union allows (a1..a8) — this regex once said
// a[1-4] after the campaign grew to 8 acts/world and silently ATE saved clears
// for acts 5-8 (castles included) on every load. Data-loss class: keep in
// lockstep with ActNo, and the round-trip test below the union's edges.
const LEVEL_ID_RE = /^w[1-4]a[1-8]$/;

/** Exhaustive over CutsceneId — a new cutscene does not compile until it is
 *  listed here, so saved `seen` flags can be validated against the union. */
const CUTSCENE_IDS: Record<CutsceneId, true> = {
  intro: true,
  'w1-end': true,
  'w2-end': true,
  'w3-end': true,
  ending: true,
};

function isCutsceneId(k: string): k is CutsceneId {
  return Object.prototype.hasOwnProperty.call(CUTSCENE_IDS, k);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function finiteNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Validate one saved ActBest; null if any field is missing or non-numeric. */
function sanitizeBest(v: unknown): ActBest | null {
  if (!isRecord(v)) return null;
  const coins = finiteNum(v['coins']);
  const goldbars = finiteNum(v['goldbars']);
  const secrets = finiteNum(v['secrets']);
  const deaths = finiteNum(v['deaths']);
  const timeFrames = finiteNum(v['timeFrames']);
  if (
    coins === null ||
    goldbars === null ||
    secrets === null ||
    deaths === null ||
    timeFrames === null
  ) {
    return null;
  }
  return { coins, goldbars, secrets, deaths, timeFrames };
}

/** Load progress. Corrupt JSON, wrong shapes, unknown ids and absent storage
 *  all degrade to fresh defaults (per entry where possible) — never a throw. */
export function loadProgress(): ProgressData {
  const out: ProgressData = { cleared: {}, seen: {} };
  let raw: string | null | undefined;
  try {
    raw = globalThis.localStorage?.getItem(STORAGE_KEYS.progress);
  } catch {
    return out;
  }
  if (typeof raw !== 'string') return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!isRecord(parsed)) return out;

  const cleared = parsed['cleared'];
  if (isRecord(cleared)) {
    for (const [k, v] of Object.entries(cleared)) {
      if (!LEVEL_ID_RE.test(k)) continue; // not a LevelId — drop, don't crash
      const best = sanitizeBest(v);
      if (best !== null) out.cleared[k as LevelId] = best;
    }
  }
  const seen = parsed['seen'];
  if (isRecord(seen)) {
    for (const [k, v] of Object.entries(seen)) {
      if (isCutsceneId(k) && v === true) out.seen[k] = true;
    }
  }
  return out;
}

export function saveProgress(p: ProgressData): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEYS.progress, JSON.stringify(p));
  } catch {
    // Private mode / quota: progress just lives for the session.
  }
}

/** Record an act clear, keeping the BEST of each metric independently:
 *  max coins/goldbars/secrets, min deaths/timeFrames. Returns a new object. */
export function recordClear(p: ProgressData, id: LevelId, best: ActBest): ProgressData {
  const prev = p.cleared[id];
  const merged: ActBest = prev
    ? {
        coins: Math.max(prev.coins, best.coins),
        goldbars: Math.max(prev.goldbars, best.goldbars),
        secrets: Math.max(prev.secrets, best.secrets),
        deaths: Math.min(prev.deaths, best.deaths),
        timeFrames: Math.min(prev.timeFrames, best.timeFrames),
      }
    : { ...best };
  return { cleared: { ...p.cleared, [id]: merged }, seen: { ...p.seen } };
}

/** The first act of the order is always unlocked; any other act unlocks when
 *  the act before it in the order is cleared. An id not in the order THROWS —
 *  that is a caller bug, not a save-data condition. */
export function isUnlocked(p: ProgressData, order: readonly LevelId[], id: LevelId): boolean {
  const idx = order.indexOf(id);
  if (idx < 0) throw new Error(`isUnlocked: level id not in campaign order: ${id}`);
  if (idx === 0) return true;
  const prev = order[idx - 1]!;
  return p.cleared[prev] !== undefined;
}

/** Mark a cutscene as watched. Returns a new object. */
export function markSeen(p: ProgressData, id: CutsceneId): ProgressData {
  return { cleared: { ...p.cleared }, seen: { ...p.seen, [id]: true } };
}

/** Where "Continue" lands: the first non-cleared act that is unlocked, or the
 *  last act of the order when everything is cleared. */
export function continueAt(p: ProgressData, order: readonly LevelId[]): LevelId {
  const last = order[order.length - 1];
  if (last === undefined) throw new Error('continueAt: empty campaign order');
  for (const id of order) {
    if (p.cleared[id] === undefined && isUnlocked(p, order, id)) return id;
  }
  return last;
}
