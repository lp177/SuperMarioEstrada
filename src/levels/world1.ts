// ============================================================================
// WORLD 1 — MUSHROOM HEIGHTS ('meadow'). Produced in-fiction by M. ESTRADA:
// the opening set of his hero movie. The kingdom right after the scam —
// foreclosure signs, betting billboards, film-crew gear (decor is the painter
// crew's job; this file owns layout + placement).
//
// Authoring rules honored here:
//   - Motifs chained on {endX, endRow}; raw builder calls only where a motif
//     cannot say it (hidden goldbar pockets, shallow pit floors, late fliers).
//   - The mandatory route is flow-bot honest: steps <= 2 rows, gaps <= 5,
//     nothing that needs more than run+jump.
//   - W1 is GENTLE but CLASSICAL (2026-08 playtest re-tune): wide runways and
//     3-4 tile gaps, but gaps are REAL — floorless voids that kill (die ->
//     respawn at checkpoint). "Real hole where we can die if we don't jump
//     correctly." Voids stay 3-4 wide and telegraphed in this tutorial world.
//   - At most ONE shallow coin trench per act (coinTrench: safe floor 2 deep,
//     coins on it — looting feels good, hopping out is trivial). The trench
//     slots are the short-approach gaps where a sprint takeoff could clip the
//     far lip. Safe floors 3 deep survive ONLY as stunt mats under oneway
//     ladders (re-enterable from below); crumble-bridge nets sit 2 deep.
//   - Warp features (playtest wave): w1a2 buries a bet-slip vault under the
//     lane (warp in, loot, warp out ahead), w1a5 hides a tent-pole shortcut
//     past the big gauntlet, w1a7 keeps the repossessed gold in a basement
//     vault under the boom-mic runway.
//   - Clocked hazards (gavel, lawyer) live > 27 tiles from the start; walkers
//     spawn >= 24 tiles out so an idle level stays silent.
//   - Each build() ends by proving its own arithmetic: endX must land exactly
//     on def.width, or it throws.
// ============================================================================

import type { LevelBuilderLike, LevelDef } from '../core/types.ts';
import type { MotifEnd } from '../game/motifs.ts';
import {
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
} from '../game/motifs.ts';

// ---------------------------------------------------------------------------
// goldbarPocket — a HIDDEN goldbar in a dug alcove, same trick geometry as
// secretPocket (open 1-column slot, brick lid, hollow interior) but paying out
// a goldbar. Used by the optional acts, whose rule is 2 easy bars + 3 hidden.
//   x     : shoulder ground at row
//   x+1   : entrance slot, floor at row+2
//   x+2/3 : interior — brick lid at row, hollow row+1..row+2, floor row+3,
//           the goldbar at row+2
//   x+4   : shoulder ground at row
// ---------------------------------------------------------------------------
function goldbarPocket(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts: { index: number },
): MotifEnd {
  if (row + 3 >= b.heightTiles) {
    throw new Error(`goldbarPocket: pocket floor ${row + 3} falls off the map`);
  }
  b.ground(x, x, row);
  b.ground(x + 1, x + 1, row + 2);
  b.ground(x + 2, x + 3, row + 3);
  b.platform(x + 2, x + 3, row, 'brick');
  b.ground(x + 4, x + 4, row);
  b.goldbar(opts.index, x + 3, row + 2);
  return { endX: x + 5, endRow: row };
}

/** The act's ONE loot trench: a safe floor 2 deep (rule 8's safeMaxDepth —
 *  hop out trivially) with a coin row resting on it. A floor at gapRow+2 IS
 *  seen by the bot's gap probe, so the bot runs through the trench and
 *  wall-jumps the 2-row exit instead of jumping — which is exactly why the
 *  trenches live where the sprint approach is too short for a safe void leap.
 *  Every other carved gap in W1 is a genuine deadly void (playtest 2026-08). */
function coinTrench(b: LevelBuilderLike, x0: number, x1: number, gapRow: number): void {
  b.ground(x0, x1, gapRow + 2);
  b.coinRow(x0, x1, gapRow + 1);
}

