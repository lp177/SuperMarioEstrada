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
import { ACT_RULES, BACKTRACK_SLACK, TILE } from '../src/core/constants.ts';
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

  it("goal ceremony: 'goal' once, 'flag-plant' 90 frames later, then finished", () => {
    const level = new Level(
      makeDef(40, (b) => {
        b.ground(0, 39, 30);
        b.start(3, 29);
        b.goal(12, 29);
      }),
    );
    let goalFrame = -1;
    let flagFrame = -1;
    let goalCount = 0;
    for (let i = 0; i < 600 && flagFrame < 0; i++) {
      const evs = level.update(inp({ right: true }));
      goalCount += evs.filter((e) => e === 'goal').length;
      if (goalFrame < 0 && evs.includes('goal')) {
        goalFrame = i;
        expect(level.finished).toBe(false);
      }
      if (evs.includes('flag-plant')) flagFrame = i;
    }
    expect(goalFrame).toBeGreaterThan(0);
    expect(goalCount).toBe(1);
    expect(flagFrame).toBe(goalFrame + 90);
    expect(level.finished).toBe(true);
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
    // Sprint the player straight to the goal line, past the un-fought boss.
    level.player.x = level.goalX + 4;
    const evs = run(level, 200, inp());
    // The arena engaged, but crossing the goal must NOT finish the act.
    expect(evs).toContain('boss-intro');
    expect(evs).not.toContain('goal');
    expect(level.finished).toBe(false);

    // Resolve the encounter externally (pens do this in real play): hp 0 ->
    // the staged escape -> the goal unseals -> ceremony completes.
    level.boss!.hp = 0;
    const after = run(level, 400, inp());
    expect(after).toContain('boss-escape');
    expect(after).toContain('goal');
    expect(after).toContain('flag-plant');
    expect(level.finished).toBe(true);
  });
});
