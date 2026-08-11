// ============================================================================
// World 4 gate — every Bowsonaro palace act must pass the full act contract
// (structure, nothing buried, reachability, forward-reachability, flow bot,
// idle silence), plus the world-level roster shape the campaign brief fixes:
// seven acts in act order, frozen titles, unique excuses, the rage boss only
// on the final castle.
// ============================================================================

import { describe, expect, it } from 'vitest';
import type { LevelId } from '../src/core/types.ts';
import { world4 } from '../src/levels/world4.ts';
import { checkAct } from './actContract.ts';

/** Frozen by maps.ts (ids/order) and the campaign brief (titles). */
const ROSTER: readonly { id: LevelId; title: string }[] = [
  { id: 'w4a1', title: 'Drawbridge Drive' },
  { id: 'w4a2', title: 'Ballot Battlements' },
  { id: 'w4a3', title: 'Statue Gallery' },
  { id: 'w4a4', title: 'Lava Laundry' },
  { id: 'w4a5', title: 'Throne Approach' },
  { id: 'w4a6', title: 'The Panic Room' },
  { id: 'w4a7', title: 'The Big Beautiful Throne' },
];

describe('world 4 roster', () => {
  it('holds exactly the seven w4 acts, in act order, with the frozen titles', () => {
    expect(world4.map((d) => ({ id: d.id, title: d.title }))).toEqual(ROSTER);
    for (const [i, d] of world4.entries()) {
      expect(d.world, `${d.id} world`).toBe(4);
      expect(d.act, `${d.id} act`).toBe(i + 1);
      expect(d.theme, `${d.id} theme`).toBe('castle');
    }
  });

  it('keeps widths in the 200-260 band, the final castle longest', () => {
    for (const d of world4) {
      expect(d.width, `${d.id} width`).toBeGreaterThanOrEqual(200);
      expect(d.width, `${d.id} width`).toBeLessThanOrEqual(260);
    }
    const widest = Math.max(...world4.map((d) => d.width));
    expect(world4[world4.length - 1]!.width, 'w4a7 must be the longest act').toBe(widest);
  });

  it('has unique, non-empty excuses', () => {
    const seen = new Map<string, LevelId>();
    for (const d of world4) {
      expect(d.excuse.trim().length, `${d.id} has an empty excuse`).toBeGreaterThan(0);
      const dup = seen.get(d.excuse);
      expect(dup, `excuse reused by ${dup} and ${d.id}`).toBeUndefined();
      seen.set(d.excuse, d.id);
    }
  });

  it('puts the rage boss and the ending cutscene on w4a7 only', () => {
    for (const d of world4) {
      const isCastle = d.id === 'w4a7';
      expect(d.boss ?? false, `${d.id} boss`).toBe(isCastle);
      expect(d.bossRage ?? false, `${d.id} bossRage`).toBe(isCastle);
      expect(d.cutsceneAfter, `${d.id} cutsceneAfter`).toBe(isCastle ? 'ending' : undefined);
    }
  });
});

describe('world 4 act contract', () => {
  for (const def of world4) {
    it(`${def.id} '${def.title}' passes checkAct`, () => {
      checkAct(def);
    });
  }
});
