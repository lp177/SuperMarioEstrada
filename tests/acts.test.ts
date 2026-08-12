// ============================================================================
// The campaign-wide gate. Two halves:
//
//   1. 'campaign roster' — LEVELS must be the exact 30-act campaign that
//      WORLD_MAPS describes, and every act must pass checkAct. THIS HALF IS
//      EXPECTED TO BE RED until the four world agents land their acts. Do not
//      weaken it; it is the finish line, not a smoke test.
//
//   2. 'checkAct fixtures' — proves the contract itself against inline
//      fixture acts: one GOOD act (authored with motifs — it doubles as
//      executable authoring documentation) and BAD acts for each rule class.
//      Run only this half with:
//        npx vitest run tests/acts.test.ts -t 'checkAct fixtures'
// ============================================================================

import { describe, expect, it } from 'vitest';
import type { CutsceneId, LevelDef, LevelId, WorldNo } from '../src/core/types.ts';
import { LEVELS } from '../src/levels/index.ts';
import { CASTLES, WORLD_MAPS } from '../src/levels/maps.ts';
import { checkAct, flowBot } from './actContract.ts';
import { Level } from '../src/game/level.ts';
import { TILE } from '../src/core/constants.ts';
import {
  brickGallery,
  checkpointRest,
  coinArc,
  crumbleBridge,
  enemyGauntlet,
  finishRunway,
  gapJump,
  goldbarPerch,
  pipeField,
  runway,
  secretPocket,
  steppes,
} from '../src/game/motifs.ts';

const CASTLE_CUTSCENE: Record<WorldNo, CutsceneId> = {
  1: 'w1-end',
  2: 'w2-end',
  3: 'w3-end',
  4: 'ending',
};

