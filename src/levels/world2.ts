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
//   vaults, alcove pockets, crumble-over-spikes, drainage basins, maintenance
//   catwalks) and validate LOUDLY like motifs do.
// - The mandatory route is flow-bot-clearable: gaps <= 5, climbs <= 3 rows
//   (walls up to ~6 are fine — the bot full-holds), drops land on wide strips.
// - 2026-08 playtest retune: descents step in <= 2-row treads (rule 8 — a
//   sheer safe face is a nap), every void gap gets >= 8 flat sprint tiles
//   before its lip (rule 5 at runMax), and no brick lid ever overhangs a
//   pocket's exit arc (rule 9 / the playtest trap).
// - RICHNESS WAVE (2026-08, rules 11-14): every act dives and climbs — the
//   sewer's verticality is basins (the lane drops 4 rows onto a drained
//   floor under the decommissioned walkway) and ridge catwalks (the lane
//   climbs 4-6 rows in 2-row treads and runs under a oneway service grate).
//   Both double as the rule-12 parallel path: floor vs walkway, lane vs
//   grate, always >= 4 rows apart for >= 12 contiguous columns. Every
//   non-boss act ends in finishTo's two-sided pre-pole PYRAMID (two-sided
//   because a sheer-backed staircase would scan as a rule-8 recess): its
//   4-row peak puts the certified >= 90% pole grab inside a plain run-jump
//   arc, and the pole-to-door runway stays flat (ceremony walk contract).
// - WARP FEATURES (one per flavor, rule 7-clean, laid at the END of build so
//   later tile work can never overwrite a mouth): w2a1 skim vault (bonus
//   coin room under the checkpoint stretch), w2a5 service bypass (honest
//   shortcut past the gallery/gauntlet/basin stretch), w2a7 money vault
//   (goldbar 4 + hoard under the finale). Vault rooms sit below the lane and
//   are fed/drained by warp pairs; the flood-fill gate follows the links.
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

/** catwalk — a maintenance catwalk over the main channel (RICHNESS WAVE):
 *  flat lane at `row` with a oneway service grate hanging 5 rows overhead —
 *  jump up through the grate, drop off its open ends, so BOTH lanes are
 *  flood-reachable. This is W2's stock rule-12 parallel path: 5 rows of
 *  separation across len-2 columns. The lane scan ignores surfaces >= 3
 *  rows up, so the grate never captures the mandatory lane, and the bot
 *  never interacts with oneways above its head. Optional coins pay the high
 *  road; opts.goldbar floats a bar a hop over the grate. */
function catwalk(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts: { len: number; coins?: boolean; goldbar?: number },
): MotifEnd {
  const len = requireInt(opts.len, 10, 40, 'catwalk len');
  const grate = row - 5;
  if (grate < 3) throw new Error(`catwalk: grate row ${grate} needs headroom (row >= 8)`);
  b.ground(x, x + len - 1, row);
  b.oneway(x + 1, x + len - 2, grate);
  if (opts.coins) b.coinRow(x + 2, x + len - 3, grate - 1);
  if (opts.goldbar !== undefined) {
    b.goldbar(opts.goldbar, x + Math.floor(len / 2), grate - 2);
  }
  return { endX: x + len, endRow: row };
}

/** basin — a drainage basin (RICHNESS WAVE): the lane dives `depth` rows in
 *  2-row treads (never a recess — rules 8/9 by construction) onto a wide
 *  drained floor, while the decommissioned WALKWAY (oneway) still spans the
 *  basin 5 rows over the floor. One feature, two rules: the dive is relief
 *  (rule 11 — 4 steps and `depth` rows of range at depth 4) and floor vs
 *  walkway is a real parallel path (rule 12 — `len` dual columns). Optional
 *  coins ride the walkway; opts.goldbar floats a bar a hop over it. */
