// ============================================================================
// Fixtures proving the playtest-driven pit rules of the act contract:
//
//   rule 8 (gaps carry risk) — sheer safe-floored recesses are violations;
//     deadly (lava-bottomed) drops, spike-floored pockets, shallow trenches
//     and stepped exits are legal,
//   rule 9 (no traps)        — every reachable floored pocket must be
//     exitable rightward by the flow-bot policy, unless a warp entry inside
//     the pocket is the exit,
//   rule 7 (warp sanity)     — warp mouths intact, clear, and non-stranding,
//     plus the warp-aware flood fill that legalizes sealed bonus rooms.
//
// ENGINE TRUTH THESE FIXTURES ENCODE (and PROVE, not assume — see the
// "void actually kills" test): below the map bottom is OPEN VOID
// (tilemap.ts) and falling past it dies at y > pixelH + 32 (level.ts). A
// floorless carve is therefore the genuine classical pit; lava across a pit
// bottom is its equally-deadly sibling. (History: OOB-below was once sealed
// bedrock, which made every pit riskless — if the kill-proof test here ever
// fails, that regression is back.)
// ============================================================================

import { describe, expect, it } from 'vitest';
import type { GameEvent, InputState, LevelBuilderLike, LevelDef } from '../src/core/types.ts';
import { TILE } from '../src/core/constants.ts';
import { buildLevel } from '../src/game/levelBuilder.ts';
import { Level } from '../src/game/level.ts';
import { checkAct, findRecesses } from './actContract.ts';

const IDLE: InputState = {
  left: false,
  right: false,
  up: false,
  down: false,
  jump: false,
  jumpPressed: false,
  run: false,
  firePressed: false,
  pausePressed: false,
  swapPressed: false,
};

// ---------------------------------------------------------------------------
// Base act: flat flanks (cols 0..29 and 42..59, surface row 26) carrying all
// the structural counts; each fixture carves only the middle zone 30..41 so
// every case fails (or passes) for its OWN terrain and nothing else.
// ---------------------------------------------------------------------------
function pitAct(
  title: string,
  carve: (b: LevelBuilderLike) => void,
  opts?: { goldbar4InCarve?: boolean },
): LevelDef {
  return {
    id: 'w1a2',
    world: 1,
    act: 2,
    title,
    excuse: 'The hole was load-bearing. Removing it would have been unsafe.',
    theme: 'meadow',
    width: 60,
    build(b) {
      b.ground(0, 29, 26);
      b.ground(42, 59, 26);
      carve(b); // owns columns 30..41 (and may dig under the flanks)
      b.start(2, 25);
      b.coinRow(3, 29, 22); // 27 coins
      b.coinRow(44, 58, 22); // +15 -> 42 (>= 40)
      const bars = opts?.goldbar4InCarve ? 4 : 5;
      for (let i = 0; i < bars; i++) b.goldbar(i, 6 + i * 4, 24);
      b.secret(0, 24, 24);
      b.secret(1, 26, 24);
      b.secret(2, 28, 24);
      b.checkpoint(45, 25);
      b.enemy('lobbyist', 46, 25);
      b.enemy('lobbyist', 49, 25);
      b.enemy('lobbyist', 52, 25);
      b.goal(56, 25);
    },
  };
}

// ---------------------------------------------------------------------------
// The fixtures
// ---------------------------------------------------------------------------

/** Classical deadly pit: floorless carve with LAVA across the bottom row. */
const lavaPits = pitAct('Fixture Lava Pits', (b) => {
  b.lava(30, 33, 35); // cols 30..33 stay floorless; lava seals the drop
  b.ground(34, 41, 26);
});

/** Floorless carve: a genuine bottomless VOID — the classical pit. */
const voidPit = pitAct('Fixture Void Pit', (b) => {
  // cols 30..33 floorless, open to the abyss
  b.ground(34, 41, 26);
});

/** A hazard pocket that DRAINS into the void: spike ledge 9 rows down (too
 *  deep to jump the exit wall), bottomless columns beside it. The escape
 *  probe must resolve it by DEATH — classical, not a trap. */
const voidDrainPocket = pitAct('Fixture Void Drain', (b) => {
  b.ground(30, 35, 26);
  b.ground(36, 37, 35); // ledge floor row 35 — 9 rows down, unjumpable wall
  b.spikes(36, 37, 34);
  // cols 38..39 stay bottomless: the drain
  b.ground(40, 41, 26);
});

/** The playtest pit: safe floor 4 rows down, sheer walls both sides. */
const deepSafePit = pitAct('Fixture Deep Safe Pit', (b) => {
  b.ground(30, 33, 30); // floor row 30, shoulders row 26 -> depth 4, safe
  b.ground(34, 41, 26);
});

/** A 2-deep coin trench: hop out trivially — legal tuning terrain. */
const coinTrench = pitAct('Fixture Coin Trench', (b) => {
  b.ground(30, 34, 28); // depth 2
  b.coinRow(31, 33, 27);
  b.ground(35, 41, 26);
});

