// ============================================================================
// WORLD 4 — BOWSONARO'S GRAND PALACE (theme 'castle'). Produced by Bowsonaro,
// on home turf, and by now the conspirators have stopped trying: the lava is
// real, the ballot boxes hop, the gavels are army boots, and the capybaras
// were never in costume to begin with. Hardest world, never unfair: lava pits
// stay <= 5 tiles on the mandatory route, every act carries 2 checkpoints,
// and the flow bot (right+run+jump only) clears every mandatory path.
//
// Authoring style: motifs chained on {endX,endRow}; the few raw-builder
// fragments (lava moats, gavel corridors, hidden-goldbar pockets, the final
// stretch) are the local helpers below — deterministic, loudly validated, no
// module state. Cursor arithmetic is asserted with expectCursor() where an
// absolute position matters (the a3 lava lake, the a7 arena).
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
 *  (lava lakes, the arena) expects it. Drift = loud failure, not overlap. */
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

/** The act's final stretch: ground runs to the very edge of the map, the
 *  castle door plants 8 tiles before it (brief: 6-10), one last coin ribbon.
 *  finishRunway cannot express the 6-10 spacing, hence the raw fragment. */
function castleFinish(b: LevelBuilderLike, x: number, row: number, width: number): void {
  requireLane(b, row, 'castleFinish');
  const len = width - x;
  if (len < 12 || len > 40) {
    throw new Error(`castleFinish: tail of ${len} tiles outside 12..40 — re-balance the chain, not this guard`);
  }
  b.ground(x, width - 1, row);
  b.coinRow(x + 2, x + 7, row - 3);
  b.goal(width - 8, row - 1);
}

// ---------------------------------------------------------------------------
// The seven acts. Widths 200-260, difficulty ramps a1 -> a7; a4/a6 are the
// optional harder-but-richer spurs (2 easy goldbars, 3 hidden).
// ---------------------------------------------------------------------------

