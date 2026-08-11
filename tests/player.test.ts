// Player feel-core tests. Plain Node, no DOM, fully deterministic.

import { describe, it, expect } from 'vitest';
import type { GameEvent, InputState, TileMapLike } from '../src/core/types.ts';
import { PHYS, TILE } from '../src/core/constants.ts';
import { Player } from '../src/game/player.ts';
import { makeInput, makeMap, stepN, StubMap } from './helpers.ts';

// ---------------------------------------------------------------------------
// scaffolding
// ---------------------------------------------------------------------------

const SKY_ROWS = 12;
const FLOOR_TOP = SKY_ROWS * TILE; // 192: top edge of the flat-map floor

function flatMap(w = 40): StubMap {
  const rows: string[] = [];
  for (let r = 0; r < SKY_ROWS; r++) rows.push('.'.repeat(w));
  rows.push('#'.repeat(w));
  rows.push('#'.repeat(w));
  return makeMap(rows);
}

/** Small player standing exactly on the flat-map floor. */
function smallOnFloor(x: number): Player {
  return new Player({ x, y: FLOOR_TOP - PHYS.smallHalf[1] });
}

/** One step; returns the events raised that step. */
function step1(
  p: Player,
  map: TileMapLike,
  input: Partial<InputState> = {},
): GameEvent[] {
  p.update(makeInput(input), map);
  return [...p.events];
}

/** Jump from the floor; returns total rise in px (start y - apex y). */
function apexRise(hold: boolean): number {
  const map = flatMap();
  const p = smallOnFloor(64);
  stepN(p, map, 5, {}); // settle onto the floor
  const y0 = p.y;
  p.update(makeInput({ jump: true, jumpPressed: true }), map);
  let minY = p.y;
  for (let i = 0; i < 200; i++) {
    p.update(makeInput(hold ? { jump: true } : {}), map);
    minY = Math.min(minY, p.y);
    if (p.grounded) break;
  }
  return y0 - minY;
}

// ---------------------------------------------------------------------------
// basics
// ---------------------------------------------------------------------------

describe('Player: standing and walking', () => {
  it('stands still on flat ground: no drift, no events', () => {
    const map = flatMap();
    const p = smallOnFloor(160);
    const x0 = p.x;
    const all: GameEvent[] = [];
    for (let i = 0; i < 60; i++) all.push(...step1(p, map));
    expect(all).toEqual([]);
    expect(p.x).toBe(x0);
    expect(p.vx).toBe(0);
    expect(p.grounded).toBe(true);
    expect(p.y + p.halfH).toBe(FLOOR_TOP);
  });

  it('accelerates to walkMax and never beyond; no landing spam while walking', () => {
    const map = flatMap(80);
    const p = smallOnFloor(48);
    stepN(p, map, 2, {}); // settle
    const all: GameEvent[] = [];
    for (let i = 0; i < 200; i++) {
      all.push(...step1(p, map, { right: true }));
      expect(p.vx).toBeLessThanOrEqual(PHYS.walkMax);
    }
    expect(p.vx).toBe(PHYS.walkMax);
    expect(p.facing).toBe(1);
    expect(all).toEqual([]); // walking raises nothing — no 'land' spam
  });

  it('runs to runMax and never beyond', () => {
    const map = flatMap(120);
    const p = smallOnFloor(48);
    stepN(p, map, 2, {});
    for (let i = 0; i < 300; i++) {
      step1(p, map, { right: true, run: true });
      expect(p.vx).toBeLessThanOrEqual(PHYS.runMax);
    }
    expect(p.vx).toBe(PHYS.runMax);
  });

  it('friction stops the player when input released', () => {
    const map = flatMap(80);
    const p = smallOnFloor(48);
    stepN(p, map, 60, { right: true });
    expect(p.vx).toBeGreaterThan(0);
    stepN(p, map, 60, {});
    expect(p.vx).toBe(0);
  });

  it('skids when reversing: one skid event, speed drops, facing flips', () => {
    const map = flatMap(160);
    const p = smallOnFloor(48);
    stepN(p, map, 300, { right: true, run: true });
    expect(p.vx).toBe(PHYS.runMax);
    const ev1 = step1(p, map, { left: true });
    expect(ev1).toContain('skid');
    expect(p.skidding).toBe(true);
    expect(p.vx).toBeLessThan(PHYS.runMax);
    expect(p.facing).toBe(-1);
    const ev2 = step1(p, map, { left: true });
    expect(ev2).not.toContain('skid'); // latched: one event per skid
  });
});

