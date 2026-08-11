// ============================================================================
// WORLD 2 — THE MONEY PIPES (theme 'sewer'). Produced, in fiction, by
// PRINCESS IMPEACH: this is his coin-laundering back office, dressed up as a
// heroic sewer level and failing at it. Decor agents: think laundered-money
// props — coin rolls in dryer drums, "WASH / RINSE / CERTIFY" signage, rat
// union posters (w2a3), skeleton props with price tags (w2a4), dripping prop
// pipes patched with duct tape (w2a5), and — played STRAIGHT, no gags — the
// real Peach's dungeon door cameo in w2a6 (see the corridor note there).
//
// Authoring rules honored here (see AGENTS.md + tests/actContract.ts):
// - Acts are motif chains on {endX, endRow}; local helpers below extend the
//   vocabulary (spike pits, stepped chute drops, oneway sky ladders, goldbar
//   vaults, alcove pockets, crumble-over-spikes) and validate LOUDLY like
//   motifs do.
// - The mandatory route is flow-bot-clearable: gaps <= 5, climbs <= 3 rows
//   (walls up to ~6 are fine — the bot full-holds), drops land on wide strips.
// - 2026-08 playtest retune: descents step in <= 2-row treads (rule 8 — a
//   sheer safe face is a nap), every void gap gets >= 8 flat sprint tiles
//   before its lip (rule 5 at runMax 3.8), and no brick lid ever overhangs
//   a pocket's exit arc (rule 9 / the playtest trap).
// - WARP FEATURES (one per flavor, rule 7-clean, laid at the END of build so
//   later tile work can never overwrite a mouth): w2a1 skim vault (bonus
//   coin room under the checkpoint stretch), w2a5 service bypass (honest
//   shortcut past the crumble/gavel gauntlet), w2a7 money vault (goldbar 4
//   + hoard under the final stretch). Vault rooms sit below the lane and are
//   fed/drained by warp pairs; the flood-fill gate follows the links.
// - Idle silence: everything that can walk/fly/hop TOWARD an idle player is
//   placed beyond its 600-frame reach (rats ~41 tiles, paparazzi ~30,
//   chipstacks ~14, walkers ~19). Gavels & lawyers sit > 27 tiles out.
// - Deterministic: pure functions of the builder, no module state, no RNG.
// ============================================================================

import type { LevelBuilderLike, LevelDef } from '../core/types.ts';
import {
  arenaApproach,
  brickGallery,
  checkpointRest,
  coinArc,
  crumbleBridge,
  enemyGauntlet,
  gapJump,
  goldbarPerch,
  pipeField,
  runway,
  secretPocket,
  springboardWall,
  steppes,
  type MotifEnd,
} from '../game/motifs.ts';

// ---------------------------------------------------------------------------
// Local helpers — same shape and same loud-validation manners as motifs.
// ---------------------------------------------------------------------------

function requireInt(v: number, lo: number, hi: number, what: string): number {
  if (!Number.isInteger(v) || v < lo || v > hi) {
    throw new Error(`${what} must be an integer ${lo}..${hi}, got ${v}`);
  }
  return v;
}

/** spikePit — W2's signature "moderate pit": instead of a void, the pit has a
 *  solid floor `depth` rows down carpeted with spikes. Falling in hurts but is
 *  survivable; the right pit wall (<= depth rows) is an easy jump back out.
 *  The bot sees no support past the lip (spike != standable) and jumps. */
function spikePit(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts: { gap: number; depth?: number },
): MotifEnd {
  const gap = requireInt(opts.gap, 3, 5, 'spikePit gap');
  const depth = requireInt(opts.depth ?? 3, 2, 4, 'spikePit depth');
  if (row + depth > b.heightTiles - 2) {
    throw new Error(`spikePit: floor row ${row + depth} too deep for map height ${b.heightTiles}`);
  }
  b.ground(x, x + 2, row); // approach shoulder
  b.ground(x + 3, x + 2 + gap, row + depth); // pit floor
  b.spikes(x + 3, x + 2 + gap, row + depth - 1); // the carpet
  b.ground(x + 3 + gap, x + 5 + gap, row); // landing shoulder
  return { endX: x + 6 + gap, endRow: row };
}

/** chuteDrop — a coin chute: the lane descends `drop` rows onto a WIDE
 *  landing strip (>= 12 tiles), in 2-row TREADS. Rule 8 (2026-08 playtest):
 *  the old sheer 4-row face over a safe floor was a "nap, not an obstacle" —
 *  stepped <= 2-row hops never form a recess, and this is the gentle world
 *  opener's descent, not a hazard. Coins trace the fall line as before. */
