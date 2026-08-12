import { describe, it, expect, afterEach, vi } from 'vitest';
import { Input } from '../src/core/input.ts';
import { DEFAULT_BINDINGS, loadSettings } from '../src/core/prefs.ts';
import { STORAGE_KEYS } from '../src/core/constants.ts';
import type { ActionId, InputState } from '../src/core/types.ts';
import {
  initKeyboardLayout,
  keyLabel,
  setLayoutForTest,
} from '../src/core/keyboardLayout.ts';

const mk = () => new Input(() => DEFAULT_BINDINGS);

const cloneBindings = (): Record<ActionId, string[]> => {
  const out = {} as Record<ActionId, string[]>;
  for (const a of Object.keys(DEFAULT_BINDINGS) as ActionId[]) out[a] = [...DEFAULT_BINDINGS[a]];
  return out;
};

const allFalse = (s: InputState): boolean => Object.values(s).every((v) => v === false);

describe('Input edge semantics', () => {
  it('latches jumpPressed on keydown and keeps it across multiple state() reads', () => {
    const inp = mk();
    inp.handleKey('Space', true);
    expect(inp.state().jumpPressed).toBe(true);
    expect(inp.state().jumpPressed).toBe(true); // second read: still latched
    expect(inp.state().jump).toBe(true);
    inp.endFrame();
    expect(inp.state().jumpPressed).toBe(false); // ONLY endFrame clears it
    expect(inp.state().jump).toBe(true); // key still physically down
  });

  it('edge survives a release that happens before the step consumes it', () => {
    const inp = mk();
    inp.handleKey('Space', true);
    inp.handleKey('Space', false); // tap shorter than one physics step
    const s = inp.state();
    expect(s.jumpPressed).toBe(true); // the tap is not lost
    expect(s.jump).toBe(false); // but the key is no longer held
    inp.endFrame();
    expect(inp.state().jumpPressed).toBe(false);
  });

  it('a held key produces no second edge', () => {
    const inp = mk();
    inp.handleKey('Space', true);
    inp.endFrame();
    inp.handleKey('Space', true); // OS auto-repeat while held
    inp.handleKey('Space', true);
    expect(inp.state().jumpPressed).toBe(false);
    expect(inp.state().jump).toBe(true);
    // Release and press again: that IS a new edge.
    inp.handleKey('Space', false);
    inp.handleKey('Space', true);
    expect(inp.state().jumpPressed).toBe(true);
  });

  it('any of multiple bound codes activates the action', () => {
    const inp = mk();
    inp.handleKey('KeyA', true); // left is [ArrowLeft, KeyA]
    expect(inp.state().left).toBe(true);
    inp.handleKey('ArrowLeft', true);
    inp.handleKey('KeyA', false); // one of two released: still active
    expect(inp.state().left).toBe(true);
    inp.handleKey('ArrowLeft', false);
    expect(inp.state().left).toBe(false);
  });

  it('KeyW drives both up (held) and jump (edge)', () => {
    const inp = mk();
    inp.handleKey('KeyW', true);
    const s = inp.state();
    expect(s.up).toBe(true);
    expect(s.jump).toBe(true);
    expect(s.jumpPressed).toBe(true);
  });

  it('run codes latch firePressed (the pen throw edge)', () => {
    const inp = mk();
    inp.handleKey('ShiftLeft', true);
    expect(inp.state().firePressed).toBe(true);
    expect(inp.state().run).toBe(true);
    inp.endFrame();
    expect(inp.state().firePressed).toBe(false);
    expect(inp.state().run).toBe(true); // still held
  });

  it('pause codes latch pausePressed', () => {
    const inp = mk();
    inp.handleKey('Escape', true);
    expect(inp.state().pausePressed).toBe(true);
    inp.endFrame();
    inp.handleKey('Escape', false);
    inp.handleKey('Enter', true); // both codes bound to pause
    expect(inp.state().pausePressed).toBe(true);
  });

  it('edges() reports raw codes (including unbound ones) until endFrame', () => {
    const inp = mk();
    inp.handleKey('KeyA', true);
    inp.handleKey('KeyP', true); // unbound — must still show for rebinding UI
    expect(inp.edges().has('KeyA')).toBe(true);
    expect(inp.edges().has('KeyP')).toBe(true);
    expect(inp.state().jumpPressed).toBe(false); // unbound key: no action edge
    inp.endFrame();
    expect(inp.edges().size).toBe(0);
    inp.handleKey('KeyB', true);
    expect(inp.edges().has('KeyB')).toBe(true);
    expect(inp.edges().has('KeyA')).toBe(false); // still held, but not a new edge
  });

  it('is fully drivable headless via handleKey (no DOM anywhere)', () => {
    const inp = mk();
    const s = inp.state();
    expect(s.left).toBe(false);
    expect(s.jumpPressed).toBe(false);
    inp.endFrame();
    expect(inp.edges().size).toBe(0);
  });
});

