// ============================================================================
// WORLD 4 — BOWSONARO'S GRAND PALACE (theme 'castle'). Produced by Bowsonaro,
// on home turf, and by now the conspirators have stopped trying: the lava is
// real, the ballot boxes hop, the gavels are army boots, and the capybaras
// were never in costume to begin with. Hardest world, never unfair: lava pits
// stay <= 5 tiles on the mandatory route, every act carries 2 checkpoints,
// and the flow bot (right+run+jump only) clears every mandatory path.
//
// RICHNESS REBUILD (2026-08, rules 11-14): every act now sculpts gothic
// verticality — battlement climbs to row 18, a dungeon descent to row 30
// where the fiction wants one, statue-plinth lines the lane actually climbs
// between the lava-lake shores. Every act carries parapet walks / catwalks /
// balconies (one-way upper lanes >= 12 contiguous columns, sentried — risk
// up top, reward up top) so the route is never single-file, and every
// non-boss act finishes on a two-sided stone ziggurat that puts the
// certified pole grab inside a plain run-jump (sheer-backed staircases are
// rule-8 recesses; the ziggurat descends in 2-row treads). w4a7 is the
// castle: door-only ceremony, no pole.
//
// Authoring style: motifs chained on {endX,endRow}; the few raw-builder
// fragments (lava moats, gavel corridors, hidden-goldbar pockets, parapets,
// the ziggurat finale) are the local helpers below — deterministic, loudly
// validated, no module state. Cursor arithmetic is asserted with
// expectCursor() where an absolute position matters (the a3 lava lake, warp
// plumbing, every finale).
// ============================================================================

import type { LevelBuilderLike, LevelDef } from '../core/types.ts';
import {
  LANE_TOP_ROW,
  type MotifEnd,
  arenaApproach,
  brickGallery,
  checkpointRest,
  coinArc,
  crumbleBridge,
  enemyGauntlet,
  gapJump,
  goldbarPerch,
  laneBottomRow,
  pipeField,
  runway,
  secretPocket,
  springboardWall,
  steppes,
} from '../game/motifs.ts';

// ---------------------------------------------------------------------------
// Local helper vocabulary (same validation style as motifs.ts: throw loudly,
// no silent fallbacks, everything a pure function of its arguments).
// ---------------------------------------------------------------------------

function req(v: number, lo: number, hi: number, what: string): number {
  if (!Number.isInteger(v) || v < lo || v > hi) {
    throw new Error(`${what} must be an integer ${lo}..${hi}, got ${v}`);
  }
  return v;
}

function requireLane(b: LevelBuilderLike, row: number, what: string): void {
  const bottom = laneBottomRow(b);
  if (!Number.isInteger(row) || row < LANE_TOP_ROW || row > bottom) {
    throw new Error(`${what}: surface row ${row} leaves the running lane ${LANE_TOP_ROW}..${bottom}`);
  }
}

/** Cursor sanity: the chain must be exactly where the absolute geometry
 *  (lava lakes, warp plumbing, the finale) expects it. Drift = loud failure,
 *  not overlap. */
function expectCursor(c: MotifEnd, x: number, act: string): MotifEnd {
  if (c.endX !== x) throw new Error(`${act}: cursor drifted — expected endX ${x}, got ${c.endX}`);
  return c;
}

/** Lava moat: approach ground, a 3..5-tile pit floored with lava two rows
 *  below the surface, landing ground. Coins trace the crossing (the bot reads
 *  lava as "no support" and jumps the lip). opts.goldbar floats one at the
 *  apex — greed over lava, the Bowsonaro household budget. */
function lavaGap(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts: { gap: number; approach?: number; landing?: number; goldbar?: number },
): MotifEnd {
  requireLane(b, row, 'lavaGap');
  const gap = req(opts.gap, 3, 5, 'lavaGap gap');
  const approach = req(opts.approach ?? 3, 2, 20, 'lavaGap approach');
  const landing = req(opts.landing ?? 3, 2, 20, 'lavaGap landing');
  if (row + 3 >= b.heightTiles) throw new Error(`lavaGap: lava floor ${row + 3} falls off the map`);
  b.ground(x, x + approach - 1, row);
  const g0 = x + approach;
  const g1 = g0 + gap - 1;
  b.lava(g0, g1, row + 2);
  b.lava(g0, g1, row + 3);
  for (let i = 0; i < gap; i++) b.coin(g0 + i, row - 3);
  if (opts.goldbar !== undefined) b.goldbar(opts.goldbar, g0 + Math.floor(gap / 2), row - 4);
  b.ground(g1 + 1, g1 + landing, row);
  return { endX: g1 + landing + 1, endRow: row };
}

