// ============================================================================
// Input — physical-key (KeyboardEvent.code) state with per-step edge latching.
//
// Edge semantics (the whole point of this class): jumpPressed / firePressed /
// pausePressed / swapPressed latch on keydown and are cleared ONLY by
// endFrame(), which the game calls once per physics STEP inside the
// accumulator loop. A render frame that runs zero physics steps therefore
// never eats an edge.
//
// Two-hero channels (contract in types.ts):
// - state() with no argument is the MERGED view — every binding slot, every
//   pad — plus swapPressed (edge of any 'swap'-bound code or pad button 3).
//   Menus ALWAYS read this; solo gameplay reads this.
// - setMode('coop') splits play input: channel 0 = binding slot [0] of each
//   action + gamepad index 0; channel 1 = slots [1..] + gamepad index 1.
//   swapPressed is hard FALSE on both co-op channels (no swapping in co-op).
//   pausePressed fires on EITHER channel's pause codes plus Escape / Enter /
//   either pad's start button — anyone can pause.
// - In solo, state(0) === state() and state(1) is an idle player.
// Per-channel edges latch independently of the merged ones, so a Space tap
// (P1) and an ArrowUp tap (P2) in the same step each reach their own player.
//
// attach() is the single DOM-touching method; everything else is headless and
// driven through handleKey(), which the DOM listeners also use.
// ============================================================================

import type { ActionId, InputLike, InputState, PlayerChannel } from './types.ts';

/** Synthetic "codes" for gamepad buttons, merged into edges() so menus and
 *  rebinding UI see one vocabulary. Physical standard-mapping positions:
 *  Pad0 = bottom face (jump/confirm), Pad1 = right face (run alt / menu back),
 *  Pad2 = left face (run/fire), Pad3 = top face (hero swap), Pad9 = start
 *  (pause). */
const PAD_DPAD: readonly [number, string][] = [
  [12, 'PadUp'], [13, 'PadDown'], [14, 'PadLeft'], [15, 'PadRight'],
];
const STICK_DEADZONE = 0.22;

/** Hard-mapped pause codes for co-op channels: either player can always pause
 *  with these even after a rebind removed them from the pause action. */
const COOP_PAUSE_CODES: readonly string[] = ['Escape', 'Enter'];

interface PadHeld {
  left: boolean; right: boolean; up: boolean; down: boolean;
  jump: boolean; run: boolean;
}

const noHeld = (): PadHeld =>
  ({ left: false, right: false, up: false, down: false, jump: false, run: false });

function orInto(dst: PadHeld, src: PadHeld): void {
  dst.left ||= src.left;
  dst.right ||= src.right;
  dst.up ||= src.up;
  dst.down ||= src.down;
  dst.jump ||= src.jump;
  dst.run ||= src.run;
}

/** What an absent player reads: solo state(1). Spread into a fresh object per
 *  call so no caller can alias another's view. */
const IDLE_STATE: InputState = {
  left: false, right: false, up: false, down: false,
  jump: false, jumpPressed: false, run: false, firePressed: false,
  pausePressed: false, swapPressed: false,
};

export class Input implements InputLike {
  private readonly getBindings: () => Record<ActionId, string[]>;
  /** 'solo' merges all devices/slots; 'coop' splits by slot + pad index. */
  private mode: 'solo' | 'coop' = 'solo';
  /** Codes currently held down. */
  private readonly pressed = new Set<string>();
  /** Raw codes newly pressed since the last endFrame (menus / rebinding UI). */
  private readonly edgeSet = new Set<string>();
  // Merged-view edges (all binding slots, all pads).
  private jumpEdge = false;
  private fireEdge = false;
  private pauseEdge = false;
  private swapEdge = false;
  // Per-channel edges, latched independently of the merged ones (read only by
  // the co-op channel views; endFrame clears them like every other latch).
  private readonly chJumpEdge: [boolean, boolean] = [false, false];
  private readonly chFireEdge: [boolean, boolean] = [false, false];
  /** Previous button snapshot per gamepad.index — getGamepads() is a SPARSE
   *  array indexed by pad.index that is never renumbered; we key our own map
   *  by that index and reconcile from scratch every poll (house rule). */
  private readonly prevPadButtons = new Map<number, boolean[]>();
  private padHeld: PadHeld = noHeld();
  /** Pad hold state bucketed by pad.index: [0] and [1] drive co-op channels. */
  private chPadHeld: [PadHeld, PadHeld] = [noHeld(), noHeld()];
  private padPolled = false;
  private padsSeen = 0;

  constructor(getBindings: () => Record<ActionId, string[]>) {
    this.getBindings = getBindings;
  }

  setMode(mode: 'solo' | 'coop'): void {
    this.mode = mode;
  }

