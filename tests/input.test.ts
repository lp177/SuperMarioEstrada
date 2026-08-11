import { describe, it, expect, afterEach } from 'vitest';
import { Input } from '../src/core/input.ts';
import { DEFAULT_BINDINGS } from '../src/core/prefs.ts';
import {
  initKeyboardLayout,
  keyLabel,
  setLayoutForTest,
} from '../src/core/keyboardLayout.ts';

const mk = () => new Input(() => DEFAULT_BINDINGS);

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
