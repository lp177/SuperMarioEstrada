// ============================================================================
// THE ACT CONTRACT — checkAct(def) is the gate every act in the campaign must
// pass, and flowBot(level) is the machine that walks every mandatory route.
//
// checkAct enforces (it throws at the FIRST violation, with a message naming
// the act, the rule and the position):
//   0. build determinism (two buildLevel runs must agree — catches module
//      state leaking into LevelDef.build),
//   1. STRUCTURE       — the ACT_RULES counts, castle flags and cutscenes,
//   2. NOTHING BURIED  — every spawn's center tile must be 'empty',
//   7. WARP SANITY     — numbered 7 (added late) but EXECUTED here, because
//                        the flood fill below trusts warp mouths: both pipes
//                        of every warp intact, 2 clear rows over each mouth,
//                        exits that do not strand the player; the
//                        entry-reachable half runs right after rule 3,
//   3. REACHABILITY    — flood fill: goal / goldbars / secrets / checkpoints
//                        are not entombed. The fill is WARP-AWARE: reaching
//                        the standing tiles over a warp ENTRY mouth seeds the
//                        standing tiles over its EXIT mouth (one-way, A->B,
//                        exactly like the ride) — that is what makes sealed
//                        bonus rooms legal (SEE THE LOUD CAVEAT AT RULE 3),
//   4. FORWARD-REACHABLE — nothing sits behind the backtrack ratchet,
//   5. FLOW BOT        — an immortal right+run+jump bot must clear the act,
//   6. IDLE SILENCE    — an untouched level emits ZERO events,
//   8. GAPS CARRY RISK — playtest rule (2026-08): a sheer depression (>= 3
//                        rows below its shoulders) with a SAFE floor is a
//                        nap, not an obstacle. Holes on the route must be
//                        classical: void (bottomless or lava-bottomed —
//                        falling out of the map kills), spike-floored, or
//                        shallow (<= 2 rows, hop out trivially),
//   9. NO TRAPS        — playtest rule (2026-08): every floored pocket must
//                        be exitable. The player fell into a pit and found
//                        it "near impossible to go out cause of the height
//                        to the jump and part beside me" — qblocks overhung
//                        the exit arc. Every reachable floored recess gets a
//                        live probe: drop the flow bot on its floor; it must
//                        exit the span to the RIGHT (the ratchet may legally
//                        wall the left), unless a warp entry inside the
//                        pocket provides the exit.
//  10. HAZARDS ANCHORED — playtest rule (2026-08): traps "seem just floating
//                        in air... really not fun". A hazard must grow out
//                        of the landscape. Every 'spike' tile needs a
//                        solid-ish neighbor (solid directly below = floor
//                        spikes, directly above = ceiling spikes, or
//                        laterally adjacent = wall spikes). Every 'lava'
//                        tile must belong to a POOL (4-connected lava
//                        component) that touches solid below or beside, or
//                        that reaches the map's bottom row (the classical
//                        pit-sealing pool). A hazard tile floating with no
//                        such anchor fails with act + coords.
//  11. RELIEF          — playtest rule (2026-08): "no significant relief".
//                        The mandatory lane must span >= 8 rows of height
//                        somewhere across the act AND change height in
//                        >= 2-row steps at least 6 times. Flat left-to-right
//                        corridors fail. Finale zone / boss arena exempt.
//  12. ALTERNATE ROUTE — playtest rule (2026-08): "no alternative path".
//                        >= 18% of the route's columns must offer two
//                        DISJOINT reachable standable lanes >= 4 rows apart,
//                        including at least one run of >= 12 contiguous
//                        dual-lane columns (a real parallel path, not
//                        scattered ledges). Warp-served rooms count — the
//                        reachability fill traverses warps.
//  13. ENEMY IDENTITY  — playtest rule (2026-08): "always same ennemies".
//                        >= 3 distinct enemy kinds per act; consecutive acts
//                        within a world must not repeat an identical kind
//                        roster and must each place at least one kind their
//                        immediate predecessor did not. Castle acts are
//                        exempt from the cross-act clauses, not from >= 3.
//  14. THE TOP IS EARNABLE — playtest rule (2026-08): "just necessite basic
//                        jump on going go straight". Non-boss acts must
//                        offer a reachable launch structure within 8 tiles
//                        LEFT of the flagpole from which the run-jump arc
//                        (jump math only — springs do not count) grabs
//                        >= GOAL.topGrabFrac (the certified top). The
//                        classic pre-pole staircase satisfies this; a flat
//                        finale fails. Castle acts have NO pole (the door
//                        is the whole ceremony, level.ts def.boss branch) —
//                        exempt.
//
// When a rule fails an act, the rule is working: fix the content, not the
// threshold (AGENTS.md, design rule 7). Rules 8 and 9 are EXPECTED to fail
// acts authored before the playtest (safe floored pits were the house
// pattern); rules 11, 12 and 14 are EXPECTED to fail MOST acts authored
// before the 2026-08 level-design indictment — those failure lists are the
// work order for the 4-agent world-rebuild wave, not thresholds to soften.
//
// SCOPE OF RULES 11-14: checkAct runs them for CAMPAIGN acts (defs that are
// members of LEVELS). The minimal rule-0-10 fixtures (acts.test.ts tinyAct,
// pitRules.test.ts pitAct) stay minimal by design and are not retrofitted;
// richness fixtures exercise the rules directly via checkActRichness /
// auditRichness (tests/richness.test.ts). World agents: auditRichness(def)
// returns every measurement the rules judge — use it while re-tuning.
// ============================================================================

import type {
  BuiltLevel,
  CutsceneId,
  EnemyKind,
  InputState,
  LevelDef,
  SpawnPoint,
  TileKind,
  TileMapLike,
  WorldNo,
} from '../src/core/types.ts';
import {
  ACT_RULES,
  BACKTRACK_SLACK,
  GOAL,
  PHYS,
  SOLIDITY,
  TILE,
} from '../src/core/constants.ts';
import { buildLevel } from '../src/game/levelBuilder.ts';
import { Level } from '../src/game/level.ts';
import { CASTLES } from '../src/levels/maps.ts';
import { LEVELS } from '../src/levels/index.ts';

// ---------------------------------------------------------------------------
// Flow-bot tuning. Grounded in measured player physics (fixed 60 Hz) and
// DERIVED from PHYS wherever speed matters, so retunes shift the reflexes
// automatically. At the current tune a full-hold standstill jump rises ~8
// tiles; a full-sprint arc carries PHYS.runMax px per airborne frame.
//
// SPEED-PROPORTIONAL REFLEXES (runMax 2.9 -> 3.8 -> 4.4 taught this TWICE):
//   - wall probes are GEOMETRIC (tile-quantized): jumping ~2 tiles before a
//     wall works at any approach speed, because rise is time-based,
//   - the gap probe must see a lip at least ~2.75 frames of travel out at
//     full sprint, or the bot can step past the lip between frames — it is
//     derived from PHYS.runMax so physics retunes shift it automatically,
//   - the bot sprints only to launch gap jumps (plus boss chases) — BUT
//     ground speed never decays below a carried sprint while holding right
//     (player.ts's no-clamp rule protects spring momentum), so by mid-act
//     the bot runs at runMax everywhere anyway,
//   - MEASURED HOLDS (the 3.8 -> 4.4 retune's lesson): therefore a FIXED
//     jump hold is a lie at any other speed. At 4.4 px/frame the old fixed
//     12-frame gap hold carried ~10.5 tiles (overflying 3-tile landings into
//     the NEXT void) and the old fixed 40-frame wall hold flew ~18 tiles (a
//     2-tall pipe launched w2a1/w2a2's bot clean over their runways into the
//     void — the two speed-bump casualties). The bot now MEASURES the
//     obstacle — gap width in columns, wall height in rows — and picks the
//     smallest hold whose simulated arc (HOLD_LADDER, player-physics-exact)
//     clears it with margin, exactly like a player scaling the press to what
//     is in front of them. Gap arcs land 1-3 tiles past the far lip instead
//     of a fixed 10; wall hops crest 1 tile over the wall instead of 8.
// ---------------------------------------------------------------------------
const BOT = {
  /** Wall probe distances ahead of the leading face (px): "1-2 tiles ahead"
   *  — geometric, deliberately NOT speed-scaled (see header). */
  wallLookaheadPx: [4, TILE, 2 * TILE],
  /** Gap probe: ~2.75 frames of travel at full sprint ahead of the face. */
  gapLookaheadPx: Math.ceil(2.75 * PHYS.runMax),
  /** Extra distance ahead of the gap probe at which the bot starts
   *  sprinting, so gap jumps launch at full runMax (~14 frames of spin-up). */
  sprintSpinupPx: 40,
  /** Fallback/cap hold (full height, ~8 tiles): unstick jumps, boss-bounce
   *  jumps, and walls too tall to measure a clearing arc for. */
  wallHoldFrames: 40,
  /** Gap jumps never hold longer than this (~10.5-tile carry at runMax): a
   *  lane void wider than that is content to fail, not reflex to save. */
  gapMaxHoldFrames: 12,
  /** Gap measurement: probe up to this many columns for the far lip. */
  gapMeasureMaxTiles: 8,
  /** Landing foothold: carry must put the center this far past the far lip
   *  (the feet sensor half-spread is 5px). */
  gapFootholdPx: 5,
  /** Extra carry margin over the measured requirement. */
  gapCarryMarginPx: 10,
  /** Gap arcs must also rise enough to take a <= 2-row far-side step. */
  gapMinRisePx: 2 * TILE + 8,
  /** Wall arcs must clear the measured wall top by this much. */
  wallClearMarginPx: 12,
  /** Frames of pushing right with no advance before an unstick jump. */
  unstickAfterFrames: 30,
  /** Boss engagement distance (px): start bounce attempts inside this. */
  bossEngagePx: 96,
  /** Frames between deliberate boss-bounce jumps. */
  bossJumpCadence: 50,
  /** While the boss show is on, never advance past goalX minus this (px):
   *  the goal trigger is a plain x >= goalX check with no boss guard, so a
   *  bot that blindly holds right would "finish" mid-fight. */
  bossGoalCapPx: 3 * TILE,
  /** x must grow by more than this per frame to count as advancing. */
  advanceEps: 0.05,
  /** Longest tolerated streak of alive-but-not-advancing frames. */
  maxStallFrames: 150,
  /** Minimum average forward speed (px/frame) outside boss engagement.
   *  Deliberately ABSOLUTE, not cruise-scaled: it is a content-quality
   *  floor ("the route drags"), and the faster physics only makes it
   *  easier to clear. */
  minAvgSpeed: 1.2,
  /** Collectibles may sit at most this far left of the start (px). */
  startSlackPx: 32,
} as const;

