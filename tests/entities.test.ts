// Entity behavior proofs. Self-contained: local TileMapLike / PlayerLike
// stubs (tests/helpers.ts is owned by another agent — do not import it).
import { describe, expect, it } from 'vitest';
import type {
  EntityCtx,
  GameEvent,
  PlayerLike,
  Solidity,
  TileKind,
  TileMapLike,
} from '../src/core/types.ts';
import { PHYS, SOLIDITY, TILE } from '../src/core/constants.ts';
import { createRng, RNG_STREAM } from '../src/core/rng.ts';
import {
  spawnCheckpoint,
  spawnEnemy,
  spawnPen,
  spawnPickup,
  spawnPowerup,
  spawnSpring,
} from '../src/game/entities.ts';

class StubMap implements TileMapLike {
  readonly pixelW: number;
  readonly pixelH: number;
  private readonly tiles: TileKind[];
  constructor(
    readonly wTiles: number,
    readonly hTiles: number,
  ) {
    this.pixelW = wTiles * TILE;
    this.pixelH = hTiles * TILE;
    this.tiles = new Array<TileKind>(wTiles * hTiles).fill('empty');
  }
  tileAt(tx: number, ty: number): TileKind {
    if (ty < 0) return 'empty'; // open sky
    if (tx < 0 || tx >= this.wTiles || ty >= this.hTiles) return 'bedrock';
    return this.tiles[ty * this.wTiles + tx]!;
  }
  setTile(tx: number, ty: number, k: TileKind): void {
    if (tx >= 0 && tx < this.wTiles && ty >= 0 && ty < this.hTiles) {
      this.tiles[ty * this.wTiles + tx] = k;
    }
  }
  solidAtPx(px: number, py: number): Solidity {
    return SOLIDITY[this.tileAt(Math.floor(px / TILE), Math.floor(py / TILE))];
  }
  ground(tx0: number, tx1: number, ty: number): void {
    for (let x = tx0; x <= tx1; x++) this.setTile(x, ty, 'ground');
  }
}

function stubPlayer(x: number, y: number): PlayerLike {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: false,
    ducking: false,
    skidding: false,
    size: 'small',
    immunityT: 0,
    invulnT: 0,
    dead: false,
    events: [],
    bumpedTile: null,
    halfW: 6,
    halfH: 7,
    update() {},
    bounce() {},
    hurt() {
      return true;
    },
    grow() {},
    respawn() {},
  };
}

interface Emitted {
  ev: GameEvent;
  x: number;
  y: number;
}

function makeCtx(map: TileMapLike, player: PlayerLike): { ctx: EntityCtx; emits: Emitted[] } {
  const emits: Emitted[] = [];
  const rng = createRng(42 ^ RNG_STREAM.entities);
  const ctx: EntityCtx = {
    map,
    player,
    emit: (ev, x, y) => emits.push({ ev, x, y }),
    rand: rng,
  };
  return { ctx, emits };
}

/** Platform map: solid ground tiles 2..5 on row 10 (surface at y=160),
 *  nothing on either side, deep empty space below (map bottom is bedrock). */
function platformMap(): StubMap {
  const m = new StubMap(40, 20);
  m.ground(2, 5, 10);
  return m;
}

/** Wide floor across row 10. */
function floorMap(wTiles = 60): StubMap {
  const m = new StubMap(wTiles, 20);
  m.ground(0, wTiles - 1, 10);
  return m;
}

const SURFACE = 10 * TILE; // 160