/** Stunt mat under an onewayClimb ladder: floor 3 under the lowest strip.
 *  Never a trap — a fallen player jumps back up THROUGH the oneway strips
 *  overhead, and a bot that misses the strips wall-jumps the exit shoulder.
 *  The lane scan follows the strips, so the mat never reads as a recess.
 *  Only sanctioned under onewayClimbs; 3-deep safe floors anywhere else are
 *  a rule 8 violation. */
function stuntMat(b: LevelBuilderLike, x0: number, x1: number, stripRow: number): void {
  b.ground(x0, x1, stripRow + 3);
}

/** Every build proves its own arithmetic: the chain must land exactly on the
 *  right edge of the map, or the act is mis-sized and must not ship. */
function mustEndAtWidth(b: LevelBuilderLike, endX: number, id: string): void {
  if (endX !== b.widthTiles) {
    throw new Error(`${id}: motif chain ends at x=${endX}, expected width ${b.widthTiles}`);
  }
}

export const world1: LevelDef[] = [
  // =========================================================================
  // w1a1 — FORECLOSURE FIELDS. The tutorial reel: wide runways, baby steps,
  // one small gap, the spring, and the first notary stamp in an early qblock.
  // =========================================================================
  {
    id: 'w1a1',
    world: 1,
    act: 1,
    title: 'Foreclosure Fields',
    excuse: 'She was never at this address. I checked the deed myself — notarized, stamped, and therefore true.',
    theme: 'meadow',
    width: 180,
    build(b) {
      let c = runway(b, 0, 26, { len: 14, coinRow: 22 }); // 12 coins
      b.start(3, 25);
      c = brickGallery(b, c.endX, c.endRow, { len: 8, powerup: 'stamp' }); // early stamp
      // Jump tutorial, part 1: little steps up and back down.
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 1, treadW: 3, dir: 1 });
      c = runway(b, c.endX, c.endRow, { len: 5 });
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 1, treadW: 3, dir: -1 });
      // Part 2: the campaign's first REAL gap — open void below, a short arc
      // of coins telegraphing the jump. Miss it and you die; that is the game.
      c = gapJump(b, c.endX, c.endRow, { gap: 3, approach: 4, landing: 4 });
      b.coin(43, 24);
      b.coin(44, 23);
      b.coin(45, 24);
      c = coinArc(b, c.endX, c.endRow, { gap: 3 }); // 5 coins
      coinTrench(b, 53, 55, 26); // the act's one loot trench, +3 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 });
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'lobbyist'] });
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = runway(b, c.endX, c.endRow, { len: 11, rings: true }); // 6 coins
      // Part 3: the spring. Bonus bar on the wall top for a good bounce.
      c = springboardWall(b, c.endX, c.endRow, { wallH: 4 });
      b.goldbar(3, 103, 19);
      c = runway(b, c.endX, c.endRow, { len: 12, coinRow: 18 }); // 10 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 });
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 2, dir: -1 });
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['pollster', 'lobbyist'] });
      c = runway(b, c.endX, c.endRow, { len: 12, coinRow: 23 }); // 10 coins
      b.goldbar(2, 150, 22); // crowning the coin row
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 4 });
      c = finishRunway(b, c.endX, c.endRow, { len: 9 }); // goal at 172 = width-8
      c = runway(b, c.endX, c.endRow, { len: 5 }); // ground to the edge
      mustEndAtWidth(b, c.endX, 'w1a1');
    },
  },

  // =========================================================================
  // w1a2 — BET SLIP MEADOWS. The odds get worse: first pipes (with THE
  // lawyer), a raised meadow shelf, slightly wider gaps.
  // =========================================================================
  {
    id: 'w1a2',
    world: 1,
    act: 2,
    title: 'Bet Slip Meadows',
    excuse: 'Rescue her NOW? And void every bet slip in the kingdom? I am protecting your money, Mangiani.',
    theme: 'meadow',
    width: 180,
    build(b) {
      let c = runway(b, 0, 26, { len: 10, coinRow: 22 }); // 8 coins
      b.start(3, 25);
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 });
      c = gapJump(b, c.endX, c.endRow, { gap: 3 }); // void below — jump or die
      c = brickGallery(b, c.endX, c.endRow, { len: 10 }); // 3 coin qblocks
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'pollster'] });
      c = pipeField(b, c.endX, c.endRow, { pipes: 3, lawyer: true }); // 51 tiles out
      // THE BET-SLIP VAULT: a warp pipe at the gallery's edge sinks into a
      // sealed archive under the gauntlet — a coin hoard plus goldbar 3 filed
      // among the certified slips — and the exit warp surfaces in the pipe
      // field ahead. Carve first, THEN lay pipes (room() would erase them).
      b.room(34, 44, 30, 33);
      b.warpPipe(33, 24, 2, 36, 32, 2); // lane -> vault
      b.warpPipe(42, 32, 2, 60, 25, 1); // vault -> pipe field ahead
      b.coinRow(38, 41, 32); // 4 coins
      b.coinRow(38, 41, 33); // 4 coins
      b.coin(34, 33);
      b.coin(35, 33);
      b.coin(44, 33); // 11 vault coins total
      b.goldbar(3, 39, 31); // filed in the vault (moved off the ring runway)
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // 6 coins
      coinTrench(b, 65, 68, 26); // the act's one loot trench, +4 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      // The raised shelf: up 6 rows, an airy gap, back down.
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: 1 });
      c = runway(b, c.endX, c.endRow, { len: 10, coinRow: 16 }); // 8 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 });
      c = gapJump(b, c.endX, c.endRow, { gap: 4, approach: 3, landing: 3 }); // shelf gap, void below
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: -1 });
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['pollster', 'lobbyist', 'pollster'] });
      b.coinRow(124, 131, 22); // 8 coins over the gauntlet
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = runway(b, c.endX, c.endRow, { len: 11, rings: true }); // 6 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 });
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 4 });
      c = finishRunway(b, c.endX, c.endRow, { len: 8 }); // goal at 174 = width-6
      c = runway(b, c.endX, c.endRow, { len: 3 });
      mustEndAtWidth(b, c.endX, 'w1a2');
    },
  },

  // =========================================================================
  // w1a3 — BILLBOARD HEIGHTS. The high road: up onto the rooftops of the
  // giant "IMPOSSIBLE TO LOSE!" billboards via oneway climbs, a peak lane at
  // row 16, then a long stepped descent. Falls off the boards land on floored
  // ledges — Estrada budgeted for stunt mats.
  // =========================================================================
  {
    id: 'w1a3',
    world: 1,
    act: 3,
    title: 'Billboard Heights',
    excuse: 'We lost the golden hour. No certified hero climbs a billboard in bad light — it reads terribly on camera.',
    theme: 'meadow',
    width: 180,
    build(b) {
      let c = runway(b, 0, 26, { len: 10, coinRow: 22 }); // 8 coins
      b.start(3, 25);
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 3, dir: 1 });
      // First billboard: oneway ladder, stunt-mat floor 3 under the planks
      // (mats are legal only here — the oneways above re-admit the fallen).
      c = onewayClimb(b, c.endX, c.endRow, { rise: 4 });
      stuntMat(b, 17, 23, 22);
      c = runway(b, c.endX, c.endRow, { len: 10, coinRow: 15 }); // 8 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 });
      c = gapJump(b, c.endX, c.endRow, { gap: 3 }); // off the billboard edge: void
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'pollster'] });
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = gapJump(b, c.endX, c.endRow, { gap: 4, approach: 3, landing: 3 }); // void
      c = brickGallery(b, c.endX, c.endRow, { len: 10 }); // 3 coin qblocks
      // Second billboard, up to the peak lane.
      c = onewayClimb(b, c.endX, c.endRow, { rise: 2 });
      stuntMat(b, 94, 98, 18);
      c = runway(b, c.endX, c.endRow, { len: 8, coinRow: 13 }); // 6 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 });
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: -1 });
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // 6 coins
      coinTrench(b, 129, 132, 22); // the act's one loot trench, +4 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 });
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['pollster', 'rat'] });
      b.coinRow(145, 152, 19); // 8 coins over the gauntlet
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 2, dir: -1 });
      b.goldbar(3, 160, 23); // floating beside the descent
      c = runway(b, c.endX, c.endRow, { len: 5 });
      b.goldbar(4, 164, 22);
      c = finishRunway(b, c.endX, c.endRow, { len: 9 }); // goal at 172 = width-8
      c = runway(b, c.endX, c.endRow, { len: 4 });
      mustEndAtWidth(b, c.endX, 'w1a3');
    },
  },

  // =========================================================================
  // w1a4 — COIN VACUUM VALLEY (OPTIONAL low road). A trench stuffed with the
  // kingdom's un-vacuumed coins. Harder but richer: 2 easy bars on perches,
  // 3 hidden (two dug pockets, one high on the exit wall), a spike pit, and
  // the film-can stack (chipstack) makes its debut.
  // =========================================================================
  {
    id: 'w1a4',
    world: 1,
    act: 4,
    title: 'Coin Vacuum Valley',
    excuse: 'The coin vacuum was scheduled maintenance. Totally unrelated to us. I have the log. It is documented.',
    theme: 'meadow',
    width: 162,
    build(b) {
      let c = runway(b, 0, 26, { len: 9, coinRow: 22 }); // 7 coins
      b.start(3, 25);
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 3, dir: -1 }); // into the trench
      c = runway(b, c.endX, c.endRow, { len: 12, coinRow: 26 }); // 10 coins
      b.coinRow(16, 25, 28); // 10 more — the un-vacuumed layer
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 }); // easy bar 1
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'lobbyist'] });
      b.coinRow(36, 42, 27); // 7 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = runway(b, c.endX, c.endRow, { len: 8, coinRow: 27 }); // 6 coins
      c = goldbarPocket(b, c.endX, c.endRow, { index: 2 }); // hidden bar 1
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = gapJump(b, c.endX, c.endRow, { gap: 4, approach: 3, landing: 3 }); // trench-bottom void
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // 6 coins
      b.ground(81, 84, 34); // the one nasty pit: floored...
      b.spikes(81, 84, 33); // ...with spikes. Optional act, optional pain.
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['chipstack', 'pollster', 'lobbyist'] });
      b.coinRow(91, 99, 26); // 9 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = brickGallery(b, c.endX, c.endRow, { len: 8 }); // 2 coin qblocks
      c = goldbarPocket(b, c.endX, c.endRow, { index: 3 }); // hidden bar 2
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      // Springboard out of the trench; hidden bar 3 rides high on the wall.
      c = springboardWall(b, c.endX, c.endRow, { wallH: 5 });
      b.goldbar(4, 131, 21);
      c = runway(b, c.endX, c.endRow, { len: 10, rings: true }); // 3 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 }); // easy bar 2
      c = finishRunway(b, c.endX, c.endRow, { len: 9 }); // goal at 155 = width-7
      c = runway(b, c.endX, c.endRow, { len: 4 });
      mustEndAtWidth(b, c.endX, 'w1a4');
    },
  },

  // =========================================================================
  // w1a5 — TOAD TENT CITY. The refugee camp of ruined Toads (the satire aims
  // at the scammers; the tents are decor's sad job). Tent-pole pipes, the
  // first paparazzo drone, a crumble walkway, a hidden tent-pole warp past
  // the big gauntlet, and a 4-wide void finale.
  // =========================================================================
  {
    id: 'w1a5',
    world: 1,
    act: 5,
    title: 'Toad Tent City',
    excuse: 'The tent city has no filming permit. We resume the heroism when the paperwork clears — six to eight weeks.',
    theme: 'meadow',
    width: 180,
    build(b) {
      let c = runway(b, 0, 26, { len: 13, coinRow: 22 }); // 11 coins
      b.start(3, 25);
      c = brickGallery(b, c.endX, c.endRow, { len: 8, powerup: 'stamp' }); // mid-world mercy stamp
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'lobbyist'] });
      c = gapJump(b, c.endX, c.endRow, { gap: 4 }); // void below
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 });
      c = pipeField(b, c.endX, c.endRow, { pipes: 2 }); // tent poles, no lawyer
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // 6 coins
      coinTrench(b, 62, 65, 26); // the act's one loot trench, +4 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = runway(b, c.endX, c.endRow, { len: 10, rings: true }); // 3 coins
      b.enemy('paparazzo', 84, 22); // the DOP's camera on its wire
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 2, dir: 1 });
      c = crumbleBridge(b, c.endX, c.endRow, { len: 4 }); // taped-cardboard walkway
      b.ground(96, 99, 24); // crash net 2 deep under the cardboard — hop out
      c = runway(b, c.endX, c.endRow, { len: 7, coinRow: 19 }); // 5 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 });
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 2, dir: -1 });
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['pollster', 'pollster', 'lobbyist'] });
      b.coinRow(127, 136, 22); // 10 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 });
      // TENT-POLE SHORTCUT: press down on the pole planted on the descent
      // tread to skip the three-costume gauntlet — the exit pole surfaces
      // right beside goldbar 2's perch. Explorers get paid. (The exit sits
      // on the perch ground BEFORE its platform: from the perch the lane
      // runs into the finale void, so the span reads hazard, not safe.)
      b.warpPipe(122, 24, 2, 144, 24, 2);
      // Finale: the widest void of the world so far, bar floating mid-flight
      // over the drop. 4 wide — tutorial-world voids stay 3-4 and telegraphed.
      c = gapJump(b, c.endX, c.endRow, { gap: 4, approach: 3, landing: 4 });
      b.coinRow(153, 156, 23); // 4 coins tracing the leap
      b.goldbar(3, 155, 22);
      c = goldbarPerch(b, c.endX, c.endRow, { index: 4 });
      c = finishRunway(b, c.endX, c.endRow, { len: 9 }); // goal at 173 = width-7
      c = runway(b, c.endX, c.endRow, { len: 4 });
      mustEndAtWidth(b, c.endX, 'w1a5');
    },
  },

  // =========================================================================
  // w1a6 — GRANDMA'S HAT RAVINE (OPTIONAL spur). The hat Grandma bet and
  // lost blew in here. Crumble bridges over a REAL void — this is the one
  // W1 act where falling is falling. 2 easy bars, 3 hidden, coins over every
  // bridge for the greedy.
  // =========================================================================
  {
    id: 'w1a6',
    world: 1,
    act: 6,
    title: "Grandma's Hat Ravine",
    excuse: 'We nearly had her, but Grandma’s hat blew into the ravine, and a hero honors his grandmother first. Family law.',
    theme: 'meadow',
    width: 180,
    build(b) {
      let c = runway(b, 0, 26, { len: 9, coinRow: 22 }); // 7 coins
      b.start(3, 25);
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 }); // easy bar 1
      c = crumbleBridge(b, c.endX, c.endRow, { len: 4 }); // void below
      b.coinRow(17, 20, 23); // 4 coins over the planks
      c = runway(b, c.endX, c.endRow, { len: 5, coinRow: 22 }); // 3 coins
      c = crumbleBridge(b, c.endX, c.endRow, { len: 6 }); // longer, still void
      b.coinRow(30, 35, 23); // 6 coins
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['pollster', 'lobbyist'] });
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = onewayClimb(b, c.endX, c.endRow, { rise: 4 }); // up the ravine wall
      stuntMat(b, 55, 61, 26);
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = gapJump(b, c.endX, c.endRow, { gap: 5, approach: 3, landing: 3 }); // the ravine leap, no net
      c = goldbarPocket(b, c.endX, c.endRow, { index: 2 }); // hidden bar 1
      c = crumbleBridge(b, c.endX, c.endRow, { len: 6 }); // void
      b.coinRow(88, 93, 19); // 6 coins
      c = coinArc(b, c.endX, c.endRow, { gap: 5 }); // 7 coins, void below
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['pollster', 'pollster'] });
      b.coinRow(110, 115, 18); // 6 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      // Spring to the high ridge; hidden bar 2 floats above the wall top.
      c = springboardWall(b, c.endX, c.endRow, { wallH: 5 });
      b.goldbar(3, 128, 13);
      c = runway(b, c.endX, c.endRow, { len: 14, coinRow: 14 }); // 12 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 }); // easy bar 2
      c = goldbarPocket(b, c.endX, c.endRow, { index: 4 }); // hidden bar 3
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: -1 });
      c = finishRunway(b, c.endX, c.endRow, { len: 9 }); // goal at 172 = width-8
      c = runway(b, c.endX, c.endRow, { len: 5 });
      mustEndAtWidth(b, c.endX, 'w1a6');
    },
  },

  // =========================================================================
  // w1a7 — THE REPOSSESSED KEEP (CASTLE). A castle with a lien on it. The
  // boom mic (gavel) dips into frame, the camera drone hovers, and Bowsonaro
  // grandstands in an arena carpeted with repossessed gold.
  // =========================================================================
  {
    id: 'w1a7',
    world: 1,
    act: 7,
    title: 'The Repossessed Keep',
    excuse: 'The keep was repossessed mid-rescue. New owner, new locks, new princess location. Legally she is in another castle.',
    theme: 'meadow',
    width: 156,
    boss: true,
    cutsceneAfter: 'w1-end',
    build(b) {
      let c = runway(b, 0, 26, { len: 12, coinRow: 22 }); // 10 coins
      b.start(3, 25);
      c = brickGallery(b, c.endX, c.endRow, { len: 10, powerup: 'stamp' }); // pre-boss stamp
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'pollster'] });
      b.coinRow(25, 30, 22); // 6 coins
      c = gapJump(b, c.endX, c.endRow, { gap: 4 }); // the moat: open void
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 });
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = runway(b, c.endX, c.endRow, { len: 8 });
      b.enemy('gavel', 58, 22); // the boom mic, 58 tiles from the spawn
      b.coinRow(55, 57, 23); // bait either side of the slam zone
      b.coinRow(59, 61, 23);
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 2, dir: 1 });
      c = crumbleBridge(b, c.endX, c.endRow, { len: 5 }); // the drawbridge, repossessed
      b.ground(74, 78, 24); // net 2 deep under the drawbridge — hop out
      // THE BASEMENT VAULT: the repossessed gold is kept under the boom-mic
      // runway. A stub pipe before the gavel warps down into the sealed
      // strongroom; the exit warp surfaces on the drawbridge shoulder ahead.
      // Carve first, THEN lay pipes (room() would erase them).
      b.room(56, 67, 30, 33);
      b.warpPipe(54, 25, 1, 58, 32, 2); // runway stub -> strongroom
      b.warpPipe(65, 32, 2, 72, 20, 2); // strongroom -> drawbridge shoulder
      b.coinRow(60, 64, 32); // 5 coins
      b.coinRow(60, 64, 33); // 5 coins
      b.coinRow(56, 57, 33); // 2 coins
      b.coin(67, 33); // 13 vault coins total
      b.coinRow(74, 78, 20); // 5 coins
      b.goldbar(3, 76, 18); // high over the crumbling planks
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 });
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 2, dir: -1 });
      c = runway(b, c.endX, c.endRow, { len: 10, rings: true }); // 3 coins
      b.enemy('paparazzo', 102, 22); // the castle security drone
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 });
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 4 });
      // The arena: gates, Bowsonaro, and a floor of repossessed gold.
      c = arenaApproachWithLoot(b, c.endX, c.endRow);
      c = runway(b, c.endX, c.endRow, { len: 3 });
      mustEndAtWidth(b, c.endX, 'w1a7');
    },
  },
];

/** w1a7's arena: standard arenaApproach (24-tile floor, goal inside at the
 *  right) plus the repossessed-gold coin carpet, clear of both gate columns. */
function arenaApproachWithLoot(b: LevelBuilderLike, x: number, row: number): MotifEnd {
  const end = arenaApproach(b, x, row, { width: 24 });
  b.coinRow(x + 9, x + 27, row - 4); // 19 coins inside the arena
  return end;
}