// ---------------------------------------------------------------------------
// HOLD_LADDER — simulated jump arcs for hold lengths 1..wallHoldFrames,
// mirroring player.ts exactly (gravity before displacement, gravHold while
// rising with jump held, jump-CUT clamp on release). Pure function of PHYS:
// physics retunes re-derive the whole ladder at import time.
//   sprintCarryPx — horizontal travel of a full-sprint arc (runMax, with the
//                   run-jump bonus) from launch back to launch height,
//   sprintRisePx  — apex of that same arc,
//   standRisePx   — apex of a STANDSTILL arc (no bonus) — the conservative
//                   floor for wall jumps, which may launch at any speed.
// ---------------------------------------------------------------------------
interface HoldArc {
  hold: number;
  /** Airborne frames of the sprint arc (launch to touchdown at launch height). */
  airFrames: number;
  sprintCarryPx: number;
  sprintRisePx: number;
  standRisePx: number;
}

function simJumpArc(holdFrames: number, runBonus: boolean): { risePx: number; airFrames: number } {
  let vy = PHYS.jump + (runBonus ? PHYS.jumpRunBonus : 0);
  let y = 0;
  let rise = 0;
  for (let f = 1; f <= 400; f++) {
    const held = f <= holdFrames;
    if (!held && vy < -PHYS.jumpCut) vy = -PHYS.jumpCut;
    vy = Math.min(vy + (vy < 0 && held ? PHYS.gravHold : PHYS.grav), PHYS.maxFall);
    y += vy;
    if (-y > rise) rise = -y;
    if (y >= 0 && vy > 0) return { risePx: rise, airFrames: f };
  }
  return { risePx: rise, airFrames: 400 };
}

const HOLD_LADDER: readonly HoldArc[] = Array.from({ length: BOT.wallHoldFrames }, (_, i) => {
  const hold = i + 1;
  const sprint = simJumpArc(hold, true);
  const stand = simJumpArc(hold, false);
  return {
    hold,
    airFrames: sprint.airFrames,
    sprintCarryPx: sprint.airFrames * PHYS.runMax,
    sprintRisePx: sprint.risePx,
    standRisePx: stand.risePx,
  };
});

/** Expected cutscene after each world's castle act. */
const CASTLE_CUTSCENE: Record<WorldNo, CutsceneId> = {
  1: 'w1-end',
  2: 'w2-end',
  3: 'w3-end',
  4: 'ending',
};

