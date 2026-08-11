// ============================================================================
// Motifs — the composable authoring vocabulary for acts.
//
// Every helper has the shape (b, x, row, opts?) => { endX, endRow } where:
//   - `x` is the first column the motif may use,
//   - `row` is the SURFACE row of the running lane at entry (the row the
//     ground tiles occupy — the player's feet rest on top of it),
//   - `endX` is the first FREE column after the motif (chain the next motif
//     there), `endRow` the surface row it hands over.
//
// Motifs lay ALL their own ground — chaining motifs with no gaps yields a
// fully-floored act. Guarantees every motif keeps (validated loudly, no
// silent fallbacks):
//   - the running surface stays inside the lane band
//     [LANE_TOP_ROW .. heightTiles-6],
//   - the surface never steps more than 2 rows between adjacent standable
//     columns (jumpable — PHYS jump clears ~4 up / ~6 across; we author at
//     3 up / 5 across, generous). The one sanctioned exception is
//     springboardWall, where the spring (springVy) powers a 4..6-row wall.
//
// Deterministic by construction: no RNG, no module state — everything follows
// from the arguments. That is what lets tests count spawns exactly.
// ============================================================================

import type { EnemyKind, LevelBuilderLike, PowerupKind } from '../core/types.ts';

export interface MotifEnd {
  endX: number;
  endRow: number;
}

/** Highest row the running surface may occupy (sky headroom above). */
export const LANE_TOP_ROW = 14;

/** Lowest row the running surface may occupy on this map. */
export function laneBottomRow(b: LevelBuilderLike): number {
  return b.heightTiles - 6;
}

function requireLane(b: LevelBuilderLike, row: number, what: string): void {
  const bottom = laneBottomRow(b);
  if (!Number.isInteger(row) || row < LANE_TOP_ROW || row > bottom) {
    throw new Error(`${what}: surface row ${row} leaves the running lane ${LANE_TOP_ROW}..${bottom}`);
  }
}

function requireRange(v: number, lo: number, hi: number, what: string): number {
  if (!Number.isInteger(v) || v < lo || v > hi) {
    throw new Error(`${what} must be an integer ${lo}..${hi}, got ${v}`);
  }
  return v;
}

// ---------------------------------------------------------------------------
// runway — flat ground. Optional walk-level coin row (absolute row) and
// opts.rings: clusters of 3 coins at row-3 every 5 columns.
// ---------------------------------------------------------------------------
export function runway(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts?: { len?: number; coinRow?: number; rings?: boolean },
): MotifEnd {
  requireLane(b, row, 'runway');
  const len = requireRange(opts?.len ?? 8, 2, 200, 'runway len');
  b.ground(x, x + len - 1, row);
  if (opts?.coinRow !== undefined) {
    if (len < 3) throw new Error(`runway: coinRow needs len >= 3, got ${len}`);
    if (opts.coinRow >= row || opts.coinRow < 0) {
      throw new Error(`runway: coinRow ${opts.coinRow} must sit above the surface row ${row}`);
    }
    b.coinRow(x + 1, x + len - 2, opts.coinRow);
  }
  if (opts?.rings) {
    for (let c = x + 2; c + 2 <= x + len - 2; c += 5) {
      b.coinRow(c, c + 2, row - 3);
    }
  }
  return { endX: x + len, endRow: row };
}

// ---------------------------------------------------------------------------
// gapJump — approach ground, a 3..5-tile pit, landing ground at the same row.
// ---------------------------------------------------------------------------
export function gapJump(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts?: { gap?: number; approach?: number; landing?: number },
): MotifEnd {
  requireLane(b, row, 'gapJump');
  const gap = requireRange(opts?.gap ?? 3, 3, 5, 'gapJump gap');
  const approach = requireRange(opts?.approach ?? 3, 2, 20, 'gapJump approach');
  const landing = requireRange(opts?.landing ?? 3, 2, 20, 'gapJump landing');
  b.ground(x, x + approach - 1, row);
  b.ground(x + approach + gap, x + approach + gap + landing - 1, row);
  return { endX: x + approach + gap + landing, endRow: row };
}