/** Judges' corridor: flat ground under gavel crushers every 6 columns, a coin
 *  ribbon running the gauntlet at ankle height. The gavel slam is a clocked
 *  ambient hazard — callers keep the first gavel > 27 tiles from the start
 *  (AMBIENT_RANGE) or the idle-silence rule fails, correctly. */
function gavelRun(b: LevelBuilderLike, x: number, row: number, opts: { len: number }): MotifEnd {
  requireLane(b, row, 'gavelRun');
  const len = req(opts.len, 10, 30, 'gavelRun len');
  b.ground(x, x + len - 1, row);
  b.coinRow(x + 1, x + len - 2, row - 1);
  for (let gx = x + 4; gx <= x + len - 2; gx += 6) b.enemy('gavel', gx, row - 4);
  return { endX: x + len, endRow: row };
}

/** A hidden goldbar in a secretPocket-shaped cellar (identical proven
 *  geometry: drop 2 in through the slot, hop 2 back out, brick lid on top).
 *  Bowsonaro keeps the gold where the auditors already looked. */
function goldbarCellar(b: LevelBuilderLike, x: number, row: number, opts: { index: number }): MotifEnd {
  requireLane(b, row, 'goldbarCellar');
  if (row + 3 >= b.heightTiles) throw new Error(`goldbarCellar: cellar floor ${row + 3} falls off the map`);
  b.ground(x, x, row);
  b.ground(x + 1, x + 1, row + 2); // entrance slot floor
  b.ground(x + 2, x + 3, row + 3); // cellar floor
  b.platform(x + 2, x + 3, row, 'brick'); // the lid
  b.ground(x + 4, x + 4, row);
  b.goldbar(opts.index, x + 3, row + 2);
  return { endX: x + 5, endRow: row };
}

/** A hidden goldbar on a shelf 6 rows up, served by a spring on the lane
 *  (springVy launches ~9 rows — generous). The bot that blunders into the
 *  spring just flies forward; no stall. */
function springShelf(b: LevelBuilderLike, x: number, row: number, opts: { index: number }): MotifEnd {
  requireLane(b, row, 'springShelf');
  if (row - 7 < 2) throw new Error(`springShelf: shelf row ${row - 7} needs headroom (row >= 9)`);
  b.ground(x, x + 7, row);
  b.spring(x + 2, row - 1);
  b.platform(x + 5, x + 6, row - 6, 'ground');
  b.goldbar(opts.index, x + 5, row - 7);
  return { endX: x + 8, endRow: row };
}

/** Battlement parapet — rule 12's alternate lane in castle skin. The hall
 *  lane runs at `row`; a crenellated one-way walk hangs 5 rows overhead for
 *  len-2 columns (>= 4-row separation, both lanes flood-reachable: the walk
 *  is jump-through from the hall, dropping off rejoins the lane anywhere).
 *  The walk carries a coin ribbon and, optionally, a goldbar and a sentry —
 *  this is W4, the high road is paid for. A gavel sentry slams THROUGH the
 *  one-way onto the hall floor: it threatens both lanes, fairly. */
function parapet(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts: { len: number; sentry?: 'gavel' | 'paparazzo'; goldbar?: number },
): MotifEnd {
  requireLane(b, row, 'parapet');
  const len = req(opts.len, 12, 40, 'parapet len');
  const deck = row - 5;
  if (deck < 3) throw new Error(`parapet: deck row ${deck} needs headroom (row >= 8)`);
  b.ground(x, x + len - 1, row);
  b.oneway(x + 1, x + len - 2, deck);
  b.coinRow(x + 2, x + len - 3, deck - 1);
  if (opts.goldbar !== undefined) b.goldbar(opts.goldbar, x + Math.floor(len / 2) - 2, deck - 2);
  if (opts.sentry === 'gavel') b.enemy('gavel', x + Math.floor(len / 2), deck - 4);
  if (opts.sentry === 'paparazzo') b.enemy('paparazzo', x + Math.floor(len / 2), deck - 3);
  return { endX: x + len, endRow: row };
}

/** Laundry basin: a crumble span over a lava vat with a service catwalk
 *  (one-way) 5 rows over the basin — the alternate lane over the spin cycle.
 *  Crumble is the mandatory floor (fuse 30f, never respawns — spans stay
 *  <= 8 so a sprint crosses before the first tile fires); the catwalk is the
 *  patient route. Falling through the wash lands in lava. */
