// ============================================================================
// THE ACT CONTRACT — checkAct(def) is the gate every act in the campaign must
// pass, and flowBot(level) is the machine that walks every mandatory route.
//
// checkAct enforces, in order (it throws at the FIRST violation, with a
// message naming the act, the rule and the position):
//   0. build determinism (two buildLevel runs must agree — catches module
//      state leaking into LevelDef.build),
//   1. STRUCTURE       — the ACT_RULES counts, castle flags and cutscenes,
//   2. NOTHING BURIED  — every spawn's center tile must be 'empty',
//   3. REACHABILITY    — flood fill: goal / goldbars / secrets / checkpoints
//                        are not entombed (SEE THE LOUD CAVEAT AT RULE 3),
//   4. FORWARD-REACHABLE — nothing sits behind the backtrack ratchet,
//   5. FLOW BOT        — an immortal right+run+jump bot must clear the act,
//   6. IDLE SILENCE    — an untouched level emits ZERO events.
//
// When a rule fails an act, the rule is working: fix the content, not the
// threshold (AGENTS.md, design rule 7).
// ============================================================================

import type {
  BuiltLevel,
  CutsceneId,
  InputState,
  LevelDef,
  SpawnPoint,
  TileMapLike,
  WorldNo,
} from '../src/core/types.ts';
import { ACT_RULES, BACKTRACK_SLACK, SOLIDITY, TILE } from '../src/core/constants.ts';
import { buildLevel } from '../src/game/levelBuilder.ts';
import { Level } from '../src/game/level.ts';
import { CASTLES } from '../src/levels/maps.ts';

// ---------------------------------------------------------------------------
// Flow-bot tuning. Grounded in measured player physics (fixed 60 Hz):
// full-hold jump rises ~8 tiles (9.5 at run speed), a tap rises ~3.4; a
// run-jump with a short hold carries ~8 tiles of gap. Authored acts keep
// mandatory steps <= 3 up and gaps <= 5 across, so these are generous.
// ---------------------------------------------------------------------------
const BOT = {
  /** Wall probe distances ahead of the leading face (px): "1-2 tiles ahead". */
  wallLookaheadPx: [4, TILE, 2 * TILE],
  /** Gap probe: this far ahead of the leading face (px). */
  gapLookaheadPx: 8,
  /** Hold jump this long at walls / when stuck (full height, ~8 tiles). */
  wallHoldFrames: 40,
  /** Hold jump this long at gap lips (~8 tiles of carry — clears 5-gaps). */
  gapHoldFrames: 8,
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
  /** Minimum average forward speed (px/frame) outside boss engagement. */
  minAvgSpeed: 1.2,
  /** Collectibles may sit at most this far left of the start (px). */
  startSlackPx: 32,
} as const;

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
};

/** "px (x,y) tile (tx,ty)" — every violation names its position this way. */
function at(px: number, py: number): string {
  return `px (${Math.round(px)},${Math.round(py)}) tile (${Math.floor(px / TILE)},${Math.floor(py / TILE)})`;
}

// ---------------------------------------------------------------------------
// THE FLOW BOT.
//
// It ONLY holds right+run, and presses jump when:
//   (a) a solid wall sits 1-2 tiles ahead at body height,
//   (b) there is no ground within 2 tiles below-ahead (a gap lip),
//   (c) it has been pushing right without advancing for > 30 frames (unstick).
// It is immortal: invulnT is pinned every frame, so contact damage does
// nothing. Lava and the void still KILL outright (kill() bypasses
// invulnerability); the checkpoint respawn brings the bot back and it keeps
// going — a mandatory route that repeatedly drops the bot into lava will fail
// on time or stall, which is the point.
//
// Boss acts: Level fires the goal ceremony on a plain x >= goalX check, and
// the goal stands INSIDE the arena, so the bot refuses to cross
// goalX - bossGoalCapPx while the show is on. It chases the boss instead and
// periodically jumps when within bossEngagePx, landing crude stomps until the
// boss escapes (staged) or goes down (rage). Immortality carries it.
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