// ---------------------------------------------------------------------------
// steppes — rising (dir +1) or falling (dir -1) flat treads, each stepping
// stepH (<= 2, jumpable) rows from the previous.
// ---------------------------------------------------------------------------
export function steppes(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts?: { count?: number; stepH?: number; treadW?: number; dir?: 1 | -1 },
): MotifEnd {
  requireLane(b, row, 'steppes');
  const count = requireRange(opts?.count ?? 3, 1, 12, 'steppes count');
  const stepH = requireRange(opts?.stepH ?? 2, 1, 2, 'steppes stepH');
  const treadW = requireRange(opts?.treadW ?? 2, 1, 6, 'steppes treadW');
  const dir = opts?.dir ?? 1;
  let cur = row;
  for (let i = 0; i < count; i++) {
    cur = row - stepH * (i + 1) * dir;
    requireLane(b, cur, 'steppes');
    b.ground(x + i * treadW, x + (i + 1) * treadW - 1, cur);
  }
  return { endX: x + count * treadW, endRow: cur };
}

// ---------------------------------------------------------------------------
// brickGallery — floating brick+qblock row 4 above flat ground (bumpable from
// below, standable without trapping the lane). Interior alternates brick /
// qblock('coin'); opts.powerup upgrades the LAST qblock's contents.
// ---------------------------------------------------------------------------
export function brickGallery(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts?: { len?: number; powerup?: PowerupKind },
): MotifEnd {
  requireLane(b, row, 'brickGallery');
  const len = requireRange(opts?.len ?? 8, 6, 40, 'brickGallery len');
  const galleryRow = row - 4;
  if (galleryRow < 2) throw new Error(`brickGallery: gallery row ${galleryRow} needs headroom (row >= 6)`);
  b.ground(x, x + len - 1, row);
  const qblockCols: number[] = [];
  for (let c = x + 2; c <= x + len - 3; c++) {
    if ((c - (x + 2)) % 2 === 0) b.brick(c, galleryRow);
    else qblockCols.push(c);
  }
  for (let i = 0; i < qblockCols.length; i++) {
    const col = qblockCols[i];
    if (col === undefined) throw new Error('brickGallery: qblock column bookkeeping broke');
    const isLast = i === qblockCols.length - 1;
    b.qblock(col, galleryRow, isLast && opts?.powerup ? opts.powerup : 'coin');
  }
  return { endX: x + len, endRow: row };
}

// ---------------------------------------------------------------------------
// pipeField — 2..4 pipes (2 tiles wide, 3 free columns between) of alternating
// heights 2,1,2,1 rising from flat ground; heights stay <= 2 so every pipe top
// is a jumpable step. opts.lawyer plants a lawyer in the FIRST (tall) pipe.
// ---------------------------------------------------------------------------
export function pipeField(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts?: { pipes?: number; lawyer?: boolean },
): MotifEnd {
  requireLane(b, row, 'pipeField');
  const pipes = requireRange(opts?.pipes ?? 3, 2, 4, 'pipeField pipes');
  const span = 5 * pipes + 1; // 2 pad + pipes*2 wide + (pipes-1)*3 between + 2 pad
  b.ground(x, x + span - 1, row);
  for (let i = 0; i < pipes; i++) {
    const h = i % 2 === 0 ? 2 : 1;
    const px = x + 2 + i * 5;
    b.pipe(px, row - h, h, { lawyer: opts?.lawyer === true && i === 0 });
  }
  return { endX: x + span, endRow: row };
}

// ---------------------------------------------------------------------------
// springboardWall — a spring on a short runway before a 4..6-row wall. The
// sanctioned step-rule exception: the spring (springVy) launches ~9 rows, so
// 4..6 stays generous. Throws if the wall top would leave the lane band.
// ---------------------------------------------------------------------------
export function springboardWall(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts?: { wallH?: number },
): MotifEnd {
  requireLane(b, row, 'springboardWall');
  const wallH = requireRange(opts?.wallH ?? 5, 4, 6, 'springboardWall wallH');
  const top = row - wallH;
  requireLane(b, top, 'springboardWall (wall top)');
  b.ground(x, x + 4, row);
  b.spring(x + 3, row - 1); // sits ON the runway, one column before the wall
  b.ground(x + 5, x + 6, top); // the wall: 2 columns, filled to the bottom
  return { endX: x + 7, endRow: top };
}

