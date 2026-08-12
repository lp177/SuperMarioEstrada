// ============================================================================
// Two-hero Level tests: local co-op (two bodies, bubbles, shared ledger) and
// the solo hero swap. Also a solo regression tape — the one-player path must
// keep producing the classic event sequence the existing suite established.
// ============================================================================

import { describe, expect, it } from 'vitest';
import type {
  GameEvent,
  InputState,
  LevelBuilderLike,
  LevelDef,
} from '../src/core/types.ts';
import { TILE } from '../src/core/constants.ts';
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
    excuse: 'The rescue was double-booked. Both parties were notified.',
    theme: 'meadow',
    width,
    build,
  };
}

/** A plain co-op meadow: flat ground, start at tile 3, goal near the end. */
function flatCoop(width = 80, extra?: (b: LevelBuilderLike) => void): Level {
  return new Level(
    makeDef(width, (b) => {
      b.ground(0, width - 1, 30);
      b.start(3, 29);
      extra?.(b);
      b.goal(width - 4, 29);
    }),
    { coop: true },
  );
}

/** Run `frames` steps with fixed (edge-free) inputs; returns all events. */
function run(level: Level, frames: number, in1: InputState, in2?: InputState): GameEvent[] {
  const all: GameEvent[] = [];
  for (let i = 0; i < frames; i++) all.push(...level.update(in1, in2));
  return all;
}

describe('co-op: two bodies', () => {
  it('spawns P1 mangiani and P2 estrada 20px right; solo spawns one body', () => {
    const coop = flatCoop();
    expect(coop.players.length).toBe(2);
    expect(coop.player).toBe(coop.players[0]);
    expect(coop.players[0]!.character).toBe('mangiani');
    expect(coop.players[1]!.character).toBe('estrada');
    expect(coop.players[1]!.x - coop.players[0]!.x).toBe(20);
    expect(coop.players[0]!.bubbleT).toBe(0);
    expect(coop.players[1]!.bubbleT).toBe(0);

    const solo = new Level(
      makeDef(60, (b) => {
        b.ground(0, 59, 30);
        b.start(3, 29);
        b.goal(56, 29);
      }),
    );
    expect(solo.players.length).toBe(1);
    expect(solo.players[0]).toBe(solo.player);
  });

  it('bodies move independently: P1 runs right while P2 stands still', () => {
    const level = flatCoop();
    const p1 = level.players[0]!;
    const p2 = level.players[1]!;
    const p2x = p2.x;
    run(level, 60, inp({ right: true }), inp());
    expect(p1.x).toBeGreaterThan(56 + 50); // start px 56, well underway
    expect(p2.x).toBe(p2x); // untouched channel, untouched body
    expect(p2.vx).toBe(0);
  });

  it('P2 collects coins and goldbars into the SHARED stats (one ledger)', () => {
    const level = flatCoop(80, (b) => {
      b.coin(20, 29);
      b.goldbar(0, 25, 29);
    });
    // P1 idles at the start; P2 sprints right through both pickups. At each
    // pickup moment P1 must still be far away — the collector was P2.
    const evs: GameEvent[] = [];
    for (let i = 0; i < 240; i++) {
      const step = level.update(inp(), inp({ right: true, run: true }));
      if (step.includes('coin') || step.includes('goldbar')) {
        expect(level.players[0]!.x).toBeLessThan(15 * TILE); // P1 nowhere near
      }
      evs.push(...step);
    }
    expect(evs).toContain('coin');
    expect(evs).toContain('goldbar');
    expect(level.stats.coins).toBe(1);
    expect(level.stats.goldbars[0]).toBe(true);
    // and the camera followed the LEADER (P2), not the idle P1
    expect(level.camera.x).toBeGreaterThan(50);
  });

  it('an enemy targets the NEAREST active body', () => {
    const level = flatCoop(80, (b) => {
      // high cruise line: the drone never touches anyone in one step
      b.enemy('paparazzo', 20, 25);
    });
    // Before any step, park P2 just RIGHT of the drone; P1 stays far LEFT.
    const p2 = level.players[1]!;
    p2.x = 20 * TILE + 60;
    level.update(inp(), inp());
    const pap = level.entities.find((e) => e.kind === 'paparazzo');
    expect(pap).toBeDefined();
    // Its first retarget flies toward the nearest body (P2, to its right).
    // Had it read P1 (far left), facing would be -1.
    expect(pap!.facing).toBe(1);
  });
});