const IDLE_INPUT: InputState = {
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

/** "px (x,y) tile (tx,ty)" — every violation names its position this way. */
function at(px: number, py: number): string {
  return `px (${Math.round(px)},${Math.round(py)}) tile (${Math.floor(px / TILE)},${Math.floor(py / TILE)})`;
}

// ---------------------------------------------------------------------------
// THE FLOW BOT.
//
// It ONLY holds right (sprinting for gap launches and boss chases — see the
// BOT header), and presses jump when:
//   (a) a solid wall sits 1-2 tiles ahead at body height — held just long
//       enough for the measured wall height (HOLD_LADDER),
//   (b) there is no ground within 2 tiles below-ahead (a gap lip) — held
//       just long enough for the measured gap width,
//   (c) it has been pushing right without advancing for > 30 frames (unstick
//       — a blind full hold).
// It is immortal: invulnT is pinned every frame, so contact damage does
// nothing. Lava and the void still KILL outright (kill() bypasses
// invulnerability); the checkpoint respawn brings the bot back and it keeps
// going — a mandatory route that repeatedly drops the bot into lava will fail
// on time or stall, which is the point. The bot NEVER presses down, so it
// never rides a warp: the mandatory route must work without warps.
//
// Boss acts: the ceremony trigger is x-based and the goal stands INSIDE the
// arena, so the bot refuses to cross goalX - bossGoalCapPx while the show is
// on. It chases the boss instead and periodically jumps when within
// bossEngagePx, landing crude stomps until the boss escapes (staged) or goes
// down (rage). Immortality carries it. CASTLE CEREMONY (2026-08): castle
// acts have NO flagpole — once the boss resolves, the trigger is the DOOR
// itself (goalX - 4px, level.ts def.boss branch) and the ceremony starts in
// its walk phase; the bot just keeps holding right to the doorstep. Non-boss
// acts trigger at poleX (goalX - 8 tiles) and ride the pole grab + walk.
//
// If an act's mandatory route needs anything smarter than this, the act is
// wrong, not the bot: cleverness is for optional collectibles, never the
// main path.
// ---------------------------------------------------------------------------
export interface FlowBotResult {
  /** Level.finished became true within the frame budget. */
  finished: boolean;
  /** Frames actually simulated. */
  frames: number;
  /** Deepest x (px) the bot reached. */
  maxX: number;
  /** Longest streak of alive, non-boss-engaged frames without x advancing. */
  stallFrames: number;
  /** Player x (px) where that longest stall streak happened. */
  stallX: number;
  /** Frames spent with the boss show on (phase 'intro' | 'fight') — excluded
   *  from the stall streak and from the average-speed denominator, because
   *  the fight freezes forward progress by engine design, not by content. */
  bossFrames: number;
  /** Player x (px) at frame 0, for average-speed math. */
  startX: number;
}

export function flowBot(
  level: Level,
  maxFrames: number = ACT_RULES.botFrames,
  /** Optional early-out (checked each frame AFTER the step) — used by the
   *  rule-9 pocket probes so 40 probes stay cheap. */
  stopWhen?: (level: Level) => boolean,
): FlowBotResult {
  const p = level.player;
  const map: TileMapLike = level.map;
  const startX = p.x;
  let maxX = p.x;
  let frames = 0;
  let stall = 0;
  let maxStall = 0;
  let stallX = p.x;
  let bossFrames = 0;
  let holdT = 0; // frames the current jump keeps being held
  let blockedT = 0; // consecutive grounded no-advance frames while pushing right
  let bossJumpT = 0; // cooldown between deliberate boss-bounce jumps
  let sprintAir = false; // run stays held through a gap-jump flight

  /** No standable support within 2 tiles below, `aheadPx` ahead of the face. */
  const noSupport = (aheadPx: number): boolean => {
    const feet = p.y + p.halfH;
    const ax = p.x + p.halfW + aheadPx;
    for (const dy of [4, TILE + 4, 2 * TILE + 4]) {
      const s = map.solidAtPx(ax, feet + dy);
      if (s === 'solid' || s === 'oneway') return false;
    }
    return true;
  };

  /** Wall-jump hold, two measurements:
   *  1. RISE — the blocking stack's top in the hit column and its right
   *     neighbor (2-wide pipes/walls read as one obstacle): smallest hold
   *     whose STANDSTILL rise clears it with margin (the no-bonus arc is the
   *     conservative floor; launches at speed rise more).
   *  2. LANDING — a wall hop at carried speed must come DOWN on something:
   *     project the landing point at the current speed and escalate the hold
   *     until the landing column offers a standable surface between the wall
   *     crest and 2 rows below the feet (w3a7's shortcut pipe taught this: a
   *     minimal hop over the pipe landed in the void beyond it; the sized-up
   *     hold clears pipe AND void in one measured leap, like a player would).
   *  Unmeasurable either way: the full blind hold (legacy behavior). */
  const wallHoldFor = (hitPx: number): number => {
    const hitCol = Math.floor(hitPx / TILE);
    const feet = p.y + p.halfH;
    const feetRow = Math.floor(feet / TILE);
    const bandTop = Math.floor((p.y - p.halfH + 2) / TILE);
    let needPx = 0;
    for (const wx of [hitCol, hitCol + 1]) {
      const cx = (wx + 0.5) * TILE;
      let top = -1;
      for (let ty = bandTop; ty <= feetRow; ty++) {
        if (map.solidAtPx(cx, (ty + 0.5) * TILE) === 'solid') {
          top = ty;
          break;
        }
      }
      if (top === -1) continue;
      while (top > 0 && map.solidAtPx(cx, (top - 0.5) * TILE) === 'solid') top--;
      needPx = Math.max(needPx, feet - top * TILE + BOT.wallClearMarginPx);
    }
    if (needPx <= 0) return BOT.wallHoldFrames;
    const base = HOLD_LADDER.findIndex((a) => a.standRisePx >= needPx);
    if (base === -1) return BOT.wallHoldFrames;
    // landing-aware escalation at the carried speed: the landing column must
    // offer a surface between "as high as this hold can rise" and 2 rows
    // below the feet (deeper is a drop the arc will survive elsewhere)
    const vxEst = Math.max(Math.abs(p.vx), 1);
    for (let i = base; i < HOLD_LADDER.length; i++) {
      const arc = HOLD_LADDER[i]!;
      const landTx = Math.floor((p.x + arc.airFrames * vxEst) / TILE);
      const highestRow = feetRow - Math.floor(arc.standRisePx / TILE);
      if (
        landTx >= map.wTiles ||
        columnSurfaces(map, landTx).some((s) => s.row >= highestRow && s.row <= feetRow + 2)
      ) {
        return arc.hold;
      }
    }
    return BOT.wallHoldFrames;
  };

  /** Gap-jump hold: measure the void's width (columns with no standable
   *  support within 2 tiles below the feet, starting at the column the gap
   *  probe fired on), then pick the smallest hold whose full-sprint carry
   *  reaches the far lip with foothold + margin — landing 1-3 tiles past
   *  the lip instead of overflying the landing runway into the next pit. */
  const gapHoldNow = (): number => {
    const feet = p.y + p.halfH;
    const firstCol = Math.floor((p.x + p.halfW + BOT.gapLookaheadPx) / TILE);
    let k = 1; // the probe column itself is void — that is what fired
    while (k < BOT.gapMeasureMaxTiles) {
      const cx = (firstCol + k + 0.5) * TILE;
      let support = false;
      for (const dy of [4, TILE + 4, 2 * TILE + 4]) {
        const s = map.solidAtPx(cx, feet + dy);
        if (s === 'solid' || s === 'oneway') {
          support = true;
          break;
        }
      }
      if (support) break;
      k++;
    }
    const needPx = (firstCol + k) * TILE + BOT.gapFootholdPx - p.x + BOT.gapCarryMarginPx;
    const pick = HOLD_LADDER.find(
      (a) =>
        a.hold <= BOT.gapMaxHoldFrames &&
        a.sprintCarryPx >= needPx &&
        a.sprintRisePx >= BOT.gapMinRisePx,
    );
    return pick ? pick.hold : BOT.gapMaxHoldFrames;
  };

  while (frames < maxFrames && !level.finished) {
    p.invulnT = 2; // immortal: cannot dodge, does not need to
    const boss = level.boss;
    const bossActive = boss !== null && (boss.phase === 'intro' || boss.phase === 'fight');
    const prevX = p.x;

    let left = false;
    let right = true;
    let press = false;
    let run = false;

    if (bossActive) {
      run = true;
      const cap = level.goalX - BOT.bossGoalCapPx;
      if (p.x > cap) {
        left = true;
        right = false;
      } else {
        right = boss.x > p.x + 6 && p.x < cap;
        left = boss.x < p.x - 6;
      }
      if (bossJumpT > 0) bossJumpT--;
      if (
        boss.phase === 'fight' &&
        Math.abs(boss.x - p.x) < BOT.bossEngagePx &&
        p.grounded &&
        !p.dead &&
        bossJumpT === 0
      ) {
        press = true;
        holdT = BOT.wallHoldFrames;
        bossJumpT = BOT.bossJumpCadence;
      }
    } else if (p.grounded && !p.dead) {
      sprintAir = false;
      // (a) wall 1-2 tiles ahead at body height — remember WHERE it hit so
      // the hold can be sized to the measured wall
      let wallAtPx = -1;
      for (const d of BOT.wallLookaheadPx) {
        const px = p.x + p.halfW + d;
        if (
          map.solidAtPx(px, p.y) === 'solid' ||
          map.solidAtPx(px, p.y - p.halfH + 2) === 'solid'
        ) {
          wallAtPx = px;
          break;
        }
      }
      // (b) gap: nothing standable within 2 tiles below-ahead
      const gapNow = noSupport(BOT.gapLookaheadPx);
      // sprint spin-up: see the lip early enough to hit it at full runMax
      run = gapNow || noSupport(BOT.gapLookaheadPx + BOT.sprintSpinupPx);
      // (c) unstick
      if (wallAtPx >= 0 || blockedT > BOT.unstickAfterFrames) {
        press = true;
        holdT = wallAtPx >= 0 ? wallHoldFor(wallAtPx) : BOT.wallHoldFrames;
        blockedT = 0;
      } else if (gapNow) {
        press = true;
        holdT = gapHoldNow();
        run = true;
        sprintAir = true;
      }
    } else if (sprintAir) {
      run = true; // carry the sprint through the gap-jump flight
    }

    const input: InputState = {
      left,
      right,
      up: false,
      down: false,
      jump: press || holdT > 0,
      jumpPressed: press,
      run,
      firePressed: false,
      pausePressed: false,
      swapPressed: false,
    };
    if (holdT > 0) holdT--;
    level.update(input);
    frames++;

    if (bossActive) bossFrames++;
    if (p.x > maxX) maxX = p.x;
    const advanced = p.x > prevX + BOT.advanceEps;
    if (!p.dead && !bossActive && !level.finished && !advanced) {
      stall++;
      if (stall > maxStall) {
        maxStall = stall;
        stallX = p.x;
      }
    } else {
      stall = 0;
    }
    if (!p.dead && p.grounded && right && !advanced) blockedT++;
    else blockedT = 0;

    if (stopWhen !== undefined && stopWhen(level)) break;
  }

  return {
    finished: level.finished,
    frames,
    maxX,
    stallFrames: maxStall,
    stallX,
    bossFrames,
    startX,
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
type Fail = (rule: string, msg: string) => never;

function passableAt(map: TileMapLike, tx: number, ty: number): boolean {
  const s = SOLIDITY[map.tileAt(tx, ty)];
  return s === 'pass' || s === 'oneway';
}

/** Warp mouths are 2 tiles wide; the link stores the SEAM center in px.
 *  Returns the two mouth columns and the mouth-top row. */
function mouthTiles(mx: number, my: number): { cols: [number, number]; row: number } {
  const seam = Math.round(mx / TILE);
  return { cols: [seam - 1, seam], row: Math.round(my / TILE) };
}

/** 4-connected flood fill of passable air from the start, TRAVERSING WARPS:
 *  marking a standing tile over a warp ENTRY mouth also seeds the standing
 *  tiles over its EXIT mouth (one-way, A->B — matching the ride). This is
 *  what makes a sealed underground bonus room count as reachable. */
function computeReached(built: BuiltLevel): Uint8Array {
  const map = built.map;
  const w = map.wTiles;
  const h = map.hTiles;
  const reached = new Uint8Array(w * h);
  const queue: number[] = [];

  // warp edges: entry standing tiles -> exit standing tiles
  const edges = new Map<number, number[]>();
  for (const wl of built.warps) {
    const exit = mouthTiles(wl.bx, wl.by);
    const seeds = exit.cols.map((tx) => (exit.row - 1) * w + tx);
    const entry = mouthTiles(wl.ax, wl.ay);
    for (const tx of entry.cols) {
      const idx = (entry.row - 1) * w + tx;
      edges.set(idx, [...(edges.get(idx) ?? []), ...seeds]);
    }
  }

  const push = (tx: number, ty: number): void => {
    if (tx < 0 || tx >= w || ty < 0 || ty >= h) return;
    const idx = ty * w + tx;
    if (reached[idx] === 1) return;
    if (!passableAt(map, tx, ty)) return;
    reached[idx] = 1;
    queue.push(idx);
    const warped = edges.get(idx);
    if (warped) {
      for (const e of warped) push(e % w, Math.floor(e / w));
    }
  };

  push(Math.floor(built.start.x / TILE), Math.floor(built.start.y / TILE));
  while (queue.length > 0) {
    const cur = queue.pop()!;
    const tx = cur % w;
    const ty = Math.floor(cur / w);
    push(tx + 1, ty);
    push(tx - 1, ty);
    push(tx, ty + 1);
    push(tx, ty - 1);
  }
  return reached;
}

/** Is there ANY standable spot within BACKTRACK_SLACK tiles right of fromTx?
 *  (Rule 4's ratchet test; rule 7 reuses it for warp exits.) */
function standableWithinSlack(map: TileMapLike, fromTx: number): boolean {
  const w = map.wTiles;
  const h = map.hTiles;
  const slackTiles = Math.floor(BACKTRACK_SLACK / TILE);
  const toTx = Math.min(w - 1, fromTx + slackTiles);
  for (let tx = Math.max(0, fromTx); tx <= toTx; tx++) {
    for (let ty = 0; ty < h - 1; ty++) {
      if (SOLIDITY[map.tileAt(tx, ty)] !== 'pass') continue;
      const below = SOLIDITY[map.tileAt(tx, ty + 1)];
      if (below === 'solid' || below === 'oneway') return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Recess scanning (rules 8 & 9). EXPORTED for world-author tooling: run
// findRecesses(built.map, built.start) while re-tuning an act to see every
// depression the contract will judge.
//
// THE LANE MODEL. The scan walks the MANDATORY RUNNING LANE's standable
// surface column by column, starting from the floor under the player start:
//   - a column's standable surfaces are the solid/oneway tiles with a
//     non-supporting tile above (spike above = you stand IN spikes; lava
//     above = landing there kills),
//   - the lane picks the TOPMOST surface that is at most 2 rows ABOVE the
//     previous lane row (the motif step rule) — overhead decoration (brick
//     galleries, goldbar perches, qblock rows) floats >= 3 rows up and is
//     ignored; descents of any depth are followed (you can always fall),
//   - a column whose only surfaces sit > 2 rows up takes the topmost anyway
//     (springboard walls — mandatory ascents),
//   - a column with no surface at all is a bottomless VOID (below the map is
//     open and falling out kills — see columnSurfaces), and a lava-topped
//     column is equally DEADLY.
//
// A RECESS is a maximal span of columns sitting >= 3 rows below BOTH of the
// standable columns immediately outside it (deadly columns qualify at any
// depth). Consequences of the immediate-shoulder definition, all deliberate:
//   - stepped terrain (<= 2-row hops) NEVER forms a recess — walkable
//     valleys and staircase exits are legal by construction,
//   - a safe flat run of >= terraceRun columns inside a span is the NEW lane
//     level, not a pit floor: the span closes there, opens to the right
//     (shoulderR null), and the scan re-anchors on the terrace — so a
//     descending route is measured against its own new level, not the
//     highest ground ever seen,
//   - spans that reach the map edge / a terrace count their depth from the
//     one shoulder they have (wide-open trenches on the route).
//
// Classification (per span):
//   'void'   — no restable floor at all: falls to death (bottomless carve or
//              lava across the bottom). The classical pit — always fine.
//   'hazard' — the deepest floor is spike-carpeted, or the span mixes floor
//              with deadly columns: falling in carries risk. Fine IF the
//              pocket is escapable (rule 9).
//   'safe'   — the deepest floor is plain standable and nothing in the span
//              kills: no risk. Deeper than 2 rows = rule 8 violation.
//
// KNOWN LIMITS (heuristic linter, not an oracle — rule 9's live probe is the
// ground truth for traps): sub-lane alcoves under intact lids (secret
// pockets, warp rooms) are not lane recesses; a crumble floor is treated as
// safe support; a standable ledge exactly 2 rows above a pit floor de-flags
// the span (it is an exit step).
// ---------------------------------------------------------------------------
const RECESS = {
  /** A span must sit at least this many rows below its shoulders. */
  minDepth: 3,
  /** Deepest a SAFE floor may sit below its shoulders (rule 8). */
  safeMaxDepth: 2,
  /** Max rows the lane steps UP between adjacent columns (motif rule). */
  maxLaneStepUp: 2,
  /** A safe flat this wide inside a span is a terrace (new lane level). */
  terraceRun: 6,
  /** Escape-probe budget: frames per pocket, pockets per act. */
  probeFrames: 900,
  probeCap: 40,
} as const;

type Rest = 'safe' | 'spike';

type LaneCol =
  | { kind: 'floor'; row: number; rest: Rest }
  | { kind: 'deadly' };

export interface Recess {
  /** Inclusive tile-column span of the depression. */
  x0: number;
  x1: number;
  kind: 'void' | 'hazard' | 'safe';
  /** Rows the deepest floor sits below the LOWER shoulder (Infinity: void). */
  depth: number;
  /** Deepest restable floor row, or null for a pure void/lava span. */
  floorRow: number | null;
  /** Lane row of the shoulder columns; shoulderR null = the span opens
   *  right (map edge or terrace re-anchor) and depth counts from the left. */
  shoulderL: number;
  shoulderR: number | null;
  /** Every restable floor column in the span (empty for pure void spans). */
  floorCols: { tx: number; row: number; rest: Rest }[];
}

/** Standable surfaces of one column, top to bottom. ENGINE TRUTH
 *  (tilemap.ts, re-verified after the void fix): below the map bottom is
 *  OPEN VOID ('empty') — a player falling past the bottom edge dies at
 *  y > pixelH + 32 (level.ts). A column with no surface at all is therefore
 *  a genuine bottomless drop. (History: OOB-below was once 'bedrock', which
 *  sealed every pit into a riskless shaft; if pits ever stop killing again,
 *  suspect that regression first.) */
function columnSurfaces(
  map: TileMapLike,
  tx: number,
): { row: number; rest: Rest | 'lava' }[] {
  const out: { row: number; rest: Rest | 'lava' }[] = [];
  for (let ty = 0; ty < map.hTiles; ty++) {
    const s = SOLIDITY[map.tileAt(tx, ty)];
    if (s !== 'solid' && s !== 'oneway') continue;
    const above = SOLIDITY[map.tileAt(tx, ty - 1)];
    if (above === 'solid' || above === 'oneway') continue;
    out.push({ row: ty, rest: above === 'spike' ? 'spike' : above === 'lava' ? 'lava' : 'safe' });
  }
  return out;
}

function laneScan(map: TileMapLike, start: SpawnPoint): (LaneCol | null)[] {
  const w = map.wTiles;
  const lane: (LaneCol | null)[] = new Array<LaneCol | null>(w).fill(null);
  const startTx = Math.min(w - 1, Math.max(0, Math.floor(start.x / TILE)));
  const startTy = Math.floor(start.y / TILE);
  let prevRow: number | null = null;
  for (let tx = startTx; tx < w; tx++) {
    const surfs = columnSurfaces(map, tx);
    let pick: { row: number; rest: Rest | 'lava' } | undefined;
    if (prevRow === null) {
      // anchor: the floor under the start spawn (topmost surface elsewhere)
      pick = (tx === startTx ? surfs.find((s) => s.row > startTy) : undefined) ?? surfs[0];
    } else {
      const minRow = prevRow - RECESS.maxLaneStepUp;
      pick = surfs.find((s) => s.row >= minRow) ?? surfs[0];
    }
    if (pick === undefined) {
      lane[tx] = { kind: 'deadly' }; // bottomless
      continue;
    }
    lane[tx] =
      pick.rest === 'lava'
        ? { kind: 'deadly' }
        : { kind: 'floor', row: pick.row, rest: pick.rest };
    prevRow = pick.row;
  }
  return lane;
}

/** Fallback anchor when no start is given: stand on the topmost surface of
 *  the leftmost standable column. */
function defaultAnchor(map: TileMapLike): SpawnPoint | null {
  for (let tx = 0; tx < map.wTiles; tx++) {
    const surfs = columnSurfaces(map, tx);
    const top = surfs[0];
    if (top !== undefined) {
      return { x: (tx + 0.5) * TILE, y: (top.row - 0.5) * TILE };
    }
  }
  return null;
}

export function findRecesses(map: TileMapLike, start?: SpawnPoint): Recess[] {
  const anchor = start ?? defaultAnchor(map);
  if (anchor === null) return [];
  const lane = laneScan(map, anchor);
  const w = map.wTiles;
  const startTx = Math.min(w - 1, Math.max(0, Math.floor(anchor.x / TILE)));
  const out: Recess[] = [];

  let tx = startTx + 1;
  while (tx < w) {
    const prev = lane[tx - 1];
    const cur = lane[tx];
    if (!prev || prev.kind !== 'floor' || !cur) {
      tx++;
      continue;
    }
    const L = prev.row;
    const opens = cur.kind === 'deadly' || cur.row >= L + RECESS.minDepth;
    if (!opens) {
      tx++;
      continue;
    }

    // Walk right for the shoulder that closes the span — or a terrace.
    let j = tx;
    let shoulderR: number | null = null;
    let terraceEnd: number | null = null;
    let runRow = -1;
    let runLen = 0;
    while (j < w) {
      const c = lane[j];
      if (!c) break;
      if (c.kind === 'floor' && c.row < L + RECESS.minDepth) {
        shoulderR = j;
        break;
      }
      if (c.kind === 'floor' && c.rest === 'safe') {
        if (c.row === runRow) runLen++;
        else {
          runRow = c.row;
          runLen = 1;
        }
        if (runLen >= RECESS.terraceRun) {
          terraceEnd = j;
          break;
        }
      } else {
        runRow = -1;
        runLen = 0;
      }
      j++;
    }
    const b = shoulderR !== null ? shoulderR - 1 : terraceEnd !== null ? terraceEnd : j - 1;
    const rCol = shoulderR !== null ? lane[shoulderR] : null;
    const R = rCol !== null && rCol !== undefined && rCol.kind === 'floor' ? rCol.row : null;

    // Every column must also sit >= minDepth below the RIGHT shoulder.
    let ok = b >= tx;
    if (ok && R !== null) {
      for (let k = tx; k <= b; k++) {
        const c = lane[k];
        if (c && c.kind === 'floor' && c.row < R + RECESS.minDepth) {
          ok = false;
          break;
        }
      }
    }
    if (!ok) {
      tx++; // inner candidates (sub-basins) get their own turn
      continue;
    }

    const floorCols: { tx: number; row: number; rest: Rest }[] = [];
    let hasDeadly = false;
    for (let k = tx; k <= b; k++) {
      const c = lane[k];
      if (!c || c.kind === 'deadly') hasDeadly = true;
      else floorCols.push({ tx: k, row: c.row, rest: c.rest });
    }
    const shoulderRef = R === null ? L : Math.max(L, R);
    let kind: Recess['kind'];
    let depth: number;
    let floorRow: number | null;
    if (floorCols.length === 0) {
      kind = 'void';
      depth = Infinity;
      floorRow = null;
    } else {
      floorRow = Math.max(...floorCols.map((f) => f.row));
      depth = floorRow - shoulderRef;
      const deepSafe = floorCols.some((f) => f.row === floorRow && f.rest === 'safe');
      kind = hasDeadly ? 'hazard' : deepSafe ? 'safe' : 'hazard';
    }
    out.push({ x0: tx, x1: b, kind, depth, floorRow, shoulderL: L, shoulderR: R, floorCols });
    tx = shoulderR !== null ? shoulderR : b + 1;
  }
  return out;
}

/** Where a body resting on (tx, floorRow) has its air: the first passable
 *  tile straight up (skipping spike rows). Reached = the pocket is on the
 *  playable map. A solid before any air = entombed, not playable. */
function standingTileReached(
  map: TileMapLike,
  reached: Uint8Array,
  tx: number,
  floorRow: number,
): boolean {
  const w = map.wTiles;
  for (let ty = floorRow - 1; ty >= 0; ty--) {
    const s = SOLIDITY[map.tileAt(tx, ty)];
    if (s === 'pass' || s === 'oneway') return reached[ty * w + tx] === 1;
    if (s === 'solid') return false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// checkAct
//
// `prevInWorld` feeds rule 13's cross-act clauses (roster diff vs the act's
// immediate predecessor, same world, act - 1):
//   - omitted   -> campaign acts (LEVELS members) resolve it automatically;
//                  fixture defs get none,
//   - null      -> explicitly no predecessor,
//   - a LevelDef -> use it (richness fixtures pair acts this way).
// ---------------------------------------------------------------------------
export function checkAct(def: LevelDef, prevInWorld?: LevelDef | null): void {
  const fail = (rule: string, msg: string): never => {
    throw new Error(`${def.id}: ${rule}: ${msg}`);
  };

  // -- rule 0: build determinism -------------------------------------------
  // LevelDef.build must be a pure function of the builder — two runs must
  // produce the same map dimensions and spawn counts. A mismatch means build
  // reads/writes module state, which would desync the static checks below
  // from the Levels the bot and the idle rule construct.
  const built = buildLevel(def);
  const second = buildLevel(def);
  const detPairs: [string, number, number][] = [
    ['map wTiles', built.map.wTiles, second.map.wTiles],
    ['map hTiles', built.map.hTiles, second.map.hTiles],
    ['enemy count', built.enemies.length, second.enemies.length],
    ['coin count', built.coins.length, second.coins.length],
    ['goldbar count', built.goldbars.length, second.goldbars.length],
    ['secret count', built.secrets.length, second.secrets.length],
    ['spring count', built.springs.length, second.springs.length],
    ['checkpoint count', built.checkpoints.length, second.checkpoints.length],
    ['warp count', built.warps.length, second.warps.length],
    ['qblock count', built.blockContents.size, second.blockContents.size],
    ['start x', built.start.x, second.start.x],
    ['start y', built.start.y, second.start.y],
    ['goal x', built.goalX, second.goalX],
    ['goal row', built.goalRow, second.goalRow],
  ];
  for (const [what, x, y] of detPairs) {
    if (x !== y) {
      fail(
        'build determinism',
        `${what} differs between two builds (${x} vs ${y}) — build() must be deterministic and must not touch module state`,
      );
    }
  }

  checkStructure(def, built, fail);
  checkNothingBuried(built, fail);
  checkWarpSanity(built, fail); // rule 7, static half — the fill trusts mouths
  const reached = computeReached(built);
  checkReachability(built, reached, fail);
  checkWarpEntriesReached(built, reached, fail); // rule 7, fill half
  checkForwardReachable(built, fail);
  checkFlowBot(def, fail);
  checkIdleSilence(def, fail);
  checkGapsCarryRisk(built, fail);
  checkNoTraps(def, built, reached, fail);
  checkHazardsAnchored(built, fail);
  // Rules 11-14 (richness) gate CAMPAIGN acts here; standalone/fixture defs
  // exercise them via checkActRichness — see the RICHNESS SCOPE header note.
  if (LEVELS.includes(def)) {
    runRichnessRules(def, built, reached, resolvePrevInWorld(def, prevInWorld), fail);
  }
}

// -- rule 1: STRUCTURE ------------------------------------------------------
function checkStructure(def: LevelDef, built: BuiltLevel, fail: Fail): void {
  const R = 'rule 1 (structure)';

  if (def.id !== `w${def.world}a${def.act}`) {
    fail(R, `id '${def.id}' does not match world ${def.world} act ${def.act}`);
  }

  if (built.goldbars.length !== ACT_RULES.goldbars) {
    fail(R, `expected exactly ${ACT_RULES.goldbars} goldbars, found ${built.goldbars.length}`);
  }
  for (let i = 0; i < ACT_RULES.goldbars; i++) {
    if (!built.goldbars.some((g) => g.index === i)) fail(R, `goldbar index ${i} is missing`);
  }

  if (built.secrets.length !== ACT_RULES.secrets) {
    fail(R, `expected exactly ${ACT_RULES.secrets} secrets, found ${built.secrets.length}`);
  }
  for (let i = 0; i < ACT_RULES.secrets; i++) {
    if (!built.secrets.some((s) => s.index === i)) fail(R, `secret index ${i} is missing`);
  }

  if (built.checkpoints.length < ACT_RULES.minCheckpoints) {
    fail(
      R,
      `expected >= ${ACT_RULES.minCheckpoints} checkpoint(s), found ${built.checkpoints.length}`,
    );
  }

  let qblockCoins = 0;
  for (const contents of built.blockContents.values()) {
    if (contents === 'coin') qblockCoins++;
  }
  const coins = built.coins.length + qblockCoins;
  if (coins < ACT_RULES.minCoins) {
    fail(
      R,
      `expected >= ${ACT_RULES.minCoins} coins, found ${coins} (${built.coins.length} coin entities + ${qblockCoins} coin qblocks)`,
    );
  }

  if (built.enemies.length < ACT_RULES.minEnemies) {
    fail(R, `expected >= ${ACT_RULES.minEnemies} enemies, found ${built.enemies.length}`);
  }

  if (def.boss) {
    if (built.arena === null) fail(R, `boss act laid no arena()`);
    if (built.goalX < built.arena.x0 || built.goalX > built.arena.x1) {
      fail(
        R,
        `boss act goal at x=${built.goalX}px sits outside the arena ${built.arena.x0}..${built.arena.x1}px`,
      );
    }
  } else if (built.arena !== null) {
    fail(R, `arena laid at ${built.arena.x0}..${built.arena.x1}px but def.boss is not set`);
  }

  const isCastle = CASTLES[def.world] === def.id;
  if (isCastle) {
    if (!def.boss) fail(R, `castle act must set boss: true`);
    const want = CASTLE_CUTSCENE[def.world];
    if (def.cutsceneAfter !== want) {
      fail(
        R,
        `castle act must set cutsceneAfter: '${want}', found ${def.cutsceneAfter === undefined ? 'none' : `'${def.cutsceneAfter}'`}`,
      );
    }
    if (def.world === 4 && def.bossRage !== true) {
      fail(R, `the world 4 castle is the real fight — it must set bossRage: true`);
    }
    if (def.world !== 4 && def.bossRage) {
      fail(R, `bossRage on a staged fight (only the world 4 castle rages)`);
    }
  } else {
    if (def.cutsceneAfter !== undefined) {
      fail(R, `cutsceneAfter '${def.cutsceneAfter}' on a non-castle act`);
    }
    if (def.boss) fail(R, `boss: true on a non-castle act`);
    if (def.bossRage) fail(R, `bossRage: true on a non-castle act`);
  }
}

// -- rule 2: NOTHING BURIED -------------------------------------------------
function checkNothingBuried(built: BuiltLevel, fail: Fail): void {
  const R = 'rule 2 (nothing buried)';
  const map = built.map;

  const assertEmpty = (what: string, px: number, py: number): void => {
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    const k = map.tileAt(tx, ty);
    if (k !== 'empty') {
      fail(R, `${what} at ${at(px, py)} has center tile '${k}' — it is buried, not playable`);
    }
  };

  for (const e of built.enemies) {
    if (e.kind === 'lawyer') {
      // Lawyers spawn hidden at the pipe-mouth seam (their center tile is the
      // pipe itself, by contract) — instead the tiles they RISE INTO, directly
      // above the mouth across their width, must be empty.
      const ty = Math.floor(e.y / TILE);
      for (const px of [e.x - 7, e.x + 7]) {
        const tx = Math.floor(px / TILE);
        const k = map.tileAt(tx, ty - 1);
        if (k !== 'empty') {
          fail(
            R,
            `lawyer at ${at(e.x, e.y)} cannot rise: tile (${tx},${ty - 1}) above the pipe mouth is '${k}'`,
          );
        }
      }
    } else {
      assertEmpty(`enemy '${e.kind}'`, e.x, e.y);
    }
  }
  for (const c of built.coins) assertEmpty('coin', c.x, c.y);
  for (const g of built.goldbars) assertEmpty(`goldbar ${g.index}`, g.x, g.y);
  for (const s of built.secrets) assertEmpty(`secret ${s.index}`, s.x, s.y);
  for (const s of built.springs) assertEmpty('spring', s.x, s.y);
  for (const c of built.checkpoints) assertEmpty('checkpoint', c.x, c.y);

  // Powerup spawns happen at play time: a bumped qblock releases its powerup
  // one tile ABOVE itself. That tile must be empty or the powerup is born
  // inside solid.
  for (const [key, contents] of built.blockContents) {
    if (contents === 'coin') continue; // coins score instantly, no entity spawns
    const comma = key.indexOf(',');
    const tx = Number(key.slice(0, comma));
    const ty = Number(key.slice(comma + 1));
    const above = map.tileAt(tx, ty - 1);
    if (above !== 'empty') {
      fail(
        R,
        `qblock '${contents}' at tile (${tx},${ty}) has tile '${above}' above it — its powerup would emerge inside solid`,
      );
    }
  }
}

// -- rule 7: WARP SANITY (static half; executes before the fill) ------------
// The warp ride is scripted: it stuffs the player into the entry mouth and
// pops them out of the exit mouth with no collision checks of its own. So
// the contract must prove the geometry: both pipes intact (later tile work
// can overwrite them), 2 clear rows over each mouth (a big player is 26px),
// and forward progress past the exit (the ratchet jumps WITH the warp — an
// exit with nothing standable beyond it strands the run).
function checkWarpSanity(built: BuiltLevel, fail: Fail): void {
  const R = 'rule 7 (warp sanity)';
  const map = built.map;
  built.warps.forEach((wl, i) => {
    const ends = [
      ['entry', wl.ax, wl.ay],
      ['exit', wl.bx, wl.by],
    ] as const;
    for (const [end, mx, my] of ends) {
      const m = mouthTiles(mx, my);
      for (const tx of m.cols) {
        const k = map.tileAt(tx, m.row);
        if (k !== 'pipe') {
          fail(
            R,
            `warp ${i} ${end} mouth tile (${tx},${m.row}) is '${k}', not 'pipe' — later tile work overwrote the pipe`,
          );
        }
        for (const ty of [m.row - 1, m.row - 2]) {
          const above = map.tileAt(tx, ty);
          if (SOLIDITY[above] !== 'pass') {
            fail(
              R,
              `warp ${i} ${end} mouth at column ${tx} has '${above}' at row ${ty} — the player needs 2 clear rows over the mouth to ${end === 'entry' ? 'stand on it and sink in' : 'rise out of it'}`,
            );
          }
        }
      }
      if (end === 'exit' && !standableWithinSlack(map, m.cols[1] + 1)) {
        fail(
          R,
          `warp ${i} exit at columns ${m.cols[0]}..${m.cols[1]} has nothing standable within ${BACKTRACK_SLACK}px beyond it — the ratchet jumps with the warp and the run is stranded on the pipe`,
        );
      }
    }
  });
}

// -- rule 7: WARP SANITY (fill half; executes after rule 3) -----------------
function checkWarpEntriesReached(built: BuiltLevel, reached: Uint8Array, fail: Fail): void {
  const R = 'rule 7 (warp sanity)';
  const w = built.map.wTiles;
  built.warps.forEach((wl, i) => {
    const m = mouthTiles(wl.ax, wl.ay);
    const standing = m.cols.some((tx) => reached[(m.row - 1) * w + tx] === 1);
    if (!standing) {
      fail(
        R,
        `warp ${i} entry standing tiles (${m.cols[0]},${m.row - 1})/(${m.cols[1]},${m.row - 1}) are not reachable from the start — a warp nobody can ride is dead content`,
      );
    }
  });
}

// -- rule 3: REACHABILITY ---------------------------------------------------
// A 4-connected flood fill from the start tile through 'pass'/'oneway'
// solidity, traversing warps one-way (see computeReached).
//
// LOUD CAVEAT — READ BEFORE TRUSTING THIS RULE: the fill ignores GRAVITY and
// DIRECTION completely. It proves a target is NOT ENTOMBED in tile work, and
// NOTHING more. It will happily bless a "route" that requires falling upward,
// hovering, or walking back through the ratchet. The house shipped a
// fake-route disaster through exactly this hole once; rules 4 and 5 exist
// because this fill cannot catch that class of bug. Do not "improve" content
// to satisfy only this rule.
function checkReachability(built: BuiltLevel, reached: Uint8Array, fail: Fail): void {
  const R = 'rule 3 (reachability)';
  const map = built.map;
  const w = map.wTiles;
  const h = map.hTiles;

  const startTx = Math.floor(built.start.x / TILE);
  const startTy = Math.floor(built.start.y / TILE);
  if (!passableAt(map, startTx, startTy)) {
    fail(R, `the start itself at ${at(built.start.x, built.start.y)} is inside solid`);
  }

  const isReached = (px: number, py: number): boolean => {
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    if (tx < 0 || tx >= w || ty < 0 || ty >= h) return false;
    return reached[ty * w + tx] === 1;
  };

  // The goal fires on a plain x >= goalX check at any height, so the honest
  // target is the goal COLUMN, not one tile.
  const goalTx = Math.floor(built.goalX / TILE);
  let goalColumnReached = false;
  for (let ty = 0; ty < h; ty++) {
    if (reached[ty * w + goalTx] === 1) {
      goalColumnReached = true;
      break;
    }
  }
  if (!goalColumnReached) {
    fail(R, `goal column ${goalTx} (x=${Math.round(built.goalX)}px) is not reachable from the start`);
  }

  for (const g of built.goldbars) {
    if (!isReached(g.x, g.y)) fail(R, `goldbar ${g.index} at ${at(g.x, g.y)} is not reachable from the start`);
  }
  for (const s of built.secrets) {
    if (!isReached(s.x, s.y)) fail(R, `secret ${s.index} at ${at(s.x, s.y)} is not reachable from the start`);
  }
  for (const c of built.checkpoints) {
    if (!isReached(c.x, c.y)) fail(R, `checkpoint at ${at(c.x, c.y)} is not reachable from the start`);
  }
}

// -- rule 4: FORWARD-REACHABLE ---------------------------------------------
// The world closes BACKTRACK_SLACK px (35 tiles) behind the furthest advance.
// Practical enforcement: every goldbar/secret/checkpoint must (a) not start
// behind the ratchet (>= start.x - 32px) and (b) have at least one standable
// tile within BACKTRACK_SLACK to its right — a treasure with nowhere to stand
// goal-ward of it is dead content the moment the route passes.
function checkForwardReachable(built: BuiltLevel, fail: Fail): void {
  const R = 'rule 4 (forward-reachable)';
  const map = built.map;

  const check = (what: string, px: number, py: number): void => {
    if (px < built.start.x - BOT.startSlackPx) {
      fail(
        R,
        `${what} at ${at(px, py)} sits ${Math.round(built.start.x - px)}px left of the start — behind the ratchet from frame one`,
      );
    }
    if (!standableWithinSlack(map, Math.floor(px / TILE))) {
      fail(
        R,
        `${what} at ${at(px, py)} has no standable tile within ${BACKTRACK_SLACK}px to its right — the ratchet strands it`,
      );
    }
  };

  for (const g of built.goldbars) check(`goldbar ${g.index}`, g.x, g.y);
  for (const s of built.secrets) check(`secret ${s.index}`, s.x, s.y);
  for (const c of built.checkpoints) check('checkpoint', c.x, c.y);
}

// -- rule 5: FLOW BOT -------------------------------------------------------
function checkFlowBot(def: LevelDef, fail: Fail): void {
  const R = 'rule 5 (flow bot)';
  const level = new Level(def);
  const bot = flowBot(level, ACT_RULES.botFrames);

  if (!bot.finished) {
    const bossNote =
      level.boss !== null ? `; boss phase '${level.boss.phase}', hp ${level.boss.hp}` : '';
    fail(
      R,
      `did not finish within ${ACT_RULES.botFrames} frames — deepest advance x=${Math.round(bot.maxX)}px (tile ${Math.floor(bot.maxX / TILE)}) of goal x=${Math.round(level.goalX)}px${bossNote}`,
    );
  }
  if (def.boss) {
    const boss = level.boss;
    if (boss === null) fail(R, `boss act built a Level with no boss`);
    const want = def.bossRage ? 'defeated' : 'escape';
    if (boss.phase !== want) {
      fail(
        R,
        `act finished but the boss ended in phase '${boss.phase}' (hp ${boss.hp}), expected '${want}' — the goal leaked past the show`,
      );
    }
  }
  if (bot.stallFrames > BOT.maxStallFrames) {
    fail(
      R,
      `stalled ${bot.stallFrames} consecutive frames (max ${BOT.maxStallFrames}) around x=${Math.round(bot.stallX)}px (tile ${Math.floor(bot.stallX / TILE)})`,
    );
  }
  const speedFrames = Math.max(1, bot.frames - bot.bossFrames);
  const avg = (bot.maxX - bot.startX) / speedFrames;
  if (avg <= BOT.minAvgSpeed) {
    fail(
      R,
      `average speed ${avg.toFixed(2)} px/frame (need > ${BOT.minAvgSpeed}) over ${speedFrames} non-boss frames — the route drags`,
    );
  }
}

// -- rule 6: IDLE SILENCE ---------------------------------------------------
// The single most load-bearing rule: a fresh level with an untouched player
// must emit ZERO events for ACT_RULES.idleFrames frames. The usual culprit is
// a clocked hazard (gavel, patrolling walker with a clear path) near the
// start.
function checkIdleSilence(def: LevelDef, fail: Fail): void {
  const R = 'rule 6 (idle silence)';
  const level = new Level(def);
  for (let f = 0; f < ACT_RULES.idleFrames; f++) {
    const evs = level.update(IDLE_INPUT);
    if (evs.length > 0) {
      const ev = evs[0]!;
      const src: SpawnPoint | undefined = level.eventSources.get(ev);
      const where = src ? ` from ${at(src.x, src.y)}` : '';
      fail(
        R,
        `event '${ev}' at idle frame ${f}${where} — an untouched level must be silent for ${ACT_RULES.idleFrames} frames`,
      );
    }
  }
}

// -- rule 8: GAPS CARRY RISK ------------------------------------------------
// Playtest: "most of jump on top of a hole make us just fall without any
// risk, it's better with real hole where we can die if we don't jump
// correctly and more classical." A sheer safe-floored depression is dead air:
// falling in costs nothing, climbing out is a chore. Every hole on the lane
// must be void, hazard-floored, or shallow enough to hop out of (<= 2 rows).
function checkGapsCarryRisk(built: BuiltLevel, fail: Fail): void {
  const R = 'rule 8 (gaps carry risk)';
  for (const r of findRecesses(built.map, built.start)) {
    if (r.kind !== 'safe' || r.depth <= RECESS.safeMaxDepth) continue;
    const shoulders =
      r.shoulderR === null
        ? `its left shoulder at row ${r.shoulderL} (the span opens right)`
        : `its shoulders at rows ${r.shoulderL}/${r.shoulderR}`;
    fail(
      R,
      `safe-floored recess at columns ${r.x0}..${r.x1} (floor row ${r.floorRow}, ${r.depth} rows below ${shoulders}) — falling in risks nothing: open it to the void, carpet it with spikes/lava, or raise the floor to <= ${RECESS.safeMaxDepth} rows deep`,
    );
  }
}

// -- rule 9: NO TRAPS -------------------------------------------------------
// Playtest: the player fell into a floored pit and was stuck — the exit wall
// too high, qblocks overhanging the jump arc. Every REACHABLE floored recess
// gets a live probe: a fresh Level, the player teleported onto the pocket
// floor (deepest column nearest the span center), the flow-bot policy for up
// to probeFrames. It must exit the span to the RIGHT — the ratchet may
// legally wall the left. Counted as escapes: crossing the right edge,
// finishing the act (pockets past the goal), and DYING inside the pocket
// (death respawns the run at a checkpoint — only riskless pockets can truly
// trap, and rule 8 already killed those). Pockets holding a warp ENTRY mouth
// are exempt: the warp is the sanctioned exit. Spans open to the right have
// no wall to be trapped by and are skipped.
function checkNoTraps(
  def: LevelDef,
  built: BuiltLevel,
  reached: Uint8Array,
  fail: Fail,
): void {
  const R = 'rule 9 (no traps)';

  const probes: { r: Recess; tx: number; row: number }[] = [];
  for (const r of findRecesses(built.map, built.start)) {
    if (r.floorCols.length === 0 || r.shoulderR === null || r.floorRow === null) continue;
    const warpExit = built.warps.some((wl) => {
      const m = mouthTiles(wl.ax, wl.ay);
      return m.cols[0] <= r.x1 && m.cols[1] >= r.x0;
    });
    if (warpExit) continue;
    const floorRow = r.floorRow;
    const deepest = r.floorCols.filter((f) => f.row === floorRow);
    const mid = (r.x0 + r.x1) / 2;
    deepest.sort((a, b) => Math.abs(a.tx - mid) - Math.abs(b.tx - mid));
    const spot = deepest[0];
    if (spot === undefined) continue;
    if (!standingTileReached(built.map, reached, spot.tx, spot.row)) continue;
    probes.push({ r, tx: spot.tx, row: spot.row });
  }

  if (probes.length > RECESS.probeCap) {
    console.warn(
      `${def.id}: rule 9 probing ${RECESS.probeCap} of ${probes.length} floored pockets (cap hit — consider fewer pockets per act)`,
    );
  }

  for (const { r, tx, row } of probes.slice(0, RECESS.probeCap)) {
    const level = new Level(def);
    const p = level.player;
    p.x = (tx + 0.5) * TILE;
    p.y = row * TILE - p.halfH; // feet exactly on the pocket floor
    p.vx = 0;
    p.vy = 0;
    p.grounded = true;
    const exitPx = (r.x1 + 1) * TILE;
    const bot = flowBot(
      level,
      RECESS.probeFrames,
      (lv) => lv.player.x >= exitPx || lv.player.dead,
    );
    const escaped = bot.maxX >= exitPx || level.finished || level.player.dead;
    if (!escaped) {
      fail(
        R,
        `floored ${r.kind} recess at columns ${r.x0}..${r.x1} (floor row ${r.floorRow}) is a trap: dropped at column ${tx}, the flow-bot policy could not exit right past column ${r.x1} within ${RECESS.probeFrames} frames (deepest x=${Math.round(bot.maxX)}px, tile ${Math.floor(bot.maxX / TILE)}) — lower the exit wall, clear the blocks over the exit arc, step the exit in <= 2-row hops, or warp it out`,
      );
    }
  }
}

// -- rule 10: HAZARDS ANCHORED -----------------------------------------------
// Playtest (2026-08): traps "seem just floating in air... really not fun and
// highly predictable". A hazard is landscape, not weather — it must visibly
// grow out of something solid.
//
//   SPIKES (per tile): every 'spike' tile needs a solid-ish neighbor —
//     a solid tile directly BELOW (floor spikes growing from their pit
//     floor), directly ABOVE (ceiling spikes in duck-under corridors), or
//     LATERALLY adjacent (wall spikes). Solid-ish kinds: ground / bedrock /
//     brick / pipe / usedblock / crumble.
//
//   LAVA (per pool): lava behaves as a liquid body, so anchoring is judged
//     on the whole 4-connected component, not tile by tile (the interior of
//     a wide moat only ever touches its own lava). A pool is anchored if ANY
//     of its tiles has a solid-ish tile directly below or laterally beside
//     (a moat cupped by its banks), OR if the pool reaches the map's bottom
//     row (the classical pool sealing a bottomless pit). A pool touching
//     neither is a floating lava blob and fails.
//
// Out-of-bounds behavior this rule leans on (tilemap.ts): side OOB is
// 'bedrock' (map-edge hazards are anchored by the world wall), below-bottom
// OOB is 'empty' — which is exactly why bottom-row pools need their explicit
// exemption.
const ANCHOR_KINDS: ReadonlySet<TileKind> = new Set<TileKind>([
  'ground',
  'bedrock',
  'brick',
  'pipe',
  'usedblock',
  'crumble',
]);

function checkHazardsAnchored(built: BuiltLevel, fail: Fail): void {
  const R = 'rule 10 (hazards anchored)';
  const map = built.map;
  const w = map.wTiles;
  const h = map.hTiles;

  const solidish = (tx: number, ty: number): boolean => ANCHOR_KINDS.has(map.tileAt(tx, ty));

  // -- spikes: every tile anchors itself -------------------------------------
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      if (map.tileAt(tx, ty) !== 'spike') continue;
      const anchored =
        solidish(tx, ty + 1) || // floor spikes
        solidish(tx, ty - 1) || // ceiling spikes
        solidish(tx - 1, ty) || // wall spikes
        solidish(tx + 1, ty);
      if (!anchored) {
        fail(
          R,
          `spike at ${at((tx + 0.5) * TILE, (ty + 0.5) * TILE)} floats with no solid neighbor (below/above/beside) — spikes must grow out of the landscape`,
        );
      }
    }
  }

  // -- lava: every pool anchors itself ----------------------------------------
  const seen = new Uint8Array(w * h);
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      if (map.tileAt(tx, ty) !== 'lava' || seen[ty * w + tx] === 1) continue;
      // flood the pool
      const pool: number[] = [];
      const stack = [ty * w + tx];
      seen[ty * w + tx] = 1;
      let anchored = false;
      while (stack.length > 0) {
        const cur = stack.pop()!;
        pool.push(cur);
        const cx = cur % w;
        const cy = Math.floor(cur / w);
        if (cy === h - 1) anchored = true; // bottom-row pool seals a void pit
        if (solidish(cx, cy + 1) || solidish(cx - 1, cy) || solidish(cx + 1, cy)) {
          anchored = true;
        }
        for (const [nx, ny] of [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ] as const) {
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const idx = ny * w + nx;
          if (seen[idx] === 1 || map.tileAt(nx, ny) !== 'lava') continue;
          seen[idx] = 1;
          stack.push(idx);
        }
      }
      if (!anchored) {
        fail(
          R,
          `lava pool of ${pool.length} tile(s) starting at ${at((tx + 0.5) * TILE, (ty + 0.5) * TILE)} floats: no tile of the pool touches solid below or beside, and it never reaches the bottom row — lava needs banks or a pit to sit in`,
        );
      }
    }
  }
}

// ============================================================================
// RULES 11-14 — THE RICHNESS RULES (playtest 2026-08, verbatim indictment:
// "lvl are little and really not vary in terme of gameplay purposed, always
// same ennemies, just necessite basic jump on going go straight... no
// significant relief, no alternative path").
//
// These are permanent machine-checked design rules, not a one-off audit.
// MOST acts authored before the indictment are EXPECTED to fail 11/12 (and
// 14): those failure lists are the work order for the 4-agent world-rebuild
// wave — fix the content, never the thresholds (design rule 7).
//
// World-agent tooling: auditRichness(def) returns every measurement these
// rules judge (lane range/steps, dual-lane % and best run, kind roster, best
// pole grab) plus the violation list — run it while sculpting an act.
// ============================================================================
export const RICHNESS = {
  /** Rule 11: the mandatory lane's standable rows must span at least this
   *  vertical range somewhere across the act (rows, max - min). */
  reliefMinRangeRows: 8,
  /** Rule 11: a lane height change counts as a step from this many rows. */
  reliefStepRows: 2,
  /** Rule 11: minimum number of such steps across the act. */
  reliefMinSteps: 6,
  /** Rule 11: a lane row only counts (for range AND steps) while it PERSISTS
   *  this many columns — 1-column dips (secret-pocket entrance slots, vault
   *  wells) are slots, not relief, and must not buy the rule off. */
  reliefTreadCols: 2,
  /** Rule 12: fraction of route columns that must offer dual lanes. */
  dualMinFrac: 0.18,
  /** Rule 12: vertical separation (rows) that makes two lanes DISJOINT. */
  dualMinSeparationRows: 4,
  /** Rule 12: at least one contiguous dual-lane run must be this long. */
  dualMinRunCols: 12,
  /** Rule 13: distinct enemy kinds per act. */
  minEnemyKinds: 3,
  /** Rule 14: the launch structure must stand within this many tiles LEFT
   *  of the flagpole (past the pole the ceremony has already triggered). */
  poleLaunchRadiusTiles: 8,
} as const;

/** Rule 14's jump arc: the run-jump BALLISTIC apex — the jump impulse plus
 *  run bonus under plain gravity, simulated in player.ts frame order.
 *  Deliberately NOT the float-stretched full-hold apex (~8-9.5 rows): the
 *  ceremony grabs on the FIRST poleX crossing, so converting the full-hold
 *  apex into grab height means launching ~10 tiles out at sprint and
 *  crossing the pole plane frame-perfectly at apex — stunt play, not the
 *  dependable arc the rule prices the pole against. ~3.7 rows at the
 *  current tune; re-derived from PHYS at import time. */
export const FULL_JUMP_APEX_PX = (() => {
  let vy = PHYS.jump + PHYS.jumpRunBonus;
  let rise = 0;
  for (let f = 0; f < 400; f++) {
    vy += PHYS.grav;
    if (vy >= 0) break;
    rise += -vy;
  }
  return rise;
})();

/** First column of the act's finale zone — from here rightward is ceremony
 *  runway (non-boss: the flagpole, GOAL.poleOffsetTiles before the door;
 *  boss: the arena) and exempt from rules 11/12. */
function finaleBoundaryCol(def: LevelDef, built: BuiltLevel): number {
  if (def.boss && built.arena !== null) return Math.floor(built.arena.x0 / TILE);
  return Math.floor((built.goalX - GOAL.poleOffsetTiles * TILE) / TILE);
}

/** The rules-11/12 measurement zone: start column to the finale boundary. */
function richnessZone(def: LevelDef, built: BuiltLevel): { x0: number; x1: number } {
  const startTx = Math.min(
    built.map.wTiles - 1,
    Math.max(0, Math.floor(built.start.x / TILE)),
  );
  return { x0: startTx, x1: Math.max(startTx, finaleBoundaryCol(def, built)) - 1 };
}

// -- rule 11: RELIEF ----------------------------------------------------------
export interface ReliefMeasure {
  /** Inclusive column zone measured (start column .. finale boundary - 1). */
  zone: { x0: number; x1: number };
  /** Vertical span of the lane's standable rows (max row - min row). */
  rangeRows: number;
  /** Highest lane point (smallest row — rows grow downward). */
  high: { row: number; col: number };
  /** Lowest lane point. */
  low: { row: number; col: number };
  /** Lane height changes of >= reliefStepRows between consecutive lane
   *  TREADS (runs persisting >= reliefTreadCols columns; voids between the
   *  treads are skipped — a step across a gap counts, a 1-column pocket
   *  slot does not). */
  steps: number;
}

function measureRelief(def: LevelDef, built: BuiltLevel): ReliefMeasure {
  const lane = laneScan(built.map, built.start);
  const zone = richnessZone(def, built);
  // collapse the lane into maximal same-row floor runs
  const runs: { row: number; col: number; len: number }[] = [];
  for (let tx = zone.x0; tx <= zone.x1; tx++) {
    const c = lane[tx];
    if (!c || c.kind !== 'floor') {
      runs.push({ row: NaN, col: tx, len: 0 }); // break marker (void column)
      continue;
    }
    const last = runs[runs.length - 1];
    if (last !== undefined && last.row === c.row) last.len++;
    else runs.push({ row: c.row, col: tx, len: 1 });
  }
  // treads = runs long enough to stand on as terrain, not slot dips
  const treads = runs.filter((r) => r.len >= RICHNESS.reliefTreadCols);
  let high = { row: Infinity, col: -1 };
  let low = { row: -Infinity, col: -1 };
  let steps = 0;
  let prevRow: number | null = null;
  for (const t of treads) {
    if (t.row < high.row) high = { row: t.row, col: t.col };
    if (t.row > low.row) low = { row: t.row, col: t.col };
    if (prevRow !== null && Math.abs(t.row - prevRow) >= RICHNESS.reliefStepRows) steps++;
    prevRow = t.row;
  }
  const rangeRows = low.row >= high.row ? low.row - high.row : 0;
  return { zone, rangeRows, high, low, steps };
}

function checkRelief(def: LevelDef, built: BuiltLevel, fail: Fail): void {
  const R = 'rule 11 (relief)';
  const m = measureRelief(def, built);
  const problems: string[] = [];
  if (m.rangeRows < RICHNESS.reliefMinRangeRows) {
    problems.push(
      `the lane's vertical range is ${m.rangeRows} row(s) (need >= ${RICHNESS.reliefMinRangeRows}) — highest surface row ${m.high.row} at column ${m.high.col}, lowest row ${m.low.row} at column ${m.low.col}`,
    );
  }
  if (m.steps < RICHNESS.reliefMinSteps) {
    problems.push(
      `the lane changes height (steps of >= ${RICHNESS.reliefStepRows} rows between treads persisting >= ${RICHNESS.reliefTreadCols} columns — 1-column pocket slots do not count) only ${m.steps} time(s) (need >= ${RICHNESS.reliefMinSteps})`,
    );
  }
  if (problems.length > 0) {
    fail(
      R,
      `${problems.join('; ')} across columns ${m.zone.x0}..${m.zone.x1} — a flat left-to-right corridor is a treadmill: sculpt climbs, ridges and descents (the finale zone from column ${m.zone.x1 + 1} and boss arenas are exempt)`,
    );
  }
}

// -- rule 12: ALTERNATE ROUTE -------------------------------------------------
export interface DualLaneMeasure {
  zone: { x0: number; x1: number };
  zoneCols: number;
  /** Columns offering >= 2 reachable safe standable surfaces >= 4 rows apart. */
  dualCols: number;
  frac: number;
  bestRun: number;
  bestRunAt: { x0: number; x1: number } | null;
}

function measureDualLanes(
  def: LevelDef,
  built: BuiltLevel,
  reached: Uint8Array,
): DualLaneMeasure {
  const map = built.map;
  const w = map.wTiles;
  const zone = richnessZone(def, built);
  const zoneCols = Math.max(0, zone.x1 - zone.x0 + 1);
  let dualCols = 0;
  let run = 0;
  let bestRun = 0;
  let bestEnd = -1;
  for (let tx = zone.x0; tx <= zone.x1; tx++) {
    const rows: number[] = [];
    for (const s of columnSurfaces(map, tx)) {
      if (s.rest !== 'safe') continue; // spike/lava rests are not lanes
      if (s.row < 1) continue;
      if (reached[(s.row - 1) * w + tx] !== 1) continue; // standing tile unreached
      rows.push(s.row); // columnSurfaces scans top-down: ascending rows
    }
    const dual =
      rows.length >= 2 &&
      rows[rows.length - 1]! - rows[0]! >= RICHNESS.dualMinSeparationRows;
    if (dual) {
      dualCols++;
      run++;
      if (run > bestRun) {
        bestRun = run;
        bestEnd = tx;
      }
    } else {
      run = 0;
    }
  }
  return {
    zone,
    zoneCols,
    dualCols,
    frac: zoneCols > 0 ? dualCols / zoneCols : 0,
    bestRun,
    bestRunAt: bestRun > 0 ? { x0: bestEnd - bestRun + 1, x1: bestEnd } : null,
  };
}

function checkAlternateRoute(
  def: LevelDef,
  built: BuiltLevel,
  reached: Uint8Array,
  fail: Fail,
): void {
  const R = 'rule 12 (alternate route)';
  const m = measureDualLanes(def, built, reached);
  if (m.zoneCols === 0) return; // degenerate zone (arena-only act): nothing to measure
  const problems: string[] = [];
  if (m.frac < RICHNESS.dualMinFrac) {
    problems.push(
      `only ${m.dualCols}/${m.zoneCols} columns (${(m.frac * 100).toFixed(1)}%) offer two reachable standable lanes >= ${RICHNESS.dualMinSeparationRows} rows apart (need >= ${RICHNESS.dualMinFrac * 100}%)`,
    );
  }
  if (m.bestRun < RICHNESS.dualMinRunCols) {
    problems.push(
      `the longest contiguous dual-lane stretch is ${m.bestRun} column(s)${m.bestRunAt ? ` (columns ${m.bestRunAt.x0}..${m.bestRunAt.x1})` : ''} (need >= ${RICHNESS.dualMinRunCols} — a real parallel path, not scattered ledges)`,
    );
  }
  if (problems.length > 0) {
    fail(
      R,
      `${problems.join('; ')} across columns ${m.zone.x0}..${m.zone.x1} — the route is single-file: add an upper gallery, a lower duct, or a warp-served parallel room (the fill traverses warps, so warp routes count)`,
    );
  }
}

// -- rule 13: ENEMY IDENTITY --------------------------------------------------
function checkEnemyIdentity(
  def: LevelDef,
  built: BuiltLevel,
  prev: LevelDef | null,
  fail: Fail,
): void {
  const R = 'rule 13 (enemy identity)';
  const kinds = new Set<EnemyKind>(built.enemies.map((e) => e.kind));
  const roster = [...kinds].sort().join(', ');
  if (kinds.size < RICHNESS.minEnemyKinds) {
    fail(
      R,
      `only ${kinds.size} distinct enemy kind(s) [${roster}] (need >= ${RICHNESS.minEnemyKinds}) — "always same ennemies" is the playtest's core complaint`,
    );
  }
  // Castle acts are exempt from the cross-act clauses (their cast is the
  // boss show), and act 1 of a world has no predecessor to differ from.
  if (CASTLES[def.world] === def.id || prev === null) return;
  const prevKinds = new Set<EnemyKind>(buildLevel(prev).enemies.map((e) => e.kind));
  if (kinds.size === prevKinds.size && [...kinds].every((k) => prevKinds.has(k))) {
    fail(
      R,
      `enemy roster [${roster}] is IDENTICAL to ${prev.id}'s — consecutive acts within a world must not repeat a roster`,
    );
  }
  if ([...kinds].every((k) => prevKinds.has(k))) {
    fail(
      R,
      `every kind of [${roster}] already walked ${prev.id} — each act must place at least one kind its immediate predecessor did not`,
    );
  }
}

// -- rule 14: THE TOP IS EARNABLE ----------------------------------------------
export interface TopGrabMeasure {
  /** Column of the flagpole (GOAL.poleOffsetTiles before the door). */
  poleCol: number;
  /** Best grab fraction a run-jump reaches from any reachable launch. */
  bestFrac: number;
  best: { col: number; row: number } | null;
  /** Rows above the goal ground line a launch surface must reach. */
  neededRows: number;
}

function measureTopGrab(built: BuiltLevel, reached: Uint8Array): TopGrabMeasure {
  const map = built.map;
  const w = map.wTiles;
  const poleCol = Math.floor((built.goalX - GOAL.poleOffsetTiles * TILE) / TILE);
  const poleBaseY = (built.goalRow + 1) * TILE; // mirrors Level.poleBaseY
  const poleHPx = GOAL.poleHeightTiles * TILE;
  let bestFrac = 0;
  let best: { col: number; row: number } | null = null;
  const x0 = Math.max(0, poleCol - RICHNESS.poleLaunchRadiusTiles);
  const x1 = Math.min(w - 1, poleCol);
  for (let tx = x0; tx <= x1; tx++) {
    for (const s of columnSurfaces(map, tx)) {
      if (s.rest !== 'safe') continue;
      if (s.row < 1 || reached[(s.row - 1) * w + tx] !== 1) continue;
      // center at apex of a run-jump from this surface (small body)
      const apexCenterY = s.row * TILE - PHYS.smallHalf[1] - FULL_JUMP_APEX_PX;
      const frac = Math.min(1, (poleBaseY - apexCenterY) / poleHPx);
      if (frac > bestFrac) {
        bestFrac = frac;
        best = { col: tx, row: s.row };
      }
    }
  }
  const neededRows = Math.ceil(
    (GOAL.topGrabFrac * poleHPx - PHYS.smallHalf[1] - FULL_JUMP_APEX_PX) / TILE,
  );
  return { poleCol, bestFrac, best, neededRows };
}

function checkTopEarnable(
  def: LevelDef,
  built: BuiltLevel,
  reached: Uint8Array,
  fail: Fail,
): void {
  const R = 'rule 14 (the top is earnable)';
  if (def.boss) return; // castle acts: door-only ceremony, no pole to grab
  const m = measureTopGrab(built, reached);
  if (m.bestFrac >= GOAL.topGrabFrac) return;
  const from =
    m.best === null
      ? 'no reachable launch surface exists there at all'
      : `the best launch (column ${m.best.col}, surface row ${m.best.row}) reaches ${(m.bestFrac * 100).toFixed(0)}%`;
  fail(
    R,
    `a run-jump from within ${RICHNESS.poleLaunchRadiusTiles} tiles left of the pole (column ${m.poleCol}) grabs at most ${(m.bestFrac * 100).toFixed(0)}% of the pole, below the certified ${GOAL.topGrabFrac * 100}% — ${from}: raise a launch structure (stairs/pyramid/platform) to >= ${m.neededRows} rows above the goal line; springs do not count (jump math only), and keep the pole-to-door runway itself flat (ceremony walk contract)`,
  );
}

// -- richness plumbing ---------------------------------------------------------
function resolvePrevInWorld(
  def: LevelDef,
  explicit: LevelDef | null | undefined,
): LevelDef | null {
  if (explicit !== undefined) return explicit;
  if (!LEVELS.includes(def)) return null;
  return LEVELS.find((d) => d.world === def.world && d.act === def.act - 1) ?? null;
}

function runRichnessRules(
  def: LevelDef,
  built: BuiltLevel,
  reached: Uint8Array,
  prev: LevelDef | null,
  fail: Fail,
): void {
  checkRelief(def, built, fail);
  checkAlternateRoute(def, built, reached, fail);
  checkEnemyIdentity(def, built, prev, fail);
  checkTopEarnable(def, built, reached, fail);
}

/** Rules 11-14 standalone (fixtures, in-progress acts not yet in LEVELS).
 *  Same throw-at-first-violation manners as checkAct. */
export function checkActRichness(def: LevelDef, prevInWorld?: LevelDef | null): void {
  const fail: Fail = (rule, msg) => {
    throw new Error(`${def.id}: ${rule}: ${msg}`);
  };
  const built = buildLevel(def);
  const reached = computeReached(built);
  runRichnessRules(def, built, reached, resolvePrevInWorld(def, prevInWorld), fail);
}

/** Everything rules 11-14 measure, plus their violation messages — the
 *  world-rebuild wave's per-act dashboard. Never throws. */
export interface RichnessAudit {
  relief: ReliefMeasure;
  dual: DualLaneMeasure;
  kinds: EnemyKind[];
  /** null on boss acts (door-only ceremony, no pole). */
  topGrab: TopGrabMeasure | null;
  /** Rule 11-14 violation messages, rule order. Empty = richness-clean. */
  violations: string[];
}

export function auditRichness(def: LevelDef, prevInWorld?: LevelDef | null): RichnessAudit {
  const built = buildLevel(def);
  const reached = computeReached(built);
  const prev = resolvePrevInWorld(def, prevInWorld);
  const violations: string[] = [];
  const collect = (run: (fail: Fail) => void): void => {
    try {
      run((rule, msg) => {
        throw new Error(`${def.id}: ${rule}: ${msg}`);
      });
    } catch (e) {
      violations.push(e instanceof Error ? e.message : String(e));
    }
  };
  collect((fail) => checkRelief(def, built, fail));
  collect((fail) => checkAlternateRoute(def, built, reached, fail));
  collect((fail) => checkEnemyIdentity(def, built, prev, fail));
  collect((fail) => checkTopEarnable(def, built, reached, fail));
  return {
    relief: measureRelief(def, built),
    dual: measureDualLanes(def, built, reached),
    kinds: [...new Set<EnemyKind>(built.enemies.map((e) => e.kind))].sort(),
    topGrab: def.boss ? null : measureTopGrab(built, reached),
    violations,
  };
}