// ---------------------------------------------------------------------------
// onewayClimb — jump-through platforms laddering up over a pit; each strip
// 2 rows above the last (jumpable), overlapping by a column so there is
// always a landing. rise must be even (2 or 4).
// ---------------------------------------------------------------------------
export function onewayClimb(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts?: { rise?: number },
): MotifEnd {
  requireLane(b, row, 'onewayClimb');
  const rise = requireRange(opts?.rise ?? 4, 2, 4, 'onewayClimb rise');
  if (rise % 2 !== 0) throw new Error(`onewayClimb rise must be even (steps of 2), got ${rise}`);
  const top = row - rise;
  requireLane(b, top, 'onewayClimb (top)');
  b.ground(x, x, row); // entry shoulder
  const nStrips = rise / 2 + 1;
  for (let k = 0; k < nStrips; k++) {
    b.oneway(x + 1 + 2 * k, x + 3 + 2 * k, row - 2 * k);
  }
  const landX = x + 2 * nStrips + 2;
  b.ground(landX, landX + 1, top); // exit shoulder
  return { endX: landX + 2, endRow: top };
}

// ---------------------------------------------------------------------------
// crumbleBridge — a strip of crumble tiles at surface level spanning a pit,
// solid ground shoulders on both sides. Dawdle and it drops you.
// ---------------------------------------------------------------------------
export function crumbleBridge(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts?: { len?: number },
): MotifEnd {
  requireLane(b, row, 'crumbleBridge');
  const len = requireRange(opts?.len ?? 4, 2, 8, 'crumbleBridge len');
  b.ground(x, x + 1, row);
  b.crumble(x + 2, x + 2 + len - 1, row);
  b.ground(x + len + 2, x + len + 3, row);
  return { endX: x + len + 4, endRow: row };
}

// ---------------------------------------------------------------------------
// coinArc — a gap crossing with an arc of coins tracing the jump. Coins span
// from the lip column to the landing column, rising to 4 rows over the surface.
// ---------------------------------------------------------------------------
export function coinArc(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts?: { gap?: number },
): MotifEnd {
  requireLane(b, row, 'coinArc');
  const gap = requireRange(opts?.gap ?? 4, 3, 5, 'coinArc gap');
  b.ground(x, x + 2, row);
  b.ground(x + 3 + gap, x + 5 + gap, row);
  const n = gap + 2; // lip column .. landing column
  for (let i = 0; i < n; i++) {
    const dy = 2 + Math.min(i, n - 1 - i, 2); // 2,3,4,...,4,3,2
    b.coin(x + 2 + i, row - dy);
  }
  return { endX: x + 6 + gap, endRow: row };
}

// ---------------------------------------------------------------------------
// secretPocket — a hidden alcove dug under the lane, sealed by a brick lid,
// reachable through a visible 1-column slot. Layout (surface row R):
//   x     : shoulder ground at R
//   x+1   : ENTRANCE — open slot, floor at R+2 (drop of 2, hop of 2 back out)
//   x+2/3 : INTERIOR — brick lid at R, hollow R+1..R+2, floor at R+3,
//           the secret floating at R+2 (an empty tile)
//   x+4   : shoulder ground at R
// Big Estrada ducks under the lid; the certified stamp does not cover dignity.
// ---------------------------------------------------------------------------
export function secretPocket(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts: { index: number },
): MotifEnd {
  requireLane(b, row, 'secretPocket');
  if (row + 3 >= b.heightTiles) throw new Error(`secretPocket: pocket floor ${row + 3} falls off the map`);
  b.ground(x, x, row);
  b.ground(x + 1, x + 1, row + 2); // entrance floor; rows R..R+1 stay open
  b.ground(x + 2, x + 3, row + 3); // interior floor
  b.platform(x + 2, x + 3, row, 'brick'); // the lid — bricks hint at the trick
  b.ground(x + 4, x + 4, row);
  b.secret(opts.index, x + 3, row + 2);
  return { endX: x + 5, endRow: row };
}