describe('co-op: bubbles (death is free, wipes are not)', () => {
  it('P2 death -> free bubble -> drifts to the leader -> hovers -> pops on its jump edge', () => {
    const level = flatCoop(120);
    const p1 = level.players[0]!;
    const p2 = level.players[1]!;

    // P2 falls out of the world.
    p2.y = level.map.pixelH + 100;
    const evs = level.update(inp(), inp());
    expect(evs).toContain('die');
    expect(p2.dead).toBe(true);
    expect(p2.bubbleT).toBe(90);
    expect(level.stats.deaths).toBe(0); // bubbling is FREE
    expect(level.finished).toBe(false);

    // The bubble drifts toward the leader (P1) at a fixed speed.
    const dist = (): number => Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const d0 = dist();
    run(level, 30, inp(), inp());
    const d1 = dist();
    expect(d1).toBeLessThan(d0);
    // ~2.5 px/frame (measured to the leader's center; the drift itself aims
    // at the hover point 24px above, hence the small tolerance)
    expect(d0 - d1).toBeGreaterThan(70);
    expect(d0 - d1).toBeLessThan(80);

    // A jump press while still counting down does NOT pop.
    level.update(inp(), inp({ jump: true, jumpPressed: true }));
    expect(p2.dead).toBe(true);
    expect(p2.bubbleT).toBeGreaterThan(1);

    // After the countdown it hovers near the leader, still a bubble.
    run(level, 150, inp(), inp());
    expect(p2.bubbleT).toBe(1); // holds >0 while hovering: still drawn as a bubble
    expect(Math.abs(p2.x - p1.x)).toBeLessThan(1);
    expect(Math.abs(p2.y - (p1.y - 24))).toBeLessThan(1);

    // Its channel's jump edge pops it back in at the leader, with grace.
    const popEvs = level.update(inp(), inp({ jump: true, jumpPressed: true }));
    expect(popEvs).toContain('hero-swap'); // the pop shares the morph blip
    expect(p2.dead).toBe(false);
    expect(p2.bubbleT).toBe(0);
    expect(p2.invulnT).toBe(60); // pop grace, NOT the 90f classic respawn grace
    expect(Math.abs(p2.x - p1.x)).toBeLessThan(1);
    expect(level.stats.deaths).toBe(0); // still free
    const src = level.eventSources.get('hero-swap');
    expect(src).toBeDefined();

    // Popped body plays again: it can walk.
    const x0 = p2.x;
    run(level, 30, inp(), inp({ right: true }));
    expect(p2.x).toBeGreaterThan(x0 + 20);
  });

  it('a full wipe counts ONE death and respawns everyone at the checkpoint', () => {
    const level = flatCoop(120);
    const p1 = level.players[0]!;
    const p2 = level.players[1]!;
    const startX = p1.x;

    // Both fall out of the world on the same step: P1 bubbles first (P2 was
    // still alive when it died), then P2's death finds no active partner —
    // that is the wipe, and the only counted death.
    p1.y = level.map.pixelH + 100;
    p2.y = level.map.pixelH + 100;
    const evs = level.update(inp(), inp());
    expect(evs.filter((e) => e === 'die').length).toBeGreaterThanOrEqual(1);
    expect(level.stats.deaths).toBe(1);

    // Classic death timer, then EVERYONE returns.
    const evs2 = run(level, 120, inp(), inp());
    expect(evs2.filter((e) => e === 'respawn').length).toBe(2);
    expect(p1.dead).toBe(false);
    expect(p2.dead).toBe(false);
    expect(p1.bubbleT).toBe(0);
    expect(p2.bubbleT).toBe(0);
    expect(p1.x).toBeCloseTo(startX, 3);
    expect(p2.x).toBeCloseTo(startX + 20, 3);
    expect(level.stats.deaths).toBe(1); // the wipe counted once, nothing since
  });
});

describe('co-op: goal', () => {
  it('P2 alone crossing the goal runs the ceremony for the team', () => {
    const level = flatCoop(40);
    let goalFrame = -1;
    let flagFrame = -1;
    for (let i = 0; i < 900 && flagFrame < 0; i++) {
      const evs = level.update(inp(), inp({ right: true, run: true }));
      if (goalFrame < 0 && evs.includes('goal')) goalFrame = i;
      if (evs.includes('flag-plant')) flagFrame = i;
    }
    expect(goalFrame).toBeGreaterThan(0);
    expect(flagFrame).toBe(goalFrame + 90);
    expect(level.finished).toBe(true);
    expect(level.players[0]!.x).toBeLessThan(level.goalX); // P1 never crossed
  });
});

