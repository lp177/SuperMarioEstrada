// ============================================================================
// THE SOLO DEATH SEQUENCE ("cinematic when we die") and the RUN HEAT band of
// Level.intensity. Pure sim tests, plain Node.
//
// Death, staged (solo): the corpse holds perfectly still for 12 frames, then
// the classic launch (vy = -5.5) fires and it falls through the set on dead
// physics — while the WHOLE WORLD holds its breath (entities frozen, camera
// parked) and the score ducks (intensity 0) under the ~1.8 s death jingle.
// Co-op is explicitly NOT held — bubbles never freeze the live partner
// (tests/level-coop.test.ts guards that side; this file guards solo).
// ============================================================================

import { describe, expect, it } from 'vitest';
import type { GameEvent, InputState, LevelBuilderLike, LevelDef } from '../src/core/types.ts';
import { PHYS } from '../src/core/constants.ts';
import { Level } from '../src/game/level.ts';

function inp(over: Partial<InputState> = {}): InputState {
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
    swapPressed: false,
    ...over,
  };
}

function makeDef(width: number, build: (b: LevelBuilderLike) => void): LevelDef {
  return {
    id: 'w1a1',
    world: 1,
    act: 1,
    title: 'Fiduciary Meadows',
    excuse: 'The corpse required a notarized burial permit. Processing.',
    theme: 'meadow',
    width,
    build,
  };
}

/** Flat solo meadow with one walker far from the start. */
function soloWithWalker(width = 120): Level {
  return new Level(
    makeDef(width, (b) => {
      b.ground(0, width - 1, 30);
      b.start(3, 29);
      b.enemy('lobbyist', 40, 29);
      b.goal(width - 4, 29);
    }),
  );
}

function run(level: Level, frames: number, input: InputState): GameEvent[] {
  const all: GameEvent[] = [];
  for (let i = 0; i < frames; i++) all.push(...level.update(input));
  return all;
}

/** Kill the solo player via the void and step once (the death step). */
function dieNow(level: Level): GameEvent[] {
  level.player.y = level.map.pixelH + 100;
  return level.update(inp());
}

describe('solo death: the staged pop', () => {
  it('holds the corpse perfectly still for 12 frames, then launches it upward', () => {
    const level = soloWithWalker();
    run(level, 5, inp());
    const evs = dieNow(level);
    const p = level.player;
    expect(evs).toContain('die');
    expect(p.dead).toBe(true);
    expect(p.vx).toBe(0);
    expect(p.vy).toBe(0); // staged: no motion until the pop

    const y0 = p.y;
    run(level, 12, inp()); // the stillness beat (elapsed 0..11)
    expect(p.y).toBe(y0);
    expect(p.vy).toBe(0);

    level.update(inp()); // elapsed 12: the classic launch
    expect(p.vy).toBeLessThan(0);
    expect(p.y).toBeLessThan(y0);

    // ...and from here it is a gravity-only fall through everything.
    run(level, 40, inp());
    expect(p.y).toBeGreaterThan(y0);
  });

  it('respawns at the checkpoint when the sequence ends (within the classic window)', () => {
    const level = soloWithWalker();
    dieNow(level);
    expect(level.stats.deaths).toBe(1);
    const tape = run(level, 120, inp());
    expect(tape).toContain('respawn');
    expect(level.player.dead).toBe(false);
    expect(level.stats.deaths).toBe(1); // the sequence never double-counts
  });
});

describe('solo death: the world holds its breath', () => {
  it('freezes entities during the sequence and wakes them after respawn', () => {
    const level = soloWithWalker();
    run(level, 10, inp());
    const walker = level.entities.find((e) => e.kind === 'lobbyist');
    expect(walker).toBeDefined();

    // alive world: the walker walks
    const xAlive = walker!.x;
    level.update(inp());
    expect(walker!.x).not.toBe(xAlive);

    dieNow(level);
    const xHeld = walker!.x;
    const tape = run(level, 60, inp());
    expect(walker!.x, 'the world must hold its breath').toBe(xHeld);
    expect(tape, 'no respawn mid-sequence').not.toContain('respawn');

    // finish the sequence; the world breathes again
    expect(run(level, 60, inp())).toContain('respawn');
    const xBack = walker!.x;
    level.update(inp());
    expect(walker!.x).not.toBe(xBack);
  });

  it('parks the camera for the whole sequence', () => {
    const level = soloWithWalker(200);
    // get moving so the camera has been following
    run(level, 90, inp({ right: true, run: true }));
    dieNow(level);
    const camX = level.camera.x;
    run(level, 60, inp({ right: true })); // input is ignored by a corpse
    expect(level.camera.x).toBe(camX);
  });
});

describe('Level.intensity: the death duck and the run-heat band', () => {
  it('is 0 for the whole solo death sequence and recovers after respawn', () => {
    const level = soloWithWalker();
    run(level, 5, inp());
    expect(level.intensity).toBeGreaterThan(0);
    dieNow(level);
    expect(level.intensity).toBe(0);
    run(level, 60, inp());
    expect(level.intensity).toBe(0); // still ducked mid-sequence
    run(level, 60, inp());
    expect(level.player.dead).toBe(false);
    expect(level.intensity).toBeGreaterThanOrEqual(0.28); // un-ducked
  });

  it('charged full run sits in its own hot band, clear of walking', () => {
    const level = soloWithWalker(300);
    // walking cruise (sampled BEFORE the P-speed auto-charge breaks into a
    // run — sustained walking is DESIGNED to earn the run band eventually):
    // never hot.
    run(level, 20, inp({ right: true }));
    expect(Math.abs(level.player.vx)).toBeLessThanOrEqual(PHYS.walkMax + 0.01);
    expect(level.intensity).toBeLessThan(0.5);
    // full run: the dedicated hot band (>= music.ts's HOT_NOISE_AT = 0.7)
    run(level, 120, inp({ right: true, run: true }));
    expect(Math.abs(level.player.vx)).toBeCloseTo(PHYS.runMax, 1);
    expect(level.player.grounded).toBe(true);
    expect(level.intensity).toBeGreaterThanOrEqual(0.7);
    expect(level.intensity).toBeCloseTo(0.75, 2);
  });
});
