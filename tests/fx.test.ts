// FxSystem policy + determinism tests. Plain Node, no DOM: rendering is not
// exercised here, only the sim-side surface (events, freeze, shake, flash,
// particle pool).

import { describe, expect, it } from 'vitest';
import { FX_TABLE, FxSystem } from '../src/fx/fx.ts';
import { HIT_STOP, JUICE } from '../src/core/constants.ts';
import type { GameEvent } from '../src/core/types.ts';

const mk = (rm = false) => new FxSystem(() => rm);

/** Drain the freeze counter, returning how many frames it held. */
function drainFreeze(fx: FxSystem): number {
  let n = 0;
  while (fx.tickFreeze()) {
    n++;
    if (n > 1000) throw new Error('freeze never ended');
  }
  return n;
}

describe('juice policy (the death-spiral rule)', () => {
  const damageEvents: GameEvent[] = ['hurt', 'die', 'boss-shot'];
  const ambientEvents: GameEvent[] = ['drip', 'slot-spin', 'gavel-slam', 'lava-bubble'];

  it('hurt / die / boss-shot and ambients are NOT in the HIT_STOP allow-list', () => {
    for (const ev of [...damageEvents, ...ambientEvents]) {
      expect(HIT_STOP[ev], `${ev} must not freeze`).toBeUndefined();
    }
  });

  it('hurt / die / boss-shot produce zero freeze at runtime', () => {
    for (const ev of damageEvents) {
      const fx = mk();
      fx.onEvent(ev, 100, 100);
      expect(fx.tickFreeze(), `${ev} froze the world`).toBe(false);
    }
  });

  it('hurt / die / boss-shot declare shake <= 0.3', () => {
    for (const ev of damageEvents) {
      expect(FX_TABLE[ev]?.shake ?? 0, `${ev} shakes too hard`).toBeLessThanOrEqual(0.3);
    }
  });

  it('ambient events declare ZERO shake (source may be off-screen)', () => {
    for (const ev of ambientEvents) {
      expect(FX_TABLE[ev]?.shake ?? 0, `${ev} must not shake the camera`).toBe(0);
    }
  });

  it('ui events and text-blip are explicit nulls', () => {
    const uiEvents: GameEvent[] = ['ui-move', 'ui-select', 'ui-back', 'text-blip'];
    for (const ev of uiEvents) expect(FX_TABLE[ev]).toBeNull();
  });
});

describe('hit-stop', () => {
  it('HIT_STOP events freeze for their listed duration', () => {
    const fx = mk();
    fx.onEvent('stomp', 0, 0);
    expect(drainFreeze(fx)).toBe(JUICE.stompStop);
  });

  it('freezes never stack: overlapping events take max, not sum', () => {
    const fx = mk();
    fx.onEvent('stomp', 0, 0); // 3
    fx.onEvent('boss-hit', 0, 0); // 8
    expect(drainFreeze(fx)).toBe(JUICE.bossHitStop); // 8, not 11
  });

  it('spamming 10x in one frame still clamps total to JUICE.maxHitStop', () => {
    const fx = mk();
    for (let i = 0; i < 10; i++) fx.onEvent('boss-defeat', 0, 0);
    expect(drainFreeze(fx)).toBe(JUICE.maxHitStop);
  });

  it('an active freeze is never extended beyond the cap', () => {
    const fx = mk();
    fx.onEvent('boss-defeat', 0, 0); // maxHitStop
    fx.tickFreeze(); // burn one frame
    fx.onEvent('boss-defeat', 0, 0); // re-arms to maxHitStop at most
    expect(drainFreeze(fx)).toBe(JUICE.maxHitStop);
  });

  it('unknown event ids throw (no silent fallbacks)', () => {
    const fx = mk();
    expect(() => fx.onEvent('lobbying-scandal' as GameEvent, 0, 0)).toThrow();
  });
});

describe('reduced motion', () => {
  it('hit-stop clamps to exactly JUICE.reducedHitStop — never zero', () => {
    expect(JUICE.reducedHitStop).toBeGreaterThan(0); // guard the premise
    const fx = mk(true);
    fx.onEvent('boss-defeat', 0, 0); // would be 10 frames normally
    expect(drainFreeze(fx)).toBe(JUICE.reducedHitStop);
  });

  it('shake offset is exactly {0,0}', () => {
    const fx = mk(true);
    fx.onEvent('boss-defeat', 0, 0); // shake 0.7 normally
    for (const frame of [0, 1, 7, 100]) {
      expect(fx.shakeOffset(frame)).toEqual({ x: 0, y: 0 });
    }
  });

  it('particle counts halve', () => {
    const a = mk(false);
    const b = mk(true);
    a.onEvent('coin', 0, 0);
    b.onEvent('coin', 0, 0);
    expect(a.snapshot().length).toBe(6);
    expect(b.snapshot().length).toBe(3);
    a.onEvent('goal', 0, 0);
    b.onEvent('goal', 0, 0);
    expect(a.snapshot().length).toBe(6 + 40);
    expect(b.snapshot().length).toBe(3 + 20);
  });

  it('flash alpha halves but still fires', () => {
    const fx = mk(true);
    fx.onEvent('hurt', 0, 0);
    const f = fx.flash();
    expect(f).not.toBeNull();
    expect(f?.alpha).toBeCloseTo(0.15);
  });
});