  /** Poll gamepads at most once per physics step (first state()/edges() call
   *  after endFrame). The API is not evented: this is the only correct way. */
  private pollPads(): void {
    if (this.padPolled) return;
    this.padPolled = true;
    const nav = globalThis.navigator as Navigator | undefined;
    const pads = nav?.getGamepads?.() ?? [];
    const merged = noHeld();
    const byChannel: [PadHeld, PadHeld] = [noHeld(), noHeld()];
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
      const one: PadHeld = {
        left: btn(14) || sx < -0.35,
        right: btn(15) || sx > 0.35,
        up: btn(12) || sy < -0.5,
        down: btn(13) || sy > 0.5,
        jump: btn(0),
        run: btn(2) || btn(1),
      };
      orInto(merged, one);
      // Co-op bucketing: pad.index 0 -> channel 0, index 1 -> channel 1.
      // Higher indexes still reach the merged view (menus) but drive no player.
      const ch: PlayerChannel | null = pad.index === 0 ? 0 : pad.index === 1 ? 1 : null;
      if (ch !== null) orInto(byChannel[ch], one);
      if (edge(0)) {
        this.jumpEdge = true;
        this.edgeSet.add('Pad0');
        if (ch !== null) this.chJumpEdge[ch] = true;
      }
      if (edge(2)) {
        this.fireEdge = true;
        this.edgeSet.add('Pad2');
        if (ch !== null) this.chFireEdge[ch] = true;
      }
      if (edge(1)) {
        this.fireEdge = true;
        this.edgeSet.add('Pad1');
        if (ch !== null) this.chFireEdge[ch] = true;
      }
      // Button 3 (top face) is the hard-mapped hero swap. It latches the
      // merged swap edge only — co-op channel views never expose swapPressed.
      if (edge(3)) {
        this.swapEdge = true;
        this.edgeSet.add('Pad3');
      }
      if (edge(9)) {
        this.pauseEdge = true;
        this.edgeSet.add('Pad9');
      }
      for (const [i, name] of PAD_DPAD) if (edge(i)) this.edgeSet.add(name);
      this.prevPadButtons.set(pad.index, pad.buttons.map((b) => b.pressed));
    }
    this.padHeld = merged;
    this.chPadHeld = byChannel;
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
    // Merged edges: any binding slot of the action.
    if (b.jump.includes(code)) this.jumpEdge = true;
    if (b.run.includes(code)) this.fireEdge = true; // run's edge = pen throw
    if (b.pause.includes(code)) this.pauseEdge = true;
    if (b.swap.includes(code)) this.swapEdge = true;
    // Per-channel edges: slot [0] -> channel 0, slots [1..] -> channel 1.
    // Latched unconditionally (mode only selects which view is READ) so both
    // players' taps in the same step each survive until endFrame.
    if (b.jump[0] === code) this.chJumpEdge[0] = true;
    if (b.jump.indexOf(code, 1) !== -1) this.chJumpEdge[1] = true;
    if (b.run[0] === code) this.chFireEdge[0] = true;
    if (b.run.indexOf(code, 1) !== -1) this.chFireEdge[1] = true;
  }

  state(channel?: PlayerChannel): InputState {
    this.pollPads();
    if (channel === undefined) return this.mergedState(); // menus & solo play
    if (this.mode === 'solo') {
      // Solo: channel 0 IS the merge; channel 1 is an idle player.
      return channel === 0 ? this.mergedState() : { ...IDLE_STATE };
    }
    return this.channelState(channel);
  }

  /** Today's solo behavior: every binding slot, every pad, plus swapPressed. */
  private mergedState(): InputState {
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
      swapPressed: this.swapEdge,
    };
  }

  /** One co-op player's view: their binding slots + their pad index only. */
  private channelState(ch: PlayerChannel): InputState {
    const b = this.getBindings();
    const held = (a: ActionId): boolean => {
      const codes = b[a];
      if (ch === 0) {
        const primary = codes[0];
        return primary !== undefined && this.pressed.has(primary);
      }
      for (let i = 1; i < codes.length; i++) {
        const c = codes[i];
        if (c !== undefined && this.pressed.has(c)) return true;
      }
      return false;
    };
    const p = this.chPadHeld[ch];
    return {
      left: held('left') || p.left,
      right: held('right') || p.right,
      up: held('up') || p.up,
      down: held('down') || p.down,
      jump: held('jump') || p.jump,
      jumpPressed: this.chJumpEdge[ch],
      run: held('run') || p.run,
      firePressed: this.chFireEdge[ch],
      // Anyone can pause: either channel's pause codes and either pad's start
      // (both latch the merged pauseEdge), plus hard-mapped Escape/Enter.
      pausePressed: this.pauseEdge || COOP_PAUSE_CODES.some((c) => this.edgeSet.has(c)),
      swapPressed: false, // no swapping in co-op — P2 IS the other hero
    };
  }

  /** Called once per physics step, INSIDE the accumulator loop. */
  endFrame(): void {
    this.jumpEdge = false;
    this.fireEdge = false;
    this.pauseEdge = false;
    this.swapEdge = false;
    this.chJumpEdge[0] = this.chJumpEdge[1] = false;
    this.chFireEdge[0] = this.chFireEdge[1] = false;
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