export const world4: LevelDef[] = [
  // -------------------------------------------------------------------------
  // w4a1 — the moat crossing. Gentlest castle act: one crumble drawbridge,
  // one small lava moat, gaps of 3. Coins: 10+2+3+3+3+5+6+3+6+6 = 47.
  // Enemies: lobbyist, pollster, lawyer, rat, lobbyist = 5.
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
      c = gapJump(b, c.endX, c.endRow, { gap: 3, approach: 4, landing: 4 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 });
      c = crumbleBridge(b, c.endX, c.endRow, { len: 4 }); // the drawbridge
      b.lava(41, 44, 29); // the moat under the drawbridge planks
      b.lava(41, 44, 30);
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'pollster'] });
      c = runway(b, c.endX, c.endRow, { len: 6, rings: true }); // 3 coins
      c = lavaGap(b, c.endX, c.endRow, { gap: 3 }); // 3 coins
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 });
      c = pipeField(b, c.endX, c.endRow, { pipes: 2, lawyer: true });
      c = coinArc(b, c.endX, c.endRow, { gap: 3 }); // 5 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 });
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 3, dir: 1 }); // up to 22
      c = runway(b, c.endX, c.endRow, { len: 8, coinRow: 18 }); // 6 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 3 });
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 3, dir: -1 }); // back to 26
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'lobbyist'] }); // the rat is a capybara
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 4 });
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // 6 coins
      expectCursor(c, 185, 'w4a1');
      castleFinish(b, c.endX, c.endRow, 200); // 6 coins
    },
  },

  // -------------------------------------------------------------------------
  // w4a2 — up onto the battlements: ballot-box chipstacks on the parapet, a
  // three-gavel corridor, first 4-wide lava moat.
  // Coins: 10+3+3+16+3+4+6+3+6 = 54. Enemies: 2 chipstacks, 3 gavels,
  // lawyer, chipstack, pollster = 8.
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
      c = brickGallery(b, c.endX, c.endRow, { len: 12, powerup: 'stamp' }); // 3 coin qblocks
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 3, dir: 1 }); // up to 22
      c = runway(b, c.endX, c.endRow, { len: 10, rings: true }); // 3 coins
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['chipstack', 'chipstack'] }); // ballot boxes
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 });
      c = gapJump(b, c.endX, c.endRow, { gap: 4 });
      c = gavelRun(b, c.endX, c.endRow, { len: 18 }); // 3 gavels, 16 coins
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 3, dir: -1 }); // down to 26
      c = lavaGap(b, c.endX, c.endRow, { gap: 4 }); // 4 coins
      c = pipeField(b, c.endX, c.endRow, { pipes: 3, lawyer: true });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 });
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // 6 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['chipstack', 'pollster'] });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 });
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = crumbleBridge(b, c.endX, c.endRow, { len: 5 });
      b.lava(174, 178, 29); // under the crumble span
      b.lava(174, 178, 30);
      c = goldbarPerch(b, c.endX, c.endRow, { index: 3 });
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 4 });
      expectCursor(c, 198, 'w4a2');
      castleFinish(b, c.endX, c.endRow, 210); // 6 coins
    },
  },

  // -------------------------------------------------------------------------
  // w4a3 — the high road over the lava lake: gold pedestal-pillars rise out
  // of the melt (the ground fills of each island read as statue plinths), a
  // paparazzo drone patrols the gallery. Gaps ramp to 5.
  // Coins: 10+2+3+3+7+3+3+5+6+6 = 48. Enemies: pollster, lobbyist,
  // paparazzo, lawyer, rat, chipstack = 6.
  // -------------------------------------------------------------------------
  {
    id: 'w4a3',
    world: 4,
    act: 3,
    title: 'Statue Gallery',
    excuse: 'I stopped to appraise the statues for insurance. Gold-plated fraud appreciates twelve percent a year.',
    theme: 'castle',
    width: 220,
    build(b) {
      let c = runway(b, 0, 26, { len: 12, coinRow: 22 }); // 10 coins
      b.start(3, 25);
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 });
      c = brickGallery(b, c.endX, c.endRow, { len: 10, powerup: 'stamp' }); // 2 coin qblocks
      c = gapJump(b, c.endX, c.endRow, { gap: 3, approach: 4, landing: 4 });
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['pollster', 'lobbyist'] });
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: 1 }); // up to 20
      expectCursor(c, 62, 'w4a3');
      // The lava lake spans the whole gallery; island grounds laid after this
      // overwrite it column by column, leaving lava only under the real gaps.
      b.lava(62, 129, 28);
      b.lava(62, 129, 29);
      c = runway(b, c.endX, c.endRow, { len: 8, rings: true }); // 3 coins
      c = gapJump(b, c.endX, c.endRow, { gap: 4 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 });
      c = gapJump(b, c.endX, c.endRow, { gap: 4 });
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = coinArc(b, c.endX, c.endRow, { gap: 5 }); // 7 coins
      c = runway(b, c.endX, c.endRow, { len: 6 });
      b.enemy('paparazzo', 115, 17); // the surveillance drone over the gallery
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 });
      c = runway(b, c.endX, c.endRow, { len: 6, rings: true }); // 3 coins
      expectCursor(c, 130, 'w4a3'); // lake ends at 129 — islands covered it
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: -1 }); // down to 26
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = lavaGap(b, c.endX, c.endRow, { gap: 5, landing: 4 }); // 5 coins
      c = pipeField(b, c.endX, c.endRow, { pipes: 2, lawyer: true });
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 3 });
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'chipstack'] });
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 4 });
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // 6 coins
      expectCursor(c, 208, 'w4a3');
      castleFinish(b, c.endX, c.endRow, 220); // 6 coins
    },
  },

  // -------------------------------------------------------------------------
  // w4a4 — OPTIONAL spur: the money laundering is now literal. Four crumble
  // bridges over lava, goldbar-rich: 0 and 1 sit on easy perches, 2 hides on
  // a spring shelf, 3 in a bricked cellar, 4 floats over a lava pit.
  // Coins: 16+3+3+3+3+4+7+6+6 = 51. Enemies: chipstack, rat, chipstack x2,
  // rat, lawyer, pollster, chipstack = 8.
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
      c = crumbleBridge(b, c.endX, c.endRow, { len: 5 });
      b.lava(41, 45, 29);
      b.lava(41, 45, 30);
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['chipstack', 'rat'] });
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = crumbleBridge(b, c.endX, c.endRow, { len: 6 });
      b.lava(72, 77, 29);
      b.lava(72, 77, 30);
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 }); // easy
      c = crumbleBridge(b, c.endX, c.endRow, { len: 7 });
      b.lava(88, 94, 29);
      b.lava(88, 94, 30);
      c = goldbarCellar(b, c.endX, c.endRow, { index: 3 }); // hidden: under the lid
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['chipstack', 'chipstack', 'rat'] });
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = lavaGap(b, c.endX, c.endRow, { gap: 4, goldbar: 4 }); // hidden: apex greed; 4 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = coinArc(b, c.endX, c.endRow, { gap: 5 }); // 7 coins
      c = springShelf(b, c.endX, c.endRow, { index: 2 }); // hidden: shelf 6 up
      c = pipeField(b, c.endX, c.endRow, { pipes: 3, lawyer: true });
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = crumbleBridge(b, c.endX, c.endRow, { len: 8 }); // the big spin cycle
      b.lava(180, 187, 29);
      b.lava(180, 187, 30);
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['pollster', 'chipstack'] });
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // 6 coins
      expectCursor(c, 211, 'w4a4');
      castleFinish(b, c.endX, c.endRow, 230); // 6 coins
    },
  },

  // -------------------------------------------------------------------------
  // w4a5 — the red carpet to the throne: every hazard the palace owns, back
  // to back. High crumble line, springboard wall, 5-wide lava moat, a goldpen
  // qblock at the second rest stop for the road ahead.
  // Coins: 16+3+4+16+3+3+3+5+6 = 59. Enemies: lobbyist, pollster, chipstack,
  // 3 gavels, lawyer, chipstack, pollster = 9.
  // -------------------------------------------------------------------------
  {
    id: 'w4a5',
    world: 4,
    act: 5,
    title: 'Throne Approach',
    excuse: 'A motorcycle parade had right of way in the throne corridor. I waited. Respectfully. For hours.',
    theme: 'castle',
    width: 240,
    build(b) {
      let c = runway(b, 0, 26, { len: 12, coinRow: 22, rings: true }); // 16 coins
      b.start(3, 25);
      c = brickGallery(b, c.endX, c.endRow, { len: 12, powerup: 'stamp' }); // 3 coin qblocks
      c = gapJump(b, c.endX, c.endRow, { gap: 4 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 });
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'pollster', 'chipstack'] });
      c = lavaGap(b, c.endX, c.endRow, { gap: 4 }); // 4 coins
      c = gavelRun(b, c.endX, c.endRow, { len: 18 }); // 3 gavels, 16 coins
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: 1 }); // up to 20
      c = runway(b, c.endX, c.endRow, { len: 6, rings: true }); // 3 coins
      c = gapJump(b, c.endX, c.endRow, { gap: 5 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 });
      c = crumbleBridge(b, c.endX, c.endRow, { len: 6 });
      b.lava(125, 130, 28); // deep drop off the high line
      b.lava(125, 130, 29);
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: -1 }); // down to 26
      c = springboardWall(b, c.endX, c.endRow, { wallH: 5 }); // up to 21
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 });
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 2, dir: -1 }); // down to 25
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      b.qblock(160, 21, 'goldpen'); // armament for the approach
      c = pipeField(b, c.endX, c.endRow, { pipes: 3, lawyer: true });
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['chipstack', 'pollster'] });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 3 });
      c = lavaGap(b, c.endX, c.endRow, { gap: 5, landing: 4 }); // 5 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 4 });
      expectCursor(c, 223, 'w4a5');
      castleFinish(b, c.endX, c.endRow, 240); // 6 coins
    },
  },

  // -------------------------------------------------------------------------
  // w4a6 — OPTIONAL spur: the palace panic room, wall-to-wall entourage. Two
  // immunity galleries pace the blitz; goldbars 0 and 1 easy, 2 on top of the
  // second gallery, 3 in a cellar, 4 on a spring shelf.
  // Coins: 16+2+12+10+3+3+1+12+6 = 65. Enemies: 17.
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
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['pollster', 'pollster', 'chipstack'] });
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = brickGallery(b, c.endX, c.endRow, { len: 8, powerup: 'immunity' }); // 1 coin qblock
      b.goldbar(2, 114, 21); // hidden: on TOP of the immunity gallery
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'rat', 'chipstack'] });
      b.coinRow(120, 131, 22); // 12 coins over the capybara pen
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 }); // easy
      c = pipeField(b, c.endX, c.endRow, { pipes: 3, lawyer: true });
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = goldbarCellar(b, c.endX, c.endRow, { index: 3 }); // hidden
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'chipstack'] });
      c = springShelf(b, c.endX, c.endRow, { index: 4 }); // hidden
      expectCursor(c, 190, 'w4a6');
      castleFinish(b, c.endX, c.endRow, 206); // 6 coins
    },
  },

  // -------------------------------------------------------------------------
  // w4a7 — FINAL CASTLE. The full palace tour, then the longest arena
  // approach in the campaign and the only fight Bowsonaro cannot jetpack out
  // of. Coins: 16+3+4+16+3+7+4+3 = 56. Enemies: lobbyist, pollster,
  // chipstack, 3 gavels, lawyer, chipstack, rat = 9.
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
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: 1 }); // up to 20
      c = coinArc(b, c.endX, c.endRow, { gap: 5 }); // 7 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 });
      c = crumbleBridge(b, c.endX, c.endRow, { len: 6 });
      b.lava(119, 124, 28);
      b.lava(119, 124, 29);
      c = gapJump(b, c.endX, c.endRow, { gap: 5 });
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: -1 }); // down to 26
      c = pipeField(b, c.endX, c.endRow, { pipes: 3, lawyer: true });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 3 });
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['chipstack', 'rat'] });
      c = lavaGap(b, c.endX, c.endRow, { gap: 4, goldbar: 4 }); // 4 coins, apex bar
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins — last save before the show
      expectCursor(c, 209, 'w4a7');
      // Longest arena approach in the game: 43-tile throne room, goal at
      // width-7 (brief wants 6-10), ground filled to the map edge.
      c = arenaApproach(b, c.endX, c.endRow, { width: 43 });
      b.ground(c.endX, 259, 26);
    },
  },
];