describe('walkers vs ledges', () => {
  it('lobbyist turns at the ledge and never falls off the platform', () => {
    const map = platformMap();
    const p = stubPlayer(600, 0); // far away: no contacts
    const { ctx } = makeCtx(map, p);
    const e = spawnEnemy('lobbyist', 40, SURFACE - 7);
    let turns = 0;
    let prevFacing = e.facing;
    for (let i = 0; i < 900; i++) {
      e.update(ctx);
      if (e.facing !== prevFacing) {
        turns++;
        prevFacing = e.facing;
      }
      expect(e.y).toBeLessThan(SURFACE); // feet never below the surface
      expect(e.x).toBeGreaterThan(2 * TILE);
      expect(e.x).toBeLessThan(6 * TILE);
    }
    expect(e.alive).toBe(true);
    expect(turns).toBeGreaterThanOrEqual(2); // it patrols, it does not stall
  });

  it('pollster walks straight off the ledge and falls', () => {
    const map = platformMap();
    const p = stubPlayer(600, 0);
    const { ctx } = makeCtx(map, p);
    const e = spawnEnemy('pollster', 40, SURFACE - 8);
    e.facing = 1;
    let fell = false;
    for (let i = 0; i < 900 && !fell; i++) {
      e.update(ctx);
      if (e.y > SURFACE + TILE) fell = true;
    }
    expect(fell).toBe(true);
  });

  it('rat ignores ledges, falls, survives and keeps walking below', () => {
    const map = platformMap();
    map.ground(0, 39, 15); // lower floor to land on (surface y=240)
    const p = stubPlayer(600, 0);
    const { ctx } = makeCtx(map, p);
    const e = spawnEnemy('rat', 40, SURFACE - 5);
    for (let i = 0; i < 600; i++) e.update(ctx);
    expect(e.alive).toBe(true);
    expect(e.y).toBeCloseTo(15 * TILE - 5, 0); // standing on the lower floor
  });
});

describe('contact decision', () => {
  it('falling player with feet above center => stomped (enemy squashes)', () => {
    const map = floorMap();
    const p = stubPlayer(100, 145);
    p.vy = 2;
    const { ctx } = makeCtx(map, p);
    const e = spawnEnemy('lobbyist', 100, SURFACE - 7);
    expect(e.update(ctx)).toBe('stomped');
    expect(e.dyingT).toBeGreaterThan(0);
    // While dying: no AI, no contacts, then alive flips false.
    expect(e.update(ctx)).toBe('none');
    for (let i = 0; i < 30; i++) e.update(ctx);
    expect(e.alive).toBe(false);
  });

  it('side contact (not falling) => hurt', () => {
    const map = floorMap();
    const p = stubPlayer(108, SURFACE - 7);
    const { ctx } = makeCtx(map, p);
    const e = spawnEnemy('lobbyist', 100, SURFACE - 7);
    expect(e.update(ctx)).toBe('hurt');
    expect(e.alive).toBe(true);
  });

  it('hurt-box is shrunk 2px per side: a grazing overlap is forgiven', () => {
    const map = floorMap();
    // Full boxes (6+7=13) would overlap at dx=12; shrunk (11) must not.
    const p = stubPlayer(112, SURFACE - 7);
    const { ctx } = makeCtx(map, p);
    const e = spawnEnemy('lobbyist', 100, SURFACE - 7);
    e.facing = -1; // walk away so the gap does not close this step
    expect(e.update(ctx)).toBe('none');
  });

  it('immune player: enemy flips dead, emits enemy-flip, no contact', () => {
    const map = floorMap();
    const p = stubPlayer(100, SURFACE - 7);
    p.immunityT = 600;
    const { ctx, emits } = makeCtx(map, p);
    const e = spawnEnemy('lobbyist', 100, SURFACE - 7);
    expect(e.update(ctx)).toBe('none');
    expect(e.dyingT).toBeGreaterThan(0);
    expect(emits.some((m) => m.ev === 'enemy-flip')).toBe(true);
    for (let i = 0; i < 60; i++) e.update(ctx);
    expect(e.alive).toBe(false);
  });
});