// ---------------------------------------------------------------------------
// the historical spring-eating bug
// ---------------------------------------------------------------------------

describe('Player: speed above the cap is never eaten', () => {
  it('bounce(true) + externally-set vx=6 survives holding right (walk)', () => {
    const map = flatMap(90);
    const p = smallOnFloor(64);
    stepN(p, map, 2, {});
    p.vx = 6; // e.g. shell ride / spring launch set this
    p.bounce(true);
    expect(p.vy).toBe(PHYS.bounceHold);
    for (let i = 0; i < 40; i++) {
      step1(p, map, { right: true });
      expect(p.vx).toBe(6); // never clamped down to walkMax, never boosted
    }
  });

  it('same while run is held, including after landing back on the ground', () => {
    const map = flatMap(90);
    const p = smallOnFloor(64);
    stepN(p, map, 2, {});
    p.vx = 6;
    p.bounce(true);
    let sawGround = false;
    for (let i = 0; i < 60; i++) {
      step1(p, map, { right: true, run: true });
      if (p.grounded) sawGround = true;
      expect(p.vx).toBe(6);
    }
    expect(sawGround).toBe(true); // the invariant held on the ground too
  });

  it('bounce clears the jumping flag (gravHold must not stretch a bounce)', () => {
    const map = flatMap();
    const p = smallOnFloor(64);
    stepN(p, map, 2, {});
    step1(p, map, { jump: true, jumpPressed: true }); // real jump: jumping=true
    p.bounce(false);
    expect(p.vy).toBe(PHYS.bounce);
    // While rising with jump held, gravity must be the heavy one now.
    const vyBefore = p.vy;
    step1(p, map, { jump: true });
    expect(p.vy - vyBefore).toBeCloseTo(PHYS.grav, 10);
  });
});

// ---------------------------------------------------------------------------
// jumping
// ---------------------------------------------------------------------------

