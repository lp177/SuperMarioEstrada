// ============================================================================
// LevelBuilder — the authoring surface for acts (LevelBuilderLike), plus
// buildLevel(def) which runs a LevelDef and validates the result LOUDLY.
//
// Unit conventions (ground truth for every module downstream):
//   - All builder arguments are TILES. Rows grow downward.
//   - A `row` argument always means THE ROW THE THING OCCUPIES. So
//     ground(x0,x1,row) has its walkable surface AT `row` (feet rest on top
//     of that tile), and an enemy placed at row R stands ON the ground whose
//     surface is at R+1 — its pixel center is R*16+8.
//   - BuiltLevel positions are PIXEL CENTERS: px = tx*TILE + 8, py = row*TILE + 8.
//     Exceptions, by name: goalRow / arena.floorRow stay in TILE rows;
//     the lawyer pipe-mouth spawn sits at the mouth seam (x*16+16, row*16).
//   - BuiltLevel.arena x0/x1 are the pixel centers of the arena's end tiles.
//
// NO SILENT FALLBACKS: unknown ids throw, duplicate uniques throw, missing
// required structure throws in buildLevel/finish with a message naming the act.
// ============================================================================

import type {
  BlockContents,
  BuiltLevel,
  EnemyKind,
  EnemySpawn,
  LevelBuilderLike,
  LevelDef,
  PowerupKind,
  SpawnPoint,
} from '../core/types.ts';
import { TILE, WORLD_H_TILES } from '../core/constants.ts';
import { TileMap } from './tilemap.ts';

/** Pixel center of a tile coordinate (either axis). */
const center = (t: number): number => t * TILE + TILE / 2;

// Closed-set runtime guards (exhaustive Records — a new union member does not
// compile until it is declared here, and an unknown runtime id throws).
const ENEMY_KINDS: Record<EnemyKind, true> = {
  lobbyist: true,
  pollster: true,
  lawyer: true,
  paparazzo: true,
  rat: true,
  chipstack: true,
  gavel: true,
};

const POWERUP_KINDS: Record<PowerupKind, true> = {
  stamp: true,
  goldpen: true,
  immunity: true,
};

const BLOCK_CONTENTS: Record<BlockContents, true> = {
  coin: true,
  ...POWERUP_KINDS,
};

const PLATFORM_KINDS: Record<'ground' | 'brick', true> = {
  ground: true,
  brick: true,
};

export class LevelBuilder implements LevelBuilderLike {
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly map: TileMap;

  // Accumulators — public readonly references so tests can watch them grow.
  readonly enemies: EnemySpawn[] = [];
  readonly coins: SpawnPoint[] = [];
  readonly goldbars: { index: number; x: number; y: number }[] = [];
  readonly secrets: { index: number; x: number; y: number }[] = [];
  readonly springs: SpawnPoint[] = [];
  readonly checkpoints: SpawnPoint[] = [];
  readonly blockContents = new Map<string, BlockContents>();

  private startPt: SpawnPoint | null = null;
  private goalTile: { tx: number; row: number } | null = null;
  private arenaTiles: { x0: number; x1: number; floorRow: number } | null = null;

  constructor(widthTiles: number, heightTiles: number) {
    this.widthTiles = widthTiles;
    this.heightTiles = heightTiles;
    this.map = new TileMap(widthTiles, heightTiles);
  }

  private span(x0: number, x1: number, what: string): void {
    if (x1 < x0) throw new Error(`${what}: x1 (${x1}) < x0 (${x0}) — spans are inclusive left..right`);
  }

  /** Solid themed ground from x0..x1 inclusive, surface AT `row`: 'ground'
   *  for rows row..row+2, 'bedrock' below that (cave-in visuals), down to the
   *  bottom of the map. Carving a pit = simply not laying ground there. */
  ground(x0: number, x1: number, row: number): void {
    this.span(x0, x1, 'ground');
    for (let x = x0; x <= x1; x++) {
      for (let ty = row; ty < this.heightTiles; ty++) {
        this.map.setTile(x, ty, ty <= row + 2 ? 'ground' : 'bedrock');
      }
    }
  }

