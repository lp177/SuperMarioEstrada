import type { BlockContents, LevelBuilderLike, LevelDef } from '../core/types.ts';
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

// ============================================================================
// WORLD 3 — CASINO PENINSULA. Produced (in fiction) by Princess Impeach, who
// insisted on having TWO areas. The betting platform made physical: qblock
// slot banks, card-table oneways, chipstack goons in poker-chip costumes,
// winged security cameras, brick vault cells — and more coins than any other
// world, because it IS the casino. The set dressing (duct tape, prop sticks,
// "LOOSEST SLOTS IN THE KINGDOM" signage) is the painter's job; this file
// owns geometry, spawns and Estrada's excuses.
//
// Authoring invariants kept here (the act contract enforces most of them):
//   - every act chains motifs on {endX, endRow}; raw builder calls only where
//     no motif says "casino" (slot banks, card tables, vault cells, shelves),
//   - the goal lands 7 tiles before def.width and ground runs to the edge,
//   - clocked hazards (gavel, lawyer) sit > 27 tiles from the start,
//   - paparazzi sit far enough out (> 34 tiles) that an idle player is never
//     dive-bombed inside the 600-frame silence window; walkers likewise
//     cannot wander back to the spawn in time,
//   - the mandatory route is flow-bot fare: steps <= 2, gaps <= 5, walls only
//     where an 8-tile bot jump (or a spring, for humans) clears them,
//   - warp features (2026-08 re-tune) are OPTIONAL side content — the flow
//     bot never presses down, so the mandatory route ignores them: w3a1 the
//     High-Roller Lounge (10-coin vault), w3a6 the deep vault (16 coins +
//     goldbar 3), w3a7 an honest shortcut past the entourage gauntlet.
// ============================================================================

// ---------------------------------------------------------------------------
// Local casino motifs. Same contract as src/game/motifs.ts: pure functions of
// their arguments, all own ground laid, {endX, endRow} handed over.
// ---------------------------------------------------------------------------

/** A bank of three qblock "slot reels" 4 rows over flat ground — bump the
 *  machine, see what pays out. Mixed contents is the whole joke. */
function slotBank(
  b: LevelBuilderLike,
  x: number,
  row: number,
  reels: [BlockContents, BlockContents, BlockContents],
): MotifEnd {
  b.ground(x, x + 6, row);
  b.qblock(x + 2, row - 4, reels[0]);
  b.qblock(x + 3, row - 4, reels[1]);
  b.qblock(x + 4, row - 4, reels[2]);
  return { endX: x + 7, endRow: row };
}

/** A brick-lidded vault cell holding a goldbar — secretPocket geometry (the
 *  proven stride-over slot) with treasure instead of a fanfare. */
function vaultCell(b: LevelBuilderLike, x: number, row: number, bar: number): MotifEnd {
  b.ground(x, x, row);
  b.ground(x + 1, x + 1, row + 2); // entrance slot; drop 2 in, hop 2 out
  b.ground(x + 2, x + 3, row + 3); // cell floor
  b.platform(x + 2, x + 3, row, 'brick'); // the vault lid
  b.ground(x + 4, x + 4, row);
  b.goldbar(bar, x + 3, row + 2);
  return { endX: x + 5, endRow: row };
}

/** A warp-served COUNTING ROOM carved under the lane: press down on the
 *  entry pipe, sink into a coin hoard (optionally one of the act's goldbars
 *  or secrets — counts unchanged, just relocated), ride the far pipe back to
 *  the lane ahead. Lane silhouette: 16 flat columns with two 2-tall pipes —
 *  the exact shape the flow bot already clears in pipeField, so the
 *  mandatory route never needs the warp. Room geometry keeps contract rule 7
 *  honest by construction: 2 clear rows over every mouth, and the hop from
 *  the room floor onto the departure mouth is a 2-row step. */