describe('Input hero swap (solo)', () => {
  it('Tab latches swapPressed across reads; only endFrame clears it', () => {
    const inp = mk();
    inp.handleKey('Tab', true);
    expect(inp.state().swapPressed).toBe(true);
    expect(inp.state().swapPressed).toBe(true); // second read: still latched
    inp.endFrame();
    expect(inp.state().swapPressed).toBe(false); // ONLY endFrame clears it
  });

  it('a held swap key produces no second edge; re-press does', () => {
    const inp = mk();
    inp.handleKey('Tab', true);
    inp.endFrame();
    inp.handleKey('Tab', true); // OS auto-repeat while held
    expect(inp.state().swapPressed).toBe(false);
    inp.handleKey('Tab', false);
    inp.handleKey('Tab', true); // release + press: a real new edge
    expect(inp.state().swapPressed).toBe(true);
  });

  it('swap is rebindable like any action (reads the bindings record)', () => {
    const custom = cloneBindings();
    custom.swap = ['KeyC'];
    const inp = new Input(() => custom);
    inp.handleKey('Tab', true); // no longer bound to swap
    expect(inp.state().swapPressed).toBe(false);
    inp.handleKey('KeyC', true);
    expect(inp.state().swapPressed).toBe(true);
  });
});

describe('Input channels (two heroes)', () => {
  it('solo: state(0) equals state(); state(1) is an idle player', () => {
    const inp = mk();
    inp.handleKey('KeyA', true);
    inp.handleKey('Space', true);
    inp.handleKey('Tab', true);
    expect(inp.state(0)).toEqual(inp.state()); // merged view, swap included
    expect(inp.state(0).swapPressed).toBe(true);
    expect(allFalse(inp.state(1))).toBe(true); // held keys, edges: all false
  });

  it('solo merge is unchanged after a coop round-trip (regression)', () => {
    const inp = mk();
    inp.setMode('coop');
    inp.setMode('solo');
    inp.handleKey('ArrowLeft', true); // secondary slot still merges in solo
    inp.handleKey('ArrowUp', true);
    const s = inp.state();
    expect(s.left).toBe(true);
    expect(s.up).toBe(true);
    expect(s.jumpPressed).toBe(true); // slot-1 jump code latches solo merge
  });

  it('coop: KeyA drives ch0 left, ArrowLeft drives ch1 left, NOT vice versa', () => {
    const inp = mk();
    inp.setMode('coop');
    inp.handleKey('KeyA', true); // left slot [0]
    expect(inp.state(0).left).toBe(true);
    expect(inp.state(1).left).toBe(false);
    inp.handleKey('KeyA', false);
    inp.handleKey('ArrowLeft', true); // left slots [1..]
    expect(inp.state(1).left).toBe(true);
    expect(inp.state(0).left).toBe(false);
  });

  it('coop: jump edges latch per channel independently in the same step', () => {
    const inp = mk();
    inp.setMode('coop');
    inp.handleKey('ArrowUp', true); // jump slots [1..] -> channel 1 only
    expect(inp.state(1).jumpPressed).toBe(true);
    expect(inp.state(0).jumpPressed).toBe(false);
    inp.handleKey('Space', true); // jump slot [0] -> channel 0, same step
    expect(inp.state(0).jumpPressed).toBe(true);
    expect(inp.state(1).jumpPressed).toBe(true); // ch1 latch survived
    inp.endFrame();
    expect(inp.state(0).jumpPressed).toBe(false);
    expect(inp.state(1).jumpPressed).toBe(false);
    expect(inp.state(0).jump).toBe(true); // still held on both channels
    expect(inp.state(1).jump).toBe(true);
  });

  it('coop: run edge (pen throw) splits by slot too', () => {
    const inp = mk();
    inp.setMode('coop');
    inp.handleKey('KeyF', true); // run slots [1..] -> channel 1
    expect(inp.state(1).firePressed).toBe(true);
    expect(inp.state(0).firePressed).toBe(false);
    expect(inp.state(1).run).toBe(true);
    expect(inp.state(0).run).toBe(false);
  });

  it('coop: pause fires on BOTH channels from either channel pause code', () => {
    const inp = mk();
    inp.setMode('coop');
    inp.handleKey('Escape', true); // pause slot [0]
    expect(inp.state(0).pausePressed).toBe(true);
    expect(inp.state(1).pausePressed).toBe(true);
    inp.endFrame();
    inp.handleKey('Escape', false);
    inp.handleKey('Enter', true); // pause slots [1..]
    expect(inp.state(0).pausePressed).toBe(true);
    expect(inp.state(1).pausePressed).toBe(true);
  });

  it('coop: Escape/Enter pause both channels even when pause is rebound away', () => {
    const custom = cloneBindings();
    custom.pause = ['KeyP'];
    const inp = new Input(() => custom);
    inp.setMode('coop');
    inp.handleKey('Escape', true); // unbound, but hard-mapped for co-op
    expect(inp.state(0).pausePressed).toBe(true);
    expect(inp.state(1).pausePressed).toBe(true);
    inp.endFrame();
    inp.handleKey('Escape', false);
    inp.handleKey('Enter', true);
    expect(inp.state(1).pausePressed).toBe(true);
    inp.endFrame();
    inp.handleKey('Enter', false);
    inp.handleKey('KeyP', true); // the rebound code still pauses everyone
    expect(inp.state(0).pausePressed).toBe(true);
    expect(inp.state(1).pausePressed).toBe(true);
  });

  it('coop: swapPressed is ALWAYS false on both channels (menus still see it)', () => {
    const inp = mk();
    inp.setMode('coop');
    inp.handleKey('Tab', true);
    expect(inp.state(0).swapPressed).toBe(false);
    expect(inp.state(1).swapPressed).toBe(false);
    expect(inp.state().swapPressed).toBe(true); // merged view: menus/rebinding
  });
});