// ---------------------------------------------------------------------------
// Half 1: the campaign roster. RED until all 30 acts exist — by design.
// ---------------------------------------------------------------------------
describe('campaign roster', () => {
  const mapIds: LevelId[] = WORLD_MAPS.flatMap((m) => m.nodes.map((n) => n.levelId));

  it('LEVELS holds exactly the 30 acts of the world-map graph (both directions)', () => {
    expect(mapIds.length).toBe(30); // the graph itself is frozen at 30 nodes
    const defIds = LEVELS.map((d) => d.id);
    expect(new Set(defIds).size, 'duplicate level ids in LEVELS').toBe(defIds.length);
    // both directions: every def is on the map, every map node has a def
    expect([...defIds].sort()).toEqual([...mapIds].sort());
  });

  it('titles are unique', () => {
    const titles = LEVELS.map((d) => d.title);
    const seen = new Map<string, LevelId>();
    for (const d of LEVELS) {
      const dup = seen.get(d.title);
      expect(dup, `title '${d.title}' used by both ${dup} and ${d.id}`).toBeUndefined();
      seen.set(d.title, d.id);
    }
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('excuses are unique and non-empty', () => {
    const seen = new Map<string, LevelId>();
    for (const d of LEVELS) {
      expect(d.excuse.trim().length, `${d.id} has an empty excuse`).toBeGreaterThan(0);
      const dup = seen.get(d.excuse);
      expect(dup, `excuse '${d.excuse}' used by both ${dup} and ${d.id}`).toBeUndefined();
      seen.set(d.excuse, d.id);
    }
  });

  it('castle acts carry boss + their world cutscene; non-castle acts carry neither', () => {
    const castleIds = new Set<LevelId>(Object.values(CASTLES));
    for (const world of [1, 2, 3, 4] as const) {
      const id = CASTLES[world];
      const def = LEVELS.find((d) => d.id === id);
      expect(def, `castle act ${id} missing from LEVELS`).toBeDefined();
      if (!def) continue;
      expect(def.boss, `${id} must set boss: true`).toBe(true);
      expect(def.cutsceneAfter, `${id} must end in '${CASTLE_CUTSCENE[world]}'`).toBe(
        CASTLE_CUTSCENE[world],
      );
      if (world === 4) expect(def.bossRage, `${id} is the real fight — bossRage`).toBe(true);
      else expect(def.bossRage ?? false, `${id} is staged — no bossRage`).toBe(false);
    }
    for (const def of LEVELS) {
      if (castleIds.has(def.id)) continue;
      expect(def.cutsceneAfter, `${def.id} is not a castle — no cutsceneAfter`).toBeUndefined();
      expect(def.boss ?? false, `${def.id} is not a castle — no boss`).toBe(false);
      expect(def.bossRage ?? false, `${def.id} is not a castle — no bossRage`).toBe(false);
    }
  });

  describe('act contract', () => {
    // One `it` per existing def so a failure names its act in the runner.
    // The roster-count test above is what catches acts that are missing
    // entirely (this loop can only gate what exists).
    for (const def of LEVELS) {
      it(`${def.id} '${def.title}' passes checkAct`, () => {
        checkAct(def);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Half 2: fixtures proving the contract itself.
// ---------------------------------------------------------------------------

/** The GOOD fixture — a complete, motif-authored act (~150 tiles). This is
 *  the executable authoring documentation: chain motifs on {endX,endRow},
 *  place start/goal, and the counts land where ACT_RULES wants them.
 *  Coins: 41 entities + 2 coin qblocks = 43 (>= 40). Enemies: lobbyist +
 *  pollster + lawyer = 3. Goldbars 0-4, secrets 0-2, one checkpoint. */
const goodAct: LevelDef = {
  id: 'w1a3',
  world: 1,
  act: 3,
  title: 'Fixture Heights',
  excuse: 'The princess rescheduled. I have the fax to prove it.',
  theme: 'meadow',
  width: 150,
  build(b) {
    let c = runway(b, 0, 26, { len: 12, coinRow: 21, rings: true }); // 16 coins
    b.start(2, 25);
    c = brickGallery(b, c.endX, c.endRow, { len: 10, powerup: 'stamp' }); // 2 coin qblocks
    c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'pollster'] });
    c = goldbarPerch(b, c.endX, c.endRow, { index: 0 });
    c = gapJump(b, c.endX, c.endRow, { gap: 3 });
    c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // 6 coins
    c = secretPocket(b, c.endX, c.endRow, { index: 0 });
    c = checkpointRest(b, c.endX, c.endRow); // 3 coins
    c = runway(b, c.endX, c.endRow, { len: 8, coinRow: 22, rings: true }); // 9 coins
    c = goldbarPerch(b, c.endX, c.endRow, { index: 1 });
    c = pipeField(b, c.endX, c.endRow, { pipes: 2, lawyer: true }); // 3rd enemy
    c = secretPocket(b, c.endX, c.endRow, { index: 1 });
    c = goldbarPerch(b, c.endX, c.endRow, { index: 2 });
    c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 3, dir: 1 }); // lane rises to row 22
    c = goldbarPerch(b, c.endX, c.endRow, { index: 3 });
    c = secretPocket(b, c.endX, c.endRow, { index: 2 });
    c = crumbleBridge(b, c.endX, c.endRow, { len: 4 });
    c = goldbarPerch(b, c.endX, c.endRow, { index: 4 });
    c = runway(b, c.endX, c.endRow, { len: 6, coinRow: 18, rings: true }); // 7 coins
    finishRunway(b, c.endX, c.endRow, { len: 8 }); // ends exactly at width 150
  },
};

/** Options for the tiny bad-fixture act. The clean baseline passes checkAct;
 *  each flag breaks exactly one rule so each bad test fails for its OWN
 *  reason and not an accident of the layout. */
interface TinyOpts {
  dropGoldbar?: boolean; // rule 1: only 4 goldbars
  buriedCoin?: boolean; // rule 2: a coin inside the ground fill
  sealedSecret?: boolean; // rule 3: secret 2 bricked into a floating vault
  wall?: boolean; // rule 5: a 12-tile wall the fill passes but the bot cannot
  gavelAtStart?: boolean; // rule 6: a gavel slamming next to the idle spawn
}

function tinyAct(opts: TinyOpts = {}): LevelDef {
  return {
    id: 'w1a2',
    world: 1,
    act: 2,
    title: 'Fixture Flats',
    excuse: 'The stamp pad was dry. A dry stamp pad is a legal void.',
    theme: 'meadow',
    width: 60,
    build(b) {
      b.ground(0, 59, 26);
      b.start(2, 25);
      b.coinRow(3, 29, 22); // 27 coins
      b.coinRow(44, 58, 22); // 15 coins -> 42 total
      const bars = opts.dropGoldbar ? 4 : 5;
      for (let i = 0; i < bars; i++) b.goldbar(i, 6 + i * 4, 24);
      b.secret(0, 24, 24);
      b.secret(1, 26, 24);
      if (opts.sealedSecret) {
        // An empty tile bricked in on all four sides: its center tile is
        // 'empty' (rule 2 passes) but no flood fill can enter (rule 3 fails).
        b.platform(33, 35, 9, 'brick');
        b.platform(33, 35, 11, 'brick');
        b.brick(33, 10);
        b.brick(35, 10);
        b.secret(2, 34, 10);
      } else {
        b.secret(2, 28, 24);
      }
      b.checkpoint(40, 25);
      if (opts.buriedCoin) b.coin(5, 27); // inside the ground fill
      if (opts.wall) b.ground(30, 31, 14); // 12 rows above the lane: the fill
      // crosses the open sky above it, the bot's ~8-tile jump cannot
      if (opts.gavelAtStart) b.enemy('gavel', 4, 22); // slams on its own clock
      b.enemy('lobbyist', 46, 25);
      b.enemy('lobbyist', 49, 25);
      b.enemy('lobbyist', 52, 25);
      b.goal(56, 25);
    },
  };
}

describe('checkAct fixtures', () => {
  it('accepts the motif-authored good act', () => {
    expect(() => checkAct(goodAct)).not.toThrow();
  });

  it('accepts the tiny baseline (so each bad fixture fails for its own reason)', () => {
    expect(() => checkAct(tinyAct())).not.toThrow();
  });

  it('flowBot reports a full clear of the baseline', () => {
    const level = new Level(tinyAct());
    const bot = flowBot(level);
    expect(bot.finished).toBe(true);
    // the goal ceremony walks the hero INTO the door and stops 4px short of
    // goalX — a cleared run now tops out at the doorstep, not past it
    expect(bot.maxX).toBeGreaterThanOrEqual(level.goalX - TILE);
    expect(bot.stallFrames).toBeLessThanOrEqual(150);
    expect(bot.frames).toBeLessThan(1500); // 60 flat tiles: a quick jog
  });

  it('rejects a missing goldbar (rule 1)', () => {
    expect(() => checkAct(tinyAct({ dropGoldbar: true }))).toThrow(/rule 1 .*goldbar/);
  });

  it('rejects a buried coin (rule 2)', () => {
    expect(() => checkAct(tinyAct({ buriedCoin: true }))).toThrow(
      /rule 2 .*coin at px \(88,440\) tile \(5,27\)/,
    );
  });

  it('rejects an unreachable secret (rule 3)', () => {
    expect(() => checkAct(tinyAct({ sealedSecret: true }))).toThrow(
      /rule 3 .*secret 2 .*not reachable/,
    );
  });

  it('rejects an act the bot cannot clear: a 12-tile wall (rule 5)', () => {
    expect(() => checkAct(tinyAct({ wall: true }))).toThrow(/rule 5 \(flow bot\)/);
  });

  it('rejects idle noise: a gavel slamming beside the spawn (rule 6)', () => {
    expect(() => checkAct(tinyAct({ gavelAtStart: true }))).toThrow(/rule 6 \(idle silence\)/);
  });
});