function warpVault(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts: { coins: 10 | 16; goldbar?: number; secret?: number },
): MotifEnd {
  const roomTop = row + 3; // 3-row lid keeps the lane surface intact
  const roomBot = b.heightTiles - 2; // floor is the map's last bedrock row
  if (roomBot - roomTop < 5) {
    throw new Error(`warpVault: lane row ${row} leaves no depth for the vault room`);
  }
  b.ground(x, x + 15, row);
  b.room(x + 1, x + 12, roomTop, roomBot); // carve BEFORE laying vault pipes
  b.warpPipe(x + 1, row - 2, 2, x + 3, roomBot - 1, 2); // down into the vault
  b.warpPipe(x + 9, roomBot - 1, 2, x + 13, row - 2, 2); // back to the lane
  b.coinRow(x + 2, x + 11, roomBot - 3); // 10 coins
  if (opts.coins === 16) b.coinRow(x + 4, x + 9, roomBot - 2); // +6: the grand hoard
  if (opts.goldbar !== undefined) b.goldbar(opts.goldbar, x + 6, roomBot);
  if (opts.secret !== undefined) b.secret(opts.secret, x + 7, roomBot);
  return { endX: x + 16, endRow: row };
}

/** Card-table flats: three felt-top oneway tables over the CARD SHREDDER —
 *  a spike-carpeted service pit where the house shreds misdealt cards (and
 *  misdealt heroes). Falling between tables costs a hit (rule 8: gaps carry
 *  risk — the old safe floor was a nap); hop back out through the felt
 *  (oneways) or over the low exit wall. Coins hover over the honest line. */
function cardTables(b: LevelBuilderLike, x: number, row: number): MotifEnd {
  b.ground(x, x + 1, row);
  b.ground(x + 2, x + 13, row + 3); // service-pit floor…
  b.spikes(x + 2, x + 13, row + 2); // …under the shredder carpet
  b.oneway(x + 2, x + 4, row - 1);
  b.oneway(x + 6, x + 8, row - 2);
  b.oneway(x + 10, x + 12, row - 1);
  b.coinRow(x + 2, x + 4, row - 3);
  b.coinRow(x + 6, x + 8, row - 4);
  b.coinRow(x + 10, x + 12, row - 3);
  b.ground(x + 14, x + 15, row);
  return { endX: x + 16, endRow: row };
}

/** A runway under a giant slot-machine lever (gavel crusher) with a taunting
 *  coin trail straight through its slam column. */
function gavelRun(b: LevelBuilderLike, x: number, row: number): MotifEnd {
  const end = runway(b, x, row, { len: 8, coinRow: row - 3 }); // 6 coins
  b.enemy('gavel', x + 4, row - 4);
  return end;
}

/** THE CHIP SORTER (2026-08 difficulty wave): two spike-floored sorting trays
 *  with one 2-wide safe island between them — precision landing, W3/W4 only.
 *  Each tray is 3 deep and its carpet sits ON the tray floor (rule 10); the
 *  deepest rest is spikes, so falling in carries risk (rule 8), and the plain
 *  3-row exit walls clear rule 9's live escape probe. A sprint jump clears
 *  the whole 10-column feature in one leap (the flow bot does exactly that);
 *  the island is for the cautious and the greedy alike. */
function spikeTrays(b: LevelBuilderLike, x: number, row: number): MotifEnd {
  b.ground(x, x + 1, row); // takeoff shoulder
  b.ground(x + 2, x + 3, row + 3); // tray 1 floor...
  b.spikes(x + 2, x + 3, row + 2); // ...its carpet, anchored on it
  b.ground(x + 4, x + 5, row); // the island
  b.ground(x + 6, x + 7, row + 3); // tray 2 floor
  b.spikes(x + 6, x + 7, row + 2);
  b.ground(x + 8, x + 9, row); // landing shoulder
  b.coinRow(x + 2, x + 7, row - 2); // 6 coins tracing the honest line
  return { endX: x + 10, endRow: row };
}

