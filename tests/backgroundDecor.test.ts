// Tests for src/render/background.ts and src/render/decor.ts.
// Runs in plain Node: the canvas context is a no-op Proxy stub, which proves
// the modules never read DOM globals and never crash across themes/frames.
// Visual correctness is NOT provable here — that needs integration screenshots.

import { describe, it, expect } from 'vitest';
import type { TileKind, TileMapLike, ThemeId } from '../src/core/types.ts';
import { TILE } from '../src/core/constants.ts';
import { drawBackground } from '../src/render/background.ts';
import { buildDecor, drawDecor, type Decor } from '../src/render/decor.ts';

const THEMES: readonly ThemeId[] = ['meadow', 'sewer', 'casino', 'castle'];

// --------------------------------------------------------------------------
// Stubs
// --------------------------------------------------------------------------

function mockCtx(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => undefined };
  return new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
          return () => gradient;
        }
        if (prop === 'measureText') return () => ({ width: 10 });
        return () => undefined; // every other method is a no-op
      },
      set: () => true, // fillStyle, font, lineWidth, ...
    },
  ) as unknown as CanvasRenderingContext2D;
}

/** Flat 'ground' surface at `surface`, with a pit (no ground at all) over
 *  [pitX0, pitX1] and a column of pipe tiles at pipeX. */
function testMap(w: number, h: number, surface: number, pitX0 = -1, pitX1 = -2, pipeX = -1): TileMapLike {
  return {
    wTiles: w,
    hTiles: h,
    pixelW: w * TILE,
    pixelH: h * TILE,
    tileAt(tx: number, ty: number): TileKind {
      if (ty < 0) return 'empty';
      if (tx < 0 || tx >= w || ty >= h) return 'bedrock';
      if (tx >= pitX0 && tx <= pitX1) return 'empty';
      if (tx === pipeX) return ty >= surface - 2 ? 'pipe' : 'empty';
      return ty >= surface ? 'ground' : 'empty';
    },
    setTile() {
      throw new Error('test map is read-only');
    },
    solidAtPx() {
      return 'pass';
    },
  };
}

// --------------------------------------------------------------------------
// drawBackground
// --------------------------------------------------------------------------

describe('drawBackground', () => {
  it('draws every theme at many frames without touching real DOM', () => {
    const ctx = mockCtx();
    // includes castle lightning-flash frames (frame % 623 < 6) and non-flash
    const frames = [0, 3, 5, 100, 622, 623 * 4 + 2, 9999];
    for (const theme of THEMES) {
      for (const f of frames) {
        expect(() => drawBackground(ctx, theme, { x: 0, y: 0 }, f)).not.toThrow();
        expect(() => drawBackground(ctx, theme, { x: 5321.5, y: 180 }, f)).not.toThrow();
        expect(() => drawBackground(ctx, theme, { x: -40, y: 0 }, f)).not.toThrow();
      }
    }
  });

  it('throws on an unknown theme id', () => {
    const ctx = mockCtx();
    expect(() => drawBackground(ctx, 'volcano' as ThemeId, { x: 0, y: 0 }, 0)).toThrow(/unknown theme/);
  });
});

// --------------------------------------------------------------------------
// buildDecor
// --------------------------------------------------------------------------

const VOCAB: Record<ThemeId, readonly string[]> = {
  meadow: ['saisieSign', 'betsBillboard', 'boardedHouse', 'flower', 'bush', 'coinTruck', 'grassTuft'],
  sewer: ['leakPipe', 'ratHole', 'skeletonBettor', 'launderTape', 'sewerShroom', 'mossTuft'],
  casino: ['slotFacade', 'chipStack', 'cardLean', 'allInArrow', 'velvetRope', 'chipScatter'],
  castle: ['impeachStatue', 'ballotCrenel', 'chainedDoor', 'wallTorch', 'graffiti', 'emberTuft'],
};

const FRONT_KINDS = new Set(['grassTuft', 'mossTuft', 'chipScatter', 'emberTuft']);

describe('buildDecor', () => {
  it('is deterministic for a given (theme, map, seed)', () => {
    const map = testMap(220, 30, 20);
    for (const theme of THEMES) {
      const a = buildDecor(theme, map, 1234);
      const b = buildDecor(theme, map, 1234);
      expect(a).toEqual(b);
      expect(a.length).toBeGreaterThan(0);
    }
  });

  it('different seeds give different sprinklings', () => {
    const map = testMap(220, 30, 20);
    const a = buildDecor('meadow', map, 1);
    const b = buildDecor('meadow', map, 2);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('anchors every item on the surface line, inside the map', () => {
    const surface = 20;
    const map = testMap(220, 30, surface);
    for (const theme of THEMES) {
      for (const d of buildDecor(theme, map, 77)) {
        expect(d.y).toBe(surface * TILE);
        expect(d.x).toBeGreaterThan(0);
        expect(d.x).toBeLessThan(map.pixelW);
      }
    }
  });

  it('uses only the theme vocabulary, and produces both layers', () => {
    const map = testMap(300, 30, 20);
    for (const theme of THEMES) {
      const items = buildDecor(theme, map, 42);
      const kinds = new Set(items.map((d) => d.kind));
      for (const k of kinds) expect(VOCAB[theme]).toContain(k);
      expect(items.some((d) => FRONT_KINDS.has(d.kind))).toBe(true);
      expect(items.some((d) => !FRONT_KINDS.has(d.kind))).toBe(true);
    }
  });

  it('never decorates pit columns or non-ground (pipe) columns', () => {
    const pit0 = 40;
    const pit1 = 55;
    const pipeX = 80;
    const map = testMap(160, 30, 20, pit0, pit1, pipeX);
    for (const theme of THEMES) {
      for (const d of buildDecor(theme, map, 9)) {
        const tx = Math.floor(d.x / TILE);
        expect(tx < pit0 || tx > pit1).toBe(true);
        expect(tx).not.toBe(pipeX);
      }
    }
  });

  it('throws on an unknown theme id', () => {
    const map = testMap(40, 30, 20);
    expect(() => buildDecor('volcano' as ThemeId, map, 1)).toThrow(/unknown theme/);
  });
});

// --------------------------------------------------------------------------
// drawDecor
// --------------------------------------------------------------------------

describe('drawDecor', () => {
  it('draws every generated item in both layers without throwing', () => {
    const ctx = mockCtx();
    const map = testMap(300, 30, 20);
    for (const theme of THEMES) {
      const items = buildDecor(theme, map, 42);
      for (const frame of [0, 61, 1234]) {
        // cam sweep so nothing is culled at least once
        for (const camX of [0, 1000, 3000]) {
          expect(() => drawDecor(ctx, items, { x: camX, y: 40 }, 'back', frame)).not.toThrow();
          expect(() => drawDecor(ctx, items, { x: camX, y: 40 }, 'front', frame)).not.toThrow();
        }
      }
    }
  });

  it('THROWS on a decor kind missing from the switch (never guard)', () => {
    const ctx = mockCtx();
    const rogue = [{ kind: 'nftKiosk', x: 10, y: 320, variant: 0 } as unknown as Decor];
    expect(() => drawDecor(ctx, rogue, { x: 0, y: 0 }, 'back', 0)).toThrow();
  });
});
