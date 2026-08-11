// ============================================================================
// Shared test scaffolding. DEPENDENCY-FREE on purpose: imports ONLY the
// contract (core/types.ts) and the tuning table (core/constants.ts), so every
// test file can use it without pulling in modules other agents are writing.
// ============================================================================

import type {
  InputState, PlayerLike, Solidity, TileKind, TileMapLike,
} from '../src/core/types.ts';
import { SOLIDITY, TILE } from '../src/core/constants.ts';

/** Row-string legend for StubMap. Unknown characters THROW — no silent tiles. */
const CHAR_TILE: Record<string, TileKind> = {
  '#': 'ground',
  '=': 'oneway',
  '^': 'spike',
  '~': 'lava',
  'B': 'brick',
  '?': 'qblock',
  '.': 'empty',
};

/** Minimal TileMapLike built from string rows. Implements the out-of-bounds
 *  contract: bedrock on all sides except open sky above the map top. */
export class StubMap implements TileMapLike {
  readonly wTiles: number;
  readonly hTiles: number;
  readonly pixelW: number;
  readonly pixelH: number;
  private readonly grid: TileKind[][];

  constructor(rows: readonly string[]) {
    if (rows.length === 0) throw new Error('StubMap: no rows');
    const w = rows[0]!.length;
    this.grid = rows.map((row, ry) => {
      if (row.length !== w) {
        throw new Error(`StubMap: row ${ry} width ${row.length} != ${w}`);
      }
      return [...row].map((ch, rx) => {
        const kind = CHAR_TILE[ch];
        if (kind === undefined) {
          throw new Error(`StubMap: unknown tile char '${ch}' at ${rx},${ry}`);
        }
        return kind;
      });
    });
    this.wTiles = w;
    this.hTiles = rows.length;
    this.pixelW = w * TILE;
    this.pixelH = rows.length * TILE;
  }

  tileAt(tx: number, ty: number): TileKind {
    if (tx < 0 || tx >= this.wTiles) return 'bedrock';
    if (ty < 0) return 'empty'; // open sky above the map top
    if (ty >= this.hTiles) return 'bedrock';
    return this.grid[ty]![tx]!;
  }

  setTile(tx: number, ty: number, k: TileKind): void {
    if (tx < 0 || tx >= this.wTiles || ty < 0 || ty >= this.hTiles) {
      throw new Error(`StubMap.setTile out of bounds: ${tx},${ty}`);
    }
    this.grid[ty]![tx] = k;
  }

  solidAtPx(px: number, py: number): Solidity {
    return SOLIDITY[this.tileAt(Math.floor(px / TILE), Math.floor(py / TILE))];
  }
}

export function makeMap(rows: string[]): StubMap {
  return new StubMap(rows);
}

/** Fill a full InputState from a partial (everything defaults to false). */
export function makeInput(partial: Partial<InputState> = {}): InputState {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    jump: false,
    jumpPressed: false,
    run: false,
    firePressed: false,
    pausePressed: false,
    ...partial,
  };
}

/** Run n fixed steps with the same (filled) input each step. Note: `*Pressed`
 *  edges passed here re-fire EVERY step — use n=1 for a single press. */
export function stepN(
  p: PlayerLike,
  map: TileMapLike,
  n: number,
  input: Partial<InputState> = {},
): void {
  const full = makeInput(input);
  for (let i = 0; i < n; i++) p.update(full, map);
}