/** A goldbar floating two rows over a spike trench (3 deep, teeth ON the
 *  trench floor — rule 10): risk the LOOT, not the lane. The 2-wide trench
 *  reads as a gap to the flow bot's 2-tile support probe (the teeth sit 2
 *  rows down, the floor 3), so the mandatory run JUMPS it at speed and never
 *  dips — the trench only ever catches whoever goes for the bar and
 *  undershoots (Certified shrinks, neutral knockback shoves goal-ward, and
 *  the plain 3-row wall under open sky is one full-hold jump out). It scans
 *  as a floored hazard recess, so rule 9's live probe re-proves that escape
 *  every run. */
function spikeGuardedBar(b: LevelBuilderLike, x: number, row: number, bar: number): MotifEnd {
  b.ground(x, x + 2, row);
  b.ground(x + 3, x + 4, row + 3); // trench floor...
  b.spikes(x + 3, x + 4, row + 2); // ...its teeth
  b.ground(x + 5, x + 5, row);
  b.goldbar(bar, x + 3, row - 2); // the bait, one clean arc away
  b.coin(x + 3, row - 1); // two taunt coins under the bar
  b.coin(x + 4, row - 1);
  return { endX: x + 6, endRow: row };
}

/** A 2-brick teller wall with the loot visible behind it. Certified Estrada
 *  smashes through; everyone else jumps the counter (2 high — jumpable). */
function brickCache(b: LevelBuilderLike, x: number, row: number): MotifEnd {
  b.ground(x, x + 7, row);
  b.brick(x + 3, row - 1);
  b.brick(x + 3, row - 2);
  b.coinRow(x + 5, x + 7, row - 1); // the loot behind the counter
  return { endX: x + 8, endRow: row };
}

/** A goldbar on a brick shelf 7 rows up, with a house spring beside it. The
 *  lane runs beneath uninterrupted; the spring is the honest way up. */
function highShelf(b: LevelBuilderLike, x: number, row: number, bar: number): MotifEnd {
  b.ground(x, x + 5, row);
  b.platform(x + 2, x + 3, row - 6, 'brick');
  b.goldbar(bar, x + 2, row - 7);
  b.spring(x + 4, row - 1);
  return { endX: x + 6, endRow: row };
}

/** Standard act ending: pad runway, goal exactly 7 tiles before def.width,
 *  ground running to the right edge (the ceremony jog never finds a pit). */
function closeOut(b: LevelBuilderLike, c: MotifEnd): void {
  const pad = b.widthTiles - 14 - c.endX;
  if (pad < 2) {
    throw new Error(`closeOut: chain ran long — endX ${c.endX} leaves pad ${pad} (< 2)`);
  }
  c = runway(b, c.endX, c.endRow, { len: pad, rings: true });
  c = finishRunway(b, c.endX, c.endRow, { len: 10 }); // goal at width-7
  runway(b, c.endX, c.endRow, { len: 4 }); // prop ground to the edge
}

/** Castle ending: pad runway into a 26-tile arena whose far wall is 3 tiles
 *  short of width (goal lands at width-7), then ground to the edge. */
function closeArena(b: LevelBuilderLike, c: MotifEnd): void {
  const x = b.widthTiles - 34; // approach 6 + arena 26 + 2 edge tiles
  const pad = x - c.endX;
  if (pad < 2) {
    throw new Error(`closeArena: chain ran long — endX ${c.endX} leaves pad ${pad} (< 2)`);
  }
  c = runway(b, c.endX, c.endRow, { len: pad, rings: true });
  c = arenaApproach(b, c.endX, c.endRow, { width: 26 }); // goal at width-7
  b.ground(c.endX, b.widthTiles - 1, c.endRow); // prop ground to the edge
}

// ---------------------------------------------------------------------------
// The acts
// ---------------------------------------------------------------------------