  platform(x0: number, x1: number, row: number, kind: 'ground' | 'brick' = 'ground'): void {
    this.span(x0, x1, 'platform');
    if (!(kind in PLATFORM_KINDS)) throw new Error(`platform: unknown kind '${String(kind)}'`);
    for (let x = x0; x <= x1; x++) this.map.setTile(x, row, kind);
  }

  oneway(x0: number, x1: number, row: number): void {
    this.span(x0, x1, 'oneway');
    for (let x = x0; x <= x1; x++) this.map.setTile(x, row, 'oneway');
  }

  brick(x: number, row: number): void {
    this.map.setTile(x, row, 'brick');
  }

  qblock(x: number, row: number, contents: BlockContents): void {
    if (!(contents in BLOCK_CONTENTS)) {
      throw new Error(`qblock at ${x},${row}: unknown contents '${String(contents)}'`);
    }
    const key = `${x},${row}`;
    if (this.blockContents.has(key)) {
      throw new Error(`qblock at ${x},${row}: a qblock already sits there (contents '${this.blockContents.get(key)}')`);
    }
    this.map.setTile(x, row, 'qblock');
    this.blockContents.set(key, contents);
  }

  /** Vertical pipe: top opening at `row`, body extends DOWN `h` tiles
   *  (rows row..row+h-1), 2 tiles wide (columns x and x+1). Optional lawyer
   *  plant spawns centered at the mouth seam: (x*16+16, row*16). */
  pipe(x: number, row: number, h: number, opts?: { lawyer?: boolean }): void {
    if (!Number.isInteger(h) || h < 1) throw new Error(`pipe at ${x},${row}: height must be a positive integer, got ${h}`);
    for (let ty = row; ty < row + h; ty++) {
      this.map.setTile(x, ty, 'pipe');
      this.map.setTile(x + 1, ty, 'pipe');
    }
    if (opts?.lawyer) {
      this.enemies.push({ kind: 'lawyer', x: x * TILE + TILE, y: row * TILE });
    }
  }

  spikes(x0: number, x1: number, row: number): void {
    this.span(x0, x1, 'spikes');
    for (let x = x0; x <= x1; x++) this.map.setTile(x, row, 'spike');
  }

  lava(x0: number, x1: number, row: number): void {
    this.span(x0, x1, 'lava');
    for (let x = x0; x <= x1; x++) this.map.setTile(x, row, 'lava');
  }

  crumble(x0: number, x1: number, row: number): void {
    this.span(x0, x1, 'crumble');
    for (let x = x0; x <= x1; x++) this.map.setTile(x, row, 'crumble');
  }

  /** Ascending stairs of solid blocks, one tile per column. dir +1 = up-right
   *  (each column one row HIGHER than the last), -1 = down-right. */
  steps(x: number, row: number, n: number, dir: 1 | -1): void {
    if (!Number.isInteger(n) || n < 1) throw new Error(`steps at ${x},${row}: n must be a positive integer, got ${n}`);
    for (let i = 0; i < n; i++) {
      this.map.setTile(x + i, row - i * dir, 'ground');
    }
  }

  coin(x: number, row: number): void {
    this.coins.push({ x: center(x), y: center(row) });
  }

  coinRow(x0: number, x1: number, row: number): void {
    this.span(x0, x1, 'coinRow');
    for (let x = x0; x <= x1; x++) this.coin(x, row);
  }

  goldbar(index: number, x: number, row: number): void {
    if (!Number.isInteger(index) || index < 0 || index > 4) {
      throw new Error(`goldbar index must be an integer 0..4, got ${index}`);
    }
    if (this.goldbars.some((g) => g.index === index)) {
      throw new Error(`goldbar index ${index} placed twice (second at ${x},${row})`);
    }
    this.goldbars.push({ index, x: center(x), y: center(row) });
  }