/** Spike pocket, 5-row exit wall, bricks over the exit arc: the trap the
 *  playtest hit (screenshot: blocks overhanging the exit jump). */
const spikeTrapPit = pitAct('Fixture Spike Trap', (b) => {
  b.ground(30, 35, 26);
  b.ground(36, 39, 31); // support under the spikes
  b.spikes(36, 39, 30); // resting depth 5, hazard
  b.ground(40, 41, 26);
  b.platform(38, 40, 25, 'brick'); // ceiling over the exit corner
});

/** Same spike pocket but with a proper <= 2-row stepped exit: legal. */
const steppedSpikePit = pitAct('Fixture Stepped Spikes', (b) => {
  b.ground(30, 35, 26);
  b.ground(36, 38, 31);
  b.spikes(36, 38, 30);
  b.ground(39, 39, 29); // 2-row hop
  b.ground(40, 40, 27); // 2-row hop
  b.ground(41, 41, 26); // 1-row hop out
});

/** Spike pocket with a plain 4-row wall and open sky: the full-hold jump
 *  (~8 rows) climbs out — the escape probe must PASS this one. */
const clearSpikePit = pitAct('Fixture Clear Spikes', (b) => {
  b.ground(30, 35, 26);
  b.ground(36, 39, 30);
  b.spikes(36, 39, 29); // resting depth 4, hazard
  b.ground(40, 41, 26);
});

/** Warp bonus room: a sealed vault under the left flank, entered and exited
 *  by warp pipes, with goldbar 4 inside — provable only through the
 *  warp-aware flood fill. */
const warpRoom = pitAct(
  'Fixture Warp Vault',
  (b) => {
    b.ground(30, 41, 26);
    b.room(20, 30, 28, 33); // vault under the flank; lid rows 26..27 intact
    b.warpPipe(11, 24, 2, 22, 30, 4); // surface -> vault (cols 11..12 clear of goldbars)
    // vault -> surface, further along; cols 42..43 stay LEFT of the goal
    // ceremony runway (flagpole at goal-8 = col 48) — a pipe standing in the
    // pole->door walk would wall off the auto-walk
    b.warpPipe(27, 30, 4, 42, 24, 2);
    b.goldbar(4, 25, 31); // loot only a warp rider can reach
  },
  { goldbar4InCarve: true },
);

/** Warp whose exit mouth is bricked over: rule 7 must refuse it. */
const warpExitBlocked = pitAct('Fixture Blocked Warp', (b) => {
  b.ground(30, 41, 26);
  b.warpPipe(11, 24, 2, 40, 24, 2);
  b.platform(40, 41, 23); // solid across the exit mouth's clearance
});

/** The spike trap again — but a warp entry stands on the pocket floor, so
 *  the pocket has a sanctioned exit and rule 9 must exempt it. */
const warpEscapePit = pitAct('Fixture Warp Escape', (b) => {
  b.ground(30, 35, 26);
  b.ground(36, 39, 31);
  b.spikes(36, 39, 30);
  b.ground(40, 41, 26);
  b.platform(38, 40, 25, 'brick'); // exit arc still blocked...
  // ...but the warp IS the exit (cols 42..43: left of the goal ceremony
  // runway — the pole at col 48 must keep a flat walk to the door)
  b.warpPipe(37, 29, 2, 42, 24, 2);
});

/** The playtest complaint verbatim: spikes hovering 4 rows over the lane,
 *  touching nothing solid. Rule 10 must name the act and the tile. */
const floatingSpikes = pitAct('Fixture Floating Spikes', (b) => {
  b.ground(30, 41, 26); // flat lane straight across
  b.spikes(34, 35, 22); // "just floating in air" — no neighbor anywhere
});

/** Every legal anchor mode at once: a floor-spiked trench (solid directly
 *  below), and ceiling spikes under a brick lintel (solid directly above).
 *  All anchored — rule 10 must PASS this act. */
const anchoredSpikes = pitAct('Fixture Anchored Spikes', (b) => {
  b.ground(30, 33, 26);
  b.ground(34, 35, 28); // trench floor...
  b.spikes(34, 35, 27); // ...carpet sits ON it (2 deep: hop out, rule 8 ok)
  b.ground(36, 41, 26);
  b.platform(38, 39, 22, 'brick'); // lintel over the lane...
  b.spikes(38, 39, 23); // ...ceiling spikes hang FROM it (2 rows clearance)
});

