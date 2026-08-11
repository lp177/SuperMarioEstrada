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
//     where an 8-tile bot jump (or a spring, for humans) clears them.
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

/** Card-table flats: three felt-top oneway tables over a shallow service pit.
 *  Fall between tables and you land on the pit floor and walk out under them
 *  (generous, never lethal); the coins hover over the felt. */
function cardTables(b: LevelBuilderLike, x: number, row: number): MotifEnd {
  b.ground(x, x + 1, row);
  b.ground(x + 2, x + 13, row + 3); // service-pit floor
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
  // w3a1 — the marquee entrance: valet runway, first slot bank, chip goons.
  // Easy: gaps 3-4, everything on one gentle lane at row 26.
  // Coins: 16 + 5 + 3 + 6 + 9 + 3 rings = 42 entities + 8 qblock = 50.
  // -------------------------------------------------------------------------
  {
    id: 'w3a1',
    world: 3,
    act: 1,
    title: 'The Welcome Strip',
    excuse: 'No princess at check-in — but the desk comped me the Notary Suite, so I certified the minibar instead.',
    theme: 'casino',
    width: 180,
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
      c = pipeField(b, c.endX, c.endRow, { pipes: 2, lawyer: true }); // waitress plant, 75 tiles out
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
  // service pits, back-to-back chipstack gauntlets. Two goldbars sit in the
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
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // 6 coins
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
  // w3a6 — OPTIONAL spur: the vault. Brick everywhere, three goldbars locked
  // in brick-lidded cells, a teller counter to smash (Certified) or hop, and
  // the world's second (last) Immunity badge. Coins run rich.
  // Coins: 11 + 9 + 3 + 6 + 3 + 6 + 13 rings/rows = 51 with 9 qblock coins.
  // -------------------------------------------------------------------------
  {
    id: 'w3a6',
    world: 3,
    act: 6,
    title: 'The Vault',
    excuse: 'Opening the vault mid-rescue would trigger an audit. A very stable genius waits for the fiscal year to close.',
    theme: 'casino',
    width: 200,
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
      c = vaultCell(b, c.endX, c.endRow, 3); // vault bar 3
      c = secretPocket(b, c.endX, c.endRow, { index: 2 });
      // Long approach: the bot arrives slow out of the slot cluster and needs
      // the full runup to carry a 5-gap.
      c = gapJump(b, c.endX, c.endRow, { gap: 5, approach: 6 });
      c = goldbarPerch(b, c.endX, c.endRow, { index: 4 }); // easy bar 2
      c = brickGallery(b, c.endX, c.endRow, { len: 10 }); // 3 coin qb, all coins
      closeOut(b, c); // pad 11: 6 ring coins
    },
  },

  // -------------------------------------------------------------------------
  // w3a7 — the neon midway: everything the peninsula sells at once. Bounce
  // chains, drone escorts, a oneway marquee climb, the longest act in the
  // world. Gaps run at 5; this is the pre-castle exam.
  // Coins: 11 + 9 + 3 + 6 + 9 + 3 + 13 + 7 + 3 rings = 64 + 2 qblock = 66.
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
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 });
      c = crumbleBridge(b, c.endX, c.endRow, { len: 6 });
      const g3 = c.endX; // the full entourage, 116+ tiles out
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['paparazzo', 'chipstack', 'lobbyist'] });
      b.coinRow(g3 + 1, g3 + 13, c.endRow - 5); // 13 coins
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
      closeOut(b, c); // pad 7: 3 ring coins
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