describe('Input gamepad bucketing (headless fake pads)', () => {
  type FakePad = { index: number; buttons: { pressed: boolean }[]; axes: number[] };
  const makePad = (index: number): FakePad => ({
    index,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false })),
    axes: [0, 0],
  });
  const press = (pad: FakePad, i: number, down = true): void => {
    const b = pad.buttons[i];
    if (!b) throw new Error(`fake pad has no button ${i}`);
    b.pressed = down;
  };

  const install = (...pads: FakePad[]) => {
    vi.stubGlobal('navigator', { getGamepads: () => pads });
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('solo merges all pads (and counts them)', () => {
    const p0 = makePad(0);
    const p1 = makePad(1);
    install(p0, p1);
    const inp = mk();
    press(p1, 14); // dpad left on pad 1
    expect(inp.state().left).toBe(true);
    expect(inp.padCount()).toBe(2);
  });

  it('solo: pad button 3 edge is the hero swap and shows as Pad3 in edges()', () => {
    const p0 = makePad(0);
    install(p0);
    const inp = mk();
    press(p0, 3);
    expect(inp.state().swapPressed).toBe(true);
    expect(inp.edges().has('Pad3')).toBe(true);
    inp.endFrame();
    expect(inp.state().swapPressed).toBe(false); // held: no second edge
    inp.endFrame();
    press(p0, 3, false);
    inp.state(); // poll observes the release
    inp.endFrame();
    press(p0, 3); // press again: a real new edge
    expect(inp.state().swapPressed).toBe(true);
  });

  it('coop buckets held state by pad.index, not by array position', () => {
    const p0 = makePad(0);
    const p1 = makePad(1);
    install(p1, p0); // deliberately out of order: index must win
    const inp = mk();
    inp.setMode('coop');
    press(p0, 14); // pad 0: dpad left
    press(p1, 15); // pad 1: dpad right
    const s0 = inp.state(0);
    const s1 = inp.state(1);
    expect(s0.left).toBe(true);
    expect(s0.right).toBe(false);
    expect(s1.right).toBe(true);
    expect(s1.left).toBe(false);
    const merged = inp.state(); // menus keep the merged view in coop
    expect(merged.left).toBe(true);
    expect(merged.right).toBe(true);
  });

  it('coop: pad jump edge reaches only its own channel and clears on endFrame', () => {
    const p0 = makePad(0);
    const p1 = makePad(1);
    install(p0, p1);
    const inp = mk();
    inp.setMode('coop');
    press(p1, 0); // pad 1 bottom face
    expect(inp.state(1).jumpPressed).toBe(true);
    expect(inp.state(0).jumpPressed).toBe(false);
    inp.endFrame();
    expect(inp.state(1).jumpPressed).toBe(false); // held: no re-edge
    expect(inp.state(1).jump).toBe(true);
    expect(inp.state(0).jump).toBe(false);
  });

  it('coop: start on EITHER pad pauses both channels; pad button 3 swaps nobody', () => {
    const p0 = makePad(0);
    const p1 = makePad(1);
    install(p0, p1);
    const inp = mk();
    inp.setMode('coop');
    press(p1, 9); // P2 presses start
    expect(inp.state(0).pausePressed).toBe(true);
    expect(inp.state(1).pausePressed).toBe(true);
    inp.endFrame();
    press(p1, 9, false);
    press(p0, 3); // top face in coop: no swap for anyone
    expect(inp.state(0).swapPressed).toBe(false);
    expect(inp.state(1).swapPressed).toBe(false);
  });
});