// ---------------------------------------------------------------------------
// checkAct verdicts
// ---------------------------------------------------------------------------
describe('pit rules — checkAct verdicts', () => {
  it('accepts the classical lava-bottomed pits (gaps that kill)', () => {
    expect(() => checkAct(lavaPits)).not.toThrow();
  });

  it('accepts a floorless pit: the open void IS the classical deadly gap', () => {
    expect(() => checkAct(voidPit)).not.toThrow();
  });

  it('PROVES the void kills (guards the open-bottom engine contract)', () => {
    const level = new Level(voidPit);
    const p = level.player;
    p.x = 32 * TILE; // over the floorless columns 30..33
    p.y = 26 * TILE - p.halfH; // at lane height, nothing below
    p.vx = 0;
    p.vy = 0;
    const seen: GameEvent[] = [];
    for (let f = 0; f < 240; f++) seen.push(...level.update(IDLE));
    expect(seen).toContain('die');
    expect(seen).toContain('respawn');
    expect(level.stats.deaths).toBe(1);
    expect(level.player.dead).toBe(false); // respawned, run continues
  });

  it('accepts a hazard pocket that drains into the void (death resolves it, rule 9)', () => {
    expect(() => checkAct(voidDrainPocket)).not.toThrow();
  });

  it('rejects the playtest pit: deep safe floor, sheer walls (rule 8)', () => {
    expect(() => checkAct(deepSafePit)).toThrow(
      /w1a2: rule 8 \(gaps carry risk\).*columns 30\.\.33.*floor row 30.*4 rows below/s,
    );
  });

  it('accepts a 2-deep coin trench (shallow terrain is not a pit)', () => {
    expect(() => checkAct(coinTrench)).not.toThrow();
  });

  it('rejects the spike pocket with a blocked exit arc (rule 9)', () => {
    expect(() => checkAct(spikeTrapPit)).toThrow(
      /w1a2: rule 9 \(no traps\).*columns 36\.\.39.*trap/s,
    );
  });

  it('accepts the spike pocket with a <= 2-row stepped exit', () => {
    expect(() => checkAct(steppedSpikePit)).not.toThrow();
  });

  it('accepts the spike pocket with a plain 4-row wall (escape probe passes)', () => {
    expect(() => checkAct(clearSpikePit)).not.toThrow();
  });

  it('rejects spikes floating in mid-air (rule 10)', () => {
    expect(() => checkAct(floatingSpikes)).toThrow(
      /w1a2: rule 10 \(hazards anchored\).*spike at .*tile \(34,22\).*floats/s,
    );
  });

  it('accepts anchored spikes: floor carpet on its floor, ceiling row under its lintel', () => {
    expect(() => checkAct(anchoredSpikes)).not.toThrow();
  });
});

describe('pit rules — warps', () => {
  it('accepts the warp bonus vault (warp-aware fill reaches sealed rooms)', () => {
    expect(() => checkAct(warpRoom)).not.toThrow();
  });

  it('rejects a warp whose exit mouth is covered (rule 7)', () => {
    expect(() => checkAct(warpExitBlocked)).toThrow(
      /w1a2: rule 7 \(warp sanity\).*exit mouth at column 4[01]/s,
    );
  });

  it('exempts a trapped pocket whose floor holds a warp entry (rule 9)', () => {
    expect(() => checkAct(warpEscapePit)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// findRecesses — the exported scanner world agents re-tune against
// ---------------------------------------------------------------------------
describe('pit rules — findRecesses', () => {
  it('classifies a lava-bottomed carve as a deadly drop (kind void)', () => {
    const built = buildLevel(lavaPits);
    const rs = findRecesses(built.map, built.start);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ x0: 30, x1: 33, kind: 'void', floorRow: null });
  });

  it('classifies a floorless carve as a bottomless void', () => {
    const built = buildLevel(voidPit);
    const rs = findRecesses(built.map, built.start);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ x0: 30, x1: 33, kind: 'void', floorRow: null, depth: Infinity });
  });

  it('classifies the void-drain pocket as hazard (spike ledge + deadly drain)', () => {
    const built = buildLevel(voidDrainPocket);
    const rs = findRecesses(built.map, built.start);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ x0: 36, x1: 39, kind: 'hazard', floorRow: 35 });
  });

  it('measures the playtest pit (safe, depth 4) and the spike pocket (hazard)', () => {
    const deep = findRecesses(buildLevel(deepSafePit).map, buildLevel(deepSafePit).start);
    expect(deep).toHaveLength(1);
    expect(deep[0]).toMatchObject({ x0: 30, x1: 33, kind: 'safe', floorRow: 30, depth: 4 });

    const spiky = findRecesses(buildLevel(clearSpikePit).map, buildLevel(clearSpikePit).start);
    expect(spiky).toHaveLength(1);
    expect(spiky[0]).toMatchObject({ x0: 36, x1: 39, kind: 'hazard', floorRow: 30, depth: 4 });
  });

  it('sees no recess in shallow trenches or stepped exits', () => {
    const trench = buildLevel(coinTrench);
    expect(findRecesses(trench.map, trench.start)).toHaveLength(0);
    const stepped = buildLevel(steppedSpikePit);
    expect(findRecesses(stepped.map, stepped.start)).toHaveLength(0);
  });
});