describe('solo: hero swap', () => {
  it('swapCharacter toggles the hero in place and emits hero-swap at the body', () => {
    const level = new Level(
      makeDef(60, (b) => {
        b.ground(0, 59, 30);
        b.start(3, 29);
        b.goal(56, 29);
      }),
    );
    run(level, 10, inp()); // settle
    expect(level.player.character).toBe('mangiani');

    level.swapCharacter(); // the scene calls this right before update()
    expect(level.player.character).toBe('estrada');
    const evs = level.update(inp());
    expect(evs).toContain('hero-swap');
    const src = level.eventSources.get('hero-swap');
    expect(src).toBeDefined();
    expect(Math.abs((src?.x ?? Infinity) - level.player.x)).toBeLessThan(8);

    level.swapCharacter(); // and back
    expect(level.player.character).toBe('mangiani');
    expect(level.update(inp())).toContain('hero-swap');
  });

  it('swapCharacter is a no-op in co-op — P2 IS the other hero', () => {
    const level = flatCoop();
    level.swapCharacter();
    expect(level.players[0]!.character).toBe('mangiani');
    expect(level.players[1]!.character).toBe('estrada');
    expect(run(level, 2, inp(), inp())).not.toContain('hero-swap');
  });
});

describe('solo: regression (the classic tape)', () => {
  it('a scripted one-player run still produces the classic event sequence', () => {
    const level = new Level(
      makeDef(80, (b) => {
        b.ground(0, 79, 30);
        b.start(3, 29);
        b.qblock(3, 26, 'coin');
        b.checkpoint(20, 29);
        b.goal(40, 29);
      }),
    );
    expect(level.players.length).toBe(1);
    expect(level.player.bubbleT).toBe(0);
    const tape: GameEvent[] = [];

    // 1. idle settle: SILENT (the idle-silence house rule holds)
    tape.push(...run(level, 30, inp()));
    expect(tape).toEqual([]);

    // 2. jump into the coin block: jump, coin + block-bump, block used
    tape.push(...level.update(inp({ jump: true, jumpPressed: true })));
    for (let i = 0; i < 90; i++) tape.push(...level.update(inp({ jump: true })));
    expect(tape).toContain('jump');
    expect(tape).toContain('coin');
    expect(tape).toContain('block-bump');
    expect(level.stats.coins).toBe(1);
    expect(level.map.tileAt(3, 26)).toBe('usedblock');

    // 3. walk right and claim the checkpoint
    let sawCp = false;
    for (let i = 0; i < 600 && !sawCp; i++) {
      const evs = level.update(inp({ right: true }));
      tape.push(...evs);
      if (evs.includes('checkpoint')) sawCp = true;
    }
    expect(sawCp).toBe(true);

    // 4. the void kills: ONE counted death (solo counts every death), classic
    // 90f timer, checkpoint respawn with the classic grace window
    level.player.y = level.map.pixelH + 100;
    tape.push(...level.update(inp()));
    expect(tape.filter((e) => e === 'die').length).toBe(1);
    expect(level.stats.deaths).toBe(1);
    expect(level.player.bubbleT).toBe(0); // solo NEVER bubbles
    tape.push(...run(level, 120, inp()));
    expect(tape).toContain('respawn');
    expect(level.player.dead).toBe(false);
    expect(level.player.invulnT).toBeGreaterThan(0);

    // 5. sprint to the goal: 'goal' exactly once, 'flag-plant' exactly 90
    // frames later, then finished
    let goalFrame = -1;
    let flagFrame = -1;
    let goals = 0;
    for (let i = 0; i < 1200 && flagFrame < 0; i++) {
      const evs = level.update(inp({ right: true, run: true }));
      tape.push(...evs);
      goals += evs.filter((e) => e === 'goal').length;
      if (goalFrame < 0 && evs.includes('goal')) goalFrame = i;
      if (evs.includes('flag-plant')) flagFrame = i;
    }
    expect(goals).toBe(1);
    expect(flagFrame).toBe(goalFrame + 90);
    expect(level.finished).toBe(true);

    // 6. and the tape carries zero two-hero noise: solo play never emits
    // 'hero-swap' on its own
    expect(tape).not.toContain('hero-swap');
  });
});