export function flowBot(level: Level, maxFrames: number = ACT_RULES.botFrames): FlowBotResult {
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

  while (frames < maxFrames && !level.finished) {
    p.invulnT = 2; // immortal: cannot dodge, does not need to
    const boss = level.boss;
    const bossActive = boss !== null && (boss.phase === 'intro' || boss.phase === 'fight');
    const prevX = p.x;

    let left = false;
    let right = true;
    let press = false;

    if (bossActive) {
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
      // (a) wall 1-2 tiles ahead at body height
      let wall = false;
      for (const d of BOT.wallLookaheadPx) {
        const px = p.x + p.halfW + d;
        if (
          map.solidAtPx(px, p.y) === 'solid' ||
          map.solidAtPx(px, p.y - p.halfH + 2) === 'solid'
        ) {
          wall = true;
          break;
        }
      }
      // (b) gap: nothing standable within 2 tiles below-ahead
      const feet = p.y + p.halfH;
      const aheadX = p.x + p.halfW + BOT.gapLookaheadPx;
      let support = false;
      for (const dy of [4, TILE + 4, 2 * TILE + 4]) {
        const s = map.solidAtPx(aheadX, feet + dy);
        if (s === 'solid' || s === 'oneway') {
          support = true;
          break;
        }
      }
      // (c) unstick
      if (wall || blockedT > BOT.unstickAfterFrames) {
        press = true;
        holdT = BOT.wallHoldFrames;
        blockedT = 0;
      } else if (!support) {
        press = true;
        holdT = BOT.gapHoldFrames;
      }
    }

    const input: InputState = {
      left,
      right,
      up: false,
      down: false,
      jump: press || holdT > 0,
      jumpPressed: press,
      run: true,
      firePressed: false,
      pausePressed: false,
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
// checkAct
// ---------------------------------------------------------------------------
export function checkAct(def: LevelDef): void {
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
  checkReachability(built, fail);
  checkForwardReachable(built, fail);
  checkFlowBot(def, fail);
  checkIdleSilence(def, fail);
}

type Fail = (rule: string, msg: string) => never;

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

// -- rule 3: REACHABILITY ---------------------------------------------------
// A 4-connected flood fill from the start tile through 'pass'/'oneway'
// solidity.
//
// LOUD CAVEAT — READ BEFORE TRUSTING THIS RULE: the fill ignores GRAVITY and
// DIRECTION completely. It proves a target is NOT ENTOMBED in tile work, and
// NOTHING more. It will happily bless a "route" that requires falling upward,
// hovering, or walking back through the ratchet. The house shipped a
// fake-route disaster through exactly this hole once; rules 4 and 5 exist
// because this fill cannot catch that class of bug. Do not "improve" content
// to satisfy only this rule.
function checkReachability(built: BuiltLevel, fail: Fail): void {
  const R = 'rule 3 (reachability)';
  const map = built.map;
  const w = map.wTiles;
  const h = map.hTiles;

  const passable = (tx: number, ty: number): boolean => {
    const s = SOLIDITY[map.tileAt(tx, ty)];
    return s === 'pass' || s === 'oneway';
  };

  const startTx = Math.floor(built.start.x / TILE);
  const startTy = Math.floor(built.start.y / TILE);
  if (!passable(startTx, startTy)) {
    fail(R, `the start itself at ${at(built.start.x, built.start.y)} is inside solid`);
  }

  const reached = new Uint8Array(w * h);
  const queue: number[] = [startTy * w + startTx];
  reached[startTy * w + startTx] = 1;
  while (queue.length > 0) {
    const cur = queue.pop()!;
    const tx = cur % w;
    const ty = Math.floor(cur / w);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const idx = ny * w + nx;
      if (reached[idx]) continue;
      if (!passable(nx, ny)) continue;
      reached[idx] = 1;
      queue.push(idx);
    }
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
  const w = map.wTiles;
  const h = map.hTiles;
  const slackTiles = Math.floor(BACKTRACK_SLACK / TILE);

  const standableInRange = (fromTx: number): boolean => {
    const toTx = Math.min(w - 1, fromTx + slackTiles);
    for (let tx = Math.max(0, fromTx); tx <= toTx; tx++) {
      for (let ty = 0; ty < h - 1; ty++) {
        if (SOLIDITY[map.tileAt(tx, ty)] !== 'pass') continue;
        const below = SOLIDITY[map.tileAt(tx, ty + 1)];
        if (below === 'solid' || below === 'oneway') return true;
      }
    }
    return false;
  };

  const check = (what: string, px: number, py: number): void => {
    if (px < built.start.x - BOT.startSlackPx) {
      fail(
        R,
        `${what} at ${at(px, py)} sits ${Math.round(built.start.x - px)}px left of the start — behind the ratchet from frame one`,
      );
    }
    if (!standableInRange(Math.floor(px / TILE))) {
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
