import { describe, it, expect } from 'vitest';
import { TileMap, TILE_ORD, ORD_TILE } from '../src/game/tilemap.ts';
import { SOLIDITY, TILE } from '../src/core/constants.ts';
import type { TileKind } from '../src/core/types.ts';

const ALL_KINDS = Object.keys(TILE_ORD) as TileKind[];

describe('TileMap basics', () => {
  it('starts all empty with correct pixel dimensions', () => {
    const m = new TileMap(20, 12);
    expect(m.wTiles).toBe(20);
    expect(m.hTiles).toBe(12);
    expect(m.pixelW).toBe(20 * TILE);
    expect(m.pixelH).toBe(12 * TILE);
    for (let ty = 0; ty < 12; ty++) {
      for (let tx = 0; tx < 20; tx++) {
        expect(m.tileAt(tx, ty)).toBe('empty');
      }
    }
  });

  it('round-trips every TileKind through set/get', () => {
    const m = new TileMap(ALL_KINDS.length, 2);
    ALL_KINDS.forEach((k, i) => m.setTile(i, 1, k));
    ALL_KINDS.forEach((k, i) => expect(m.tileAt(i, 1)).toBe(k));
  });

  it('keeps TILE_ORD and ORD_TILE in exact agreement', () => {
    expect(ORD_TILE.length).toBe(ALL_KINDS.length);
    for (const k of ALL_KINDS) expect(ORD_TILE[TILE_ORD[k]]).toBe(k);
  });

  it('floors fractional tile coords', () => {
    const m = new TileMap(8, 8);
    m.setTile(2, 3, 'ground');
    expect(m.tileAt(2.7, 3.2)).toBe('ground');
    expect(m.tileAt(2.99, 3.99)).toBe('ground');
    expect(m.tileAt(3.01, 3.5)).toBe('empty');
  });

  it('rejects invalid dimensions', () => {
    expect(() => new TileMap(0, 10)).toThrow(/positive/);
    expect(() => new TileMap(10, -3)).toThrow(/positive/);
    expect(() => new TileMap(10.5, 10)).toThrow(/positive/);
  });

  it('setTile throws out of bounds and on non-integers', () => {
    const m = new TileMap(8, 8);
    expect(() => m.setTile(-1, 4, 'ground')).toThrow(/out of bounds/);
    expect(() => m.setTile(8, 4, 'ground')).toThrow(/out of bounds/);
    expect(() => m.setTile(4, -1, 'ground')).toThrow(/out of bounds/);
    expect(() => m.setTile(4, 8, 'ground')).toThrow(/out of bounds/);
    expect(() => m.setTile(2.5, 4, 'ground')).toThrow(/integer/);
  });
});

describe('TileMap out-of-bounds semantics', () => {
  const m = new TileMap(10, 6);

  it('left / right of the map read as bedrock; below is OPEN VOID', () => {
    expect(m.tileAt(-1, 3)).toBe('bedrock');
    expect(m.tileAt(10, 3)).toBe('bedrock');
    // Below the bottom is empty — falling out must be lethal (a sealed
    // bedrock bottom once made every pit riskless and voided void-death).
    expect(m.tileAt(4, 6)).toBe('empty');
    expect(m.tileAt(4, 100)).toBe('empty');
    // ...but the side walls still win below the map: no escaping sideways.
    expect(m.tileAt(-1, 100)).toBe('bedrock');
    expect(m.tileAt(10, 100)).toBe('bedrock');
  });

  it('above the map top reads as empty (no headbonk over the top edge)', () => {
    expect(m.tileAt(4, -1)).toBe('empty');
    expect(m.tileAt(0, -50)).toBe('empty');
    expect(m.tileAt(9, -1)).toBe('empty');
  });

  it('side walls win over sky in the corners above the map', () => {
    expect(m.tileAt(-1, -1)).toBe('bedrock');
    expect(m.tileAt(10, -5)).toBe('bedrock');
  });
});

describe('TileMap solidity sampling', () => {
  it('maps every TileKind through SOLIDITY at pixel positions', () => {
    for (const k of ALL_KINDS) {
      const m = new TileMap(6, 6);
      m.setTile(2, 3, k);
      expect(m.solidAtPx(2 * TILE + 8, 3 * TILE + 8)).toBe(SOLIDITY[k]);
    }
  });

  it('samples tile edges into the correct tile', () => {
    const m = new TileMap(6, 6);
    m.setTile(2, 3, 'ground');
    expect(m.solidAtPx(2 * TILE, 3 * TILE)).toBe('solid'); // top-left corner belongs to the tile
    expect(m.solidAtPx(3 * TILE, 3 * TILE)).toBe('pass'); // next tile over is empty
    expect(m.solidAtPx(2 * TILE - 1, 3 * TILE)).toBe('pass');
  });

  it('treats out-of-bounds pixels per the OOB rules', () => {
    const m = new TileMap(6, 6);
    expect(m.solidAtPx(-5, 40)).toBe('solid'); // left wall
    expect(m.solidAtPx(6 * TILE + 5, 40)).toBe('solid'); // right wall
    expect(m.solidAtPx(40, 6 * TILE + 5)).toBe('pass'); // OPEN VOID below
    expect(m.solidAtPx(40, -5)).toBe('pass'); // open sky
  });
});