describe('pollster -> shell -> kick chain', () => {
  it('stomp converts to a shell, touch kicks it, moving shell hurts', () => {
    const map = floorMap();
    const p = stubPlayer(100, 145);
    p.vy = 2;
    const { ctx, emits } = makeCtx(map, p);
    const e = spawnEnemy('pollster', 100, SURFACE - 8);

    // 1) stomp -> becomes shell, no dying animation
    expect(e.update(ctx)).toBe('stomped');
    expect(e.kind).toBe('shell');
    expect(e.dyingT).toBe(0);
    expect(e.alive).toBe(true);

    // 2) parked shell stays put with the player far away
    p.x = 600;
    p.y = 0;
    p.vy = 0;
    for (let i = 0; i < 10; i++) e.update(ctx);
    expect(e.vx).toBe(0);

    // 3) touched from the left -> kicked away rightward, no damage
    p.x = e.x - 10;
    p.y = e.y;
    expect(e.update(ctx)).toBe('none');
    expect(e.vx).toBeGreaterThan(0);
    expect(emits.some((m) => m.ev === 'shell-kick')).toBe(true);

    // 4) moving shell on side contact -> hurt
    p.x = e.x + e.vx + 8; // where the shell will be after its move step
    p.y = e.y;
    expect(e.update(ctx)).toBe('hurt');
  });

  it('shell slides off ledges and despawns 100px below the map', () => {
    // Abyss variant: below the map there is nothing at all, so the shell can
    // actually leave the world and must silently despawn (base rule).
    class AbyssMap extends StubMap {
      override tileAt(tx: number, ty: number): TileKind {
        if (ty >= this.hTiles) return 'empty';
        return super.tileAt(tx, ty);
      }
    }
    const map = new AbyssMap(40, 40);
    map.ground(2, 5, 10);
    const p = stubPlayer(600, 0);
    const { ctx } = makeCtx(map, p);
    const e = spawnEnemy('pollster', 40, SURFACE - 8);
    // stomp it into a shell
    p.x = 40;
    p.y = 145;
    p.vy = 2;
    expect(e.update(ctx)).toBe('stomped');
    // kick it toward the right edge of the platform
    p.x = e.x - 10;
    p.y = e.y;
    p.vy = 0;
    e.update(ctx);
    expect(e.vx).toBeGreaterThan(0);
    p.x = 600;
    p.y = 0;
    let offLedge = false;
    for (let i = 0; i < 600; i++) {
      e.update(ctx);
      if (e.y > SURFACE + TILE) offLedge = true;
    }
    expect(offLedge).toBe(true); // it did fly off the ledge
    expect(e.alive).toBe(false); // and despawned below the map, no lingering
  });
});

describe('lawyer (pipe plant)', () => {
  const MOUTH_Y = 128;

  it('rises on its cycle when the player is away', () => {
    const map = floorMap();
    const p = stubPlayer(600, SURFACE - 7); // 432px away: mercy not engaged
    const { ctx } = makeCtx(map, p);
    const e = spawnEnemy('lawyer', 168, MOUTH_Y);
    let rose = false;
    for (let i = 0; i < 200; i++) {
      e.update(ctx);
      if (e.y < MOUTH_Y - 10) rose = true;
    }
    expect(rose).toBe(true);
  });

  it('stays hidden while the player stands within 24px (classic mercy)', () => {
    const map = floorMap();
    const p = stubPlayer(168 + 20, SURFACE - 7); // 20px away: inside mercy
    const { ctx } = makeCtx(map, p);
    const e = spawnEnemy('lawyer', 168, MOUTH_Y);
    for (let i = 0; i < 400; i++) {
      expect(e.update(ctx)).toBe('none');
      expect(e.y).toBeGreaterThanOrEqual(MOUTH_Y); // never above hidden base
    }
  });

  it('is never stompable: overlap while risen hurts even from above', () => {
    const map = floorMap();
    const p = stubPlayer(600, SURFACE - 7);
    const { ctx } = makeCtx(map, p);
    const e = spawnEnemy('lawyer', 168, MOUTH_Y);
    // let it rise fully: hidden 90 + rise 60, then some hold
    for (let i = 0; i < 160; i++) e.update(ctx);
    expect(e.y).toBeLessThan(MOUTH_Y - 20);
    p.x = e.x;
    p.y = e.y - 10;
    p.vy = 2; // a would-be stomp
    expect(e.update(ctx)).toBe('hurt');
  });
});