// ---------------------------------------------------------------------------
// goldbarPerch — a goldbar on a floating perch 3 rows over flat ground
// (3-up jump: generous). The ground lane runs beneath uninterrupted.
// ---------------------------------------------------------------------------
export function goldbarPerch(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts: { index: number },
): MotifEnd {
  requireLane(b, row, 'goldbarPerch');
  const perchRow = row - 3;
  if (perchRow < 2) throw new Error(`goldbarPerch: perch row ${perchRow} needs headroom (row >= 5)`);
  b.ground(x, x + 5, row);
  b.platform(x + 2, x + 3, perchRow, 'ground');
  b.goldbar(opts.index, x + 2, perchRow - 1); // sits ON the perch
  return { endX: x + 6, endRow: row };
}

// ---------------------------------------------------------------------------
// enemyGauntlet — flat ground with 2-3 spaced enemies. Ground walkers patrol
// at surface level; fliers and crushers hang in the air. Lawyers refuse: they
// only take cases from inside a pipe (use pipeField({lawyer:true})).
// ---------------------------------------------------------------------------

/** Row offset (relative to the surface row) each kind occupies when placed by
 *  the gauntlet. Exhaustive over EnemyKind; null = not placeable here. */
const GAUNTLET_ROW_OFFSET: Record<EnemyKind, number | null> = {
  lobbyist: -1,
  pollster: -1,
  rat: -1,
  chipstack: -1,
  paparazzo: -3,
  gavel: -4,
  lawyer: null,
};

export function enemyGauntlet(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts?: { kinds?: EnemyKind[] },
): MotifEnd {
  requireLane(b, row, 'enemyGauntlet');
  const kinds = opts?.kinds ?? ['lobbyist', 'pollster'];
  if (kinds.length < 2 || kinds.length > 3) {
    throw new Error(`enemyGauntlet wants 2-3 enemies, got ${kinds.length}`);
  }
  const span = 4 * kinds.length + 3;
  b.ground(x, x + span - 1, row);
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    if (kind === undefined) throw new Error('enemyGauntlet: kinds indexing broke');
    const off = GAUNTLET_ROW_OFFSET[kind];
    if (off === undefined) throw new Error(`enemyGauntlet: unknown enemy kind '${String(kind)}'`);
    if (off === null) {
      throw new Error(`enemyGauntlet: '${kind}' does not walk the gauntlet — use pipeField({ lawyer: true })`);
    }
    b.enemy(kind, x + 3 + i * 4, row + off);
  }
  return { endX: x + span, endRow: row };
}

// ---------------------------------------------------------------------------
// checkpointRest — a breather: flat ground, a checkpoint, a few coins.
// ---------------------------------------------------------------------------
export function checkpointRest(b: LevelBuilderLike, x: number, row: number): MotifEnd {
  requireLane(b, row, 'checkpointRest');
  b.ground(x, x + 5, row);
  b.checkpoint(x + 2, row - 1);
  b.coinRow(x + 3, x + 5, row - 1);
  return { endX: x + 6, endRow: row };
}

// ---------------------------------------------------------------------------
// arenaApproach — a flat runway into the boss arena (opts.width, default 24
// tiles), flat boss floor, goal planted inside at the right edge minus 4.
// ---------------------------------------------------------------------------
export function arenaApproach(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts?: { width?: number },
): MotifEnd {
  requireLane(b, row, 'arenaApproach');
  const width = requireRange(opts?.width ?? 24, 12, 60, 'arenaApproach width');
  b.ground(x, x + 5, row); // approach runway
  const x0 = x + 6;
  const x1 = x0 + width - 1;
  b.arena(x0, x1, row);
  b.goal(x1 - 4, row - 1); // the door stands ON the arena floor
  return { endX: x1 + 1, endRow: row };
}

// ---------------------------------------------------------------------------
// finishRunway — flat ground with the act's goal door near its end.
// ---------------------------------------------------------------------------
export function finishRunway(
  b: LevelBuilderLike,
  x: number,
  row: number,
  opts?: { len?: number },
): MotifEnd {
  requireLane(b, row, 'finishRunway');
  const len = requireRange(opts?.len ?? 8, 6, 40, 'finishRunway len');
  b.ground(x, x + len - 1, row);
  b.goal(x + len - 3, row - 1); // the door stands ON the runway
  return { endX: x + len, endRow: row };
}