function basin(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts: { len: number; depth?: number; coins?: boolean; goldbar?: number },
): MotifEnd {
  const depth = requireInt(opts.depth ?? 4, 4, 6, 'basin depth');
  if (depth % 2 !== 0) throw new Error(`basin depth must be even (2-row treads), got ${depth}`);
  const len = requireInt(opts.len, 8, 40, 'basin len');
  const floor = row + depth;
  if (floor > b.heightTiles - 6) {
    throw new Error(`basin: floor row ${floor} leaves the running lane`);
  }
  const treads = depth / 2 - 1;
  b.ground(x, x + 1, row); // entry rim
  for (let i = 0; i < treads; i++) {
    b.ground(x + 2 + 2 * i, x + 3 + 2 * i, row + 2 * (i + 1)); // down treads
  }
  const fx0 = x + 2 + 2 * treads;
  const fx1 = fx0 + len - 1;
  b.ground(fx0, fx1, floor); // the drained floor
  b.oneway(fx0, fx1, floor - 5); // the old walkway, still spanning the basin
  if (opts.coins) b.coinRow(fx0 + 1, fx1 - 1, floor - 6);
  if (opts.goldbar !== undefined) {
    b.goldbar(opts.goldbar, fx0 + Math.floor(len / 2), floor - 7);
  }
  for (let i = 0; i < treads; i++) {
    b.ground(fx1 + 1 + 2 * i, fx1 + 2 + 2 * i, floor - 2 * (i + 1)); // up treads
  }
  const ex = fx1 + 1 + 2 * treads;
  b.ground(ex, ex + 1, row); // exit rim
  return { endX: ex + 2, endRow: row };
}

/** finishTo — the act's closing stretch: flat ground running to the map edge,
 *  goal door 8 tiles before `width` — and THE PRE-POLE PYRAMID (rule 14): a
 *  two-sided 2-row-tread pyramid whose peak, 4 rows over the goal line, puts
 *  the certified (>= 90%) pole grab inside a plain run-jump arc. Two-sided
 *  because a sheer-backed staircase would scan as a rule-8 recess; fully
 *  LEFT of the flagpole (pole col = width-16) so the pole-to-door runway
 *  stays flat (ceremony walk contract). Needs >= 24 columns so the pyramid
 *  sits on finishTo's own ground — throws if the chain over/under-ran. */
function finishTo(b: LevelBuilderLike, x: number, row: number, width: number): void {
  const span = width - x;
  if (span < 24 || span > 34) {
    throw new Error(
      `finishTo: ${span} tiles left before width ${width} (x=${x}) — needs 24..34 (pyramid + pole + door)`,
    );
  }
  b.ground(x, width - 1, row);
  b.ground(width - 22, width - 21, row - 2); // up tread
  b.ground(width - 20, width - 19, row - 4); // the peak: launch for the top grab
  b.ground(width - 18, width - 17, row - 2); // down tread (two-sided!)
  b.goal(width - 8, row - 1);
}

// ---------------------------------------------------------------------------
// The acts. Chain comments track the running cursor: "-> x" is endX.
// ---------------------------------------------------------------------------