describe('Player: jumping', () => {
  it('held jump rises at least 4 tiles; tap rises at least 2 and much less', () => {
    const held = apexRise(true);
    const tapped = apexRise(false);
    expect(held).toBeGreaterThanOrEqual(4 * TILE);
    expect(held).toBeLessThanOrEqual(10 * TILE); // sanity ceiling
    expect(tapped).toBeGreaterThanOrEqual(2 * TILE);
    expect(tapped).toBeLessThan(held - TILE);
  });

  it('raises exactly one jump event and one land event per hop', () => {
    const map = flatMap();
    const p = smallOnFloor(64);
    stepN(p, map, 2, {});
    const all: GameEvent[] = [];
    all.push(...step1(p, map, { jump: true, jumpPressed: true }));
    for (let i = 0; i < 200 && !p.grounded; i++) {
      all.push(...step1(p, map, { jump: true }));
    }
    expect(all.filter((e) => e === 'jump')).toHaveLength(1);
    expect(all.filter((e) => e === 'land')).toHaveLength(1);
  });

  it('coyote time: jump still fires a few frames after walking off a ledge', () => {
    const rows: string[] = [];
    for (let r = 0; r < SKY_ROWS; r++) rows.push('.'.repeat(40));
    rows.push('#'.repeat(20) + '.'.repeat(20));
    rows.push('#'.repeat(20) + '.'.repeat(20));
    const map = makeMap(rows);
    const p = smallOnFloor(18 * TILE);
    stepN(p, map, 2, {});
    let guard = 0;
    while (p.grounded && guard++ < 300) step1(p, map, { right: true });
    expect(p.grounded).toBe(false);
    stepN(p, map, 3, { right: true }); // 3 more airborne frames — within coyote
    const ev = step1(p, map, { right: true, jump: true, jumpPressed: true });
    expect(ev).toContain('jump');
    expect(p.vy).toBeLessThan(0);
  });

  it('no coyote jump after the window expires', () => {
    const rows: string[] = [];
    for (let r = 0; r < SKY_ROWS; r++) rows.push('.'.repeat(40));
    rows.push('#'.repeat(20) + '.'.repeat(20));
    rows.push('#'.repeat(20) + '.'.repeat(20));
    const map = makeMap(rows);
    const p = smallOnFloor(18 * TILE);
    stepN(p, map, 2, {});
    let guard = 0;
    while (p.grounded && guard++ < 300) step1(p, map, { right: true });
    stepN(p, map, PHYS.coyote + 2, { right: true }); // past the window
    const ev = step1(p, map, { jump: true, jumpPressed: true });
    expect(ev).not.toContain('jump');
    expect(p.vy).toBeGreaterThan(0); // still falling
  });

  it('jump buffer: a press 4 frames before landing jumps on landing', () => {
    const map = flatMap();
    // First, measure frames-to-land from a 3-tile drop.
    const probe = new Player({ x: 64, y: FLOOR_TOP - PHYS.smallHalf[1] - 48 });
    let n = 0;
    while (!probe.grounded && n < 300) {
      stepN(probe, map, 1, {});
      n++;
    }
    expect(n).toBeGreaterThan(6);
    // Now the real run: press jump 4 frames before that landing frame.
    const p = new Player({ x: 64, y: FLOOR_TOP - PHYS.smallHalf[1] - 48 });
    stepN(p, map, n - 4, {});
    expect(p.grounded).toBe(false);
    step1(p, map, { jumpPressed: true });
    const all: GameEvent[] = [];
    for (let i = 0; i < 6; i++) all.push(...step1(p, map));
    expect(all).toContain('land');
    expect(all).toContain('jump');
    expect(p.vy).toBeLessThan(0);
  });

  it('run-speed jump gets the bonus impulse', () => {
    const map = flatMap(160);
    const p = smallOnFloor(48);
    stepN(p, map, 300, { right: true, run: true });
    expect(p.vx).toBe(PHYS.runMax);
    step1(p, map, { right: true, run: true, jump: true, jumpPressed: true });
    // vy = jump + jumpRunBonus, then one frame of gravHold
    expect(p.vy).toBeCloseTo(PHYS.jump + PHYS.jumpRunBonus + PHYS.gravHold, 10);
  });
});

// ---------------------------------------------------------------------------
// ducking
// ---------------------------------------------------------------------------

describe('Player: ducking', () => {
  const tunnelRows = [
    '......######', // ceiling over the tunnel (tx >= 6)
    '............',
    '############', // floor: top edge at y=32
  ];

  it('certified ducks: box shrinks, feet stay put; small cannot duck', () => {
    const map = makeMap(tunnelRows);
    // Spawn small (a fresh player IS small); grow preserves the feet line.
    const big = new Player({ x: 48, y: 32 - PHYS.smallHalf[1] });
    big.grow('stamp');
    expect(big.size).toBe('certified');
    stepN(big, map, 2, {});
    stepN(big, map, 2, { down: true });
    expect(big.ducking).toBe(true);
    expect(big.halfH).toBe(PHYS.duckHalf[1]);
    expect(big.y + big.halfH).toBe(32); // feet preserved

    const small = new Player({ x: 48, y: 32 - PHYS.smallHalf[1] });
    stepN(small, map, 4, { down: true });
    expect(small.ducking).toBe(false);
  });

  it('cannot unduck under a 1-tile ceiling; unducks once clear', () => {
    const map = makeMap(tunnelRows);
    const p = new Player({ x: 136, y: 32 - PHYS.duckHalf[1] }); // inside tunnel
    p.size = 'certified';
    p.ducking = true;
    p.halfH = PHYS.duckHalf[1];
    stepN(p, map, 2, { down: true });
    expect(p.ducking).toBe(true);
    stepN(p, map, 5, {}); // down released — but the ceiling pins us
    expect(p.ducking).toBe(true);
    expect(p.halfH).toBe(PHYS.duckHalf[1]);
    p.x = 48; // teleport to the open area
    stepN(p, map, 2, {});
    expect(p.ducking).toBe(false);
    expect(p.halfH).toBe(PHYS.bigHalf[1]);
    expect(p.y + p.halfH).toBe(32); // feet preserved through the unduck
  });

  it('ducking kills acceleration but keeps friction', () => {
    const map = flatMap(80);
    const p = smallOnFloor(48);
    p.grow('stamp');
    stepN(p, map, 60, { right: true });
    const v0 = p.vx;
    expect(v0).toBeGreaterThan(0);
    stepN(p, map, 10, { right: true, down: true }); // duck + hold right
    expect(p.ducking).toBe(true);
    expect(p.vx).toBeLessThan(v0); // friction still bites, no acceleration
    stepN(p, map, 120, { right: true, down: true });
    expect(p.vx).toBe(0); // slid to a stop while ducking despite held input
  });
});

