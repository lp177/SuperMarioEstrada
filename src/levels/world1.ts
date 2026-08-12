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
//     ladders (re-enterable from below); crumble-bridge nets sit 2 deep —
//     and since the 2026-08 difficulty wave the FAR half of each net carries
//     spikes (anchored on the net floor, rule 10): dawdling on the cardboard
//     drops you onto teeth, dropping early still finds the clean half.
//   - Warp features (playtest wave): w1a2 buries a bet-slip vault under the
//     lane (warp in, loot, warp out ahead), w1a5 hides a tent-pole shortcut
//     past the pollster gauntlet, w1a7 keeps the repossessed gold in a
//     basement vault under the boom-mic runway.
//   - RICHNESS WAVE (2026-08, rules 11-14): every act now has a terrain
//     PROFILE — ridge climbs, hilltop stretches, valley dips in 2-row treads
//     (>= 8 rows of lane range, >= 6 height steps); billboard rooftops /
//     scaffold walks (oneway decks 5 rows over the lane, billboardDeck or
//     raw b.oneway overlays) give >= 18% dual-lane columns with a >= 12-col
//     parallel stretch; every act fields >= 3 enemy kinds and debuts one on
//     its predecessor (a1 lobbyist/pollster/rat -> a2 lawyer -> a3 rat ->
//     a4 chipstack -> a5 paparazzo -> a6 chipstack); non-boss finales end in
//     pyramidFinish, the two-sided pre-pole pyramid that puts the certified
//     90% grab inside a plain run-jump (w1a6's descent treads already grab
//     100% and keep the classic finishRunway).
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

/** billboardDeck — W1's stock rule-12 parallel path (RICHNESS WAVE, cloned
 *  from W2's proven catwalk): the lane runs at `row` under a billboard
 *  rooftop / scaffold plank walk — a oneway strip 5 rows overhead spanning
 *  len-2 columns. Both lanes are flood-reachable (the planks are
 *  jump-through from below; dropping off either open end rejoins the lane),
 *  the lane scan ignores surfaces >= 3 rows up so the deck never captures
 *  the mandatory lane, and the bot never touches oneways above its head.
 *  Optional coins pay the high road; opts.goldbar floats a bar a hop over
 *  the planks. */
function billboardDeck(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts: { len: number; coins?: boolean; goldbar?: number },
): MotifEnd {
  const len = opts.len;
  if (!Number.isInteger(len) || len < 10 || len > 40) {
    throw new Error(`billboardDeck len must be an integer 10..40, got ${len}`);
  }
  const deck = row - 5;
  if (deck < 3) throw new Error(`billboardDeck: deck row ${deck} needs headroom (row >= 8)`);
  b.ground(x, x + len - 1, row);
  b.oneway(x + 1, x + len - 2, deck);
  if (opts.coins) b.coinRow(x + 2, x + len - 3, deck - 1);
  if (opts.goldbar !== undefined) {
    b.goldbar(opts.goldbar, x + Math.floor(len / 2), deck - 2);
  }
  return { endX: x + len, endRow: row };
}

/** pyramidFinish — the act's final stretch, W1 skin on the classic ending
 *  (rule 14, cloned from W4's proven ziggurat): flat ground to the map edge
 *  with the goal door 8 tiles before `width`, and a two-sided pyramid
 *  (2-row treads, 4-row peak) just left of the flagpole so the certified
 *  (>= 90%) top grab is a plain run-jump. Two-sided because a sheer-backed
 *  staircase would scan as a rule-8 recess; fully LEFT of the pole (col
 *  width-16) so the pole-to-door runway stays flat (ceremony walk contract).
 *  A coin ribbon crowns the peak. Throws if the chain left it under 23 or
 *  over 34 columns — re-balance the chain, not this guard. */