describe('shake', () => {
  it('offset is pure-ish: same frame twice gives the identical offset', () => {
    const fx = mk();
    fx.onEvent('gate-slam', 0, 0);
    expect(fx.shakeOffset(42)).toEqual(fx.shakeOffset(42));
  });

  it('trauma decays ALWAYS — even while frozen — shrinking the amplitude', () => {
    const fx = mk();
    fx.onEvent('boss-defeat', 0, 0); // trauma 0.7 + freeze
    const before = fx.shakeOffset(7);
    for (let i = 0; i < 10; i++) fx.update(); // frozen the whole time
    const after = fx.shakeOffset(7); // same frame -> same direction, smaller amp
    expect(Math.abs(after.x)).toBeLessThan(Math.abs(before.x));
    expect(Math.abs(after.y)).toBeLessThan(Math.abs(before.y));
  });

  it('offset is bounded by trauma^2 * maxShake and dies with trauma', () => {
    const fx = mk();
    fx.onEvent('stomp', 0, 0); // trauma 0.15
    const o = fx.shakeOffset(3);
    const amp = 0.15 * 0.15 * JUICE.maxShake;
    expect(Math.abs(o.x)).toBeLessThanOrEqual(amp);
    expect(Math.abs(o.y)).toBeLessThanOrEqual(amp);
    for (let i = 0; i < 60; i++) fx.update(); // decay 0.02/frame -> gone
    expect(fx.shakeOffset(3)).toEqual({ x: 0, y: 0 });
  });
});

describe('freeze vs particle aging', () => {
  it('particles age only while not frozen; flash decays regardless', () => {
    const fx = mk();
    fx.onEvent('coin', 50, 50);
    fx.onEvent('stomp', 50, 50); // freeze 3
    const before = fx.snapshot();
    fx.update(); // frozen: particles untouched
    expect(fx.snapshot()).toEqual(before);
    expect(drainFreeze(fx)).toBe(JUICE.stompStop);
    fx.update(); // thawed: particles move and age
    const after = fx.snapshot();
    expect(after).not.toEqual(before);
    const b0 = before[0];
    const a0 = after[0];
    expect(a0 && b0 && a0.life === b0.life - 1).toBe(true);
  });

  it('flash decays every update and eventually returns null', () => {
    const fx = mk();
    fx.onEvent('hurt', 0, 0);
    expect(fx.flash()?.alpha).toBeCloseTo(0.3);
    fx.update();
    const a = fx.flash()?.alpha ?? 0;
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(0.3);
    for (let i = 0; i < 120; i++) fx.update();
    expect(fx.flash()).toBeNull();
  });

  it("die's flash decays slower than hurt's", () => {
    const hurt = mk();
    const die = mk();
    hurt.onEvent('hurt', 0, 0); // 0.3
    die.onEvent('die', 0, 0); // 0.4, slow
    hurt.update();
    die.update();
    const hurtLoss = 0.3 - (hurt.flash()?.alpha ?? 0);
    const dieLoss = 0.4 - (die.flash()?.alpha ?? 0);
    expect(dieLoss).toBeLessThan(hurtLoss);
  });
});

describe('determinism', () => {
  it('two systems fed the identical event sequence match snapshot-for-snapshot', () => {
    const seq: ReadonlyArray<[GameEvent, number, number]> = [
      ['coin', 10, 20],
      ['stomp', 30, 40],
      ['certify', 55, 66],
      ['goal', 100, 50],
      ['boss-hit', 200, 60],
      ['secret', 5, 5],
      ['brick-break', 77, 88],
    ];
    const a = mk();
    const b = mk();
    for (const [ev, x, y] of seq) {
      a.onEvent(ev, x, y);
      b.onEvent(ev, x, y);
    }
    expect(a.snapshot()).toEqual(b.snapshot());
    for (let i = 0; i < 30; i++) {
      a.tickFreeze();
      b.tickFreeze();
      a.update();
      b.update();
    }
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.snapshot().length).toBeGreaterThan(0); // sequence wasn't vacuous
    expect(a.shakeOffset(9)).toEqual(b.shakeOffset(9));
  });
});

describe('particle pool', () => {
  it('never exceeds the ~400 cap; oldest are evicted', () => {
    const fx = mk();
    for (let i = 0; i < 20; i++) fx.onEvent('goal', i * 10, 0); // 800 spawned
    expect(fx.snapshot().length).toBe(400);
    // eviction is FIFO: the earliest bursts (x = 0..90) are gone
    const xs = fx.snapshot().map((p) => p.x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(100 - 1);
  });

  it('dead particles leave the pool', () => {
    const fx = mk();
    fx.onEvent('coin', 0, 0);
    expect(fx.snapshot().length).toBe(6);
    for (let i = 0; i < 300; i++) fx.update();
    expect(fx.snapshot().length).toBe(0);
  });
});
