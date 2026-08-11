// ============================================================================
// World 1 gate — every authored w1 act must pass the full act contract
// (structure, nothing buried, reachability, forward-reachability, flow bot,
// idle silence), plus the world-level roster facts the contract cannot see:
// the frozen id/title list, meadow theming, width band, and unique excuses.
// ============================================================================

import { describe, expect, it } from 'vitest';
import type { LevelId } from '../src/core/types.ts';
import { WORLD_MAPS } from '../src/levels/maps.ts';
import { world1 } from '../src/levels/world1.ts';
import { checkAct } from './actContract.ts';

/** The frozen w1 roster: ids from the campaign graph, titles from the brief. */
const W1_TITLES: Record<string, string> = {
  w1a1: 'Foreclosure Fields',
  w1a2: 'Bet Slip Meadows',
  w1a3: 'Billboard Heights',
  w1a4: 'Coin Vacuum Valley',
  w1a5: 'Toad Tent City',
  w1a6: "Grandma's Hat Ravine",
  w1a7: 'The Repossessed Keep',
};

describe('world 1 roster', () => {
  const w1map = WORLD_MAPS.find((m) => m.world === 1);
  if (!w1map) throw new Error('world 1 missing from WORLD_MAPS');
  const mapIds: LevelId[] = w1map.nodes.map((n) => n.levelId);

  it('holds exactly the seven w1 nodes of the campaign graph, in act order', () => {
    expect(world1.map((d) => d.id)).toEqual(mapIds);
    for (const d of world1) {
      expect(d.world, `${d.id} world field`).toBe(1);
      expect(d.id, `${d.id} id/act consistency`).toBe(`w1a${d.act}`);
    }
  });

  it('carries the frozen titles', () => {
    for (const d of world1) {
      expect(d.title, `${d.id} title`).toBe(W1_TITLES[d.id]);
    }
  });

  it('is meadow-themed with widths in the 140-180 band', () => {
    for (const d of world1) {
      expect(d.theme, `${d.id} theme`).toBe('meadow');
      expect(d.width, `${d.id} width`).toBeGreaterThanOrEqual(140);
      expect(d.width, `${d.id} width`).toBeLessThanOrEqual(180);
    }
  });

  it('only the castle is a boss act, ending in w1-end; no act rages', () => {
    for (const d of world1) {
      if (d.id === 'w1a7') {
        expect(d.boss, 'w1a7 must be the boss act').toBe(true);
        expect(d.cutsceneAfter, 'w1a7 cutscene').toBe('w1-end');
      } else {
        expect(d.boss ?? false, `${d.id} must not be a boss act`).toBe(false);
        expect(d.cutsceneAfter, `${d.id} must not carry a cutscene`).toBeUndefined();
      }
      expect(d.bossRage ?? false, `${d.id} must not rage (w4 castle only)`).toBe(false);
    }
  });

  it('has a unique, non-empty excuse per act', () => {
    const seen = new Map<string, LevelId>();
    for (const d of world1) {
      expect(d.excuse.trim().length, `${d.id} has an empty excuse`).toBeGreaterThan(0);
      const dup = seen.get(d.excuse);
      expect(dup, `excuse reused by ${dup} and ${d.id}`).toBeUndefined();
      seen.set(d.excuse, d.id);
    }
  });
});

describe('world 1 act contract', () => {
  // One `it` per act so a failure names its act in the runner. The roster
  // test above catches acts missing entirely.
  for (const def of world1) {
    it(`${def.id} '${def.title}' passes checkAct`, () => {
      checkAct(def);
    });
  }
});