// ---------------------------------------------------------------------------
// tiles: oneway, head-bump
// ---------------------------------------------------------------------------

describe('Player: tile interactions', () => {
  it('oneway: passable rising from below, solid landing from above', () => {
    const rows = [
      '..........',
      '..........',
      '..........',
      '...====...', // oneway top edge at y=48
      '..........',
      '..........',
      '##########', // floor top at y=96
    ];
    const map = makeMap(rows);
    const p = new Player({ x: 80, y: 96 - PHYS.smallHalf[1] });
    stepN(p, map, 2, {});
    step1(p, map, { jump: true, jumpPressed: true });
    for (let i = 0; i < 300 && !p.grounded; i++) step1(p, map, { jump: true });
    expect(p.grounded).toBe(true);
    expect(p.y + p.halfH).toBe(48); // landed ON the oneway, from below

    const above = new Player({ x: 80, y: 48 - PHYS.smallHalf[1] - 20 });
    for (let i = 0; i < 120 && !above.grounded; i++) step1(above, map);
    expect(above.grounded).toBe(true);
    expect(above.y + above.halfH).toBe(48); // solid from above
  });

  it('head-bump zeroes vy and reports a qblock; plain ground reports nothing', () => {
    const qRows = [
      '..........',
      '....?.....', // qblock at tx=4, ty=1
      '..........',
      '..........',
      '##########',
    ];
    const map = makeMap(qRows);
    const p = new Player({ x: 72, y: 4 * TILE - PHYS.smallHalf[1] });
    stepN(p, map, 2, {});
    step1(p, map, { jump: true, jumpPressed: true });
    let bumped: { tx: number; ty: number } | null = null;
    for (let i = 0; i < 60 && bumped === null; i++) {
      step1(p, map, { jump: true });
      if (p.bumpedTile) bumped = { ...p.bumpedTile };
    }
    expect(bumped).toEqual({ tx: 4, ty: 1 });

    const bRows = qRows.map((r) => r.replace('?', 'B'));
    const bMap = makeMap(bRows);
    const pb = new Player({ x: 72, y: 4 * TILE - PHYS.smallHalf[1] });
    stepN(pb, bMap, 2, {});
    step1(pb, bMap, { jump: true, jumpPressed: true });
    let brickBumped: { tx: number; ty: number } | null = null;
    for (let i = 0; i < 60 && brickBumped === null; i++) {
      step1(pb, bMap, { jump: true });
      if (pb.bumpedTile) brickBumped = { ...pb.bumpedTile };
    }
    expect(brickBumped).toEqual({ tx: 4, ty: 1 });

    const gRows = qRows.map((r) => r.replace('?', '#'));
    const gMap = makeMap(gRows);
    const pg = new Player({ x: 72, y: 4 * TILE - PHYS.smallHalf[1] });
    stepN(pg, gMap, 2, {});
    step1(pg, gMap, { jump: true, jumpPressed: true });
    let sawCeilingStop = false;
    for (let i = 0; i < 60; i++) {
      step1(pg, gMap, { jump: true });
      expect(pg.bumpedTile).toBeNull(); // ground is not bumpable
      if (pg.vy === 0 && !pg.grounded) sawCeilingStop = true;
    }
    expect(sawCeilingStop).toBe(true); // it did hit the ceiling, silently
  });

  it('walls stop horizontal motion', () => {
    const rows: string[] = [];
    for (let r = 0; r < SKY_ROWS; r++) {
      rows.push('.'.repeat(19) + '#' + '.'.repeat(20));
    }
    rows.push('#'.repeat(40));
    rows.push('#'.repeat(40));
    const map = makeMap(rows);
    const p = smallOnFloor(16 * TILE);
    stepN(p, map, 200, { right: true, run: true });
    expect(p.vx).toBe(0);
    expect(p.x + p.halfW).toBeLessThanOrEqual(19 * TILE);
    expect(p.x + p.halfW).toBeGreaterThan(19 * TILE - 2); // flush against it
  });
});