function chuteDrop(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts: { drop: number; land?: number },
): MotifEnd {
  const drop = requireInt(opts.drop, 4, 6, 'chuteDrop drop');
  if (drop % 2 !== 0) {
    throw new Error(`chuteDrop drop must be even (2-row treads), got ${drop}`);
  }
  const land = requireInt(opts.land ?? 16, 12, 30, 'chuteDrop land');
  const floor = row + drop;
  if (floor > b.heightTiles - 6) {
    throw new Error(`chuteDrop: landing row ${floor} leaves the running lane`);
  }
  b.ground(x, x + 2, row); // the lip
  const treads = drop / 2 - 1;
  for (let i = 0; i < treads; i++) {
    b.ground(x + 3 + 2 * i, x + 4 + 2 * i, row + 2 * (i + 1)); // 2-wide tread
    b.coin(x + 4 + 2 * i, row + 2 * i + 1); // coin over the tread
  }
  const lx = x + 3 + 2 * treads;
  b.ground(lx, x + 2 + land, floor); // landing strip
  b.coin(lx + 1, floor - 1); // the chute spills onto the landing
  b.coin(lx + 2, floor - 1);
  return { endX: x + 3 + land, endRow: floor };
}

/** skyLadder — two oneway grates laddering up beside the lane to a goldbar
 *  perched high (row-7). Purely optional: the lane runs beneath untouched,
 *  and the bot never interacts with oneways above its head. 3-row hops. */
function skyLadder(b: LevelBuilderLike, x: number, row: number, opts: { index: number }): MotifEnd {
  if (row - 7 < 2) throw new Error(`skyLadder: goldbar row ${row - 7} needs headroom (row >= 9)`);
  b.ground(x, x + 7, row); // lane continues beneath
  b.oneway(x + 1, x + 3, row - 3);
  b.oneway(x + 3, x + 5, row - 6);
  b.goldbar(opts.index, x + 4, row - 7); // grab standing on the top grate
  return { endX: x + 8, endRow: row };
}

/** goldbarVault — secretPocket geometry (proven bot-safe: the lid catches the
 *  running bot) but holding a goldbar: a brick lid, a 1-column entry slot,
 *  the bar hidden in the hollow below the lane. */
function goldbarVault(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts: { index: number },
): MotifEnd {
  if (row + 3 >= b.heightTiles) {
    throw new Error(`goldbarVault: vault floor ${row + 3} falls off the map`);
  }
  b.ground(x, x, row);
  b.ground(x + 1, x + 1, row + 2); // entry slot floor (drop 2, hop 2 back out)
  b.ground(x + 2, x + 3, row + 3); // vault floor
  b.platform(x + 2, x + 3, row, 'brick'); // the lid
  b.goldbar(opts.index, x + 3, row + 2);
  b.ground(x + 4, x + 4, row);
  return { endX: x + 5, endRow: row };
}

/** alcovePocket — the REWORKED secret pocket (2026-08 playtest: the classic
 *  secretPocket's brick lid overhangs the exit arc — the exact trap shape the
 *  playtest hit). Here the lid shifts LEFT over a side alcove and the exit
 *  well is open sky:
 *    x       : shoulder ground at R
 *    x+1/x+2 : ALCOVE — brick lid at R-1, hollow R..R+1 (32px: Certified
 *              Estrada fits standing), the secret tucked at R+1 under bricks
 *    x+3     : EXIT WELL — same floor (R+2, a 2-row hop out), nothing above
 *    x+4     : shoulder ground at R
 *  The 1-high lid is a plain wall-hop for the lane (reads like a 1-high
 *  pipe); the flow bot full-jumps it and overflies the whole feature. The
 *  well is 2 deep against its right shoulder, so it never scans as a recess
 *  and can never violate rules 8/9. */
function alcovePocket(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts: { index: number },
): MotifEnd {
  if (row + 2 >= b.heightTiles) {
    throw new Error(`alcovePocket: floor ${row + 2} falls off the map`);
  }
  b.ground(x, x, row); // left shoulder
  b.ground(x + 1, x + 3, row + 2); // flat alcove + well floor (2 deep)
  b.platform(x + 1, x + 2, row - 1, 'brick'); // lid over the ALCOVE only
  b.ground(x + 4, x + 4, row); // right shoulder
  b.secret(opts.index, x + 1, row + 1); // under the bricks
  return { endX: x + 5, endRow: row };
}

