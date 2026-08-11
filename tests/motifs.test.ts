import { describe, it, expect } from 'vitest';
import { LevelBuilder, buildLevel } from '../src/game/levelBuilder.ts';
import {
  LANE_TOP_ROW,
  laneBottomRow,
  arenaApproach,
  brickGallery,
  checkpointRest,
  coinArc,
  crumbleBridge,
  enemyGauntlet,
  finishRunway,
  gapJump,
  goldbarPerch,
  onewayClimb,
  pipeField,
  runway,
  secretPocket,
  springboardWall,
  steppes,
} from '../src/game/motifs.ts';
import { SOLIDITY, TILE, WORLD_H_TILES } from '../src/core/constants.ts';
import type { BuiltLevel, LevelDef, Solidity, TileMapLike } from '../src/core/types.ts';

// ---------------------------------------------------------------------------
// Builder validation — every structural mistake must throw, loudly.
// ---------------------------------------------------------------------------

function def(partial: Partial<LevelDef> & { build: LevelDef['build'] }): LevelDef {
  return {
    id: 'w1a1',
    world: 1,
    act: 1,
    title: 'Foreclosure Flats',
    excuse: 'The rescue was postponed for notarial reasons. Fees apply.',
    theme: 'meadow',
    width: 60,
    ...partial,
  };
}

describe('LevelBuilder validation', () => {
  it('throws when no start was placed', () => {
    const d = def({
      build(b) {
        b.ground(0, 20, 24);
        b.goal(18, 23);
      },
    });
    expect(() => buildLevel(d)).toThrow(/start/);
  });

  it('throws when no goal was placed', () => {
    const d = def({
      build(b) {
        b.ground(0, 20, 24);
        b.start(2, 23);
      },
    });
    expect(() => buildLevel(d)).toThrow(/goal/);
  });

  it('throws on a duplicate goldbar index', () => {
    const d = def({
      build(b) {
        b.ground(0, 20, 24);
        b.start(2, 23);
        b.goal(18, 23);
        b.goldbar(2, 5, 22);
        b.goldbar(2, 8, 22);
      },
    });
    expect(() => buildLevel(d)).toThrow(/goldbar index 2/);
  });

  it('throws on out-of-range goldbar and secret indices', () => {
    const b = new LevelBuilder(40, WORLD_H_TILES);
    expect(() => b.goldbar(5, 4, 20)).toThrow(/goldbar index/);
    expect(() => b.goldbar(-1, 4, 20)).toThrow(/goldbar index/);
    expect(() => b.secret(3, 4, 20)).toThrow(/secret index/);
  });

  it('throws on a duplicate secret index', () => {
    const b = new LevelBuilder(40, WORLD_H_TILES);
    b.secret(1, 4, 20);
    expect(() => b.secret(1, 9, 20)).toThrow(/secret index 1/);
  });

  it('throws on a second start or goal', () => {
    const b = new LevelBuilder(40, WORLD_H_TILES);
    b.start(2, 23);
    expect(() => b.start(3, 23)).toThrow(/twice/);
    b.goal(30, 23);
    expect(() => b.goal(31, 23)).toThrow(/twice/);
  });

  it('throws when a castle act (boss) has no arena', () => {
    const d = def({
      boss: true,
      build(b) {
        b.ground(0, 20, 24);
        b.start(2, 23);
        b.goal(18, 23);
      },
    });
    expect(() => buildLevel(d)).toThrow(/arena/);
  });

  it('throws when the goal lands outside the arena', () => {
    const d = def({
      boss: true,
      build(b) {
        b.ground(0, 9, 24);
        b.start(2, 23);
        b.arena(10, 30, 24);
        b.goal(35, 23);
      },
    });
    expect(() => buildLevel(d)).toThrow(/outside the arena/);
  });

  it('throws on stacked qblocks and unknown enemy kinds', () => {
    const b = new LevelBuilder(40, WORLD_H_TILES);
    b.qblock(5, 20, 'coin');
    expect(() => b.qblock(5, 20, 'stamp')).toThrow(/already/);
    expect(() => b.enemy('influencer' as never, 5, 23)).toThrow(/unknown kind/);
  });

  it('lays ground as surface ground with bedrock below surface+2', () => {
    const b = new LevelBuilder(10, WORLD_H_TILES);
    b.ground(5, 5, 24);
    expect(b.map.tileAt(5, 23)).toBe('empty');
    expect(b.map.tileAt(5, 24)).toBe('ground');
    expect(b.map.tileAt(5, 25)).toBe('ground');
    expect(b.map.tileAt(5, 26)).toBe('ground');
    expect(b.map.tileAt(5, 27)).toBe('bedrock');
    expect(b.map.tileAt(5, WORLD_H_TILES - 1)).toBe('bedrock');
  });
});

