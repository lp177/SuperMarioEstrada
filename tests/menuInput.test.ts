// MenuNav — the single owner of "keys drive a menu". These tests lock the
// contract: priming (a key held when the menu opens does nothing until it is
// released once), the 26/11 hold-repeat cadence, action priority, and the
// hard-coded raw codes that work regardless of bindings.

import { describe, expect, it } from 'vitest';
import type { InputLike, InputState } from '../src/core/types.ts';
import { MenuNav, NAV_DELAY, NAV_REPEAT } from '../src/ui/menuInput.ts';
import type { MenuAction } from '../src/ui/menuInput.ts';

function freshState(): InputState {
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
  };
}

/** Minimal InputLike stub. Mutate `st` / `edgeSet` between polls to simulate
 *  frames; edges are cleared manually (the real Input clears them in
 *  endFrame, which the scene loop owns — MenuNav never calls it). */
class StubInput implements InputLike {
  st: InputState = freshState();
  edgeSet = new Set<string>();
  stateCalls = 0;

  setMode(): void {
    // menus never switch modes; contract stub
  }

  state(): InputState {
    this.stateCalls += 1;
    return { ...this.st };
  }

  endFrame(): void {
    this.st.jumpPressed = false;
    this.st.firePressed = false;
    this.st.pausePressed = false;
    this.edgeSet.clear();
  }

  attach(_target: EventTarget): void {
    // headless: nothing to attach
  }

  edges(): ReadonlySet<string> {
    return this.edgeSet;
  }
}

describe('MenuNav priming', () => {
  it('a direction held when the menu opens emits nothing until released and re-pressed', () => {
    const inp = new StubInput();
    inp.st.down = true;
    const nav = new MenuNav(inp);
    for (let i = 0; i < 60; i++) {
      expect(nav.poll()).toBe(null);
    }
    inp.st.down = false;
    expect(nav.poll()).toBe(null); // release frame emits nothing
    inp.st.down = true;
    expect(nav.poll()).toBe('down'); // fresh press after release works
  });

  it('a held select channel does not activate until released once', () => {
    const inp = new StubInput();
    inp.st.jump = true;
    const nav = new MenuNav(inp);
    for (let i = 0; i < 30; i++) {
      expect(nav.poll()).toBe(null);
    }
    // even a raw Enter edge while the channel is still primed stays muted
    inp.edgeSet.add('Enter');
    expect(nav.poll()).toBe(null);
    inp.edgeSet.clear();
    inp.st.jump = false;
    expect(nav.poll()).toBe(null); // seen released -> unprimed
    inp.st.jump = true;
    inp.st.jumpPressed = true;
    expect(nav.poll()).toBe('select');
  });

  it('the Escape edge that opened the menu is swallowed', () => {
    const inp = new StubInput();
    inp.edgeSet.add('Escape'); // the press that opened the pause menu
    const nav = new MenuNav(inp);
    expect(nav.poll()).toBe(null); // same frame: still primed
    inp.edgeSet.clear(); // endFrame ran
    expect(nav.poll()).toBe(null); // release observed
    inp.edgeSet.add('Escape');
    expect(nav.poll()).toBe('back'); // a genuine new press
  });
});

describe('MenuNav hold-repeat cadence', () => {
  it('exports the house cadence', () => {
    expect(NAV_DELAY).toBe(26);
    expect(NAV_REPEAT).toBe(11);
  });

  it('fresh press emits at frame 1, then 1+NAV_DELAY+1, then every NAV_REPEAT', () => {
    const inp = new StubInput();
    const nav = new MenuNav(inp);
    inp.st.right = true;
    const emitted: number[] = [];
    const total = 1 + NAV_DELAY + NAV_REPEAT * 2; // 49 frames
    for (let f = 1; f <= total; f++) {
      const a: MenuAction = nav.poll();
      if (a === 'right') emitted.push(f);
      else expect(a).toBe(null);
    }
    expect(emitted).toEqual([1, 27, 38, 49]);
  });

  it('releasing resets the cadence to a fresh press', () => {
    const inp = new StubInput();
    const nav = new MenuNav(inp);
    inp.st.up = true;
    expect(nav.poll()).toBe('up');
    expect(nav.poll()).toBe(null);
    expect(nav.poll()).toBe(null);
    inp.st.up = false;
    expect(nav.poll()).toBe(null);
    inp.st.up = true;
    expect(nav.poll()).toBe('up'); // immediate again, no residual delay
  });
});

describe('MenuNav priority', () => {
  it('select wins over a simultaneous direction press', () => {
    const inp = new StubInput();
    const nav = new MenuNav(inp);
    inp.st.left = true;
    inp.st.jump = true;
    inp.st.jumpPressed = true;
    expect(nav.poll()).toBe('select');
  });

  it('back wins over directions but loses to select', () => {
    const inp = new StubInput();
    let nav = new MenuNav(inp);
    inp.st.left = true;
    inp.st.pausePressed = true;
    expect(nav.poll()).toBe('back');

    const inp2 = new StubInput();
    nav = new MenuNav(inp2);
    inp2.st.pausePressed = true;
    inp2.st.jumpPressed = true;
    inp2.st.jump = true;
    expect(nav.poll()).toBe('select');
  });
});

describe('MenuNav raw codes with empty bindings', () => {
  it('Enter and Space raw edges select even when state() never activates', () => {
    const inp = new StubInput(); // st stays all-false: empty bindings
    const nav = new MenuNav(inp);
    expect(nav.poll()).toBe(null);
    inp.edgeSet.add('Enter');
    expect(nav.poll()).toBe('select');
    inp.edgeSet.clear();
    expect(nav.poll()).toBe(null);
    inp.edgeSet.add('Space');
    expect(nav.poll()).toBe('select');
  });

  it('raw arrow and WASD edges navigate with no bindings', () => {
    const inp = new StubInput();
    const nav = new MenuNav(inp);
    inp.edgeSet.add('ArrowDown');
    expect(nav.poll()).toBe('down');
    inp.edgeSet.clear();
    expect(nav.poll()).toBe(null); // edge-only: no held state, no repeat
    inp.edgeSet.add('KeyD');
    expect(nav.poll()).toBe('right');
  });
});

describe('MenuNav reads input once per poll', () => {
  it('calls state() exactly once per poll', () => {
    const inp = new StubInput();
    const nav = new MenuNav(inp); // constructor reads once to prime
    const afterCtor = inp.stateCalls;
    expect(afterCtor).toBe(1);
    nav.poll();
    expect(inp.stateCalls).toBe(afterCtor + 1);
    nav.poll();
    expect(inp.stateCalls).toBe(afterCtor + 2);
  });
});
