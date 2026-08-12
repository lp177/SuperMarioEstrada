// ============================================================================
// Level orchestrator tests. Tiny inline LevelDefs (direct builder calls, no
// motifs) drive the REAL player / entities / builder through Level.update.
// ============================================================================

import { describe, expect, it } from 'vitest';
import type {
  GameEvent,
  InputState,
  LevelBuilderLike,
  LevelDef,
} from '../src/core/types.ts';
import { ACT_RULES, BACKTRACK_SLACK, GOAL, TILE } from '../src/core/constants.ts';
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
    excuse: 'I was notarizing the rescue paperwork. In triplicate.',
    theme: 'meadow',
    width,
    build,
  };
}

/** Run `frames` steps with the same (edge-free) input; returns all events. */
function run(level: Level, frames: number, input: InputState): GameEvent[] {
  const all: GameEvent[] = [];
  for (let i = 0; i < frames; i++) all.push(...level.update(input));
  return all;
}

describe('Level', () => {
  it('coin qblock increments coins, uses the block, sources the event at it', () => {
    const level = new Level(
      makeDef(60, (b) => {
        b.ground(0, 59, 30);
        b.start(3, 29);
        b.qblock(3, 26, 'coin');
        b.goal(56, 29);
      }),
    );
    run(level, 30, inp()); // settle on the ground, silently
    expect(level.stats.coins).toBe(0);

    // jump into the block: edge on the first frame, held after
    level.update(inp({ jump: true, jumpPressed: true }));
    let sawCoin = false;
    let sourceTx = -1;
    for (let i = 0; i < 90 && !sawCoin; i++) {
      const evs = level.update(inp({ jump: true }));
      if (evs.includes('coin')) {
        sawCoin = true;
        expect(evs).toContain('block-bump');
        const src = level.eventSources.get('coin');
        expect(src).toBeDefined();
        sourceTx = Math.floor((src?.x ?? -1) / TILE);
      }
    }
    expect(sawCoin).toBe(true);
    expect(sourceTx).toBe(3);
    expect(level.stats.coins).toBe(1);
    expect(level.map.tileAt(3, 26)).toBe('usedblock');
  });

  it('bricks only break when the player is big', () => {
    const level = new Level(
      makeDef(60, (b) => {
        b.ground(0, 59, 30);
        b.start(3, 29);
        b.brick(3, 26);
        b.goal(56, 29);
      }),
    );
    run(level, 30, inp());

    // small: thunk, brick survives
    level.update(inp({ jump: true, jumpPressed: true }));
    const evsSmall = run(level, 90, inp({ jump: true }));
    expect(evsSmall).toContain('block-bump');
    expect(evsSmall).not.toContain('brick-break');
    expect(level.map.tileAt(3, 26)).toBe('brick');

    // certified: brick breaks
    level.player.grow('stamp');
    run(level, 30, inp()); // land + settle
    level.update(inp({ jump: true, jumpPressed: true }));
    const evsBig = run(level, 90, inp({ jump: true }));
    expect(evsBig).toContain('brick-break');
    expect(level.map.tileAt(3, 26)).toBe('empty');
  });

  it('falling onto a lobbyist stomps it: event, bounce, enemy dies, no damage', () => {
    const level = new Level(
      makeDef(60, (b) => {
        b.ground(0, 59, 30);
        b.enemy('lobbyist', 8, 29);
        b.start(8, 26); // spawn in the air directly above the enemy
        b.goal(56, 29);
      }),
    );
    let stompFrame = -1;
    let vyAtStomp = 0;
    for (let i = 0; i < 120 && stompFrame < 0; i++) {
      const evs = level.update(inp());
      if (evs.includes('stomp')) {
        stompFrame = i;
        vyAtStomp = level.player.vy;
      }
    }
    expect(stompFrame).toBeGreaterThanOrEqual(0);
    expect(vyAtStomp).toBeLessThan(0); // bounced
    expect(level.player.dead).toBe(false);
    expect(level.stats.deaths).toBe(0);
    // squash animation (20f) ends well within 60 frames; entity gets culled
    run(level, 60, inp());
    expect(level.entities.some((e) => e.kind === 'lobbyist' && e.alive)).toBe(false);
  });

  it('spikes hurt through Level.damagePlayer and invulnerability blocks repeats', () => {
    const level = new Level(
      makeDef(60, (b) => {
        b.ground(0, 59, 30);
        b.spikes(10, 12, 29);
        b.start(11, 27); // falls straight onto the spikes
        b.goal(56, 29);
      }),
    );
    level.player.grow('stamp'); // certified: first hit shrinks, not kills
    let hurtFrame = -1;
    for (let i = 0; i < 120 && hurtFrame < 0; i++) {
      level.update(inp());
      if (level.player.invulnT > 0) hurtFrame = i;
    }
    expect(hurtFrame).toBeGreaterThanOrEqual(0);
    expect(level.player.size).toBe('small');
    expect(level.player.dead).toBe(false);
    expect(level.stats.deaths).toBe(0);

    // stays on/next to the spikes inside the invuln window: no second hit
    run(level, 60, inp());
    expect(level.player.dead).toBe(false);
    expect(level.player.size).toBe('small');
    expect(level.stats.deaths).toBe(0);
  });

  it("goal ceremony: goal -> pole-slide -> door-in -> flag-plant, finished only at the flag", () => {
    const level = new Level(
      makeDef(40, (b) => {
        b.ground(0, 39, 30);
        b.start(3, 29);
        b.goal(20, 29);
      }),
    );
    const first = new Map<GameEvent, number>();
    let goalCount = 0;
    let goalSrcX = -1;
    for (let i = 0; i < 900 && !level.finished; i++) {
      const evs = level.update(inp({ right: true }));
      goalCount += evs.filter((e) => e === 'goal').length;
      for (const ev of evs) if (!first.has(ev)) first.set(ev, i);
      if (evs.includes('goal')) {
        goalSrcX = level.eventSources.get('goal')?.x ?? -1;
      }
      if (!evs.includes('flag-plant')) expect(level.finished).toBe(false);
    }
    // the ceremony starts at the POLE, 8 tiles before the door — the trigger
    // is no longer an invisible x-line at the facade
    expect(goalCount).toBe(1);
    expect(goalSrcX).toBe(level.goalX - GOAL.poleOffsetTiles * TILE);
    const goalF = first.get('goal')!;
    const slideF = first.get('pole-slide')!;
    const doorF = first.get('door-in')!;
    const flagF = first.get('flag-plant')!;
    expect(goalF).toBeGreaterThan(0);
    expect(slideF).toBeGreaterThanOrEqual(goalF); // slide starts at the grab
    expect(doorF).toBeGreaterThan(slideF); // then the walk to the door
    expect(flagF).toBe(doorF + 90); // the flag-plant beat, 90f after entry
    expect(level.finished).toBe(true);
    // the hero is INSIDE the castle, not wandering behind the set
    expect(level.player.hidden).toBe(true);
    expect(level.player.x).toBeLessThanOrEqual(level.goalX);
  });

  it('pole grab height pays the bonus: a platform jump-grab out-earns a walk grab and certifies', () => {
    // Flat act with a raised platform ending just before the pole (pole x =
    // goalX - 8 tiles = tile 32.5; platform top surface row 22 ~= 8 tiles up).
    const build = (withPlatform: boolean) => (b: LevelBuilderLike): void => {
      b.ground(0, 59, 30);
      b.start(3, 29);
      if (withPlatform) b.platform(24, 30, 22);
      b.goal(40, 29);
    };

    // WALK grab: sprint along the ground into the pole — grabs at the base.
    const low = new Level(makeDef(60, build(false)));
    let lowEvs: GameEvent[] = [];
    for (let i = 0; i < 400 && !lowEvs.includes('goal'); i++) {
      lowEvs = lowEvs.concat(low.update(inp({ right: true, run: true })));
    }
    expect(lowEvs).toContain('goal');
    expect(lowEvs).toContain('pole-slide');
    expect(lowEvs).not.toContain('certify'); // base grab: no notary stamp
    const lowCoins = low.stats.coins;

    // JUMP grab: run off the platform and leap at the lip — hits the pole
    // near the pennant, the notary certifies the maximum height.
    const high = new Level(makeDef(60, build(true)));
    const hp = high.player;
    hp.x = 28 * TILE + 8; // on the platform
    hp.y = 22 * TILE - hp.halfH;
    hp.vy = 0;
    run(high, 2, inp()); // settle grounded
    let highEvs: GameEvent[] = [];
    let jumped = false;
    for (let i = 0; i < 400 && !highEvs.includes('goal'); i++) {
      const jumpNow = !jumped && hp.grounded && hp.x > 30 * TILE + 2;
      if (jumpNow) jumped = true;
      highEvs = highEvs.concat(
        high.update(inp({ right: true, jump: jumped, jumpPressed: jumpNow })),
      );
    }
    expect(highEvs).toContain('goal');
    expect(highEvs).toContain('certify'); // top grab: certified, ka-ching
    const highCoins = high.stats.coins;

    expect(highCoins).toBeGreaterThan(lowCoins);
    expect(highCoins).toBeLessThanOrEqual(GOAL.bonusMaxCoins);
  });

  it('co-op ceremony: single bonus award, both bodies end hidden inside the door', () => {
    const level = new Level(
      makeDef(40, (b) => {
        b.ground(0, 39, 30);
        b.start(3, 29);
        b.goal(20, 29);
      }),
      { coop: true },
    );
    const runCoop = (frames: number): GameEvent[] => {
      const all: GameEvent[] = [];
      for (let i = 0; i < frames; i++) all.push(...level.update(inp(), inp()));
      return all;
    };
    runCoop(10); // settle both on the ground
    const poleX = level.goalX - GOAL.poleOffsetTiles * TILE;
    // park BOTH bodies past the pole line on the same frame: P1 rides (tie
    // breaks to P1) and the height bonus must be paid exactly once
    level.players[0]!.x = poleX + 1;
    level.players[1]!.x = poleX + 1;
    const grabEvs = runCoop(1);
    expect(grabEvs).toContain('goal');
    expect(grabEvs).toContain('pole-slide');
    // both grounded at the base: h = halfH/poleH -> round(...) = 1 coin.
    // A double award would have paid 2.
    expect(level.stats.coins).toBe(1);

    const rest = runCoop(600);
    expect(rest.filter((e) => e === 'door-in').length).toBe(2); // once per body
    expect(rest).toContain('flag-plant');
    expect(level.finished).toBe(true);
    expect(level.players[0]!.hidden).toBe(true);
    expect(level.players[1]!.hidden).toBe(true);
    expect(level.stats.coins).toBe(1); // still the single grab award
  });

  it('an idle player near nothing hears NOTHING (far gavel + lawyer stay silent)', () => {
    const level = new Level(
      makeDef(100, (b) => {
        b.ground(0, 99, 30);
        b.start(3, 29);
        b.enemy('gavel', 70, 28); // ~1070px away, far beyond AMBIENT_RANGE
        b.enemy('lawyer', 75, 28);
        b.goal(96, 29);
      }),
    );
    const evs = run(level, ACT_RULES.idleFrames, inp());
    expect(evs).toEqual([]);
  });

  it('backtrack ratchet advances, clamps the player, and never reopens', () => {
    const level = new Level(
      makeDef(200, (b) => {
        b.ground(0, 199, 30);
        b.start(3, 29);
        b.goal(197, 29);
      }),
    );
    const bl0 = level.backLimitX;
    run(level, 700, inp({ right: true, run: true })); // sprint ~2000px right
    const bl1 = level.backLimitX;
    expect(bl1).toBeGreaterThan(bl0);
    expect(bl1).toBeCloseTo(level.player.x - BACKTRACK_SLACK, 3);

    // now walk left: the wall holds and the ratchet never rolls back
    for (let i = 0; i < 700; i++) {
      level.update(inp({ left: true }));
      expect(level.player.x).toBeGreaterThanOrEqual(
        level.backLimitX + level.player.halfW - 1e-6,
      );
      expect(level.backLimitX).toBeGreaterThanOrEqual(bl1);
    }
  });

  it('the void kills, counts the death, and respawns at the claimed checkpoint', () => {
    const level = new Level(
      makeDef(80, (b) => {
        b.ground(0, 79, 30);
        b.checkpoint(20, 29);
        b.start(3, 29);
        b.goal(76, 29);
      }),
    );
    // claim the checkpoint by actually walking through it
    let sawCheckpoint = false;
    for (let i = 0; i < 600 && !sawCheckpoint; i++) {
      const evs = level.update(inp({ right: true }));
      if (evs.includes('checkpoint')) sawCheckpoint = true;
    }
    expect(sawCheckpoint).toBe(true);

    // The TileMap contract seals the world bottom in bedrock, so a walking
    // player can never leave the map — the void check is Level's safety net
    // against physics gone wrong. Exercise it directly: drop the player
    // below the map and step once.
    level.player.y = level.map.pixelH + 100;
    const evs = level.update(inp());
    expect(evs).toContain('die');
    expect(level.player.dead).toBe(true);
    expect(level.stats.deaths).toBe(1);

    // respawn timer is 90f; give it 120 idle frames
    run(level, 120, inp());
    expect(level.player.dead).toBe(false);
    expect(level.stats.deaths).toBe(1);
    const cp = level.entities.find((e) => e.kind === 'checkpoint');
    expect(cp).toBeDefined();
    expect(Math.abs(level.player.x - (cp?.x ?? Infinity))).toBeLessThan(TILE * 1.5);
    // and the ratchet reset behind the checkpoint, not ahead of the player
    expect(level.backLimitX).toBeLessThanOrEqual(level.player.x - level.player.halfW + 1e-6);
  });

  it('holding fire auto-throws pens on the repeat cadence (classic hold-to-fire)', () => {
    const level = new Level(
      makeDef(120, (b) => {
        b.ground(0, 119, 30);
        b.start(6, 29);
        b.goal(110, 29);
      }),
    );
    level.player.grow('goldpen');
    // Hold run with NO fresh edges: pens must keep coming as slots free up.
    let throws = 0;
    for (let f = 0; f < 240; f++) {
      const evs = level.update(inp({ run: true }));
      throws += evs.filter((e) => e === 'pen-throw').length;
    }
    // 240 frames: penMax caps live pens at 2, pens die on walls/timeout, and
    // the 12-frame cadence refills — several throws must happen with zero
    // firePressed edges (the old behavior threw exactly 0 here).
    expect(throws).toBeGreaterThanOrEqual(4);
  });

  it('warp pipes: down on the mouth rides to the exit, ratchet follows', () => {
    const level = new Level(
      makeDef(120, (b) => {
        b.ground(0, 119, 30);
        b.start(3, 29);
        // entry pipe on the surface; bonus vault carved underground with the
        // exit warp further along
        b.warpPipe(10, 28, 2, 60, 28, 2);
        b.goal(110, 29);
      }),
    );
    const p = level.player;
    // walk onto the entry mouth (center x = 10*16+16 = 176)
    p.x = 176;
    p.y = 28 * TILE - p.halfH;
    p.vy = 0;
    let evs = run(level, 2, inp());
    expect(p.grounded).toBe(true);
    // press down: transit begins, 'pipe' fires
    evs = run(level, 1, inp({ down: true }));
    expect(evs).toContain('pipe');
    // ride completes within a second; player emerges on the exit mouth
    evs = run(level, 60, inp());
    expect(evs).toContain('pipe'); // the exit-side emit
    expect(Math.abs(p.x - (60 * TILE + TILE))).toBeLessThan(2);
    expect(p.y).toBeCloseTo(28 * TILE - p.halfH, 1);
    // the world closed behind the exit, not the entry
    expect(level.backLimitX).toBeGreaterThan(176);
    // and play continues normally (no residual transit lock)
    run(level, 10, inp({ right: true }));
    expect(p.x).toBeGreaterThan(60 * TILE + TILE);
  });

  it('a castle goal stays sealed until the boss encounter resolves', () => {
    const def: LevelDef = {
      ...makeDef(80, (b) => {
        b.ground(0, 39, 30);
        b.start(3, 29);
        b.arena(40, 72, 30);
        b.goal(66, 29);
      }),
      boss: true,
    };
    const level = new Level(def);
    // Sprint the player straight past the un-fought boss — beyond BOTH the
    // pole line (goalX - 8 tiles) and the door line.
    level.player.x = level.goalX + 4;
    const evs = run(level, 200, inp());
    // The arena engaged, but crossing pole/goal must NOT start the ceremony.
    expect(evs).toContain('boss-intro');
    expect(evs).not.toContain('goal');
    expect(evs).not.toContain('pole-slide');
    expect(level.ceremony).toBe(false);
    expect(level.finished).toBe(false);

    // Resolve the encounter externally (pens do this in real play): hp 0 ->
    // the staged escape -> the DOOR unseals. Castle acts have NO flagpole
    // (boss OR flag, never both — the fight is the climax): the ceremony is
    // door-only, so 'pole-slide' must never fire here.
    level.boss!.hp = 0;
    const after = run(level, 400, inp());
    expect(after).toContain('boss-escape');
    expect(after).toContain('goal');
    expect(after).not.toContain('pole-slide');
    expect(after).toContain('door-in');
    expect(after).toContain('flag-plant');
    expect(level.finished).toBe(true);
    expect(level.player.hidden).toBe(true);
  });
});