// ---------------------------------------------------------------------------
// Motif misuse — bad arguments throw instead of quietly producing bad levels.
// ---------------------------------------------------------------------------

describe('motif argument validation', () => {
  const fresh = () => new LevelBuilder(60, WORLD_H_TILES);

  it('rejects surfaces that leave the running lane', () => {
    expect(() => runway(fresh(), 2, LANE_TOP_ROW - 2)).toThrow(/lane/);
    expect(() => runway(fresh(), 2, laneBottomRow(fresh()) + 1)).toThrow(/lane/);
    expect(() => springboardWall(fresh(), 2, 17, { wallH: 5 })).toThrow(/lane/); // top would be 12
  });

  it('rejects unjumpable or out-of-spec shapes', () => {
    expect(() => gapJump(fresh(), 2, 24, { gap: 6 })).toThrow(/gap/);
    expect(() => steppes(fresh(), 2, 24, { stepH: 3 })).toThrow(/stepH/);
    expect(() => pipeField(fresh(), 2, 24, { pipes: 5 })).toThrow(/pipes/);
    expect(() => springboardWall(fresh(), 2, 24, { wallH: 7 })).toThrow(/wallH/);
  });

  it('refuses lawyers in the open gauntlet', () => {
    expect(() => enemyGauntlet(fresh(), 2, 24, { kinds: ['lobbyist', 'lawyer'] })).toThrow(/pipeField/);
  });
});

// ---------------------------------------------------------------------------
// The sampler chain — ALL motifs chained at row 24 on a 300-wide map.
// ---------------------------------------------------------------------------

interface Segment {
  name: string;
  endX: number;
  endRow: number;
}

/** Build the sampler act, recording each motif's return for the chain checks.
 *  arenaApproach places a goal, so it lives in its own sampler (defB below);
 *  together the two defs exercise every motif. */
function buildSamplerA(): { built: BuiltLevel; segments: Segment[] } {
  const segments: Segment[] = [];
  const d = def({
    width: 300,
    title: 'Sampler Estates (Repossessed)',
    build(b) {
      b.start(3, 23);
      let x = 2;
      let row = 24;
      const step = (name: string, end: { endX: number; endRow: number }): void => {
        segments.push({ name, ...end });
        x = end.endX;
        row = end.endRow;
      };
      step('runway', runway(b, x, row, { len: 8, coinRow: 23 }));
      step('gapJump', gapJump(b, x, row, { gap: 4 }));
      step('brickGallery', brickGallery(b, x, row, { len: 8 }));
      step('enemyGauntlet', enemyGauntlet(b, x, row, { kinds: ['lobbyist', 'pollster', 'rat'] }));
      step('pipeField', pipeField(b, x, row, { pipes: 3, lawyer: true }));
      step('coinArc', coinArc(b, x, row, { gap: 4 }));
      step('steppes-up', steppes(b, x, row, { count: 3, stepH: 2, dir: 1 }));
      step('springboardWall', springboardWall(b, x, row, { wallH: 4 }));
      step('steppes-down', steppes(b, x, row, { count: 4, stepH: 2, dir: -1 }));
      step('onewayClimb', onewayClimb(b, x, row, { rise: 4 }));
      step('steppes-down2', steppes(b, x, row, { count: 3, stepH: 2, dir: -1 }));
      step('crumbleBridge', crumbleBridge(b, x, row, { len: 4 }));
      step('secretPocket', secretPocket(b, x, row, { index: 0 }));
      step('goldbarPerch', goldbarPerch(b, x, row, { index: 0 }));
      step('checkpointRest', checkpointRest(b, x, row));
      step('finishRunway', finishRunway(b, x, row, { len: 8 }));
    },
  });
  return { built: buildLevel(d), segments };
}