function basinCatwalk(b: LevelBuilderLike, x: number, row: number, opts: { len: number }): MotifEnd {
  requireLane(b, row, 'basinCatwalk');
  const len = req(opts.len, 3, 8, 'basinCatwalk len');
  if (row + 4 >= b.heightTiles) throw new Error(`basinCatwalk: vat floor ${row + 4} falls off the map`);
  const deck = row - 5;
  if (deck < 3) throw new Error(`basinCatwalk: catwalk row ${deck} needs headroom (row >= 8)`);
  b.ground(x, x + 1, row);
  b.crumble(x + 2, x + len + 1, row);
  b.ground(x + len + 2, x + len + 3, row);
  b.lava(x + 2, x + len + 1, row + 3);
  b.lava(x + 2, x + len + 1, row + 4);
  b.oneway(x + 1, x + len + 2, deck);
  b.coinRow(x + 2, x + len + 1, deck - 1);
  return { endX: x + len + 4, endRow: row };
}

/** The act's final stretch — castle skin on the classic ending (rule 14): a
 *  two-sided stone ziggurat (2-row treads, 4-row peak) stands just left of
 *  the flagpole so the certified top grab is a plain run-jump; the descent
 *  side steps down in 2-row treads (a sheer back would be a rule-8 recess).
 *  Pole-to-door runway stays flat (ceremony walk contract); the castle door
 *  plants 8 tiles before the map edge, one last coin ribbon over the peak. */
function pyramidFinish(b: LevelBuilderLike, x: number, row: number, width: number): void {
  requireLane(b, row, 'pyramidFinish');
  const len = width - x;
  if (len < 23 || len > 40) {
    throw new Error(`pyramidFinish: tail of ${len} tiles outside 23..40 — re-balance the chain, not this guard`);
  }
  b.ground(x, width - 1, row);
  const pole = width - 16; // the pole stands GOAL.poleOffsetTiles before the door
  b.ground(pole - 6, pole - 5, row - 2);
  b.ground(pole - 4, pole - 3, row - 4); // the peak: 4 rows up = certified grab
  b.ground(pole - 2, pole - 1, row - 2);
  b.coinRow(pole - 6, pole - 1, row - 6);
  b.goal(width - 8, row - 1);
}

// ---------------------------------------------------------------------------
// The seven acts. Widths 200-260, difficulty ramps a1 -> a7; a4/a6 are the
// optional harder-but-richer spurs (2 easy goldbars, 3 hidden).
// ---------------------------------------------------------------------------