export const world3: LevelDef[] = [
  // -------------------------------------------------------------------------
  // w3a1 — the marquee entrance: valet runway, first slot bank, chip goons,
  // and the world's first warp: the comped High-Roller Lounge, a 10-coin
  // counting room under the strip (teaches press-down-on-pipes early).
  // Easy: gaps 3-4, everything on one gentle lane at row 26.
  // Coins: 16 + 5 + 3 + 6 + 9 + 10 vault + 3 rings = 52 entities + 8 qblock.
  // -------------------------------------------------------------------------
  {
    id: 'w3a1',
    world: 3,
    act: 1,
    title: 'The Welcome Strip',
    excuse: 'No princess at check-in — but the desk comped me the Notary Suite, so I certified the minibar instead.',
    theme: 'casino',
    width: 196,
    build(b) {
      let c = runway(b, 0, 26, { len: 12, coinRow: 22, rings: true }); // 16 coins
      b.start(2, 25);
      c = brickGallery(b, c.endX, c.endRow, { len: 10, powerup: 'stamp' }); // 2 coin qb
      c = slotBank(b, c.endX, c.endRow, ['coin', 'coin', 'coin']); // 3 coin qb
      const g1 = c.endX; // pit-boss nephews on the strip (>= 30 tiles out)
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'chipstack'] });
      b.coinRow(g1 + 1, g1 + 9, c.endRow - 3); // 9 coins
      c = coinArc(b, c.endX, c.endRow, { gap: 3 }); // 5 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 });
      c = gapJump(b, c.endX, c.endRow, { gap: 3 });
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = warpVault(b, c.endX, c.endRow, { coins: 10 }); // the comped High-Roller Lounge
      c = pipeField(b, c.endX, c.endRow, { pipes: 2, lawyer: true }); // waitress plant, 91 tiles out
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 });
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['chipstack', 'lobbyist'] });
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // 6 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 });
      c = gapJump(b, c.endX, c.endRow, { gap: 4 });
      c = slotBank(b, c.endX, c.endRow, ['coin', 'coin', 'coin']); // 3 coin qb
      c = goldbarPerch(b, c.endX, c.endRow, { index: 3 });
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 4 });
      closeOut(b, c); // pad 8: 3 ring coins
    },
  },

  // -------------------------------------------------------------------------
  // w3a2 — the slot hall: qblock-heavy, five banks of mixed reels plus two
  // brick galleries. The world's first (rare) Immunity badge hides in a reel.
  // Coins: 16 + 9 + 6 + 3 + 3 rings = 37 entities + 16 qblock = 53.
  // -------------------------------------------------------------------------
  {
    id: 'w3a2',
    world: 3,
    act: 2,
    title: 'Slot Canyon',
    excuse: 'The rescue came up three lemons. House rules: a lemon rescue is void. I stamped the void myself.',
    theme: 'casino',
    width: 210,
    build(b) {
      let c = runway(b, 0, 26, { len: 12, coinRow: 22, rings: true }); // 16 coins
      b.start(2, 25);
      c = slotBank(b, c.endX, c.endRow, ['coin', 'coin', 'coin']); // 3 coin qb
      c = brickGallery(b, c.endX, c.endRow, { len: 12, powerup: 'stamp' }); // 3 coin qb
      const g1 = c.endX;
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'pollster'] });
      b.coinRow(g1 + 1, g1 + 9, c.endRow - 3); // 9 coins
      c = gapJump(b, c.endX, c.endRow, { gap: 3 });
      c = slotBank(b, c.endX, c.endRow, ['coin', 'coin', 'coin']); // 3 coin qb
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // 6 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 });
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = pipeField(b, c.endX, c.endRow, { pipes: 3, lawyer: true }); // subpoena service
      c = slotBank(b, c.endX, c.endRow, ['coin', 'goldpen', 'coin']); // 2 coin qb
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['chipstack', 'pollster', 'lobbyist'] });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 });
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = gapJump(b, c.endX, c.endRow, { gap: 4 });
      c = slotBank(b, c.endX, c.endRow, ['coin', 'immunity', 'coin']); // the RARE badge
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 });
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = crumbleBridge(b, c.endX, c.endRow, { len: 4 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 3 });
      c = slotBank(b, c.endX, c.endRow, ['coin', 'coin', 'coin']); // 3 coin qb
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 4 });
      closeOut(b, c); // pad 7: 3 ring coins
    },
  },

  // -------------------------------------------------------------------------
  // w3a3 — the high road: neon rooftops. Two spring-powered wall bounces lift
  // the lane to the very top of the band; paparazzi patrol the skyline.
  // Coins: 11 + 3 + 3 + 9 + 6 + 3 + 3 + 7 + 3 rings = 48 entities.
  // -------------------------------------------------------------------------
  {
    id: 'w3a3',
    world: 3,
    act: 3,
    title: 'High Roller Rooftops',
    excuse: 'I had her on the rooftop, but the paparazzi ruled my cape fake news. A hero cannot rescue under libel.',
    theme: 'casino',
    width: 200,
    build(b) {
      let c = runway(b, 0, 26, { len: 10, coinRow: 22, rings: true }); // 11 coins
      b.start(2, 25);
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 3, dir: 1 }); // up to 20
      c = runway(b, c.endX, c.endRow, { len: 6, rings: true }); // 3 coins
      c = springboardWall(b, c.endX, c.endRow, { wallH: 5 }); // bounce to 15
      c = runway(b, c.endX, c.endRow, { len: 8, rings: true }); // 3 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 });
      c = gapJump(b, c.endX, c.endRow, { gap: 4 });
      const g1 = c.endX; // skyline surveillance, 54+ tiles out
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['paparazzo', 'chipstack'] });
      b.coinRow(g1 + 1, g1 + 9, c.endRow - 5); // 9 coins, above the drone lane
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // 6 coins
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 2, dir: -1 }); // down to 19
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = springboardWall(b, c.endX, c.endRow, { wallH: 5 }); // bounce to 14 (lane top)
      c = runway(b, c.endX, c.endRow, { len: 6, rings: true }); // 3 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 });
      c = gapJump(b, c.endX, c.endRow, { gap: 5 });
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['paparazzo', 'lobbyist'] });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 });
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: -1 }); // down to 20
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = coinArc(b, c.endX, c.endRow, { gap: 5 }); // 7 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 3 });
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 4 });
      closeOut(b, c); // pad 8: 3 ring coins
    },
  },

  // -------------------------------------------------------------------------
  // w3a4 — OPTIONAL low road: the poker floor. Card-table oneways over
  // spike-carpeted CARD SHREDDER pits (rule 8: falling between tables must
  // carry risk), back-to-back chipstack gauntlets. Two goldbars sit in the
  // open (perches); three hide (two vault cells, one spring-only high shelf).
  // Coins: 11 + 9 + 3 + 9 + 6 + 6 rings = 44 entities + 1 qblock = 45.
  // -------------------------------------------------------------------------
  {
    id: 'w3a4',
    world: 3,
    act: 4,
    title: 'Card Table Flats',
    excuse: 'I held a pair of princesses; the dealer showed a royal flush. I folded the rescue, face down, for tax reasons.',
    theme: 'casino',
    width: 190,
    build(b) {
      let c = runway(b, 0, 26, { len: 10, coinRow: 22, rings: true }); // 11 coins
      b.start(2, 25);
      c = brickGallery(b, c.endX, c.endRow, { len: 8, powerup: 'stamp' }); // 1 coin qb
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['chipstack', 'chipstack'] });
      c = cardTables(b, c.endX, c.endRow); // 9 coins over the felt
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 }); // easy bar 1
      c = gapJump(b, c.endX, c.endRow, { gap: 4 });
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['chipstack', 'pollster', 'chipstack'] });
      c = vaultCell(b, c.endX, c.endRow, 1); // hidden bar 1
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // 6 coins
      c = cardTables(b, c.endX, c.endRow); // 9 coins over the felt
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = springboardWall(b, c.endX, c.endRow, { wallH: 4 }); // up to 22
      c = highShelf(b, c.endX, c.endRow, 2); // hidden bar 2 — spring only
      c = gapJump(b, c.endX, c.endRow, { gap: 5 });
      c = vaultCell(b, c.endX, c.endRow, 3); // hidden bar 3
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 4 }); // easy bar 2
      closeOut(b, c); // pad 13: 6 ring coins
    },
  },

  // -------------------------------------------------------------------------
  // w3a5 — the chip mountain: two steppes climbs to the summit ridge (lane
  // top), a crumbling ridge walk, a giant slot-lever gavel on the way down.
  // Coins: 11 + 9 + 3 + 9 + 3 + 6 + 6 = 47 entities + 2 qblock = 49.
  // -------------------------------------------------------------------------
  {
    id: 'w3a5',
    world: 3,
    act: 5,
    title: 'Chip Mountain',
    excuse: 'The ransom cage takes chips only and demanded two forms of ID. Mine are notarized. Hers were kidnapped with her.',
    theme: 'casino',
    width: 210,
    build(b) {
      let c = runway(b, 0, 26, { len: 10, coinRow: 22, rings: true }); // 11 coins
      b.start(2, 25);
      c = brickGallery(b, c.endX, c.endRow, { len: 10, powerup: 'stamp' }); // 2 coin qb
      const g1 = c.endX;
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'pollster'] });
      b.coinRow(g1 + 1, g1 + 9, c.endRow - 3); // 9 coins
      c = steppes(b, c.endX, c.endRow, { count: 4, stepH: 2, treadW: 2, dir: 1 }); // up to 18
      c = runway(b, c.endX, c.endRow, { len: 5 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 });
      c = gapJump(b, c.endX, c.endRow, { gap: 4 });
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 3, dir: 1 }); // summit: 14
      c = runway(b, c.endX, c.endRow, { len: 8, rings: true }); // 3 coins
      const g2 = c.endX; // summit security, 73+ tiles out
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['chipstack', 'paparazzo'] });
      b.coinRow(g2 + 1, g2 + 9, c.endRow - 5); // 9 coins, above the drone
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 });
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = crumbleBridge(b, c.endX, c.endRow, { len: 5 }); // the ridge gives way
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: -1 }); // down to 20
      c = gavelRun(b, c.endX, c.endRow); // 6 coins under the house lever
      c = spikeTrays(b, c.endX, c.endRow); // 6 coins — the chip sorter: two
      // spike trays, one narrow island (was a free coinArc glide; 2026-08
      // difficulty wave). 34 tiles past the checkpoint, in plain view.
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 });
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: -1 }); // down to 26
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = pipeField(b, c.endX, c.endRow, { pipes: 2, lawyer: true });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 3 });
      c = gapJump(b, c.endX, c.endRow, { gap: 5 });
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 4 });
      closeOut(b, c); // pad 5: no ring room
    },
  },

  // -------------------------------------------------------------------------
  // w3a6 — OPTIONAL spur: the vault. Brick everywhere, two goldbars locked in
  // brick-lidded cells and a third in the DEEP VAULT — a warp-served counting
  // room under the lane, 16 coins deep (the act is named The Vault; now there
  // is one). A teller counter to smash (Certified) or hop, and the world's
  // second (last) Immunity badge. Coins run rich.
  // Coins: 11 + 3 + 13 + 6 + 3 + 16 vault + 3 rings = 55 + 9 qblock = 64.
  // -------------------------------------------------------------------------
  {
    id: 'w3a6',
    world: 3,
    act: 6,
    title: 'The Vault',
    excuse: 'Opening the vault mid-rescue would trigger an audit. A very stable genius waits for the fiscal year to close.',
    theme: 'casino',
    width: 212,
    build(b) {
      let c = runway(b, 0, 26, { len: 10, coinRow: 22, rings: true }); // 11 coins
      b.start(2, 25);
      c = brickGallery(b, c.endX, c.endRow, { len: 12, powerup: 'stamp' }); // 3 coin qb
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['pollster', 'lobbyist'] });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 }); // easy bar 1
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = brickGallery(b, c.endX, c.endRow, { len: 8, powerup: 'goldpen' }); // 1 coin qb
      c = gapJump(b, c.endX, c.endRow, { gap: 3 });
      c = vaultCell(b, c.endX, c.endRow, 1); // vault bar 1
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = pipeField(b, c.endX, c.endRow, { pipes: 3, lawyer: true });
      c = slotBank(b, c.endX, c.endRow, ['coin', 'immunity', 'coin']); // the last badge
      const g1 = c.endX; // the card-counting rat works deep in the vault
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'chipstack', 'lobbyist'] });
      b.coinRow(g1 + 1, g1 + 13, c.endRow - 3); // 13 coins
      c = vaultCell(b, c.endX, c.endRow, 2); // vault bar 2
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // 6 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = brickCache(b, c.endX, c.endRow); // 3 coins behind the teller wall
      c = warpVault(b, c.endX, c.endRow, { coins: 16, goldbar: 3 }); // THE deep vault
      // Flat, forgiving terrain must follow the vault pipes: a sprint-carried
      // bot wall-jumps a 2-tall pipe into a ~21-tile flight, and it has to
      // land on something standable (perch lane + gallery ground/brick tops).
      c = goldbarPerch(b, c.endX, c.endRow, { index: 4 }); // easy bar 2
      c = brickGallery(b, c.endX, c.endRow, { len: 10 }); // 3 coin qb, all coins
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      // Long approach: the bot arrives slow out of the pocket and needs the
      // full runup to carry a 5-gap.
      c = gapJump(b, c.endX, c.endRow, { gap: 5, approach: 6 });
      closeOut(b, c); // pad 9: 3 ring coins
    },
  },

  // -------------------------------------------------------------------------
  // w3a7 — the neon midway: everything the peninsula sells at once. Bounce
  // chains, drone escorts, a oneway marquee climb, the longest act in the
  // world — plus an honest warp shortcut past the entourage gauntlet for
  // players who press down on pipes. Gaps run at 5; the pre-castle exam.
  // Coins: 11 + 9 + 3 + 6 + 9 + 3 + 2 + 13 + 7 = 63 entities + 2 qblock = 65.
  // -------------------------------------------------------------------------
  {
    id: 'w3a7',
    world: 3,
    act: 7,
    title: 'Neon Midway',
    excuse: 'The midway sign spelled COVFEFE in neon. That is legally a closing time. I do not rescue after hours.',
    theme: 'casino',
    width: 230,
    build(b) {
      let c = runway(b, 0, 26, { len: 10, coinRow: 22, rings: true }); // 11 coins
      b.start(2, 25);
      c = brickGallery(b, c.endX, c.endRow, { len: 10, powerup: 'stamp' }); // 2 coin qb
      const g1 = c.endX;
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['chipstack', 'lobbyist'] });
      b.coinRow(g1 + 1, g1 + 9, c.endRow - 3); // 9 coins
      c = springboardWall(b, c.endX, c.endRow, { wallH: 4 }); // up to 22
      c = runway(b, c.endX, c.endRow, { len: 6, rings: true }); // 3 coins
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // 6 coins
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 });
      c = gapJump(b, c.endX, c.endRow, { gap: 5 });
      const g2 = c.endX; // midway security detail
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['paparazzo', 'pollster'] });
      b.coinRow(g2 + 1, g2 + 9, c.endRow - 5); // 9 coins above the drone
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = springboardWall(b, c.endX, c.endRow, { wallH: 5 }); // up to 17
      c = spikeGuardedBar(b, c.endX, c.endRow, 1); // +2 coins — goldbar 1 now
      // floats over a 2-deep spike trench (2026-08 difficulty wave: risk the
      // loot, not the lane): arc clean off the spring wall and it pays;
      // undershoot and the teeth take their cut.
      // HONEST SHORTCUT (warp): press down here to skip the collapsing carpet
      // and the full entourage, surfacing on the gauntlet's far shoulder.
      // Walkers keep the 13-coin row; explorers keep their skin.
      c = runway(b, c.endX, c.endRow, { len: 4 });
      const skipX = c.endX - 3; // entry pipe on that runway's middle columns
      c = crumbleBridge(b, c.endX, c.endRow, { len: 6 });
      const g3 = c.endX; // the full entourage, 116+ tiles out
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['paparazzo', 'chipstack', 'lobbyist'] });
      b.coinRow(g3 + 1, g3 + 13, c.endRow - 5); // 13 coins
      b.warpPipe(skipX, c.endRow - 2, 2, g3 + 13, c.endRow - 2, 2); // the skip
      c = coinArc(b, c.endX, c.endRow, { gap: 5 }); // 7 coins
      const climbX = c.endX;
      c = onewayClimb(b, c.endX, c.endRow, { rise: 2 }); // marquee ledges, up to 15
      b.ground(climbX + 1, climbX + 5, c.endRow + 5); // safety floor under the marquee
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 });
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: -1 }); // down to 21
      c = pipeField(b, c.endX, c.endRow, { pipes: 3, lawyer: true });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 3 });
      c = gapJump(b, c.endX, c.endRow, { gap: 5, approach: 2, landing: 2 });
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 4 });
      closeOut(b, c); // pad 3: no ring room (the shortcut runway took it)
    },
  },

  // -------------------------------------------------------------------------
  // w3a8 — CASTLE: Jackpot Palace. Two house levers, a subpoena pipe field,
  // a drone escort, then the staged Bowsonaro show in a 26-tile arena.
  // Coins: 11 + 9 + 6 + 3 + 9 + 6 + 6 + 6 rings = 56 + 5 qblock = 61.
  // -------------------------------------------------------------------------
  {
    id: 'w3a8',
    world: 3,
    act: 8,
    title: 'Jackpot Palace',
    excuse: 'Bowsonaro took the princess and the jackpot, so I made a perfect phone call about it. Perfect. Ask anyone.',
    theme: 'casino',
    width: 200,
    boss: true,
    cutsceneAfter: 'w3-end',
    build(b) {
      let c = runway(b, 0, 26, { len: 10, coinRow: 22, rings: true }); // 11 coins
      b.start(2, 25);
      c = brickGallery(b, c.endX, c.endRow, { len: 10, powerup: 'stamp' }); // 2 coin qb
      const g1 = c.endX;
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['chipstack', 'pollster'] });
      b.coinRow(g1 + 1, g1 + 9, c.endRow - 3); // 9 coins
      c = gavelRun(b, c.endX, c.endRow); // 6 coins, lever 1 (33 tiles out)
      c = gapJump(b, c.endX, c.endRow, { gap: 4 });
      b.enemy('gavel', c.endX - 2, c.endRow - 4); // lever 1.5 (2026-08
      // difficulty wave): a second house lever stamps the gap LANDING (col
      // 47) — time the jump and the slam together. A hurt, not a kill for
      // Certified; 47 tiles from the start (> 27, idle-silent) and the
      // checkpoint at 69 sits after it.
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 });
      c = slotBank(b, c.endX, c.endRow, ['coin', 'coin', 'coin']); // 3 coin qb
      c = secretPocket(b, c.endX, c.endRow, { index: 0 });
      c = checkpointRest(b, c.endX, c.endRow); // 3 coins
      c = pipeField(b, c.endX, c.endRow, { pipes: 2, lawyer: true });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 });
      const g2 = c.endX; // palace air cover
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['paparazzo', 'chipstack'] });
      b.coinRow(g2 + 1, g2 + 9, c.endRow - 5); // 9 coins above the drone
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // 6 coins
      c = secretPocket(b, c.endX, c.endRow, { index: 1 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 });
      c = gavelRun(b, c.endX, c.endRow); // 6 coins, lever 2
      c = goldbarPerch(b, c.endX, c.endRow, { index: 3 });
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 4 });
      c = crumbleBridge(b, c.endX, c.endRow, { len: 4 }); // the red carpet collapses
      closeArena(b, c); // pad 11 rings, arena, ground to the edge
    },
  },
];
