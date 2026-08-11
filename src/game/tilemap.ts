// ============================================================================
// TileMap — the collision/terrain grid. A flat Uint8Array of TileKind
// ordinals. Pure simulation data: no DOM, no clocks, no randomness.
//
// Out-of-bounds semantics (contract, see TileMapLike in types.ts):
//   - left / right / below the map  -> 'bedrock'  (the world is walled in)
//   - above the map top (ty < 0)    -> 'empty'    (open sky; jumping over the
//     top edge must never headbonk). Side walls win over sky: an OOB column
//     is 'bedrock' at ANY ty, including negative ones, so the player cannot
//     escape sideways by flying above the map.
// ============================================================================

import type { Solidity, TileKind, TileMapLike } from '../core/types.ts';
import { SOLIDITY, TILE } from '../core/constants.ts';

/** TileKind -> byte ordinal. Exhaustive over TileKind: a new tile kind does
 *  not compile until it gets an ordinal here. 0 MUST stay 'empty' (fresh
 *  Uint8Array is zero-filled). */
export const TILE_ORD: Record<TileKind, number> = {
  empty: 0,
  ground: 1,
  bedrock: 2,
  brick: 3,
  qblock: 4,
  usedblock: 5,
  oneway: 6,
  pipe: 7,
  spike: 8,
  lava: 9,
  crumble: 10,
};

/** Ordinal -> TileKind, derived from TILE_ORD so the two can never drift.
 *  Built strictly: a gap or duplicate ordinal throws at module load. */
export const ORD_TILE: readonly TileKind[] = (() => {
  const kinds = Object.keys(TILE_ORD) as TileKind[];
  const arr: TileKind[] = new Array<TileKind>(kinds.length);
  const seen = new Set<number>();
  for (const k of kinds) {
    const ord = TILE_ORD[k];
    if (!Number.isInteger(ord) || ord < 0 || ord >= kinds.length) {
      throw new Error(`TILE_ORD['${k}'] = ${ord} is out of the dense range 0..${kinds.length - 1}`);
    }
    if (seen.has(ord)) throw new Error(`TILE_ORD ordinal ${ord} assigned twice (at '${k}')`);
    seen.add(ord);
    arr[ord] = k;
  }
  return arr;
})();

export class TileMap implements TileMapLike {
  readonly wTiles: number;
  readonly hTiles: number;
  readonly pixelW: number;
  readonly pixelH: number;
  private readonly tiles: Uint8Array;

  constructor(wTiles: number, hTiles: number) {
    if (!Number.isInteger(wTiles) || wTiles <= 0 || !Number.isInteger(hTiles) || hTiles <= 0) {
      throw new Error(`TileMap dimensions must be positive integers, got ${wTiles}x${hTiles}`);
    }
    this.wTiles = wTiles;
    this.hTiles = hTiles;
    this.pixelW = wTiles * TILE;
    this.pixelH = hTiles * TILE;
    this.tiles = new Uint8Array(wTiles * hTiles); // zero-filled = all 'empty'
  }

  tileAt(tx: number, ty: number): TileKind {
    const x = Math.floor(tx);
    const y = Math.floor(ty);
    if (x < 0 || x >= this.wTiles) return 'bedrock'; // side walls (any height)
    if (y < 0) return 'empty'; // open sky above the top
    if (y >= this.hTiles) return 'bedrock'; // sealed floor below
    const ord = this.tiles[y * this.wTiles + x];
    if (ord === undefined) throw new Error(`TileMap index out of range at ${x},${y}`); // unreachable, satisfies noUncheckedIndexedAccess honestly
    const kind = ORD_TILE[ord];
    if (kind === undefined) throw new Error(`TileMap holds unknown tile ordinal ${ord} at ${x},${y}`);
    return kind;
  }

  setTile(tx: number, ty: number, k: TileKind): void {
    if (!Number.isInteger(tx) || !Number.isInteger(ty)) {
      throw new Error(`setTile needs integer tile coords, got ${tx},${ty}`);
    }
    if (tx < 0 || tx >= this.wTiles || ty < 0 || ty >= this.hTiles) {
      throw new Error(`setTile out of bounds: ${tx},${ty} on a ${this.wTiles}x${this.hTiles} map`);
    }
    const ord = TILE_ORD[k];
    if (ord === undefined) throw new Error(`setTile: unknown tile kind '${String(k)}'`);
    this.tiles[ty * this.wTiles + tx] = ord;
  }

  /** Solidity sampled at a pixel position (px/py in world pixels). */
  solidAtPx(px: number, py: number): Solidity {
    return SOLIDITY[this.tileAt(Math.floor(px / TILE), Math.floor(py / TILE))];
  }
}
