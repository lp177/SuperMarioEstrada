// ============================================================================
// World 3 gate — every Casino Peninsula act must pass the full act contract,
// plus the world-level invariants the contract does not know about: roster
// order against the frozen map graph, casino theme, width band, the goal
// landing 6-10 tiles before the right edge with ground running to it, and
// the Immunity badge staying rare (exactly two in the whole world).
// ============================================================================

import { describe, expect, it } from 'vitest';
import type { LevelId } from '../src/core/types.ts';
import { SOLIDITY, TILE } from '../src/core/constants.ts';
import { buildLevel } from '../src/game/levelBuilder.ts';
import { WORLD_MAPS } from '../src/levels/maps.ts';
import { world3 } from '../src/levels/world3.ts';
import { checkAct } from './actContract.ts';

const W3_IDS: LevelId[] = ['w3a1', 'w3a2', 'w3a3', 'w3a4', 'w3a5', 'w3a6', 'w3a7', 'w3a8'];

describe('world 3 — Casino Peninsula roster', () => {
  it('holds exactly the 8 acts of the world-3 map graph, in act order', () => {
    expect(world3.map((d) => d.id)).toEqual(W3_IDS);
    const map = WORLD_MAPS.find((m) => m.world === 3);
    expect(map).toBeDefined();
    const mapIds = [...(map?.nodes.map((n) => n.levelId) ?? [])].sort();
    expect([...world3.map((d) => d.id)].sort()).toEqual(mapIds);
  });

  it('every act is casino-themed, world 3, width 180-230', () => {
    for (const def of world3) {
      expect(def.theme, `${def.id} theme`).toBe('casino');
      expect(def.world, `${def.id} world`).toBe(3);
      expect(def.width, `${def.id} width`).toBeGreaterThanOrEqual(180);
      expect(def.width, `${def.id} width`).toBeLessThanOrEqual(230);
    }
  });

  it('titles and excuses are unique within the world, excuses non-empty', () => {
    const titles = new Set(world3.map((d) => d.title));
    expect(titles.size).toBe(world3.length);
    const excuses = new Set(world3.map((d) => d.excuse));
    expect(excuses.size).toBe(world3.length);
    for (const def of world3) {
      expect(def.excuse.trim().length, `${def.id} excuse`).toBeGreaterThan(0);
    }
  });

  it('only the castle act carries boss/cutscene flags', () => {
    for (const def of world3) {
      if (def.id === 'w3a8') {
        expect(def.boss, 'w3a8 boss').toBe(true);
        expect(def.cutsceneAfter, 'w3a8 cutscene').toBe('w3-end');
      } else {
        expect(def.boss ?? false, `${def.id} boss`).toBe(false);
        expect(def.cutsceneAfter, `${def.id} cutscene`).toBeUndefined();
      }
      expect(def.bossRage ?? false, `${def.id} bossRage (w4a7 only)`).toBe(false);
    }
  });

  it('the goal sits 6-10 tiles before width and ground runs to the right edge', () => {
    for (const def of world3) {
      const built = buildLevel(def);
      const goalTx = Math.floor(built.goalX / TILE);
      expect(goalTx, `${def.id} goal tile`).toBeGreaterThanOrEqual(def.width - 10);
      expect(goalTx, `${def.id} goal tile`).toBeLessThanOrEqual(def.width - 6);
      let solid = false;
      for (let ty = 0; ty < built.map.hTiles; ty++) {
        if (SOLIDITY[built.map.tileAt(def.width - 1, ty)] === 'solid') solid = true;
      }
      expect(solid, `${def.id} last column has no ground`).toBe(true);
    }
  });

  it('the Immunity badge stays rare: exactly two in the whole world', () => {
    let immunity = 0;
    for (const def of world3) {
      for (const contents of buildLevel(def).blockContents.values()) {
        if (contents === 'immunity') immunity++;
      }
    }
    expect(immunity).toBe(2);
  });
});

describe('world 3 — act contract', () => {
  for (const def of world3) {
    it(`${def.id} '${def.title}' passes checkAct`, () => {
      checkAct(def);
    });
  }
});
