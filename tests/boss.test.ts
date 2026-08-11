// Bowsonaro staged-fight proofs. Self-contained: local TileMapLike /
// PlayerLike stubs (tests/helpers.ts is owned by another agent — no import).
import { describe, expect, it } from 'vitest';
import type {
  EntityCtx,
  GameEvent,
  PlayerLike,
  Solidity,
  TileKind,
  TileMapLike,
} from '../src/core/types.ts';
import { BOSS, SOLIDITY, TILE } from '../src/core/constants.ts';
import { createRng, RNG_STREAM } from '../src/core/rng.ts';
import { Bowsonaro } from '../src/game/boss.ts';

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
    if (ty < 0) return 'empty';
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
}

function stubPlayer(x: number, y: number): PlayerLike {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: true,
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

const ARENA = { x0: 100, x1: 500, floorRow: 12 };
const FLOOR_Y = ARENA.floorRow * TILE; // 192

function makeWorld(): { map: StubMap; p: PlayerLike; ctx: EntityCtx; emits: Emitted[] } {
  const map = new StubMap(40, 20);
  for (let tx = 0; tx < 40; tx++) map.setTile(tx, ARENA.floorRow, 'ground');
  const p = stubPlayer(150, FLOOR_Y - 7);
  const emits: Emitted[] = [];
  const ctx: EntityCtx = {
    map,
    player: p,
    emit: (ev, x, y) => emits.push({ ev, x, y }),
    rand: createRng(7 ^ RNG_STREAM.entities),
  };
  return { map, p, ctx, emits };
}

function count(emits: Emitted[], ev: GameEvent): number {
  return emits.filter((m) => m.ev === ev).length;
}

/** Land one clean stomp, then retreat and wait out the stagger. */
function stompOnce(boss: Bowsonaro, ctx: EntityCtx, p: PlayerLike): void {
  p.x = boss.x;
  p.y = boss.y - 12;
  p.vy = 2;
  expect(boss.update(ctx)).toBe('stomped');
  p.x = 150;
  p.y = FLOOR_Y - 7;
  p.vy = 0;
  for (let i = 0; i < 60; i++) boss.update(ctx);
}

describe('Bowsonaro phases', () => {
  it('stays off (silent, immobile) until the Level flips him on', () => {
    const { ctx, emits } = makeWorld();
    const boss = new Bowsonaro(ARENA, false);
    const x0 = boss.x;
    for (let i = 0; i < 60; i++) expect(boss.update(ctx)).toBe('none');
    expect(boss.phase).toBe('off');
    expect(boss.x).toBe(x0);
    expect(emits.length).toBe(0);
    expect(boss.animT).toBe(60); // the free clock still runs
  });

  it('intro roars boss-intro exactly once, then fights after 120f', () => {
    const { ctx, emits } = makeWorld();
    const boss = new Bowsonaro(ARENA, false);
    boss.phase = 'intro'; // the Level flips this when the player crosses x0
    boss.update(ctx);
    expect(count(emits, 'boss-intro')).toBe(1);
    for (let i = 0; i < 119; i++) boss.update(ctx);
    expect(boss.phase).toBe('fight');
    expect(count(emits, 'boss-intro')).toBe(1); // once, not per frame
  });

  it('staged fight (rage=false): 3 stomps -> escape, jetpack up-right, shots cleared', () => {
    const { ctx, emits, p } = makeWorld();
    const boss = new Bowsonaro(ARENA, false);
    expect(boss.hp).toBe(BOSS.hp);
    boss.phase = 'intro';
    for (let i = 0; i < 121; i++) boss.update(ctx);
    expect(boss.phase).toBe('fight');

    for (let s = 0; s < BOSS.hp; s++) stompOnce(boss, ctx, p);

    expect(boss.hp).toBe(0);
    expect(boss.phase).toBe('escape');
    expect(count(emits, 'boss-hit')).toBe(BOSS.hp);
    expect(count(emits, 'boss-escape')).toBe(1);
    expect(count(emits, 'boss-defeat')).toBe(0);
    expect(boss.shots.length).toBe(0);

    // jetpack: up and to the right, then inert
    const x0 = boss.x;
    const y0 = boss.y;
    for (let i = 0; i < 90; i++) expect(boss.update(ctx)).toBe('none');
    expect(boss.x).toBeGreaterThan(x0);
    expect(boss.y).toBeLessThan(y0);
    const xEnd = boss.x;
    for (let i = 0; i < 30; i++) boss.update(ctx);
    expect(boss.x).toBe(xEnd); // flown off; now inert
  });

  it('rage fight: 5 stomps -> defeated (no escape), boss-defeat emitted once', () => {
    const { ctx, emits, p } = makeWorld();
    const boss = new Bowsonaro(ARENA, true);
    expect(boss.hp).toBe(BOSS.rageHp);
    boss.phase = 'intro';
    for (let i = 0; i < 121; i++) boss.update(ctx);

    for (let s = 0; s < BOSS.rageHp; s++) stompOnce(boss, ctx, p);

    expect(boss.phase).toBe('defeated');
    expect(count(emits, 'boss-hit')).toBe(BOSS.rageHp);
    expect(count(emits, 'boss-defeat')).toBe(1);
    expect(count(emits, 'boss-escape')).toBe(0);
    expect(boss.shots.length).toBe(0);
    // defeated = inert heap
    const x0 = boss.x;
    for (let i = 0; i < 30; i++) expect(boss.update(ctx)).toBe('none');
    expect(boss.x).toBe(x0);
  });

  it('pen path: Level decrements hp externally; boss notices and exits', () => {
    const { ctx, p } = makeWorld();
    const boss = new Bowsonaro(ARENA, false);
    boss.phase = 'intro';
    for (let i = 0; i < 121; i++) boss.update(ctx);
    p.x = 150;
    boss.hp = 0; // three pen hits, resolved by the Level
    boss.update(ctx);
    expect(boss.phase).toBe('escape');
  });
});

describe('Bowsonaro decrees', () => {
  it('shots spawn on the cadence, fly toward the player, and despawn', () => {
    const { ctx, emits, p } = makeWorld();
    const boss = new Bowsonaro(ARENA, false);
    boss.phase = 'intro';
    for (let i = 0; i < 121; i++) boss.update(ctx);
    p.x = 150; // player parked left of the boss, out of reach

    for (let i = 0; i < BOSS.shotEvery; i++) boss.update(ctx);
    expect(count(emits, 'boss-shot')).toBe(1);
    expect(boss.shots.length).toBe(1);
    expect(boss.shots[0]!.vx).toBeLessThan(0); // aimed at the player (left)

    for (let i = 0; i < BOSS.shotEvery * 2; i++) boss.update(ctx);
    expect(count(emits, 'boss-shot')).toBe(3);
    // paper stops at the floor: old decrees are gone, never accumulated
    expect(boss.shots.length).toBeLessThanOrEqual(1);
  });

  it('a decree overlapping the player reports hurt and crumples', () => {
    const { ctx, p } = makeWorld();
    const boss = new Bowsonaro(ARENA, false);
    boss.phase = 'intro';
    for (let i = 0; i < 121; i++) boss.update(ctx);
    // run until a shot exists, then teleport the player onto its path
    let frames = 0;
    while (boss.shots.length === 0 && frames < 600) {
      boss.update(ctx);
      frames++;
    }
    expect(boss.shots.length).toBeGreaterThan(0);
    // let it fly well clear of the boss's body first, then step into it
    for (let i = 0; i < 25; i++) boss.update(ctx);
    expect(boss.shots.length).toBe(1);
    const s = boss.shots[0]!;
    p.x = s.x + s.vx;
    p.y = s.y + s.vy; // roughly where it will be next step
    const c = boss.update(ctx);
    expect(c).toBe('hurt');
    expect(boss.shots.length).toBe(0); // crumpled on impact
  });
});

describe('Bowsonaro contact model', () => {
  it('side body contact hurts; stagger after a stomp gives a free retreat', () => {
    const { ctx, p } = makeWorld();
    const boss = new Bowsonaro(ARENA, false);
    boss.phase = 'intro';
    for (let i = 0; i < 121; i++) boss.update(ctx);
    // side contact: player level with his center, not falling
    p.x = boss.x - 10;
    p.y = boss.y;
    p.vy = 0;
    expect(boss.update(ctx)).toBe('hurt');
    // stomp, then immediately overlap again: stagger skips body contact
    p.x = boss.x;
    p.y = boss.y - 12;
    p.vy = 2;
    expect(boss.update(ctx)).toBe('stomped');
    p.vy = 0;
    p.y = boss.y;
    p.x = boss.x - 10;
    expect(boss.update(ctx)).toBe('none');
  });

  it('an immune player is not hurt by body contact and cannot cheese a kill', () => {
    const { ctx, p } = makeWorld();
    const boss = new Bowsonaro(ARENA, false);
    boss.phase = 'intro';
    for (let i = 0; i < 121; i++) boss.update(ctx);
    p.immunityT = 600;
    p.x = boss.x - 10;
    p.y = boss.y;
    p.vy = 0;
    expect(boss.update(ctx)).toBe('none');
    expect(boss.hp).toBe(BOSS.hp); // immunity does not damage a boss
  });
});