export const world2: LevelDef[] = [
  // -------------------------------------------------------------------------
  // w2a1 — the descent into the laundering office: two big stepped coin
  // chutes (16 -> 20 -> 24, then steppes to 28), oneway grate ladders rising
  // to skimmed goldbars. Gentle: gaps of 3, walker enemies only. The SKIM
  // VAULT — a warp pipe on the catwalk stretch dives into a coin room carved
  // under the checkpoint stretch (the skimmed take, still in the dryer), and
  // a second pipe pops back up on the gap-jump landing ahead. RICHNESS: the
  // drain runway is now a full maintenance CATWALK (rule 12's parallel path
  // joins the vault room's 13 dual columns), and the finale carries the
  // pre-pole pyramid.
  // -------------------------------------------------------------------------
  {
    id: 'w2a1',
    world: 2,
    act: 1,
    title: 'Coin Chute Drop',
    excuse: 'The intel came from a perfect phone call. The most perfect. I certified it myself.',
    theme: 'sewer',
    width: 200,
    build(b) {
      let c = runway(b, 0, 16, { len: 12, coinRow: 12, rings: true }); // -> 12 (16 coins)
      b.start(2, 15);
      c = chuteDrop(b, c.endX, c.endRow, { drop: 4, land: 16 }); // -> 31, row 20 (+3, 2-row treads)
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'lobbyist'] }); // -> 42
      c = brickGallery(b, c.endX, c.endRow, { len: 10, powerup: 'stamp' }); // -> 52 (+2)
      c = skyLadder(b, c.endX, c.endRow, { index: 0 }); // -> 60
      c = chuteDrop(b, c.endX, c.endRow, { drop: 4, land: 16 }); // -> 79, row 24 (+3, 2-row treads)
      c = catwalk(b, c.endX, c.endRow, { len: 15, coins: true }); // -> 94 (+11, grate @ 19 over the drain)
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
      finishTo(b, c.endX, c.endRow, 200); // pyramid @ 178-183 (peak 24), pole @ 184, door @ 192
      // THE SKIM VAULT (bonus): stand on the drain pipe at cols 84-85 under
      // the catwalk grate, press down, loot the hoard carved under the
      // checkpoint stretch, ride the far pipe back up to a flush grate on
      // the gap-jump landing (cols 118-119). Laid after the chain so no
      // later tile work can overwrite a mouth (rule 7).
      b.room(98, 110, 28, 31); // vault: floor row 32, ceiling row 27
      b.warpPipe(84, 22, 2, 98, 30, 2); // catwalk drain -> vault floor
      b.warpPipe(108, 30, 2, 118, 24, 2); // vault -> flush grate ahead
      b.coinRow(101, 107, 30); // the hoard: 14 coins
      b.coinRow(101, 107, 31);
    },
  },

  // -------------------------------------------------------------------------
  // w2a2 — the wash lanes proper: the world's first lawyer plant, first spike
  // pit, and the goldpen debuts... nowhere — Impeach moved it to w2a5. Decor
  // cue: dryer drums full of coin rolls. RICHNESS: after the checkpoint the
  // lane climbs the WASH GANTRY (a 6-row ridge under a service grate), drops
  // back past a spike pit and dives into the first drainage basin — the
  // profile runs 20 high to 30 deep with a parallel lane over both the ridge
  // and the basin floor.
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
      let c = runway(b, 0, 26, { len: 11, coinRow: 22, rings: true }); // -> 11 (15 coins)
      b.start(2, 25);
      c = brickGallery(b, c.endX, c.endRow, { len: 10, powerup: 'stamp' }); // -> 21 (+2)
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'pollster'] }); // -> 32
      c = pipeField(b, c.endX, c.endRow, { pipes: 2, lawyer: true }); // -> 43 (lawyer @ 35)
      c = runway(b, c.endX, c.endRow, { len: 3 }); // -> 46 (sprint runway: 8 flat tiles before the lip)
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // -> 56 (+6, void gap 49-52)
      c = alcovePocket(b, c.endX, c.endRow, { index: 0 }); // -> 61 (lid over the alcove, exit well open)
      c = checkpointRest(b, c.endX, c.endRow); // -> 67 (+3, checkpoint @ 63)
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: 1 }); // -> 73, row 20
      c = catwalk(b, c.endX, c.endRow, { len: 16, coins: true, goldbar: 0 }); // -> 89 (+12, THE WASH GANTRY)
      c = skyLadder(b, c.endX, c.endRow, { index: 1 }); // -> 97
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: -1 }); // -> 103, row 26
      c = spikePit(b, c.endX, c.endRow, { gap: 3 }); // -> 112
      c = basin(b, c.endX, c.endRow, { len: 14, coins: true, goldbar: 2 }); // -> 134 (+12, floor 30)
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'chipstack'] }); // -> 145 (rat @ 137)
      c = goldbarPerch(b, c.endX, c.endRow, { index: 3 }); // -> 151
      c = secretPocket(b, c.endX, c.endRow, { index: 1 }); // -> 156
      c = goldbarVault(b, c.endX, c.endRow, { index: 4 }); // -> 161
      c = secretPocket(b, c.endX, c.endRow, { index: 2 }); // -> 166
      finishTo(b, c.endX, c.endRow, 190); // pyramid @ 168-173 (peak 22), pole @ 174, door @ 182
    },
  },

  // -------------------------------------------------------------------------
  // w2a3 — the accountant rats' local. Rats EVERYWHERE (all beyond their
  // 41-tile idle reach), the world's first gavels banging like meeting
  // hammers. Decor cue: union posters ("LOCAL 512 — SCURRIERS & SKIMMERS"),
  // a strike-vote ballot box, tiny picket signs. RICHNESS: after the return
  // duct the hall floor gives way to a spike trench, then the lane climbs
  // the STRIKE BALCONY — basin at 24, one more tread to a 22-row catwalk —
  // before the pyramid finale (profile 18..31).
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
      let c = runway(b, 0, 24, { len: 8, coinRow: 20, rings: true }); // -> 8 (9 coins)
      b.start(2, 23);
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 3, dir: -1 }); // -> 14, row 28
      c = brickGallery(b, c.endX, c.endRow, { len: 10, powerup: 'stamp' }); // -> 24 (+2)
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'pollster'] }); // -> 35
      c = brickGallery(b, c.endX, c.endRow, { len: 10 }); // -> 45 (+3, the minutes shelf)
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'rat'] }); // -> 56 (rats @ 48, 52)
      c = secretPocket(b, c.endX, c.endRow, { index: 0 }); // -> 61
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'gavel'] }); // -> 72 (gavel @ 68)
      c = checkpointRest(b, c.endX, c.endRow); // -> 78 (+3, checkpoint @ 74)
      // THE RETURN DUCT (2026-08 difficulty wave): the union hall's low
      // ceiling duct. A brick lintel at row 25 grows three single-column
      // spike TEETH from its underside (rule 10: anchored to the solid
      // directly above) at cols 83/85/87, with clean standing room between
      // them. Small Estrada walks under untouched; Certified must duck-slide
      // each tooth (ducking keeps momentum, kills acceleration — one tooth
      // is exactly one slide) or pay a shrink. The flow bot is small and
      // strolls the clear row; crawl coins pay the indignity. Idle-safe:
      // nothing here has a clock.
      b.ground(78, 91, 28); // -> 92 duct floor
      b.platform(83, 87, 25, 'brick'); // the duct lintel
      b.spikes(83, 83, 26); // tooth 1 (hangs FROM the lintel)
      b.spikes(85, 85, 26); // tooth 2
      b.spikes(87, 87, 26); // tooth 3
      b.coinRow(83, 87, 27); // 5 crawl coins through the duct
      b.coinRow(79, 82, 24); // 4 coins on the approach
      b.coinRow(88, 91, 24); // 4 coins on the exit
      b.coinRow(79, 81, 25); // 3 ring coins before the lintel
      b.coinRow(89, 91, 25); // 3 ring coins after (+19 total)
      c = { endX: 92, endRow: 28 }; // -> 92, same handover as a runway
      c = spikePit(b, c.endX, c.endRow, { gap: 4 }); // -> 102 (floor 31, the trench)
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 2, dir: 1 }); // -> 106, row 24
      c = basin(b, c.endX, c.endRow, { len: 15, coins: true, goldbar: 0 }); // -> 129 (+13, floor 28)
      c = steppes(b, c.endX, c.endRow, { count: 1, stepH: 2, treadW: 2, dir: 1 }); // -> 131, row 22
      c = catwalk(b, c.endX, c.endRow, { len: 14, coins: true, goldbar: 1 }); // -> 145 (+10, THE STRIKE BALCONY)
      c = goldbarVault(b, c.endX, c.endRow, { index: 2 }); // -> 150
      c = secretPocket(b, c.endX, c.endRow, { index: 1 }); // -> 155
      c = goldbarPerch(b, c.endX, c.endRow, { index: 3 }); // -> 161
      c = goldbarPerch(b, c.endX, c.endRow, { index: 4 }); // -> 167
      c = secretPocket(b, c.endX, c.endRow, { index: 2 }); // -> 172
      finishTo(b, c.endX, c.endRow, 196); // pyramid @ 174-179 (peak 18), pole @ 180, door @ 188
    },
  },

  // -------------------------------------------------------------------------
  // w2a4 — OPTIONAL spur, harder but richer: crumble decks over spike beds
  // everywhere; 1 goldbar in plain sight (perch), 4 hidden (two brick-lid
  // vaults below the lane, one over the catwalk, one high sky ladder). Decor
  // cue: prop skeletons of "previous rescuers" with price stickers still on.
  // RICHNESS (the old flattest act in the game): a proper descent-and-climb
  // CRYPT profile — the lane dives into the burial basin (floor 30), climbs
  // to the ossuary catwalk at 22, and finishes over the pyramid (peak 18).
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
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 }); // -> 32 (easy bar)
      c = crumbleSpikes(b, c.endX, c.endRow, { len: 6, coins: true }); // -> 42 (+6)
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['pollster', 'lobbyist'] }); // -> 53
      c = goldbarVault(b, c.endX, c.endRow, { index: 1 }); // -> 58 (hidden bar 1)
      c = basin(b, c.endX, c.endRow, { len: 14, coins: true }); // -> 80 (+12, THE BURIAL BASIN, floor 30)
      c = checkpointRest(b, c.endX, c.endRow); // -> 86 (+3, checkpoint @ 82)
      c = crumbleSpikes(b, c.endX, c.endRow, { len: 8, coins: true }); // -> 98 (+8)
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'gavel'] }); // -> 109 (gavel @ 105)
      c = steppes(b, c.endX, c.endRow, { count: 2, stepH: 2, treadW: 2, dir: 1 }); // -> 113, row 22
      c = catwalk(b, c.endX, c.endRow, { len: 14, coins: true, goldbar: 2 }); // -> 127 (+10, THE OSSUARY)
      c = skyLadder(b, c.endX, c.endRow, { index: 3 }); // -> 135 (hidden bar 3, high)
      c = secretPocket(b, c.endX, c.endRow, { index: 0 }); // -> 140
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'chipstack'] }); // -> 151 (chip @ 147)
      c = secretPocket(b, c.endX, c.endRow, { index: 1 }); // -> 156
      c = goldbarVault(b, c.endX, c.endRow, { index: 4 }); // -> 161 (hidden bar 4)
      c = secretPocket(b, c.endX, c.endRow, { index: 2 }); // -> 166
      finishTo(b, c.endX, c.endRow, 190); // pyramid @ 168-173 (peak 18), pole @ 174, door @ 182
    },
  },

  // -------------------------------------------------------------------------
  // w2a5 — the leaky stretch: crumble bridges over true voids, prop pipes
  // everywhere (decor cue: drips, duct tape, buckets), a springboard up to a
  // dry mezzanine and back down. Lawyers only far from the start. RICHNESS:
  // the mezzanine is now a full service deck — catwalk grate, goldpen
  // gallery, rat+gavel gauntlet — and the descent lands in a drainage basin
  // before the second void bridge (profile 20 high to 30 deep).
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
      c = pipeField(b, c.endX, c.endRow, { pipes: 2 }); // -> 30 (no lawyer this close)
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'pollster'] }); // -> 41
      c = secretPocket(b, c.endX, c.endRow, { index: 0 }); // -> 46
      c = springboardWall(b, c.endX, c.endRow, { wallH: 5 }); // -> 53, row 20 (the mezzanine)
      c = goldbarPerch(b, c.endX, c.endRow, { index: 0 }); // -> 59
      c = checkpointRest(b, c.endX, c.endRow); // -> 65 (+3, checkpoint @ 61)
      c = catwalk(b, c.endX, c.endRow, { len: 16, coins: true, goldbar: 1 }); // -> 81 (+12, the service deck)
      c = brickGallery(b, c.endX, c.endRow, { len: 10, powerup: 'goldpen' }); // -> 91 (+2)
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'gavel'] }); // -> 102 (gavel @ 98)
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: -1 }); // -> 108, row 26
      c = basin(b, c.endX, c.endRow, { len: 17, coins: true, goldbar: 2 }); // -> 133 (+15, floor 30)
      c = crumbleBridge(b, c.endX, c.endRow, { len: 6 }); // -> 143 (longer void bridge)
      c = pipeField(b, c.endX, c.endRow, { pipes: 2, lawyer: true }); // -> 154 (lawyer @ 146)
      c = secretPocket(b, c.endX, c.endRow, { index: 1 }); // -> 159
      c = goldbarVault(b, c.endX, c.endRow, { index: 3 }); // -> 164
      c = secretPocket(b, c.endX, c.endRow, { index: 2 }); // -> 169
      c = goldbarPerch(b, c.endX, c.endRow, { index: 4 }); // -> 175
      finishTo(b, c.endX, c.endRow, 200); // pyramid @ 178-183 (peak 22), pole @ 184, door @ 192
      // THE SERVICE BYPASS (honest shortcut): a maintenance pipe on the
      // mezzanine service deck (cols 67-68, under the catwalk grate) dives
      // under the whole goldpen-gallery / rat+gavel / basin stretch and
      // surfaces flush on the second void bridge's left shoulder (cols
      // 133-134). Explorers skip the gauntlet — and forgo its coins, the
      // goldpen and the basin bar. Laid after the chain so nothing
      // overwrites the mouths (rule 7).
      b.warpPipe(67, 18, 2, 133, 26, 2);
    },
  },

  // -------------------------------------------------------------------------
  // w2a6 — OPTIONAL spur. The detour passes the REAL Peach's dungeon door.
  // DECOR AGENT NOTE — THE CORRIDOR (columns 74..97, surface row 28): this
  // stretch is the sincere beat. Draw the real dungeon door in the background
  // around columns 82..88 — real stone, no prop sticks, no labels, no jokes.
  // The corridor itself is deliberately quiet: no enemies, no hazards, one
  // low unbroken line of coins leading past the door. Comedy resumes after.
  // RICHNESS: the comedy bookends carry the relief — an inspection catwalk
  // before the corridor, the coin-roll chipstacks' basin after (chipstack
  // debuts vs w2a5), and the pyramid finale.
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
      let c = runway(b, 0, 26, { len: 8, coinRow: 22, rings: true }); // -> 8 (9 coins)
      b.start(2, 25);
      c = brickGallery(b, c.endX, c.endRow, { len: 8, powerup: 'stamp' }); // -> 16 (+1)
      c = spikePit(b, c.endX, c.endRow, { gap: 3 }); // -> 25
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'pollster'] }); // -> 36
      c = catwalk(b, c.endX, c.endRow, { len: 14, coins: true, goldbar: 0 }); // -> 50 (+10, hidden bar 1)
      c = secretPocket(b, c.endX, c.endRow, { index: 0 }); // -> 55
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'gavel'] }); // -> 66 (gavel @ 62)
      c = checkpointRest(b, c.endX, c.endRow); // -> 72 (+3, checkpoint @ 68)
      c = steppes(b, c.endX, c.endRow, { count: 1, stepH: 2, treadW: 2, dir: -1 }); // -> 74, row 28
      c = runway(b, c.endX, c.endRow, { len: 24, coinRow: 25 }); // -> 98 (+22) THE CORRIDOR
      c = steppes(b, c.endX, c.endRow, { count: 1, stepH: 2, treadW: 2, dir: 1 }); // -> 100, row 26
      c = goldbarVault(b, c.endX, c.endRow, { index: 1 }); // -> 105 (hidden bar 2)
      c = goldbarPerch(b, c.endX, c.endRow, { index: 3 }); // -> 111 (easy bar 1)
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'chipstack'] }); // -> 122 (chip @ 118, THE DEBUT)
      c = basin(b, c.endX, c.endRow, { len: 14, coins: true, goldbar: 2 }); // -> 144 (+12, floor 30)
      c = secretPocket(b, c.endX, c.endRow, { index: 1 }); // -> 149
      c = skyLadder(b, c.endX, c.endRow, { index: 4 }); // -> 157 (hidden bar 3)
      c = secretPocket(b, c.endX, c.endRow, { index: 2 }); // -> 162
      finishTo(b, c.endX, c.endRow, 186); // pyramid @ 164-169 (peak 22), pole @ 170, door @ 178
    },
  },

  // -------------------------------------------------------------------------
  // w2a7 — the trunk line: two pipe fields crawling with lawyer plants,
  // goldbars sitting brazenly on pipe mouths, the surveillance drone
  // (taped craft feathers, per the authorship rule), and the world's widest
  // spike pits. Hard. THE MONEY
  // VAULT — goldbar 4 in a coin-stuffed room under the finale; a flush drain
  // grate right at the pyramid's feet (cols 176-177, because of course the
  // drain is there) drops you in, a shaft (cols 188-189) climbs back out on
  // the pole-to-door runway. RICHNESS: the lane climbs to the trunk-line
  // TOP CATWALK (row 19 under a grate) and dives into the settling basin
  // (floor 29) — profile 19..29 plus the pyramid.
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
      c = pipeField(b, c.endX, c.endRow, { pipes: 3, lawyer: true }); // -> 44 (lawyer @ 31)
      b.goldbar(0, 40, 22); // sitting on the third pipe's mouth — jump from its top
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['pollster', 'lobbyist'] }); // -> 55
      c = spikePit(b, c.endX, c.endRow, { gap: 4 }); // -> 65
      c = checkpointRest(b, c.endX, c.endRow); // -> 71 (+3, checkpoint @ 67)
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: 1 }); // -> 77, row 19
      c = catwalk(b, c.endX, c.endRow, { len: 16, coins: true, goldbar: 1 }); // -> 93 (+12, THE TOP CATWALK)
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: -1 }); // -> 99, row 25
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'paparazzo'] }); // -> 110 (drone @ 106)
      c = coinArc(b, c.endX, c.endRow, { gap: 5 }); // -> 121 (+7)
      c = pipeField(b, c.endX, c.endRow, { pipes: 3, lawyer: true }); // -> 137 (lawyer @ 124)
      b.goldbar(2, 133, 22); // on the third pipe's mouth again — they stopped hiding it
      c = basin(b, c.endX, c.endRow, { len: 16, coins: true, goldbar: 3 }); // -> 161 (+14, THE SETTLING BASIN)
      c = secretPocket(b, c.endX, c.endRow, { index: 0 }); // -> 166
      c = alcovePocket(b, c.endX, c.endRow, { index: 1 }); // -> 171
      c = secretPocket(b, c.endX, c.endRow, { index: 2 }); // -> 176
      finishTo(b, c.endX, c.endRow, 200); // pyramid @ 178-183 (peak 21), pole @ 184, door @ 192
      // THE MONEY VAULT: flush drain grate at cols 176-177 (press down —
      // right at the pyramid's feet, because of course the drain is there)
      // into the room under the finale — goldbar 4 waits at the far end
      // behind the coin hoard; the shaft at cols 188-189 surfaces flush on
      // the pole-to-door runway. Laid after the chain (rule 7).
      b.room(180, 196, 29, 32); // vault: floor row 33
      b.warpPipe(176, 25, 2, 182, 31, 2); // drain grate -> vault floor
      b.warpPipe(188, 31, 2, 188, 25, 2); // the same shaft back up
      b.coinRow(184, 187, 31); // the hoard between the shafts
      b.coinRow(184, 187, 32);
      b.coinRow(192, 195, 31);
      b.coinRow(192, 194, 32);
      b.goldbar(4, 195, 32); // the take, vaulted where they think it is safe
    },
  },

  // -------------------------------------------------------------------------
  // w2a8 — CASTLE. The drainage donjon under Impeach's office: one last
  // gauntlet of everything W2 taught (spike pit, crumble deck, lawyer pipe,
  // rat + gavel, the ridge catwalk, the drainage basin), a checkpoint
  // breather, a goldbar victory lap, then the staged Bowsonaro show in a
  // gated arena. He "escapes"; the excuse blames the locks. Cutscene w2-end
  // advances Mangiani's suspicion. (Castle: door-only ceremony — no pole, no
  // pyramid; rules 11/12 still judge the pre-arena body, hence the ridge and
  // the basin.)
  // -------------------------------------------------------------------------
  {
    id: 'w2a8',
    world: 2,
    act: 8,
    title: 'Drainage Donjon',
    excuse: 'I shouted the override word — covfefe — but Bowsonaro changed the locks. "E daí?", he said. E daí indeed.',
    theme: 'sewer',
    width: 200,
    boss: true,
    cutsceneAfter: 'w2-end',
    build(b) {
      let c = runway(b, 0, 26, { len: 10, coinRow: 22, rings: true }); // -> 10 (11 coins)
      b.start(2, 25);
      c = brickGallery(b, c.endX, c.endRow, { len: 10, powerup: 'stamp' }); // -> 20 (+2)
      c = spikePit(b, c.endX, c.endRow, { gap: 4 }); // -> 30
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['lobbyist', 'pollster'] }); // -> 41
      c = crumbleSpikes(b, c.endX, c.endRow, { len: 4, coins: true }); // -> 49 (+4)
      c = pipeField(b, c.endX, c.endRow, { pipes: 2, lawyer: true }); // -> 60 (lawyer @ 52)
      c = runway(b, c.endX, c.endRow, { len: 3 }); // -> 63 (sprint runway: 8 flat tiles before the lip)
      c = coinArc(b, c.endX, c.endRow, { gap: 4 }); // -> 73 (+6, void gap 66-69)
      b.enemy('gavel', c.endX - 2, c.endRow - 4); // 2026-08 difficulty wave:
      // the DOCKET STAMP hangs over the void-gap landing (col 71) — time the
      // jump AND the slam. Contact is a hurt (Certified shrinks, small pays
      // full price); the 45-frame pause + slow rise after each slam is the
      // generous window through. 69 tiles from the start (> 27, idle-silent)
      // and the act's checkpoint sits AFTER it, so respawns never re-face it.
      c = enemyGauntlet(b, c.endX, c.endRow, { kinds: ['rat', 'gavel'] }); // -> 84 (rat @ 76)
      c = checkpointRest(b, c.endX, c.endRow); // -> 90 (+3, checkpoint @ 86)
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: 1 }); // -> 96, row 20
      c = catwalk(b, c.endX, c.endRow, { len: 14, coins: true, goldbar: 0 }); // -> 110 (+10, the donjon rampart)
      c = steppes(b, c.endX, c.endRow, { count: 3, stepH: 2, treadW: 2, dir: -1 }); // -> 116, row 26
      c = basin(b, c.endX, c.endRow, { len: 15, coins: true, goldbar: 1 }); // -> 139 (+13, the moat basin)
      c = secretPocket(b, c.endX, c.endRow, { index: 0 }); // -> 144
      c = goldbarVault(b, c.endX, c.endRow, { index: 2 }); // -> 149
      c = secretPocket(b, c.endX, c.endRow, { index: 1 }); // -> 154
      c = goldbarPerch(b, c.endX, c.endRow, { index: 3 }); // -> 160
      c = secretPocket(b, c.endX, c.endRow, { index: 2 }); // -> 165
      c = goldbarPerch(b, c.endX, c.endRow, { index: 4 }); // -> 171
      arenaApproach(b, c.endX, c.endRow, { width: 23 }); // arena 177..199, goal @ 195, endX 200
    },
  },
];