  secret(index: number, x: number, row: number): void {
    if (!Number.isInteger(index) || index < 0 || index > 2) {
      throw new Error(`secret index must be an integer 0..2, got ${index}`);
    }
    if (this.secrets.some((s) => s.index === index)) {
      throw new Error(`secret index ${index} placed twice (second at ${x},${row})`);
    }
    this.secrets.push({ index, x: center(x), y: center(row) });
  }

  enemy(kind: EnemyKind, x: number, row: number): void {
    if (!(kind in ENEMY_KINDS)) throw new Error(`enemy at ${x},${row}: unknown kind '${String(kind)}'`);
    this.enemies.push({ kind, x: center(x), y: center(row) });
  }

  spring(x: number, row: number): void {
    this.springs.push({ x: center(x), y: center(row) });
  }

  checkpoint(x: number, row: number): void {
    this.checkpoints.push({ x: center(x), y: center(row) });
  }

  start(x: number, row: number): void {
    if (this.startPt) throw new Error(`start() called twice (second at ${x},${row}) — exactly one per act`);
    this.startPt = { x: center(x), y: center(row) };
  }

  goal(x: number, row: number): void {
    if (this.goalTile) throw new Error(`goal() called twice (second at ${x},${row}) — exactly one per act`);
    this.goalTile = { tx: x, row };
  }

  /** Boss arena: records BuiltLevel.arena and lays flat ground x0..x1 at
   *  floorRow. Does NOT place the goal — the act author calls goal() inside
   *  the arena themselves (finish() validates that it landed inside). */
  arena(x0: number, x1: number, floorRow: number): void {
    this.span(x0, x1, 'arena');
    if (this.arenaTiles) throw new Error(`arena() called twice (second at ${x0}..${x1}) — one per act`);
    this.arenaTiles = { x0, x1, floorRow };
    this.ground(x0, x1, floorRow);
  }

  /** Validate and assemble the BuiltLevel. `boss` acts must have an arena;
   *  any arena must contain the goal. Throws with `label` in the message. */
  finish(opts: { label?: string; boss?: boolean } = {}): BuiltLevel {
    const label = opts.label ?? 'act';
    if (!this.startPt) throw new Error(`${label}: no start() — exactly one player start is required`);
    if (!this.goalTile) throw new Error(`${label}: no goal() — exactly one goal is required`);
    if (opts.boss && !this.arenaTiles) {
      throw new Error(`${label}: castle act (boss) has no arena() — Bowsonaro needs a stage to grandstand on`);
    }
    if (this.arenaTiles) {
      const { x0, x1 } = this.arenaTiles;
      if (this.goalTile.tx < x0 || this.goalTile.tx > x1) {
        throw new Error(
          `${label}: goal at tile ${this.goalTile.tx} sits outside the arena ${x0}..${x1} — the goal must be inside the arena`,
        );
      }
    }
    return {
      map: this.map,
      start: this.startPt,
      goalX: center(this.goalTile.tx),
      goalRow: this.goalTile.row,
      enemies: this.enemies,
      coins: this.coins,
      goldbars: this.goldbars,
      secrets: this.secrets,
      springs: this.springs,
      checkpoints: this.checkpoints,
      blockContents: this.blockContents,
      arena: this.arenaTiles
        ? { x0: center(this.arenaTiles.x0), x1: center(this.arenaTiles.x1), floorRow: this.arenaTiles.floorRow }
        : null,
    };
  }
}

/** Run a LevelDef's build() on a fresh builder and validate the result. */
export function buildLevel(def: LevelDef): BuiltLevel {
  const b = new LevelBuilder(def.width, def.height ?? WORLD_H_TILES);
  def.build(b);
  return b.finish({ label: def.id, boss: def.boss });
}