/** crumbleSpikes — a crumble deck over a spike bed (W2a4's gimmick). Cross at
 *  speed and nothing happens; dawdle and the deck drops you two rows onto
 *  spikes (survivable; the right shoulder wall is 4 rows — jump out). The bot
 *  crosses long before the 30-frame fuses blow. */
function crumbleSpikes(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts: { len: number; coins?: boolean },
): MotifEnd {
  const len = requireInt(opts.len, 3, 8, 'crumbleSpikes len');
  b.ground(x, x + 1, row); // left shoulder
  b.ground(x + 2, x + 1 + len, row + 4); // pit floor under the deck
  b.spikes(x + 2, x + 1 + len, row + 3); // spike bed
  b.crumble(x + 2, x + 1 + len, row); // the deck itself
  b.ground(x + 2 + len, x + 3 + len, row); // right shoulder
  if (opts.coins) b.coinRow(x + 2, x + 1 + len, row - 2); // len coins, tempting a slow cross
  return { endX: x + 4 + len, endRow: row };
}

/** finishTo — the act's closing stretch: flat ground running to the map edge,
 *  goal door 8 tiles before `width`. Throws if the chain over/under-ran. */
function finishTo(b: LevelBuilderLike, x: number, row: number, width: number): void {
  const span = width - x;
  if (span < 10 || span > 34) {
    throw new Error(`finishTo: ${span} tiles left before width ${width} (x=${x}) — motif chain over/under-ran`);
  }
  b.ground(x, width - 1, row);
  b.goal(width - 8, row - 1);
}

// ---------------------------------------------------------------------------
// The acts. Chain comments track the running cursor: "-> x" is endX.
// ---------------------------------------------------------------------------