describe('gavel (ambient thwomp)', () => {
  it('far player: never slams, never emits — idle silence', () => {
    const map = floorMap(120);
    const p = stubPlayer(200 + 1000, SURFACE - 7); // way beyond AMBIENT_RANGE
    const { ctx, emits } = makeCtx(map, p);
    const e = spawnEnemy('gavel', 200, 100);
    for (let i = 0; i < 600; i++) e.update(ctx);
    expect(emits.length).toBe(0);
    expect(e.y).toBe(100); // still hovering
  });

  it('near player below: slams to the floor, emits gavel-slam, rises back', () => {
    const map = floorMap();
    const p = stubPlayer(210, SURFACE - 7);
    const { ctx, emits } = makeCtx(map, p);
    const e = spawnEnemy('gavel', 200, 100);
    let maxY = e.y;
    for (let i = 0; i < 300; i++) {
      e.update(ctx);
      maxY = Math.max(maxY, e.y);
    }
    expect(maxY).toBeCloseTo(SURFACE - 10, 0); // reached the floor
    expect(emits.filter((m) => m.ev === 'gavel-slam').length).toBeGreaterThanOrEqual(1);
    // and it returns to its hover height to re-arm
    let backUp = false;
    for (let i = 0; i < 300; i++) {
      p.x = 2000; // player leaves; gavel must still finish its cycle
      e.update(ctx);
      if (e.y === 100) backUp = true;
    }
    expect(backUp).toBe(true);
  });

  it('emit itself is distance-gated: triggered near, player teleports far, slam lands silently', () => {
    const map = floorMap(200);
    const p = stubPlayer(210, SURFACE - 7);
    const { ctx, emits } = makeCtx(map, p);
    const e = spawnEnemy('gavel', 200, 100);
    e.update(ctx); // trigger the slam while near
    p.x = 3000; // now the player sprints away before impact
    let maxY = e.y;
    for (let i = 0; i < 120; i++) {
      e.update(ctx);
      maxY = Math.max(maxY, e.y);
    }
    expect(maxY).toBeCloseTo(SURFACE - 10, 0); // it DID slam to the floor…
    expect(emits.filter((m) => m.ev === 'gavel-slam').length).toBe(0); // …silently
  });
});

describe('pen projectile', () => {
  it('flies, bounces on the floor, and dies on a wall', () => {
    const map = floorMap();
    map.setTile(20, 8, 'ground'); // wall at px 320..336
    map.setTile(20, 9, 'ground');
    const p = stubPlayer(600, 0);
    const { ctx } = makeCtx(map, p);
    const e = spawnPen(280, 150, 1);
    expect(e.vx).toBe(PHYS.penSpeed);
    let frames = 0;
    while (e.alive && frames < 60) {
      e.update(ctx);
      frames++;
    }
    expect(e.alive).toBe(false); // died on the wall
    expect(e.x).toBeLessThan(20 * TILE + 1);
  });

  it('bounces off floors (vy flips negative) and expires at penLife', () => {
    const map = floorMap(80);
    const p = stubPlayer(600, 0);
    const { ctx } = makeCtx(map, p);
    const e = spawnPen(100, 150, 1);
    let bounced = false;
    for (let i = 0; i < PHYS.penLife - 1; i++) {
      e.update(ctx);
      if (e.vy < 0) bounced = true;
      expect(e.alive).toBe(true);
    }
    expect(bounced).toBe(true);
    e.update(ctx);
    e.update(ctx);
    expect(e.alive).toBe(false); // penLife expiry
  });

  it('reports no player contact — pens only fly (Level resolves hits)', () => {
    const map = floorMap();
    const p = stubPlayer(108, 150);
    const { ctx } = makeCtx(map, p);
    const e = spawnPen(100, 150, 1);
    expect(e.update(ctx)).toBe('none');
  });
});

