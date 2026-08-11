import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadProgress,
  saveProgress,
  recordClear,
  isUnlocked,
  markSeen,
  continueAt,
} from '../src/game/progress.ts';
import { STORAGE_KEYS } from '../src/core/constants.ts';
import type { ActBest, LevelId, ProgressData } from '../src/core/types.ts';

// ---------------------------------------------------------------------------
// Fake localStorage injected on globalThis; restored in afterEach. Uses
// defineProperty because Node may expose localStorage as a getter-only global.
// ---------------------------------------------------------------------------
const store = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string): string | null => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string): void => {
    store.set(k, String(v));
  },
  removeItem: (k: string): void => {
    store.delete(k);
  },
  clear: (): void => {
    store.clear();
  },
};
let origDesc: PropertyDescriptor | undefined;

beforeEach(() => {
  origDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    value: fakeStorage,
    configurable: true,
    writable: true,
  });
  store.clear();
});

afterEach(() => {
  if (origDesc) Object.defineProperty(globalThis, 'localStorage', origDesc);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
});

const ORDER: readonly LevelId[] = ['w1a1', 'w1a2', 'w1a3', 'w1a4', 'w2a1'];

const best = (over: Partial<ActBest> = {}): ActBest => ({
  coins: 0,
  goldbars: 0,
  secrets: 0,
  deaths: 0,
  timeFrames: 6000,
  ...over,
});

describe('progress load/save', () => {
  it('fresh defaults when storage is empty', () => {
    const p = loadProgress();
    expect(p.cleared).toEqual({});
    expect(p.seen).toEqual({});
  });

  it('corrupt JSON recovers to fresh defaults, never a throw', () => {
    store.set(STORAGE_KEYS.progress, '{definitely not json[[[');
    expect(() => loadProgress()).not.toThrow();
    expect(loadProgress()).toEqual({ cleared: {}, seen: {} });
  });

  it('wrong top-level shapes recover to defaults', () => {
    for (const junk of ['[1,2,3]', '"hello"', '42', 'null', '{"cleared":7,"seen":"x"}']) {
      store.set(STORAGE_KEYS.progress, junk);
      expect(loadProgress()).toEqual({ cleared: {}, seen: {} });
    }
  });

  it('drops malformed entries but keeps valid ones', () => {
    store.set(
      STORAGE_KEYS.progress,
      JSON.stringify({
        cleared: {
          w1a1: best({ coins: 12 }), // valid
          w9a9: best(), // impossible id: dropped
          w1a2: { coins: 'lots' }, // malformed best: dropped
          'not-a-level': true, // garbage: dropped
        },
        seen: { intro: true, 'w1-end': false, 'made-up-scene': true },
      }),
    );
    const p = loadProgress();
    expect(Object.keys(p.cleared)).toEqual(['w1a1']);
    expect(p.cleared['w1a1']?.coins).toBe(12);
    expect(p.seen).toEqual({ intro: true }); // false and unknown ids dropped
  });

  it('round-trips through save/load under the versioned key', () => {
    let p = loadProgress();
    p = recordClear(p, 'w1a1', best({ coins: 33, goldbars: 4, secrets: 2, deaths: 1 }));
    p = markSeen(p, 'intro');
    saveProgress(p);
    expect(store.has(STORAGE_KEYS.progress)).toBe(true);
    expect(loadProgress()).toEqual(p);
  });

  it('works with no localStorage at all (headless), silently', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(() => saveProgress({ cleared: {}, seen: {} })).not.toThrow();
    expect(loadProgress()).toEqual({ cleared: {}, seen: {} });
  });
});

describe('recordClear best-merging', () => {
  it('keeps the BEST of each metric independently', () => {
    let p: ProgressData = { cleared: {}, seen: {} };
    p = recordClear(
      p,
      'w1a1',
      best({ coins: 10, goldbars: 2, secrets: 1, deaths: 5, timeFrames: 4000 }),
    );
    p = recordClear(
      p,
      'w1a1',
      best({ coins: 5, goldbars: 3, secrets: 0, deaths: 2, timeFrames: 5000 }),
    );
    expect(p.cleared['w1a1']).toEqual({
      coins: 10, // max
      goldbars: 3, // max
      secrets: 1, // max
      deaths: 2, // min
      timeFrames: 4000, // min
    });
  });

  it('returns a new object and never mutates its input', () => {
    const p0: ProgressData = { cleared: {}, seen: {} };
    const p1 = recordClear(p0, 'w1a1', best({ coins: 7 }));
    expect(p1).not.toBe(p0);
    expect(p0.cleared['w1a1']).toBeUndefined();
    expect(p1.cleared['w1a1']?.coins).toBe(7);
    const p2 = markSeen(p1, 'w1-end');
    expect(p1.seen['w1-end']).toBeUndefined();
    expect(p2.seen['w1-end']).toBe(true);
  });
});

describe('unlock chain', () => {
  it('first act of the order is always unlocked', () => {
    const p: ProgressData = { cleared: {}, seen: {} };
    expect(isUnlocked(p, ORDER, 'w1a1')).toBe(true);
    expect(isUnlocked(p, ORDER, 'w1a2')).toBe(false);
    expect(isUnlocked(p, ORDER, 'w2a1')).toBe(false);
  });

  it('clearing an act unlocks exactly the next one in order', () => {
    let p: ProgressData = { cleared: {}, seen: {} };
    p = recordClear(p, 'w1a1', best());
    expect(isUnlocked(p, ORDER, 'w1a2')).toBe(true);
    expect(isUnlocked(p, ORDER, 'w1a3')).toBe(false);
    p = recordClear(p, 'w1a2', best());
    p = recordClear(p, 'w1a3', best());
    p = recordClear(p, 'w1a4', best());
    expect(isUnlocked(p, ORDER, 'w2a1')).toBe(true); // across world boundary
  });

  it('throws for an id not present in the order (caller bug, not save data)', () => {
    const p: ProgressData = { cleared: {}, seen: {} };
    expect(() => isUnlocked(p, ORDER, 'w4a4')).toThrow();
  });
});

describe('continueAt', () => {
  it('fresh save continues at the first act', () => {
    expect(continueAt({ cleared: {}, seen: {} }, ORDER)).toBe('w1a1');
  });

  it('continues at the first non-cleared unlocked act', () => {
    let p: ProgressData = { cleared: {}, seen: {} };
    p = recordClear(p, 'w1a1', best());
    expect(continueAt(p, ORDER)).toBe('w1a2');
    p = recordClear(p, 'w1a2', best());
    p = recordClear(p, 'w1a3', best());
    expect(continueAt(p, ORDER)).toBe('w1a4');
  });

  it('everything cleared lands on the last act', () => {
    let p: ProgressData = { cleared: {}, seen: {} };
    for (const id of ORDER) p = recordClear(p, id, best());
    expect(continueAt(p, ORDER)).toBe('w2a1');
  });

  it('throws on an empty order', () => {
    expect(() => continueAt({ cleared: {}, seen: {} }, [])).toThrow();
  });
});