// ---------------------------------------------------------------------------
// damage ladder, death, respawn
// ---------------------------------------------------------------------------

describe('Player: hurt ladder and death', () => {
  it('goldpen -> certified -> small -> dead, with invuln windows', () => {
    const map = flatMap();
    const p = smallOnFloor(160);
    stepN(p, map, 2, {});
    p.grow('stamp');
    expect(p.size).toBe('certified');
    p.grow('goldpen');
    expect(p.size).toBe('goldpen');

    expect(p.hurt(p.x + 10)).toBe(true); // attacker on the right
    expect(p.size).toBe('certified');
    expect(p.invulnT).toBe(PHYS.invuln);
    expect(p.vx).toBeLessThan(0); // knocked away, to the left
    expect(p.events).toContain('hurt');

    expect(p.hurt(p.x)).toBe(false); // invuln window holds
    expect(p.size).toBe('certified');

    p.invulnT = 0;
    expect(p.hurt(p.x - 10)).toBe(true); // attacker on the left
    expect(p.size).toBe('small');
    expect(p.vx).toBeGreaterThan(0); // knocked right
    expect(p.halfH).toBe(PHYS.smallHalf[1]);

    p.invulnT = 0;
    expect(p.hurt(p.x)).toBe(true);
    expect(p.dead).toBe(true);
    expect(p.events).toContain('die');
    expect(p.hurt(p.x)).toBe(false); // a corpse cannot be re-hurt
  });

  it('invulnerability counts down; parliamentary immunity blocks damage', () => {
    const map = flatMap();
    const p = smallOnFloor(160);
    stepN(p, map, 2, {});
    p.grow('immunity');
    expect(p.immunityT).toBe(PHYS.immunity);
    stepN(p, map, 10, {});
    expect(p.immunityT).toBe(PHYS.immunity - 10);
    expect(p.hurt(p.x + 5)).toBe(false);
    expect(p.size).toBe('small'); // untouched

    const q = smallOnFloor(160);
    stepN(q, map, 2, {});
    q.grow('stamp');
    q.hurt(q.x + 5);
    const t0 = q.invulnT;
    stepN(q, map, 7, {});
    expect(q.invulnT).toBe(t0 - 7);
  });

  it('a dead player is inert: falls through everything, emits nothing', () => {
    const map = flatMap();
    const p = smallOnFloor(160);
    stepN(p, map, 2, {});
    p.hurt(p.x); // small -> dead
    expect(p.dead).toBe(true);
    for (let i = 0; i < 150; i++) {
      const ev = step1(p, map, {
        right: true,
        jump: true,
        jumpPressed: true,
        down: true,
      });
      expect(ev).toEqual([]);
      expect(p.bumpedTile).toBeNull();
      expect(p.vy).toBeLessThanOrEqual(PHYS.maxFall);
    }
    expect(p.y).toBeGreaterThan(FLOOR_TOP + 100); // fell through the floor
    expect(p.bounce.bind(p)).not.toThrow();
    expect(p.vy).toBeLessThanOrEqual(PHYS.maxFall); // bounce() ignored a corpse
  });

  it('respawn resets to small at the spawn point with a grace window', () => {
    const map = flatMap();
    const p = smallOnFloor(160);
    stepN(p, map, 2, {});
    p.grow('stamp');
    p.invulnT = 0;
    p.hurt(p.x);
    p.invulnT = 0;
    p.hurt(p.x);
    expect(p.dead).toBe(true);
    const animBefore = p.animT;
    p.respawn({ x: 100, y: 50 });
    expect(p.dead).toBe(false);
    expect(p.size).toBe('small');
    expect(p.x).toBe(100);
    expect(p.y).toBe(50);
    expect(p.vx).toBe(0);
    expect(p.vy).toBe(0);
    expect(p.invulnT).toBe(90);
    expect(p.events).toContain('respawn');
    expect(p.animT).toBe(animBefore); // the animation clock free-runs
    stepN(p, map, 300, {});
    expect(p.grounded).toBe(true); // lands and lives again
  });
});