describe('pickups, powerups, spring, checkpoint', () => {
  it('coin/goldbar/secret report pickup once and die; index is kept', () => {
    const map = floorMap();
    const p = stubPlayer(100, SURFACE - 7);
    const { ctx } = makeCtx(map, p);
    const coin = spawnPickup('coin', 100, SURFACE - 8);
    expect(coin.update(ctx)).toBe('pickup');
    expect(coin.alive).toBe(false);
    const bar = spawnPickup('goldbar', 100, SURFACE - 8, 3);
    expect(bar.index).toBe(3);
    expect(bar.update(ctx)).toBe('pickup');
    const secret = spawnPickup('secret', 400, SURFACE - 8, 1);
    expect(secret.update(ctx)).toBe('none'); // player nowhere near
    expect(secret.alive).toBe(true);
  });

  it('powerup emerges, then reports pickup on overlap and carries its kind', () => {
    const map = floorMap();
    const p = stubPlayer(600, 0);
    const { ctx } = makeCtx(map, p);
    const e = spawnPowerup('stamp', 100, SURFACE - 8);
    expect(e.powerup).toBe('stamp');
    const y0 = e.y;
    for (let i = 0; i < 32; i++) e.update(ctx); // emerge phase
    expect(e.y).toBeLessThan(y0); // rose out of the block
    p.x = e.x;
    p.y = e.y;
    expect(e.update(ctx)).toBe('pickup');
    expect(e.alive).toBe(false);
  });

  it('immunity powerup bounces on the floor', () => {
    const map = floorMap();
    const p = stubPlayer(600, 0);
    const { ctx } = makeCtx(map, p);
    const e = spawnPowerup('immunity', 100, SURFACE - 8);
    let wentUp = false;
    for (let i = 0; i < 300; i++) {
      e.update(ctx);
      if (e.vy < -1) wentUp = true;
    }
    expect(wentUp).toBe(true); // it bounced at least once
    expect(e.alive).toBe(true);
  });

  it('spring: contact is always none; triggered flags the compress step only', () => {
    const map = floorMap();
    const spring = spawnSpring(100, SURFACE - 8); // top at y=144
    const p = stubPlayer(100, 138); // feet at 145, just into the top band
    p.vy = 3;
    const { ctx } = makeCtx(map, p);
    expect(spring.update(ctx)).toBe('none');
    expect(spring.triggered).toBe(true);
    p.vy = -5; // launched (by Level) — flag must reset
    expect(spring.update(ctx)).toBe('none');
    expect(spring.triggered).toBe(false);
  });

  it('checkpoint claims once, then stays alive but inert', () => {
    const map = floorMap();
    const p = stubPlayer(100, SURFACE - 7);
    const { ctx } = makeCtx(map, p);
    const e = spawnCheckpoint(100, SURFACE - 14);
    expect(e.update(ctx)).toBe('pickup');
    expect(e.alive).toBe(true);
    expect(e.update(ctx)).toBe('none');
    expect(e.update(ctx)).toBe('none');
  });
});

describe('housekeeping contracts', () => {
  it('animT free-runs on every entity, every frame, even while dying', () => {
    const map = floorMap();
    const p = stubPlayer(100, 145);
    p.vy = 2;
    const { ctx } = makeCtx(map, p);
    const e = spawnEnemy('lobbyist', 100, SURFACE - 7);
    e.update(ctx); // stomped -> dying
    const t0 = e.animT;
    e.update(ctx);
    e.update(ctx);
    expect(e.animT).toBe(t0 + 2);
  });

  it('every spawnable kind constructs and updates headless without touching the DOM', () => {
    const map = floorMap();
    const p = stubPlayer(600, 0);
    const { ctx } = makeCtx(map, p);
    const all = [
      spawnEnemy('lobbyist', 100, 150),
      spawnEnemy('pollster', 100, 150),
      spawnEnemy('lawyer', 100, 128),
      spawnEnemy('paparazzo', 100, 100),
      spawnEnemy('rat', 100, 150),
      spawnEnemy('chipstack', 100, 150),
      spawnEnemy('gavel', 100, 100),
      spawnPickup('coin', 100, 150),
      spawnPickup('goldbar', 100, 150, 0),
      spawnPickup('secret', 100, 150, 0),
      spawnSpring(100, 150),
      spawnCheckpoint(100, 150),
      spawnPowerup('stamp', 100, 150),
      spawnPowerup('goldpen', 100, 150),
      spawnPowerup('immunity', 100, 150),
      spawnPen(100, 150, -1),
    ];
    for (const e of all) {
      for (let i = 0; i < 120; i++) e.update(ctx);
      expect(e.animT).toBe(120);
    }
  });
});
