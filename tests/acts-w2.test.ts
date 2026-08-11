// ============================================================================
// World 2 gate — every act of THE MONEY PIPES must pass the full act contract
// (structure, nothing buried, reachability, forward-reachability, flow bot,
// idle silence), plus world-level roster checks: the eight frozen map nodes
// in act order, the frozen titles, unique excuses, sane widths, and the
// castle flags on w2a8 alone.
// ============================================================================

import { describe, expect, it } from 'vitest';
import type { LevelId } from '../src/core/types.ts';
import { WORLD_MAPS } from '../src/levels/maps.ts';
import { world2 } from '../src/levels/world2.ts';
import { checkAct } from './actContract.ts';

/** The frozen titles (campaign brief). A typo here is a content bug. */
const TITLES: Record<string, string> = {
  w2a1: 'Coin Chute Drop',
  w2a2: 'Laundering Lanes',
  w2a3: 'Rat Union Hall',
  w2a4: 'Skeleton Vault',
  w2a5: 'Leak Alley',
  w2a6: 'Dungeon Door Detour',
  w2a7: 'The Money Main',
  w2a8: 'Drainage Donjon',
};

describe('world 2 roster', () => {
  const map = WORLD_MAPS.find((m) => m.world === 2);
  if (!map) throw new Error('world 2 missing from WORLD_MAPS');
  const mapIds: LevelId[] = map.nodes.map((n) => n.levelId);

  it('holds exactly the 8 map nodes, in act order', () => {
    expect(world2.map((d) => d.id)).toEqual(mapIds);
    for (let i = 0; i < world2.length; i++) {
      const def = world2[i];
      if (!def) throw new Error(`world2[${i}] missing`);
      expect(def.world, `${def.id} world`).toBe(2);
      expect(def.act, `${def.id} act`).toBe(i + 1);
      expect(def.theme, `${def.id} theme`).toBe('sewer');
    }
  });

  it('carries the frozen titles', () => {
    for (const def of world2) {
      expect(def.title, `${def.id} title`).toBe(TITLES[def.id]);
    }
  });

  it('excuses are unique, non-empty one-liners', () => {
    const seen = new Map<string, LevelId>();
    for (const def of world2) {
      expect(def.excuse.trim().length, `${def.id} empty excuse`).toBeGreaterThan(0);
      expect(def.excuse.includes('\n'), `${def.id} excuse is not one line`).toBe(false);
      const dup = seen.get(def.excuse);
      expect(dup, `excuse shared by ${dup} and ${def.id}`).toBeUndefined();
      seen.set(def.excuse, def.id);
    }
  });

  it('widths sit in the world-2 band (160..200)', () => {
    for (const def of world2) {
      expect(def.width, `${def.id} width`).toBeGreaterThanOrEqual(160);
      expect(def.width, `${def.id} width`).toBeLessThanOrEqual(200);
    }
  });

  it('only the castle (w2a8) carries boss + w2-end; nothing rages', () => {
    for (const def of world2) {
      if (def.id === 'w2a8') {
        expect(def.boss, 'w2a8 boss').toBe(true);
        expect(def.cutsceneAfter, 'w2a8 cutscene').toBe('w2-end');
      } else {
        expect(def.boss ?? false, `${def.id} boss`).toBe(false);
        expect(def.cutsceneAfter, `${def.id} cutscene`).toBeUndefined();
      }
      expect(def.bossRage ?? false, `${def.id} bossRage`).toBe(false);
    }
  });
});

describe('world 2 act contract', () => {
  for (const def of world2) {
    it(`${def.id} '${def.title}' passes checkAct`, () => {
      checkAct(def);
    });
  }
});