export const world4: LevelDef[] = [
  // -------------------------------------------------------------------------
  // w4a1 — the moat crossing, now with the full palace silhouette: crumble
  // drawbridge, first parapet walk, a battlement climb to row 18 with a high
  // parapet on the ridge, and a dungeon dip to row 30 (capybara pen) before
  // the ziggurat. The warp vault teaches the down-press verb 2 tiles from
  // spawn. Coins: 10+12+2+12+3+3+3+10+3+6 = 64. Enemies: lobbyist, pollster,
  // paparazzo, rat, lobbyist = 5.
  // -------------------------------------------------------------------------
  {
    id: 'w4a1',
    world: 4,
    act: 1,
    title: 'Drawbridge Drive',
    excuse: 'The drawbridge was up and the moat voids my boot warranty. I rescue exclusively under warranty.',
    theme: 'castle',
    width: 200,
    build(b) {
      let c = runway(b, 0, 26, { len: 12, coinRow: 22 }); // 10 coins
      b.start(3, 25);
      c = brickGallery(b, c.endX, c.endRow, { len: 10, powerup: 'stamp' }); // 2 coin qblocks
      c = runway(b, c.endX, c.endRow, { len: 6 }); // carries the vault's return pipe
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 });
      c = crumbleBridge(b, c.endX, c.endRow, { len: 4 }); // the drawbridge
      b.lava(36, 39, 29); // the moat under the drawbridge planks
      b.lava(36, 39, 30);
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'pollster'] });
      c = parapet(b, c.endX, c.endRow, { len: 16, sentry: 'paparazzo', goldbar: 2 }); // 12 coins
      c = lavaGap(b, c.endX, c.endRow, { gap: 3 }); // 3 coins
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      // The battlement climb: 26 -> 18 in 2-row treads, a ridge walk with its
      // own high parapet, then back down the far stair.
      c = steppes(b, c.endX, c.endRow, { count: 4, stepH: 2, treadW: 2, dir: 1 }); // up to 18
      c = runway(b, c.endX, c.endRow, { len: 6, rings: true }); // 3 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 });
      c = parapet(b, c.endX, c.endRow, { len: 14, goldbar: 3 }); // 10 coins
      c = steppes(b, c.endX, c.endRow, { count: 4, stepH: 2, treadW: 2, dir: -1 }); // down to 26
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      // The dungeon dip: down to row 30 where the capybara pen waits, and
      // back up. Stepped both ways — a walkable valley, not a rule-8 pit.
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 2, dir: -1 }); // down to 30
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'lobbyist'] }); // the rat is a capybara
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 2, dir: 1 }); // up to 26
      c = goldbarCellar(b, c.endX, c.endRow, { index: 4 });
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      expectCursor(c, 171, 'w4a1');
      pyramidFinish(b, c.endX, c.endRow, 200); // 6 coins; pole at 184
      // WARP VAULT — the moat maintenance cellar. A pipe on the opening
      // runway teaches the world's warp verb two tiles from spawn: press
      // down, loot the coin cellar carved under the drawbridge approach,
      // surface on the runway past the brick gallery (SMB 1-1 precedent: the
      // early pipe that skips a stretch is the classical bonus). 12 coins.
      // Geometry: room ceiling keeps 2 rows of fill under the lane surface;
      // both vault pipe mouths rise 2 over the room floor (hop on, hop off),
      // 3 clear rows above each mouth (rule 7 wants 2).
      b.room(7, 18, 29, 33);
      b.warpPipe(5, 24, 2, 9, 32, 2); // lane -> cellar
      b.coinRow(12, 15, 31); // the hoard: 4x3
      b.coinRow(12, 15, 32);
      b.coinRow(12, 15, 33);
      b.warpPipe(16, 32, 2, 24, 24, 2); // cellar -> the runway past the gallery
    },
  },

  // -------------------------------------------------------------------------
  // w4a2 — up onto the battlements and STAY up: the whole midsection runs at
  // row 22 with the doorman's boot on the gap landing, the gavel corridor,
  // and a sentried parapet, then a spur to row 18 before the descent to the
  // 4-wide moat. The deserters' tunnel warp still skips the corridor.
  // Coins: 10+2+14+3+3+14+3+4+12+6 = 71. Enemies: 2 chipstacks, 4 gavels,
  // lawyer = 7.
  // -------------------------------------------------------------------------
  {
    id: 'w4a2',
    world: 4,
    act: 2,
    title: 'Ballot Battlements',
    excuse: 'The ballot boxes voted 7-0 against the rescue. I demanded a recount; it came back 8-0.',
    theme: 'castle',
    width: 210,
    build(b) {
      let c = runway(b, 0, 26, { len: 12, coinRow: 22 }); // 10 coins
      b.start(3, 25);
      c = brickGallery(b, c.endX, c.endRow, { len: 10, powerup: 'stamp' }); // 2 coin qblocks
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 3, dir: 1 }); // up to 22
      c = runway(b, c.endX, c.endRow, { len: 6 }); // carries the tunnel entry pipe
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['chipstack', 'chipstack'] }); // ballot boxes
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 });
      c = gapJump(b, c.endX, c.endRow, { gap: 4 });
      b.enemy('gavel', c.endX - 2, c.endRow - 4); // the DOORMAN'S BOOT stamps
      // the gap landing (col 59) — the judges' corridor starts one jump
      // early: time the leap AND the crusher. 59 tiles out (> 27, idle-silent),
      // both checkpoints sit after it, and the deserters' tunnel still skips
      // the whole corridor for explorers.
      c = gavelRun(b, c.endX, c.endRow, { len: 16 }); // 2 gavels, 14 coins
      c = runway(b, c.endX, c.endRow, { len: 4 }); // carries the tunnel exit pipe
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = parapet(b, c.endX, c.endRow, { len: 18, sentry: 'gavel', goldbar: 1 }); // 14 coins
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 2, dir: 1 }); // up to 18
      c = runway(b, c.endX, c.endRow, { len: 6, rings: true }); // 3 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 });
      c = steppes(b, c.endX, c.endRow, { count: 4, stepH: 2, treadW: 2, dir: -1 }); // down to 26
      c = lavaGap(b, c.endX, c.endRow, { gap: 4 }); // the first 4-wide moat; 4 coins
      c = pipeField(b, c.endX, c.endRow, { pipes: 2, lawyer: true });
      b.checkpoint(149, 25); // second flag between the pipes
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = parapet(b, c.endX, c.endRow, { len: 16, goldbar: 3 }); // 12 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = goldbarCellar(b, c.endX, c.endRow, { index: 4 });
      expectCursor(c, 186, 'w4a2');
      pyramidFinish(b, c.endX, c.endRow, 210); // 6 coins; pole at 194
      // WARP SHORTCUT — the deserters' tunnel. Bowsonaro's entourage dug an
      // escape route under their own gavel corridor; explorers who press down
      // on the battlement pipe skip the chipstack gauntlet, the doorman and
      // both corridor gavels, surfacing right before the checkpoint. The
      // walking route (and its goldbar) stays mandatory-clean for the bot.
      b.warpPipe(30, 20, 2, 78, 20, 2);
    },
  },

  // -------------------------------------------------------------------------
  // w4a3 — the high road over the lava lake: statue plinths rise out of the
  // melt and the lane actually CLIMBS between the shores (20 -> 16 -> 20),
  // under a gallery balcony with the paparazzo drone on patrol. Gaps stay
  // <= 4 over the melt; the 5-wide moat waits on the far shore.
  // Coins: 10+3+3+18+3+5+14+6 = 62. Enemies: pollster, lobbyist, paparazzo,
  // lawyer, rat, lobbyist = 6 (no chipstack — the ballot-stacks debut in the
  // a4 laundry, rule 13).
  // -------------------------------------------------------------------------
  {
    id: 'w4a3',
    world: 4,
    act: 3,
    title: 'Statue Gallery',
    excuse: 'I stopped to appraise the statues for insurance. Gold-plated fraud appreciates twelve percent a year.',
    theme: 'castle',
    width: 236,
    build(b) {
      let c = runway(b, 0, 26, { len: 12, coinRow: 22 }); // 10 coins
      b.start(3, 25);
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 });
      c = brickGallery(b, c.endX, c.endRow, { len: 12, powerup: 'stamp' }); // 3 coin qblocks
      c = gapJump(b, c.endX, c.endRow, { gap: 3, approach: 4, landing: 4 });
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['pollster', 'lobbyist'] });
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: 1 }); // up to 20
      expectCursor(c, 64, 'w4a3');
      // The lava lake spans the whole gallery; plinth grounds laid after this
      // overwrite it column by column, leaving lava only under the real gaps.
      b.lava(64, 131, 28);
      b.lava(64, 131, 29);
      c = runway(b, c.endX, c.endRow, { len: 6 }); // the near shore plinth
      c = gapJump(b, c.endX, c.endRow, { gap: 4, approach: 3, landing: 3 });
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 2, dir: 1 }); // plinths climb to 16
      c = runway(b, c.endX, c.endRow, { len: 4 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 }); // gold on the tallest statue
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 2, dir: -1 }); // back down to 20
      c = runway(b, c.endX, c.endRow, { len: 6 });
      b.enemy('paparazzo', 101, 15); // the surveillance drone over the plinths
      c = gapJump(b, c.endX, c.endRow, { gap: 4, approach: 3, landing: 3 });
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = gapJump(b, c.endX, c.endRow, { gap: 3, approach: 3, landing: 3 });
      c = runway(b, c.endX, c.endRow, { len: 4 });
      expectCursor(c, 132, 'w4a3'); // lake ends at 131 — plinths covered it
      // The gallery balcony: a one-way walk over the mid-lake plinth climb,
      // coins the whole way — the second lane rule 12 wants, over real risk.
      b.oneway(84, 103, 11);
      b.coinRow(85, 102, 10); // 18 coins
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: -1 }); // down to 26
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = lavaGap(b, c.endX, c.endRow, { gap: 5, landing: 4, goldbar: 4 }); // 5 coins, apex bar
      c = pipeField(b, c.endX, c.endRow, { pipes: 2, lawyer: true });
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = parapet(b, c.endX, c.endRow, { len: 18, goldbar: 2 }); // 14 coins
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'lobbyist'] });
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = goldbarCellar(b, c.endX, c.endRow, { index: 3 });
      expectCursor(c, 211, 'w4a3');
      pyramidFinish(b, c.endX, c.endRow, 236); // 6 coins; pole at 220
    },
  },

  // -------------------------------------------------------------------------
  // w4a4 — OPTIONAL spur: the money laundering is now literal. Three crumble
  // basins with service catwalks over the vats (the alternate lane over every
  // spin cycle), a climb to the drying rack at row 18 with a paparazzo-
  // sentried parapet, and the chipstack ballot-stacks DEBUT here (rule 13).
  // Goldbar spread: 0/1 easy, 2 on the parapet walk, 3 on a spring shelf,
  // 4 over a lava pit. Coins: 16+3+3+5+3+12+6+3+4+7+4+6 = 72.
  // Enemies: chipstack, rat, paparazzo, chipstack x2, rat, lawyer = 7.
  // -------------------------------------------------------------------------
  {
    id: 'w4a4',
    world: 4,
    act: 4,
    title: 'Lava Laundry',
    excuse: 'The laundry ate one of my socks. A hero in mismatched socks is legally a civilian.',
    theme: 'castle',
    width: 230,
    build(b) {
      let c = runway(b, 0, 26, { len: 12, coinRow: 22, rings: true }); // 16 coins
      b.start(3, 25);
      c = brickGallery(b, c.endX, c.endRow, { len: 12, powerup: 'stamp' }); // 3 coin qblocks
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 }); // easy
      c = lavaGap(b, c.endX, c.endRow, { gap: 3 }); // 3 coins
      c = basinCatwalk(b, c.endX, c.endRow, { len: 5 }); // wash #1; 5 coins
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['chipstack', 'rat'] });
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      // Up to the drying rack: 26 -> 18, parapet with the house drone on it.
      c = steppes(b, c.endX, c.endRow, { count: 4, stepH: 2, treadW: 2, dir: 1 }); // up to 18
      c = runway(b, c.endX, c.endRow, { len: 4 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 }); // easy
      c = parapet(b, c.endX, c.endRow, { len: 16, sentry: 'paparazzo', goldbar: 2 }); // 12 coins
      c = steppes(b, c.endX, c.endRow, { count: 4, stepH: 2, treadW: 2, dir: -1 }); // down to 26
      c = basinCatwalk(b, c.endX, c.endRow, { len: 6 }); // wash #2; 6 coins
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['chipstack', 'chipstack', 'rat'] });
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = lavaGap(b, c.endX, c.endRow, { gap: 4, goldbar: 4 }); // hidden: apex greed; 4 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = coinArc(b, c.endX, c.endRow, { gap: 5 }); // 7 coins
      c = springShelf(b, c.endX, c.endRow, { index: 3 }); // hidden: shelf 6 up
      c = pipeField(b, c.endX, c.endRow, { pipes: 3, lawyer: true });
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = basinCatwalk(b, c.endX, c.endRow, { len: 4 }); // the delicates cycle; 4 coins
      expectCursor(c, 206, 'w4a4');
      pyramidFinish(b, c.endX, c.endRow, 230); // 6 coins; pole at 214
    },
  },

  // -------------------------------------------------------------------------
  // w4a5 — the red carpet to the throne: every hazard the palace owns, back
  // to back, and the biggest climb in the world — hall parapet at 26, stair
  // to the ridge at 18 with a second parapet over a 5-void, springboard wall,
  // then the descent to the moat floor at 25. The lava lip still eats the
  // first moat's takeoff tile. Goldpen qblock on the ridge for the road
  // ahead. Coins: 16+3+4+12+3+16+14+3+5+6 = 82. Enemies: lobbyist, pollster,
  // chipstack, 3 gavels, lawyer = 7.
  // -------------------------------------------------------------------------
  {
    id: 'w4a5',
    world: 4,
    act: 5,
    title: 'Throne Approach',
    excuse: 'A motorcycle parade had right of way in the throne corridor. I waited. Respectfully. For hours.',
    theme: 'castle',
    width: 244,
    build(b) {
      let c = runway(b, 0, 26, { len: 12, coinRow: 22, rings: true }); // 16 coins
      b.start(3, 25);
      c = brickGallery(b, c.endX, c.endRow, { len: 12, powerup: 'stamp' }); // 3 coin qblocks
      c = gapJump(b, c.endX, c.endRow, { gap: 3 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 });
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'pollster', 'chipstack'] });
      const throneLip = c.endX + 2; // last approach tile of the moat below
      c = lavaGap(b, c.endX, c.endRow, { gap: 4 }); // 4 coins
      b.lava(throneLip, throneLip, c.endRow); // LAVA LIP (2026-08 difficulty
      // wave): the melt eats the last takeoff tile (col 56) — the effective
      // crossing is 5, still inside the authoring cap, but the runway is one
      // tile shorter than it looks and the glow says so. The lip goes down
      // THREE rows (the whole ground cap of the fill) so the flow bot's
      // 2-tile support probe reads it as gap, not step — it joins the moat
      // pool and rests on bedrock (rule 10 anchored).
      b.lava(throneLip, throneLip, c.endRow + 1);
      b.lava(throneLip, throneLip, c.endRow + 2);
      c = gavelRun(b, c.endX, c.endRow, { len: 14 }); // 2 gavels, 12 coins
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = parapet(b, c.endX, c.endRow, { len: 20, sentry: 'gavel', goldbar: 1 }); // 16 coins
      c = steppes(b, c.endX, c.endRow, { count: 4, stepH: 2, treadW: 2, dir: 1 }); // up to 18
      c = runway(b, c.endX, c.endRow, { len: 4 });
      b.qblock(119, 14, 'goldpen'); // armament for the approach
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 });
      c = gapJump(b, c.endX, c.endRow, { gap: 5 }); // the ridge void
      c = parapet(b, c.endX, c.endRow, { len: 18, goldbar: 3 }); // 14 coins
      c = steppes(b, c.endX, c.endRow, { count: 4, stepH: 2, treadW: 2, dir: -1 }); // down to 26
      c = springboardWall(b, c.endX, c.endRow, { wallH: 5 }); // up to 21
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 2, dir: -1 }); // down to 25
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = pipeField(b, c.endX, c.endRow, { pipes: 2, lawyer: true });
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = lavaGap(b, c.endX, c.endRow, { gap: 5 }); // 5 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = goldbarCellar(b, c.endX, c.endRow, { index: 4 });
      expectCursor(c, 218, 'w4a5');
      pyramidFinish(b, c.endX, c.endRow, 244); // 6 coins; pole at 228
    },
  },

  // -------------------------------------------------------------------------
  // w4a6 — OPTIONAL spur: the palace panic room, wall-to-wall entourage. Two
  // immunity galleries pace the blitz; the literal panic room is a warp vault
  // under the third gauntlet (now holding goldbar 4 next to the rations); the
  // escape ladder climbs to a gavel-sentried parapet at 18 before the last
  // capybara pen. Coins: 16+2+12+10+3+15+1+12+12+6 = 89. Enemies: 14.
  // -------------------------------------------------------------------------
  {
    id: 'w4a6',
    world: 4,
    act: 6,
    title: 'The Panic Room',
    excuse: 'That was not panic, that was a certified tactical coffee break. My third today.',
    theme: 'castle',
    width: 206,
    build(b) {
      let c = runway(b, 0, 26, { len: 12, coinRow: 22, rings: true }); // 16 coins
      b.start(3, 25);
      c = brickGallery(b, c.endX, c.endRow, { len: 10, powerup: 'immunity' }); // 2 coin qblocks
      c = gapJump(b, c.endX, c.endRow, { gap: 3 }); // fences patrols off the spawn
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'lobbyist', 'pollster'] });
      b.coinRow(33, 44, 22); // 12 coins over the melee
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['chipstack', 'chipstack', 'rat'] });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 }); // easy
      c = gavelRun(b, c.endX, c.endRow, { len: 12 }); // 2 gavels, 10 coins
      c = runway(b, c.endX, c.endRow, { len: 4 }); // carries the bunker entry pipe
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['pollster', 'pollster', 'chipstack'] });
      c = runway(b, c.endX, c.endRow, { len: 4 }); // carries the bunker exit pipe
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = brickGallery(b, c.endX, c.endRow, { len: 8, powerup: 'immunity' }); // 1 coin qblock
      b.goldbar(2, 121, 21); // hidden: on TOP of the immunity gallery
      // The escape ladder: 26 -> 18, a sentried parapet over the drop, and
      // back down into the last pen.
      c = steppes(b, c.endX, c.endRow, { count: 4, stepH: 2, treadW: 2, dir: 1 }); // up to 18
      c = parapet(b, c.endX, c.endRow, { len: 16, sentry: 'gavel', goldbar: 1 }); // 12 coins
      c = steppes(b, c.endX, c.endRow, { count: 4, stepH: 2, treadW: 2, dir: -1 }); // down to 26
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'rat', 'chipstack'] });
      b.checkpoint(159, 25); // second flag at the pen door
      b.coinRow(160, 171, 22); // 12 coins over the capybara pen
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = goldbarCellar(b, c.endX, c.endRow, { index: 3 });
      expectCursor(c, 183, 'w4a6');
      pyramidFinish(b, c.endX, c.endRow, 206); // 6 coins; pole at 190
      // WARP VAULT — the ACTUAL panic room. The act is named for it: a pipe
      // beside the mid-act checkpoint drops into the bunker under the blitz
      // (canned coins, goldbar 4 next to the rations, no windows), and the
      // return pipe surfaces past the third entourage gauntlet — hiding in
      // the panic room legitimately skips the panic. 15 coins.
      // Geometry: room ceiling keeps 2 rows of fill under the lane; vault
      // pipe mouths rise 2 over the room floor, 3 clear rows above each.
      b.room(88, 99, 29, 33);
      b.warpPipe(85, 24, 2, 88, 32, 2); // checkpoint lane -> bunker
      b.coinRow(91, 95, 31); // the emergency rations: 5x3
      b.coinRow(91, 95, 32);
      b.coinRow(91, 95, 33);
      b.goldbar(4, 98, 32); // hidden: bunkered next to the rations
      b.warpPipe(96, 32, 2, 110, 24, 2); // bunker -> lane past the gauntlet
    },
  },

  // -------------------------------------------------------------------------
  // w4a7 — FINAL CASTLE. The full palace tour with the full silhouette: gavel
  // corridor, hall parapet, the ridge at 18 over a 5-void with its own high
  // walk, the lava lip on the last moat, and a throne-gallery balcony over
  // the final checkpoint pair — then the longest arena approach in the
  // campaign and the only fight Bowsonaro cannot jetpack out of. Door-only
  // ceremony (no pole). Coins: 16+3+4+16+3+14+3+10+4+3+12 = 88. Enemies:
  // lobbyist, pollster, chipstack, 3 gavels, paparazzo, lawyer, chipstack,
  // rat = 10.
  // -------------------------------------------------------------------------
  {
    id: 'w4a7',
    world: 4,
    act: 7,
    title: 'The Big Beautiful Throne',
    excuse: 'The wig fell on its own. I have never met that man, and the notary confirms: neither have I.',
    theme: 'castle',
    width: 260,
    boss: true,
    bossRage: true,
    cutsceneAfter: 'ending',
    build(b) {
      let c = runway(b, 0, 26, { len: 12, coinRow: 22, rings: true }); // 16 coins
      b.start(3, 25);
      c = brickGallery(b, c.endX, c.endRow, { len: 12, powerup: 'stamp' }); // 3 coin qblocks
      c = gapJump(b, c.endX, c.endRow, { gap: 4 });
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'pollster', 'chipstack'] });
      c = lavaGap(b, c.endX, c.endRow, { gap: 4 }); // 4 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 });
      c = gavelRun(b, c.endX, c.endRow, { len: 18 }); // 3 gavels, 16 coins
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      b.qblock(87, 22, 'goldpen'); // bring a pen to the throne room
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = parapet(b, c.endX, c.endRow, { len: 18, sentry: 'paparazzo', goldbar: 1 }); // 14 coins
      // The throne stair: 26 -> 18, a ridge runway over a 5-void with its own
      // high walk, then back down for the last hall.
      c = steppes(b, c.endX, c.endRow, { count: 4, stepH: 2, treadW: 2, dir: 1 }); // up to 18
      c = runway(b, c.endX, c.endRow, { len: 6, rings: true }); // 3 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 });
      c = gapJump(b, c.endX, c.endRow, { gap: 5 }); // the ridge void
      c = parapet(b, c.endX, c.endRow, { len: 14, goldbar: 3 }); // 10 coins
      c = steppes(b, c.endX, c.endRow, { count: 4, stepH: 2, treadW: 2, dir: -1 }); // down to 26
      c = pipeField(b, c.endX, c.endRow, { pipes: 3, lawyer: true });
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['chipstack', 'rat'] });
      const finalLip = c.endX + 2; // last approach tile of the apex-bar moat
      c = lavaGap(b, c.endX, c.endRow, { gap: 4, goldbar: 4 }); // 4 coins, apex bar
      b.lava(finalLip, finalLip, c.endRow); // LAVA LIP (2026-08 difficulty
      // wave): the palace's last moat eats its own takeoff tile (col 194) —
      // effective crossing 5, and goldbar 4 still hangs at the apex, so the
      // greed jump launches a tile earlier than it looks. The lip goes down
      // three rows (full ground cap) so the bot's support probe reads gap,
      // not step; it joins the moat pool on bedrock (rule 10 anchored). The
      // glow telegraphs it, and checkpoint 2 (col 209) sits after it so
      // respawns never re-face the moat.
      b.lava(finalLip, finalLip, c.endRow + 1);
      b.lava(finalLip, finalLip, c.endRow + 2);
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins — last save before the show
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      // The throne gallery: a one-way balcony over the final pocket-and-
      // checkpoint stretch — the gallery + floor pair before the arena.
      b.oneway(203, 216, 21);
      b.coinRow(204, 215, 20); // 12 coins
      expectCursor(c, 218, 'w4a7');
      // Longest arena approach in the game: 34-tile throne room, goal at
      // width-7 (brief wants 6-10), ground filled to the map edge.
      c = arenaApproach(b, c.endX, c.endRow, { width: 34 });
      b.ground(c.endX, 259, 26);
    },
  },
];
