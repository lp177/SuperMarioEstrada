// ============================================================================
// Input — physical-key (KeyboardEvent.code) state with per-step edge latching.
//
// Edge semantics (the whole point of this class): jumpPressed / firePressed /
// pausePressed latch on keydown and are cleared ONLY by endFrame(), which the
// game calls once per physics STEP inside the accumulator loop. A render frame
// that runs zero physics steps therefore never eats an edge.
//
// attach() is the single DOM-touching method; everything else is headless and
// driven through handleKey(), which the DOM listeners also use.
// ============================================================================

import type { ActionId, InputLike, InputState } from './types.ts';

/** Synthetic "codes" for gamepad buttons, merged into edges() so menus and
 *  rebinding UI see one vocabulary. Physical standard-mapping positions:
 *  Pad0 = bottom face (jump/confirm), Pad1 = right face (run alt / menu back),
 *  Pad2 = left face (run/fire), Pad9 = start (pause). */
const PAD_DPAD: readonly [number, string][] = [
  [12, 'PadUp'], [13, 'PadDown'], [14, 'PadLeft'], [15, 'PadRight'],
];
const STICK_DEADZONE = 0.22;

interface PadHeld {
  left: boolean; right: boolean; up: boolean; down: boolean;
  jump: boolean; run: boolean;
}

export class Input implements InputLike {
  private readonly getBindings: () => Record<ActionId, string[]>;
  /** Codes currently held down. */
  private readonly pressed = new Set<string>();
  /** Raw codes newly pressed since the last endFrame (menus / rebinding UI). */
  private readonly edgeSet = new Set<string>();
  private jumpEdge = false;
  private fireEdge = false;
  private pauseEdge = false;
  /** Previous button snapshot per gamepad.index — getGamepads() is a SPARSE
   *  array indexed by pad.index that is never renumbered; we key our own map
   *  by that index and reconcile from scratch every poll (house rule). */
  private readonly prevPadButtons = new Map<number, boolean[]>();
  private padHeld: PadHeld = { left: false, right: false, up: false, down: false, jump: false, run: false };
  private padPolled = false;
  private padsSeen = 0;

  constructor(getBindings: () => Record<ActionId, string[]>) {
    this.getBindings = getBindings;
  }

  /** Poll gamepads at most once per physics step (first state()/edges() call
   *  after endFrame). The API is not evented: this is the only correct way. */
  private pollPads(): void {
    if (this.padPolled) return;
    this.padPolled = true;
    const nav = globalThis.navigator as Navigator | undefined;
    const pads = nav?.getGamepads?.() ?? [];
    const held: PadHeld = { left: false, right: false, up: false, down: false, jump: false, run: false };
    let seen = 0;
    for (const pad of pads) {
      if (!pad) continue; // the array HAS holes — never index by player slot
      seen++;
      const prev = this.prevPadButtons.get(pad.index) ?? [];
      const btn = (i: number): boolean => pad.buttons[i]?.pressed ?? false;
      const edge = (i: number): boolean => btn(i) && !prev[i];
      // Left stick with deadzone + rescale so usable travel spans full 0..1.
      const scale = (v: number): number =>
        Math.abs(v) < STICK_DEADZONE ? 0 : (v - Math.sign(v) * STICK_DEADZONE) / (1 - STICK_DEADZONE);
      const sx = scale(pad.axes[0] ?? 0);
      const sy = scale(pad.axes[1] ?? 0);
      held.left ||= btn(14) || sx < -0.35;
      held.right ||= btn(15) || sx > 0.35;
      held.up ||= btn(12) || sy < -0.5;
      held.down ||= btn(13) || sy > 0.5;
      held.jump ||= btn(0);
      held.run ||= btn(2) || btn(1);
      if (edge(0)) { this.jumpEdge = true; this.edgeSet.add('Pad0'); }
      if (edge(2)) { this.fireEdge = true; this.edgeSet.add('Pad2'); }
      if (edge(1)) { this.fireEdge = true; this.edgeSet.add('Pad1'); }
      if (edge(9)) { this.pauseEdge = true; this.edgeSet.add('Pad9'); }
      for (const [i, name] of PAD_DPAD) if (edge(i)) this.edgeSet.add(name);
      this.prevPadButtons.set(pad.index, pad.buttons.map((b) => b.pressed));
    }
    this.padHeld = held;
    this.padsSeen = seen;
  }

  /** Connected pad count — for the settings screen status line. */
  padCount(): number {
    this.pollPads();
    return this.padsSeen;
  }

  /** Headless driver. `down = true` for keydown, `false` for keyup. A down for
   *  a code already held (OS auto-repeat) never produces a second edge. */
  handleKey(code: string, down: boolean): void {
    if (!down) {
      this.pressed.delete(code);
      return;
    }
    if (this.pressed.has(code)) return; // held: no second edge
    this.pressed.add(code);
    this.edgeSet.add(code); // raw edge — includes unbound codes, for rebinding
    const b = this.getBindings();
    if (b.jump.includes(code)) this.jumpEdge = true;
    if (b.run.includes(code)) this.fireEdge = true; // run's edge = pen throw
    if (b.pause.includes(code)) this.pauseEdge = true;
  }

  state(): InputState {
    this.pollPads();
    const b = this.getBindings();
    // An action is active if ANY of its bound codes is down, keyboard or pad.
    const held = (a: ActionId): boolean => b[a].some((c) => this.pressed.has(c));
    const p = this.padHeld;
    return {
      left: held('left') || p.left,
      right: held('right') || p.right,
      up: held('up') || p.up,
      down: held('down') || p.down,
      jump: held('jump') || p.jump,
      jumpPressed: this.jumpEdge,
      run: held('run') || p.run,
      firePressed: this.fireEdge,
      pausePressed: this.pauseEdge,
    };
  }

  /** Called once per physics step, INSIDE the accumulator loop. */
  endFrame(): void {
    this.jumpEdge = false;
    this.fireEdge = false;
    this.pauseEdge = false;
    this.edgeSet.clear();
    this.padPolled = false;
  }

  edges(): ReadonlySet<string> {
    this.pollPads();
    return this.edgeSet;
  }

  /** The ONLY method that touches the DOM. preventDefault fires ONLY for codes
   *  currently bound to an action — unbound keys are never stolen from the
   *  browser. Auto-repeat events are swallowed before they can re-latch edges. */
  attach(target: EventTarget): void {
    target.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (typeof ke.code !== 'string' || ke.code === '') return;
      if (this.isBound(ke.code)) ke.preventDefault();
      if (ke.repeat) return;
      this.handleKey(ke.code, true);
    });
    target.addEventListener('keyup', (e) => {
      const ke = e as KeyboardEvent;
      if (typeof ke.code !== 'string' || ke.code === '') return;
      this.handleKey(ke.code, false);
    });
  }

  private isBound(code: string): boolean {
    return Object.values(this.getBindings()).some((codes) => codes.includes(code));
  }
}