export const world2: LevelDef[] = [
  // -------------------------------------------------------------------------
  // w2a1 — the descent into the laundering office: two big stepped coin
  // chutes (16 -> 20 -> 24, then steppes to 28), oneway grate ladders rising
  // to skimmed goldbars. Gentle: gaps of 3, walker enemies only. NEW: the
  // SKIM VAULT — a warp pipe on the long runway dives into a coin room
  // carved under the checkpoint stretch (the skimmed take, still in the
  // dryer), and a second pipe pops back up on the gap-jump landing ahead.
  // -------------------------------------------------------------------------
  {
    id: 'w2a1',
    world: 2,
    act: 1,
    title: 'Coin Chute Drop',
    excuse: 'The intel came from a perfect phone call. The most perfect. I certified it myself.',
    theme: 'sewer',
    width: 188,
    build(b) {
      let c = runway(b, 0, 16, { len: 12, coinRow: 12, rings: true }); // -> 12 (16 coins)
      b.start(2, 15);
      c = chuteDrop(b, c.endX, c.endRow, { drop: 4, land: 16 }); // -> 31, row 20 (+3, 2-row treads)
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'lobbyist'] }); // -> 42
      c = brickGallery(b, c.endX, c.endRow, { len: 10, powerup: 'stamp' }); // -> 52 (+2)
      c = skyLadder(b, c.endX, c.endRow, { index: 0 }); // -> 60
      c = chuteDrop(b, c.endX, c.endRow, { drop: 4, land: 16 }); // -> 79, row 24 (+3, 2-row treads)
      c = runway(b, c.endX, c.endRow, { len: 15, coinRow: 21 }); // -> 94 (+13)
      c = checkpointRest(b, c.endX, c.endRow); // -> 100 (+3, checkpoint @ 96)
      c = secretPocket(b, c.endX, c.endRow, { index: 0 }); // -> 105
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 }); // -> 111
      c = gapJump(b, c.endX, c.endRow, { gap: 3 }); // -> 120
      c = coinArc(b, c.endX, c.endRow, { gap: 3 }); // -> 129 (+5)
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['pollster', 'rat'] }); // -> 140 (rat @ 136)
      c = secretPocket(b, c.endX, c.endRow, { index: 1 }); // -> 145
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 3, dir: -1 }); // -> 151, row 28
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 }); // -> 157
      c = secretPocket(b, c.endX, c.endRow, { index: 2 }); // -> 162
      c = skyLadder(b, c.endX, c.endRow, { index: 3 }); // -> 170
      c = goldbarPerch(b, c.endX, c.endRow, { index: 4 }); // -> 176
      finishTo(b, c.endX, c.endRow, 188); // coins total: 45 + 14 vault
      // THE SKIM VAULT (bonus): stand on the drain pipe at cols 84-85 on the
      // long runway, press down, loot the hoard carved under the checkpoint
      // stretch, ride the far pipe back up to a flush grate on the gap-jump
      // landing (cols 118-119). Laid after the chain so no later tile work
      // can overwrite a mouth (rule 7).
      b.room(98, 110, 28, 31); // vault: floor row 32, ceiling row 27
      b.warpPipe(84, 22, 2, 98, 30, 2); // runway drain -> vault floor
      b.warpPipe(108, 30, 2, 118, 24, 2); // vault -> flush grate ahead
      b.coinRow(101, 107, 30); // the hoard: 14 coins
      b.coinRow(101, 107, 31);
    },
  },

  // -------------------------------------------------------------------------
  // w2a2 — the wash lanes proper: long coin-laden conveyors ("delicates"),
  // the world's first lawyer plant, first spike pits, and the goldpen debuts
  // in a brick gallery. Decor cue: dryer drums full of coin rolls.
  // Retuned 2026-08: the first void gap gets a real sprint runway (the old
  // 5-tile approach launched jumps under speed — 19+ deaths in playtest),
  // and secret 0's lidded tunnel became an alcovePocket (no lid over the
  // exit arc).
  // -------------------------------------------------------------------------
  {
    id: 'w2a2',
    world: 2,
    act: 2,
    title: 'Laundering Lanes',
    excuse: 'You cannot rush a rescue mid-cycle, Mangiani. Everything down here is delicates.',
    theme: 'sewer',
    width: 190,
    build(b) {
      let c = runway(b, 0, 26, { len: 12, coinRow: 22, rings: true }); // -> 12 (16 coins)
      b.start(2, 25);
      c = brickGallery(b, c.endX, c.endRow, { len: 10, powerup: 'stamp' }); // -> 22 (+2)
      c = gapJump(b, c.endX, c.endRow, { gap: 3 }); // -> 31
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'pollster'] }); // -> 42
      c = pipeField(b, c.endX, c.endRow, { pipes: 2, lawyer: true }); // -> 53 (lawyer @ 44)
      c = runway(b, c.endX, c.endRow, { len: 3 }); // -> 56 (sprint runway: 8 flat tiles before the lip)
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // -> 66 (+6, void gap 59-62)
      c = alcovePocket(b, c.endX, c.endRow, { index: 0 }); // -> 71 (lid over the alcove, exit well open)
      c = skyLadder(b, c.endX, c.endRow, { index: 0 }); // -> 79
      c = checkpointRest(b, c.endX, c.endRow); // -> 85 (+3, checkpoint @ 81)
      c = spikePit(b, c.endX, c.endRow, { gap: 3 }); // -> 94
      c = runway(b, c.endX, c.endRow, { len: 10, coinRow: 22, rings: true }); // -> 104 (+11)
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 }); // -> 110
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'chipstack'] }); // -> 121 (rat @ 113)
      c = secretPocket(b, c.endX, c.endRow, { index: 1 }); // -> 126
      c = brickGallery(b, c.endX, c.endRow, { len: 8, powerup: 'goldpen' }); // -> 134 (+1)
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // -> 144 (+6)
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 }); // -> 150
      c = spikePit(b, c.endX, c.endRow, { gap: 4 }); // -> 160
      c = secretPocket(b, c.endX, c.endRow, { index: 2 }); // -> 165
      c = goldbarPerch(b, c.endX, c.endRow, { index: 3 }); // -> 171
      c = skyLadder(b, c.endX, c.endRow, { index: 4 }); // -> 179
      finishTo(b, c.endX, c.endRow, 190); // coins total: 45
    },
  },

  // -------------------------------------------------------------------------
  // w2a3 — the accountant rats' local. Rats EVERYWHERE (all beyond their
  // 41-tile idle reach), the world's first gavels banging like meeting
  // hammers. Decor cue: union posters ("LOCAL 512 — SCURRIERS & SKIMMERS"),
  // a strike-vote ballot box, tiny picket signs.
  // -------------------------------------------------------------------------
  {
    id: 'w2a3',
    world: 2,
    act: 3,
    title: 'Rat Union Hall',
    excuse: 'The rats went on strike and I refuse to cross a picket line I personally notarized.',
    theme: 'sewer',
    width: 196,
    build(b) {
      let c = runway(b, 0, 24, { len: 10, coinRow: 20, rings: true }); // -> 10 (11 coins)
      b.start(2, 23);
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 3, dir: -1 }); // -> 16, row 28
      c = brickGallery(b, c.endX, c.endRow, { len: 10, powerup: 'stamp' }); // -> 26 (+2)
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'pollster'] }); // -> 37
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // -> 47 (+6)
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'rat'] }); // -> 58 (rats @ 50, 54)
      c = secretPocket(b, c.endX, c.endRow, { index: 0 }); // -> 63
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'gavel'] }); // -> 74 (gavel @ 70)
      c = checkpointRest(b, c.endX, c.endRow); // -> 80 (+3, checkpoint @ 76)
      c = runway(b, c.endX, c.endRow, { len: 14, coinRow: 24, rings: true }); // -> 94 (+18)
      c = skyLadder(b, c.endX, c.endRow, { index: 0 }); // -> 102
      c = spikePit(b, c.endX, c.endRow, { gap: 4 }); // -> 112
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'pollster', 'rat'] }); // -> 127
      c = secretPocket(b, c.endX, c.endRow, { index: 1 }); // -> 132
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 }); // -> 138
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 2, dir: 1 }); // -> 142, row 24
      c = brickGallery(b, c.endX, c.endRow, { len: 8 }); // -> 150 (+2)
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'gavel'] }); // -> 161
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 }); // -> 167
      c = secretPocket(b, c.endX, c.endRow, { index: 2 }); // -> 172
      c = skyLadder(b, c.endX, c.endRow, { index: 3 }); // -> 180
      c = goldbarPerch(b, c.endX, c.endRow, { index: 4 }); // -> 186
      finishTo(b, c.endX, c.endRow, 196); // coins total: 42
    },
  },

  // -------------------------------------------------------------------------
  // w2a4 — OPTIONAL spur, harder but richer: crumble decks over spike beds
  // everywhere; 2 goldbars in plain sight (perches), 3 hidden (two brick-lid
  // vaults below the lane, one high sky ladder). Decor cue: prop skeletons of
  // "previous rescuers" with price stickers still on.
  // -------------------------------------------------------------------------
  {
    id: 'w2a4',
    world: 2,
    act: 4,
    title: 'Skeleton Vault',
    excuse: 'Those skeletons were unlicensed rescuers. No stamps, no permits. Paperwork catches everyone eventually.',
    theme: 'sewer',
    width: 190,
    build(b) {
      let c = runway(b, 0, 26, { len: 10, coinRow: 23 }); // -> 10 (8 coins)
      b.start(2, 25);
      c = crumbleSpikes(b, c.endX, c.endRow, { len: 4 }); // -> 18 (the gimmick, taught safe)
      c = brickGallery(b, c.endX, c.endRow, { len: 8, powerup: 'stamp' }); // -> 26 (+1)
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 }); // -> 32 (easy bar 1)
      c = crumbleSpikes(b, c.endX, c.endRow, { len: 6, coins: true }); // -> 42 (+6)
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['pollster', 'lobbyist'] }); // -> 53
      c = goldbarVault(b, c.endX, c.endRow, { index: 1 }); // -> 58 (hidden bar 1)
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // -> 68 (+6)
      c = spikePit(b, c.endX, c.endRow, { gap: 4 }); // -> 78
      c = checkpointRest(b, c.endX, c.endRow); // -> 84 (+3, checkpoint @ 80)
      c = crumbleSpikes(b, c.endX, c.endRow, { len: 8, coins: true }); // -> 96 (+8)
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'gavel'] }); // -> 107
      c = runway(b, c.endX, c.endRow, { len: 12, coinRow: 22, rings: true }); // -> 119 (+16)
      c = skyLadder(b, c.endX, c.endRow, { index: 2 }); // -> 127 (hidden bar 2, high)
      c = secretPocket(b, c.endX, c.endRow, { index: 0 }); // -> 132
      c = crumbleSpikes(b, c.endX, c.endRow, { len: 6 }); // -> 142
      c = secretPocket(b, c.endX, c.endRow, { index: 1 }); // -> 147
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'chipstack', 'rat'] }); // -> 162
      c = goldbarVault(b, c.endX, c.endRow, { index: 3 }); // -> 167 (hidden bar 3)
      c = goldbarPerch(b, c.endX, c.endRow, { index: 4 }); // -> 173 (easy bar 2)
      c = secretPocket(b, c.endX, c.endRow, { index: 2 }); // -> 178
      finishTo(b, c.endX, c.endRow, 190); // coins total: 48
    },
  },

  // -------------------------------------------------------------------------
  // w2a5 — the leaky stretch: crumble bridges over true voids, prop pipes
  // everywhere (decor cue: drips, duct tape, buckets), a springboard up to a
  // dry mezzanine and back down. Lawyers only far from the start.
  // -------------------------------------------------------------------------
  {
    id: 'w2a5',
    world: 2,
    act: 5,
    title: 'Leak Alley',
    excuse: 'We were delayed by a leak. Not the pipes — the PRESS. Fake news floods faster than water.',
    theme: 'sewer',
    width: 200,
    build(b) {
      let c = runway(b, 0, 25, { len: 11, coinRow: 21, rings: true }); // -> 11 (15 coins)
      b.start(2, 24);
      c = crumbleBridge(b, c.endX, c.endRow, { len: 4 }); // -> 19 (over the void)
      c = pipeField(b, c.endX, c.endRow, { pipes: 3 }); // -> 35 (no lawyer this close)
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'pollster'] }); // -> 46
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // -> 56 (+6)
      c = secretPocket(b, c.endX, c.endRow, { index: 0 }); // -> 61
      c = springboardWall(b, c.endX, c.endRow, { wallH: 5 }); // -> 68, row 20 (the mezzanine)
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 }); // -> 74
      c = checkpointRest(b, c.endX, c.endRow); // -> 80 (+3, checkpoint @ 76)
      c = crumbleSpikes(b, c.endX, c.endRow, { len: 6, coins: true }); // -> 90 (+6)
      c = brickGallery(b, c.endX, c.endRow, { len: 10, powerup: 'goldpen' }); // -> 100 (+2)
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'gavel'] }); // -> 111
      c = secretPocket(b, c.endX, c.endRow, { index: 1 }); // -> 116
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: -1 }); // -> 122, row 26
      c = runway(b, c.endX, c.endRow, { len: 12, coinRow: 22, rings: true }); // -> 134 (+16)
      c = skyLadder(b, c.endX, c.endRow, { index: 1 }); // -> 142
      c = crumbleBridge(b, c.endX, c.endRow, { len: 6 }); // -> 152 (longer void bridge)
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 }); // -> 158
      c = pipeField(b, c.endX, c.endRow, { pipes: 2, lawyer: true }); // -> 169 (lawyer @ 160)
      c = secretPocket(b, c.endX, c.endRow, { index: 2 }); // -> 174
      c = goldbarPerch(b, c.endX, c.endRow, { index: 3 }); // -> 180
      c = skyLadder(b, c.endX, c.endRow, { index: 4 }); // -> 188
      finishTo(b, c.endX, c.endRow, 200); // coins total: 48
      // THE SERVICE BYPASS (honest shortcut): a maintenance pipe on the
      // mezzanine checkpoint ledge (cols 74-75) dives under the whole
      // crumble-spike / goldpen-gallery / rat+gavel stretch and surfaces
      // flush just past the gavel (cols 109-110). Explorers skip the
      // gauntlet — and forgo its coins and the goldpen. Laid after the
      // chain so nothing overwrites the mouths (rule 7).
      b.warpPipe(74, 18, 2, 109, 20, 2);
    },
  },

  // -------------------------------------------------------------------------
  // w2a6 — OPTIONAL spur. The detour passes the REAL Peach's dungeon door.
  // DECOR AGENT NOTE — THE CORRIDOR (columns 80..106, surface row 28): this
  // stretch is the sincere beat. Draw the real dungeon door in the background
  // around columns 90..96 — real stone, no prop sticks, no labels, no jokes.
  // The corridor itself is deliberately quiet: no enemies, no hazards, one
  // low unbroken line of coins leading past the door. Comedy resumes after.
  // Harder-but-richer bookends: 2 goldbars easy, 3 hidden (sky/vault/sky).
  // -------------------------------------------------------------------------
  {
    id: 'w2a6',
    world: 2,
    act: 6,
    title: 'Dungeon Door Detour',
    excuse: 'That door? Utility closet. The sobbing is a mop. A very sad, very hydrated mop. Keep walking.',
    theme: 'sewer',
    width: 186,
    build(b) {
      let c = runway(b, 0, 26, { len: 10, coinRow: 22, rings: true }); // -> 10 (11 coins)
      b.start(2, 25);
      c = brickGallery(b, c.endX, c.endRow, { len: 8, powerup: 'stamp' }); // -> 18 (+1)
      c = spikePit(b, c.endX, c.endRow, { gap: 3 }); // -> 27
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'pollster'] }); // -> 38
      c = skyLadder(b, c.endX, c.endRow, { index: 0 }); // -> 46 (hidden bar 1)
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // -> 56 (+6)
      c = secretPocket(b, c.endX, c.endRow, { index: 0 }); // -> 61
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'gavel'] }); // -> 72
      c = checkpointRest(b, c.endX, c.endRow); // -> 78 (+3, checkpoint @ 74)
      c = steppes(b, c.endX, c.endRow, { count: 1, stepH: 2, treadW: 2, dir: -1 }); // -> 80, row 28
      c = runway(b, c.endX, c.endRow, { len: 26, coinRow: 25 }); // -> 106 (+24) THE CORRIDOR
      c = steppes(b, c.endX, c.endRow, { count: 1, stepH: 2, treadW: 2, dir: 1 }); // -> 108, row 26
      c = goldbarVault(b, c.endX, c.endRow, { index: 1 }); // -> 113 (hidden bar 2)
      c = crumbleBridge(b, c.endX, c.endRow, { len: 5 }); // -> 122
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'pollster'] }); // -> 133
      c = secretPocket(b, c.endX, c.endRow, { index: 1 }); // -> 138
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 }); // -> 144 (easy bar 1)
      c = spikePit(b, c.endX, c.endRow, { gap: 4 }); // -> 154
      c = skyLadder(b, c.endX, c.endRow, { index: 3 }); // -> 162 (hidden bar 3)
      c = secretPocket(b, c.endX, c.endRow, { index: 2 }); // -> 167
      c = goldbarPerch(b, c.endX, c.endRow, { index: 4 }); // -> 173 (easy bar 2)
      finishTo(b, c.endX, c.endRow, 186); // coins total: 45
    },
  },

  // -------------------------------------------------------------------------
  // w2a7 — the trunk line: three pipe fields crawling with lawyer plants,
  // goldbars sitting brazenly on pipe mouths, the surveillance drone
  // ("TOTALLY A BIRD"), and the world's widest spike pits. Hard. NEW: THE
  // MONEY VAULT — goldbar 4 moved off its perch into a coin-stuffed room
  // under the final stretch; a flush drain grate (cols 180-181) drops you
  // in, the same shaft (cols 190-191) climbs back out before the door.
  // -------------------------------------------------------------------------
  {
    id: 'w2a7',
    world: 2,
    act: 7,
    title: 'The Money Main',
    excuse: 'My lawyers advise no rescues this quarter. Many people are saying this. My lawyers are people.',
    theme: 'sewer',
    width: 200,
    build(b) {
      let c = runway(b, 0, 25, { len: 10, coinRow: 21, rings: true }); // -> 10 (11 coins)
      b.start(2, 24);
      c = gapJump(b, c.endX, c.endRow, { gap: 4 }); // -> 20
      c = brickGallery(b, c.endX, c.endRow, { len: 8, powerup: 'stamp' }); // -> 28 (+1)
      c = pipeField(b, c.endX, c.endRow, { pipes: 3, lawyer: true }); // -> 44 (lawyer @ 30)
      b.goldbar(0, 40, 22); // sitting on the third pipe's mouth — jump from its top
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['pollster', 'lobbyist'] }); // -> 55
      c = spikePit(b, c.endX, c.endRow, { gap: 4 }); // -> 65
      c = pipeField(b, c.endX, c.endRow, { pipes: 3, lawyer: true }); // -> 81 (lawyer @ 67)
      b.coinRow(77, 79, 21); // skim floating over the third pipe (+3)
      c = checkpointRest(b, c.endX, c.endRow); // -> 87 (+3, checkpoint @ 83)
      c = coinArc(b, c.endX, c.endRow, { gap: 5 }); // -> 98 (+7)
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'paparazzo', 'rat'] }); // -> 113
      c = secretPocket(b, c.endX, c.endRow, { index: 0 }); // -> 118
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 }); // -> 124
      c = runway(b, c.endX, c.endRow, { len: 14, coinRow: 21, rings: true }); // -> 138 (+18)
      c = pipeField(b, c.endX, c.endRow, { pipes: 3, lawyer: true }); // -> 154 (lawyer @ 140)
      b.goldbar(3, 150, 22); // on the third pipe's mouth again — they stopped hiding it
      c = skyLadder(b, c.endX, c.endRow, { index: 2 }); // -> 162
      c = secretPocket(b, c.endX, c.endRow, { index: 1 }); // -> 167
      c = spikePit(b, c.endX, c.endRow, { gap: 5 }); // -> 178
      b.ground(c.endX, c.endX + 5, c.endRow); // vault antechamber (bar 4's old perch spot)
      c = { endX: c.endX + 6, endRow: c.endRow }; // -> 184
      c = secretPocket(b, c.endX, c.endRow, { index: 2 }); // -> 189
      finishTo(b, c.endX, c.endRow, 200); // coins total: 43 + 15 vault
      // THE MONEY VAULT: flush drain grate at cols 180-181 (press down) into
      // the room under the final stretch — goldbar 4 waits at the far end
      // behind the coin hoard; the return shaft at cols 190-191 surfaces two
      // tiles before the goal door. Laid after the chain (rule 7).
      b.room(184, 196, 29, 32); // vault: floor row 33
      b.warpPipe(180, 25, 2, 184, 31, 2); // drain grate -> vault floor
      b.warpPipe(190, 31, 2, 190, 25, 2); // the same shaft back up
      b.coinRow(187, 189, 31); // the hoard: 15 coins around the shaft
      b.coinRow(187, 189, 32);
      b.coinRow(192, 196, 31);
      b.coinRow(192, 195, 32);
      b.goldbar(4, 196, 32); // the take, vaulted where they think it is safe
    },
  },

  // -------------------------------------------------------------------------
  // w2a8 — CASTLE. The drainage donjon under Impeach's office: one last
  // gauntlet of everything W2 taught (spike pit, crumble deck, lawyer pipe,
  // rat + gavel), a checkpoint breather, a goldbar victory lap, then the
  // staged Bowsonaro show in a gated arena. He "escapes"; the excuse blames
  // the locks. Cutscene w2-end advances Mangiani's suspicion.
  // -------------------------------------------------------------------------
  {
    id: 'w2a8',
    world: 2,
    act: 8,
    title: 'Drainage Donjon',
    excuse: 'I shouted the override word — covfefe — but Bowsonaro changed the locks. "E daí?", he said. E daí indeed.',
    theme: 'sewer',
    width: 185,
    boss: true,
    cutsceneAfter: 'w2-end',
    build(b) {
      let c = runway(b, 0, 26, { len: 10, coinRow: 22, rings: true }); // -> 10 (11 coins)
      b.start(2, 25);
      c = brickGallery(b, c.endX, c.endRow, { len: 10, powerup: 'stamp' }); // -> 20 (+2)
      c = spikePit(b, c.endX, c.endRow, { gap: 4 }); // -> 30
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'pollster'] }); // -> 41
      c = crumbleSpikes(b, c.endX, c.endRow, { len: 6, coins: true }); // -> 51 (+6)
      c = pipeField(b, c.endX, c.endRow, { pipes: 2, lawyer: true }); // -> 62 (lawyer @ 53)
      c = runway(b, c.endX, c.endRow, { len: 3 }); // -> 65 (sprint runway: 8 flat tiles before the lip)
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // -> 75 (+6, void gap 68-71)
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'gavel'] }); // -> 86
      c = checkpointRest(b, c.endX, c.endRow); // -> 92 (+3, checkpoint @ 88)
      c = runway(b, c.endX, c.endRow, { len: 12, coinRow: 22, rings: true }); // -> 104 (+16)
      c = skyLadder(b, c.endX, c.endRow, { index: 0 }); // -> 112
      c = secretPocket(b, c.endX, c.endRow, { index: 0 }); // -> 117
      c = goldbarPerch(b, c.endX, c.endRow, { index: 1 }); // -> 123
      c = secretPocket(b, c.endX, c.endRow, { index: 1 }); // -> 128
      c = goldbarPerch(b, c.endX, c.endRow, { index: 2 }); // -> 134
      c = secretPocket(b, c.endX, c.endRow, { index: 2 }); // -> 139
      c = goldbarPerch(b, c.endX, c.endRow, { index: 3 }); // -> 145
      c = skyLadder(b, c.endX, c.endRow, { index: 4 }); // -> 153
      arenaApproach(b, c.endX, c.endRow, { width: 26 }); // arena 159..184, goal @ 180, endX 185
    },
  },
];