function buildSamplerB(): BuiltLevel {
  const d = def({
    id: 'w4a4',
    world: 4,
    act: 4,
    title: 'The Grand Palace Photo-Op',
    excuse: 'Bowsonaro escaped through a loophole I personally notarized.',
    theme: 'castle',
    boss: true,
    width: 60,
    build(b) {
      b.start(3, 23);
      let x = 2;
      const r1 = runway(b, x, 24, { len: 6, rings: true });
      x = r1.endX;
      arenaApproach(b, x, 24, { width: 24 });
    },
  });
  return buildLevel(d);
}

// --- walkability: a lane-walk DP over standable surfaces ------------------

const passable = (s: Solidity): boolean => s === 'pass' || s === 'oneway';
const standable = (s: Solidity): boolean => s === 'solid' || s === 'oneway';

/** Rows a player could stand on in this column: a standable tile with two
 *  passable rows of headroom above it. */
function candidates(map: TileMapLike, tx: number): number[] {
  const out: number[] = [];
  for (let ty = 0; ty < map.hTiles; ty++) {
    if (!standable(SOLIDITY[map.tileAt(tx, ty)])) continue;
    if (!passable(SOLIDITY[map.tileAt(tx, ty - 1)])) continue;
    if (!passable(SOLIDITY[map.tileAt(tx, ty - 2)])) continue;
    out.push(ty);
  }
  return out;
}

/** Walk the chain column by column, asserting a route exists whose steps are
 *  jumpable: up <= 2 rows (up to 8 within 6 columns after a spring), down
 *  <= 2 rows, pits at most 5 columns wide. */
function assertWalkable(built: BuiltLevel, startCol: number, endCol: number, entryRow: number): void {
  const springCols = new Set(built.springs.map((s) => Math.floor(s.x / TILE)));
  const springNear = (x: number): boolean => {
    for (let c = x - 6; c < x; c++) if (springCols.has(c)) return true;
    return false;
  };
  let frontier = new Set<number>([entryRow]);
  let pitRun = 0;
  for (let x = startCol + 1; x <= endCol; x++) {
    const cands = candidates(built.map, x);
    if (cands.length === 0) {
      pitRun++;
      expect(pitRun, `pit at column ${x} is wider than 5`).toBeLessThanOrEqual(5);
      continue;
    }
    pitRun = 0;
    const maxUp = springNear(x) ? 8 : 2;
    const next = new Set<number>();
    for (const c of cands) {
      for (const r of frontier) {
        const up = r - c; // positive = stepping up
        if (up <= maxUp && up >= -2) next.add(c);
      }
    }
    expect(next.size, `column ${x}: no standable surface within a jumpable step`).toBeGreaterThan(0);
    frontier = next;
  }
}

// --- entities must not be buried ------------------------------------------

function tileOf(built: BuiltLevel, p: { x: number; y: number }): string {
  return built.map.tileAt(Math.floor(p.x / TILE), Math.floor(p.y / TILE));
}

function assertNothingBuried(built: BuiltLevel): void {
  for (const e of built.enemies) {
    if (e.kind === 'lawyer') {
      // Lawyers live IN pipes — their spawn sits at the pipe mouth by contract.
      expect(tileOf(built, e), `lawyer at ${e.x},${e.y} is not at a pipe mouth`).toBe('pipe');
    } else {
      expect(tileOf(built, e), `enemy ${e.kind} at ${e.x},${e.y} is buried`).toBe('empty');
    }
  }
  for (const c of built.coins) expect(tileOf(built, c), `coin at ${c.x},${c.y} is buried`).toBe('empty');
  for (const g of built.goldbars) expect(tileOf(built, g), `goldbar ${g.index} is buried`).toBe('empty');
  for (const s of built.secrets) expect(tileOf(built, s), `secret ${s.index} is buried`).toBe('empty');
  for (const s of built.springs) expect(tileOf(built, s), `spring at ${s.x},${s.y} is buried`).toBe('empty');
  for (const c of built.checkpoints) expect(tileOf(built, c), `checkpoint at ${c.x},${c.y} is buried`).toBe('empty');
  expect(tileOf(built, built.start), 'start is buried').toBe('empty');
  expect(
    built.map.tileAt(Math.floor(built.goalX / TILE), built.goalRow),
    'goal is buried',
  ).toBe('empty');
}