function pyramidFinish(b: LevelBuilderLike, x: number, row: number, width: number): MotifEnd {
  const span = width - x;
  if (span < 23 || span > 34) {
    throw new Error(
      `pyramidFinish: ${span} tiles left before width ${width} (x=${x}) — needs 23..34 (pyramid + pole + door)`,
    );
  }
  b.ground(x, width - 1, row);
  const pole = width - 16; // the pole stands GOAL.poleOffsetTiles before the door
  b.ground(pole - 6, pole - 5, row - 2); // up tread
  b.ground(pole - 4, pole - 3, row - 4); // the peak: 4 rows up = certified grab
  b.ground(pole - 2, pole - 1, row - 2); // down tread (two-sided!)
  b.coinRow(pole - 6, pole - 1, row - 6); // 6 coins riding the pyramid
  b.goal(width - 8, row - 1);
  return { endX: width, endRow: row };
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
  // w1a1 — FORECLOSURE FIELDS. The tutorial reel, richness-wave cut: the
  // painted rolling hills the lane actually climbs (26 up to the ridge at 18
  // and back), TWO billboard rooftop decks over the lane (the alternate
  // route, rule 12), the first real void, the spring, the stamp — and the
  // pre-pole pyramid that makes the certified grab earnable (rule 14). Cast:
  // cousin Fabio twice, the agent, and the intern in the rat costume (rule
  // 13's three kinds, tutorial-gentle).
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
      let c = runway(b, 0, 26, { len: 12, coinRow: 22 }); // 10 coins
      b.start(3, 25);
      c = brickGallery(b, c.endX, c.endRow, { len: 8, powerup: 'stamp' }); // early stamp
      // The first hill: 2-row treads up to the ridge at 18 (relief, rule 11).
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 3, dir: 1 });
      c = runway(b, c.endX, c.endRow, { len: 6, coinRow: 19 }); // 4 coins
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 3, dir: 1 });
      c = runway(b, c.endX, c.endRow, { len: 6, coinRow: 15 }); // 4 coins, the ridge
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 });
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 2, dir: -1 });
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 2, dir: -1 });
      // The valley: a 20-column billboard rooftop rides 5 rows over the lane
      // (board it off the descent treads) while Fabio patrols below.
      c = billboardDeck(b, c.endX, c.endRow, { len: 20, coins: true }); // 16 coins
      b.enemy('lobbyist', 64, 25);
      b.enemy('lobbyist', 71, 25);
      // The campaign's first REAL gap — open void below, then a coin arc over
      // the act's one loot trench. Miss the first and you die; that is the game.
      c = gapJump(b, c.endX, c.endRow, { gap: 3, approach: 3, landing: 3 });
      c = coinArc(b, c.endX, c.endRow, { gap: 3 }); // 5 coins
      coinTrench(b, 90, 92, 26); // the act's one loot trench, +3 coins
      b.goldbar(3, 91, 23); // hovering over the trench
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['pollster', 'lobbyist'] });
      // The spring up to the hilltop stretch; bar on the wall top for a good
      // bounce, then the second rooftop deck rides the hilltop.
      c = springboardWall(b, c.endX, c.endRow, { wallH: 4 });
      b.goldbar(1, 123, 19);
      c = billboardDeck(b, c.endX, c.endRow, { len: 12, coins: true, goldbar: 2 }); // 8 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 2, dir: -1 });
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 4 });
      b.enemy('rat', 156, 25); // the intern debuts (3rd kind, rule 13)
      c = pyramidFinish(b, c.endX, c.endRow, 180); // 6 coins; goal at 172, pole at 164
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
      b.goldbar(4, 109, 17); // hovering mid-flight over the shelf void
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: -1 });
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['pollster', 'lobbyist', 'pollster'] });
      b.coinRow(124, 131, 22); // 8 coins over the gauntlet
      // The betting-office SCAFFOLD (rule 12): a plank walk 5 rows over the
      // three-costume gauntlet — take the high road or run the gauntlet.
      b.oneway(122, 135, 21);
      b.coinRow(123, 134, 20); // 12 coins riding the scaffold
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = runway(b, c.endX, c.endRow, { len: 5 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 });
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = pyramidFinish(b, c.endX, c.endRow, 180); // 6 coins; goal at 172, pole at 164
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
      // THE HIGH ROAD EXTENDED (rule 12): the billboard BEHIND the peak lane
      // still has its rigging up — a 12-column plank walk 5 rows over the
      // peak runway and goldbar 1's perch. Coins pay the crossing.
      b.oneway(102, 113, 11);
      b.coinRow(103, 110, 10); // 8 coins on the rigging
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: -1 });
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // 6 coins
      coinTrench(b, 129, 132, 22); // the act's one loot trench, +4 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 });
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['pollster', 'rat'] });
      b.coinRow(145, 152, 19); // 8 coins over the gauntlet
      // A scaffold walkway over the descent gauntlet (rule 12's second run).
      b.oneway(143, 151, 17);
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
      // THE VACUUM DUCTWORK (rule 12): a service walkway 5 rows over the
      // trench floor, spanning the coin layer and bar 0's perch. The high
      // road watches the vacuum's leavings glitter below.
      b.oneway(16, 31, 25);
      b.coinRow(18, 29, 24); // 12 coins along the duct
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
      b.oneway(89, 101, 25); // second duct run, over the three-costume gauntlet
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = brickGallery(b, c.endX, c.endRow, { len: 8 }); // 2 coin qblocks
      c = goldbarPocket(b, c.endX, c.endRow, { index: 3 }); // hidden bar 2
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      // Springboard out of the trench; hidden bar 3 rides high on the wall.
      c = springboardWall(b, c.endX, c.endRow, { wallH: 5 });
      b.goldbar(4, 131, 21);
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 }); // easy bar 2
      c = pyramidFinish(b, c.endX, c.endRow, 162); // 6 coins; goal at 154, pole at 146
      mustEndAtWidth(b, c.endX, 'w1a4');
    },
  },

  // =========================================================================
  // w1a5 — TOAD TENT CITY. The refugee camp of ruined Toads (the satire aims
  // at the scammers; the tents are decor's sad job). Tent-pole pipes, the
  // first paparazzo drone, the camp ridge climb to row 20 with a crumble
  // walkway and the big-top rooftop deck on it, tent-frame scaffolds over
  // both gauntlets, and a hidden tent-pole warp past the pollster pair.
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
      let c = runway(b, 0, 26, { len: 12, coinRow: 22 }); // 10 coins
      b.start(3, 25);
      c = brickGallery(b, c.endX, c.endRow, { len: 8, powerup: 'stamp' }); // mid-world mercy stamp
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'lobbyist'] });
      // A tent-frame walkway over the two Fabios (rule 12, run one of three).
      b.oneway(21, 30, 21);
      b.coinRow(22, 29, 20); // 8 coins on the frame
      c = gapJump(b, c.endX, c.endRow, { gap: 4, approach: 3, landing: 3 }); // void below
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 });
      c = pipeField(b, c.endX, c.endRow, { pipes: 2 }); // tent poles, no lawyer
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // 6 coins
      coinTrench(b, 61, 64, 26); // the act's one loot trench, +4 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = runway(b, c.endX, c.endRow, { len: 5, rings: true }); // 3 coins
      b.enemy('paparazzo', 82, 22); // the DOP's camera on its wire
      // THE CAMP RIDGE (rule 11): 2-row treads up to the hilltop lane at 20 —
      // the tent city pitched its biggest tents on the only hill left.
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: 1 });
      c = crumbleBridge(b, c.endX, c.endRow, { len: 4 }); // taped-cardboard walkway
      b.ground(92, 95, 22); // crash net 2 deep under the cardboard — hop out
      b.spikes(94, 95, 21); // ...but props dept dumped the broken glass on the
      // FAR half of the net (2026-08 difficulty wave: dawdle on the cardboard
      // and the drop has teeth; the near half stays a clean landing). Rule 10:
      // the shards sit ON the net floor and under the crumble deck.
      b.goldbar(4, 94, 18); // the risky bounty, floating over the glass half
      c = runway(b, c.endX, c.endRow, { len: 6, coinRow: 17 }); // 4 coins
      // THE BIG-TOP ROOF (rule 12's long run): a 14-column rooftop plank walk
      // over the hilltop lane, bar 3 floating a hop above the canvas.
      c = billboardDeck(b, c.endX, c.endRow, { len: 14, coins: true, goldbar: 3 }); // 10 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 });
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: -1 });
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['pollster', 'pollster'] });
      b.oneway(136, 145, 21); // scaffold over the pollster pair
      b.coinRow(137, 144, 20); // 8 coins riding it
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 });
      // TENT-POLE SHORTCUT: press down on the pole planted on the descent
      // tread to skip the pollster gauntlet — the exit pole surfaces right
      // beside goldbar 2's perch. Explorers get paid. Laid AFTER the ground
      // work so nothing overwrites the pipes (rule 7).
      b.warpPipe(133, 24, 2, 155, 25, 1);
      c = pyramidFinish(b, c.endX, c.endRow, 180); // 6 coins; goal at 172, pole at 164
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
      // The rim mound (rule 11): a 2-row knoll between the two bridges —
      // the ravine's lip rolls, it does not run flat.
      c = steppes(b, c.endX, c.endRow, { count: 1, stepH: 2, treadW: 3, dir: 1 });
      c = steppes(b, c.endX, c.endRow, { count: 1, stepH: 2, treadW: 3, dir: -1 });
      c = crumbleBridge(b, c.endX, c.endRow, { len: 6 }); // longer, still void
      b.coinRow(31, 36, 23); // 6 coins
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['pollster', 'lobbyist'] });
      b.oneway(40, 48, 21); // rigging walk over the gauntlet (rule 12)
      b.coinRow(41, 47, 20); // 7 coins on the rigging
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = onewayClimb(b, c.endX, c.endRow, { rise: 4 }); // up the ravine wall
      stuntMat(b, 56, 62, 26);
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = gapJump(b, c.endX, c.endRow, { gap: 5, approach: 3, landing: 3 }); // the ravine leap, no net
      c = goldbarPocket(b, c.endX, c.endRow, { index: 2 }); // hidden bar 1
      c = crumbleBridge(b, c.endX, c.endRow, { len: 6 }); // void
      b.coinRow(89, 94, 19); // 6 coins
      c = coinArc(b, c.endX, c.endRow, { gap: 5 }); // 7 coins, void below
      // The film-can stack debuts here (rule 13): Estrada's crew dumped the
      // dailies into the ravine too.
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['pollster', 'chipstack'] });
      b.coinRow(111, 116, 18); // 6 coins
      b.oneway(109, 117, 17); // second rigging walk, over the dailies
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      // Spring to the high ridge; hidden bar 2 floats above the wall top.
      c = springboardWall(b, c.endX, c.endRow, { wallH: 5 });
      b.goldbar(3, 129, 13);
      c = runway(b, c.endX, c.endRow, { len: 13, coinRow: 14 }); // 11 coins
      // THE RIDGE RIGGING (rule 12's long run): planks 5 rows over the high
      // ridge, from the wall top to secret 2's doorstep.
      b.oneway(132, 144, 12);
      b.coinRow(133, 143, 11); // 11 coins up top
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
      // THE BATTLEMENT CLIMB (rule 11): 2-row treads all the way up to the
      // wall walk at 18 — a repossessed keep still has its keep.
      c = steppes(b, c.endX, c.endRow, { count: 4, stepH: 2, treadW: 2, dir: 1 });
      c = crumbleBridge(b, c.endX, c.endRow, { len: 5 }); // the drawbridge, repossessed
      b.ground(78, 82, 20); // net 2 deep under the drawbridge — hop out
      b.spikes(80, 82, 19); // 2026-08 difficulty wave: the repo men left the
      // portcullis teeth in the moat net — the far 3 columns bite; drop early
      // or pay. Anchored ON the net floor (rule 10).
      // THE BASEMENT VAULT: the repossessed gold is kept under the boom-mic
      // runway. A stub pipe before the gavel warps down into the sealed
      // strongroom; the exit warp surfaces on the drawbridge shoulder atop
      // the battlement. Carve first, THEN lay pipes (room() would erase them).
      b.room(56, 67, 30, 33);
      b.warpPipe(54, 25, 1, 58, 32, 2); // runway stub -> strongroom
      b.warpPipe(65, 32, 2, 76, 17, 1); // strongroom -> drawbridge shoulder
      b.coinRow(60, 64, 32); // 5 coins
      b.coinRow(60, 64, 33); // 5 coins
      b.coinRow(56, 57, 33); // 2 coins
      b.coin(67, 33); // 13 vault coins total
      b.coinRow(78, 82, 16); // 5 coins
      b.goldbar(3, 80, 14); // high over the crumbling planks
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 });
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      // The battlement UPPER WALK (rule 12): a crenellated oneway 5 rows
      // over the wall-walk lane, spanning bar 1's perch and secret 1.
      b.oneway(86, 94, 13);
      b.coinRow(87, 93, 12); // 7 coins along the crenellations
      c = steppes(b, c.endX, c.endRow, { count: 4, stepH: 2, treadW: 2, dir: -1 });
      c = runway(b, c.endX, c.endRow, { len: 2 });
      b.enemy('paparazzo', 105, 22); // the castle security drone
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