describe('prefs bindings (two heroes)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('DEFAULT_BINDINGS covers swap with a single default code', () => {
    expect(DEFAULT_BINDINGS.swap).toEqual(['Tab']);
  });

  it('loadSettings backfills a missing swap entry from defaults (old saves)', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    // A pre-two-heroes save: bindings has every action EXCEPT swap.
    store.set(STORAGE_KEYS.settings, JSON.stringify({
      musicVol: 0.5,
      sfxVol: 0.25,
      reducedMotion: true,
      bindings: {
        left: ['KeyA'],
        right: ['KeyD'],
        up: ['KeyW'],
        down: ['KeyS'],
        jump: ['KeyJ'],
        run: ['KeyK'],
        pause: ['KeyP'],
      },
    }));
    const s = loadSettings();
    expect(s.bindings.swap).toEqual(['Tab']); // backfilled from defaults
    expect(s.bindings.swap).not.toBe(DEFAULT_BINDINGS.swap); // and cloned
    expect(s.bindings.jump).toEqual(['KeyJ']); // saved rebinds preserved
    expect(s.bindings.pause).toEqual(['KeyP']);
    expect(s.musicVol).toBe(0.5); // rest of the save intact
    expect(s.reducedMotion).toBe(true);
    // The result is a COMPLETE Record<ActionId, string[]>:
    for (const a of Object.keys(DEFAULT_BINDINGS) as ActionId[]) {
      expect(Array.isArray(s.bindings[a])).toBe(true);
      expect(s.bindings[a].length).toBeGreaterThan(0);
    }
  });
});

describe('keyboardLayout labels', () => {
  afterEach(() => {
    setLayoutForTest(null); // module singleton — MUST reset
  });

  it('US defaults with no layout detected', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('Space')).toBe('SPACE');
    expect(keyLabel('ArrowLeft')).toBe('←');
    expect(keyLabel('ShiftLeft')).toBe('SHIFT');
    expect(keyLabel('Escape')).toBe('ESC');
    expect(keyLabel('Semicolon')).toBe(';');
  });

  it('setLayoutForTest overrides printable keys but not position keys', () => {
    setLayoutForTest({ KeyW: 'z', KeyA: 'q' });
    expect(keyLabel('KeyW')).toBe('Z');
    expect(keyLabel('KeyA')).toBe('Q');
    expect(keyLabel('KeyD')).toBe('D'); // not in override: US default
    expect(keyLabel('Space')).toBe('SPACE'); // position keys stay position keys
  });

  it('falls back to builtin AZERTY when nav.language starts with fr', async () => {
    await initKeyboardLayout({ language: 'fr-FR' });
    expect(keyLabel('KeyW')).toBe('Z');
    expect(keyLabel('KeyA')).toBe('Q');
    expect(keyLabel('KeyQ')).toBe('A');
    expect(keyLabel('KeyZ')).toBe('W');
    expect(keyLabel('Semicolon')).toBe('M');
    expect(keyLabel('KeyM')).toBe(',');
  });

  it('uses navigator.keyboard.getLayoutMap when available (Chromium)', async () => {
    const fakeMap = new Map<string, string>([
      ['KeyW', 'z'],
      ['KeyQ', 'a'],
    ]);
    await initKeyboardLayout({
      language: 'en-US', // getLayoutMap must win over the language heuristic
      keyboard: { getLayoutMap: () => Promise.resolve(fakeMap) },
    });
    expect(keyLabel('KeyW')).toBe('Z');
    expect(keyLabel('KeyQ')).toBe('A');
  });

  it('a failing getLayoutMap falls back to the language heuristic', async () => {
    await initKeyboardLayout({
      language: 'fr',
      keyboard: { getLayoutMap: () => Promise.reject(new Error('nope')) },
    });
    expect(keyLabel('KeyW')).toBe('Z');
  });

  it('is a safe no-op with no navigator at all', async () => {
    await initKeyboardLayout(null);
    expect(keyLabel('KeyW')).toBe('W');
    await expect(initKeyboardLayout(undefined)).resolves.toBeUndefined();
  });
});