describe('sampler chain of all motifs', () => {
  const { built, segments } = buildSamplerA();

  it('advances endX monotonically', () => {
    let prev = 2;
    for (const s of segments) {
      expect(s.endX, `${s.name} did not advance`).toBeGreaterThan(prev);
      prev = s.endX;
    }
  });

  it('keeps every hand-over surface inside the running lane', () => {
    for (const s of segments) {
      expect(s.endRow, `${s.name} left the lane`).toBeGreaterThanOrEqual(LANE_TOP_ROW);
      expect(s.endRow, `${s.name} left the lane`).toBeLessThanOrEqual(WORLD_H_TILES - 6);
    }
  });

  it('is walkable end to end with jumpable steps and pits <= 5 wide', () => {
    const last = segments[segments.length - 1];
    expect(last).toBeDefined();
    assertWalkable(built, 2, (last?.endX ?? 0) - 1, 24);
  });

  it('records exactly the placed counts in BuiltLevel', () => {
    // Ledger: runway 6 coins + coinArc 6 + checkpointRest 3 = 15 coins;
    // gauntlet 3 enemies + pipeField lawyer = 4; 1 spring; 1 checkpoint;
    // goldbar index 0; secret index 0; brickGallery 2 qblocks.
    expect(built.coins.length).toBe(15);
    expect(built.enemies.length).toBe(4);
    expect(built.enemies.map((e) => e.kind).sort()).toEqual(['lawyer', 'lobbyist', 'pollster', 'rat']);
    expect(built.springs.length).toBe(1);
    expect(built.checkpoints.length).toBe(1);
    expect(built.goldbars).toHaveLength(1);
    expect(built.goldbars[0]?.index).toBe(0);
    expect(built.secrets).toHaveLength(1);
    expect(built.secrets[0]?.index).toBe(0);
    expect(built.blockContents.size).toBe(2);
    for (const v of built.blockContents.values()) expect(v).toBe('coin');
    expect(built.arena).toBeNull();
  });

  it('converts tile coords to pixel centers', () => {
    expect(built.start).toEqual({ x: 3 * TILE + 8, y: 23 * TILE + 8 });
    expect(built.goalX).toBe(136 * TILE + 8);
    expect(built.goalRow).toBe(23);
    // The lawyer sits at the mouth seam of the first pipe (col 45, top row 22).
    const lawyer = built.enemies.find((e) => e.kind === 'lawyer');
    expect(lawyer).toEqual({ kind: 'lawyer', x: 45 * TILE + TILE, y: 22 * TILE });
  });

  it('buries no entity in a solid tile', () => {
    assertNothingBuried(built);
  });
});

describe('arenaApproach sampler (castle act)', () => {
  const built = buildSamplerB();

  it('records the arena and puts the goal inside it', () => {
    expect(built.arena).toEqual({ x0: 14 * TILE + 8, x1: 37 * TILE + 8, floorRow: 24 });
    expect(built.goalX).toBe(33 * TILE + 8);
    expect(built.goalX).toBeGreaterThanOrEqual(built.arena?.x0 ?? Infinity);
    expect(built.goalX).toBeLessThanOrEqual(built.arena?.x1 ?? -Infinity);
    expect(built.goalRow).toBe(23);
  });

  it('lays a flat, walkable arena floor', () => {
    assertWalkable(built, 2, 37, 24);
  });

  it('places the runway ring coins and nothing buried', () => {
    expect(built.coins.length).toBe(3); // one ring cluster on the len-6 runway
    assertNothingBuried(built);
  });
});
