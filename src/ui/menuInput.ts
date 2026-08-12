// ============================================================================
// ui/menuInput.ts — THE single owner of "keys drive a menu".
// History lesson: the house once duplicated this logic four times and that
// duplication caused 11 of the 15 defects in the audit. Every menu-like
// surface (title, level select, pause, settings, cutscene advance) polls a
// MenuNav; nobody else interprets keys for navigation. Do not fork this.
//
// Rules implemented here (the contract):
// - poll() reads input.state() ONCE and input.edges() ONCE per frame.
// - PRIMED: any direction/select/back channel already active when the menu is
//   constructed is muted until it has been seen released once — a key held
//   when a menu opens (including the very press that opened it) must not
//   navigate or activate instantly.
// - Navigation cadence: fresh press emits immediately, then NAV_DELAY frames
//   of silence, then a repeat every NAV_REPEAT frames while held.
// - Menus deliberately ALSO honor raw arrow/WASD physical codes plus
//   Enter/Space, regardless of the user's bindings (house convention).
// - Exactly ONE action per poll; priority: select > back > directions.
//
// Known limitation (by construction of InputLike): a direction driven ONLY by
// a raw code that is not in the bindings cannot key-repeat — InputLike exposes
// pressed edges for raw codes but no held state. Fresh presses always work;
// bound keys (the default bindings include arrows and WASD) repeat normally.
// ============================================================================

import type { InputLike, InputState } from '../core/types.ts';

export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'select' | 'back' | null;

/** Frames between the first emit of a held direction and its first repeat. */
export const NAV_DELAY = 26;
/** Frames between subsequent repeats while the direction stays held. */
export const NAV_REPEAT = 11;

type Dir = 'up' | 'down' | 'left' | 'right';
type Channel = Dir | 'select' | 'back';

/** Direction priority when several want to emit in the same poll. */
const DIR_ORDER: readonly Dir[] = ['up', 'down', 'left', 'right'];

const CHANNELS: readonly Channel[] = ['up', 'down', 'left', 'right', 'select', 'back'];

/** Hard-coded PHYSICAL codes menus always honor, regardless of bindings. */
const DIR_CODES: Record<Dir, readonly string[]> = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
};

/** Menus confirm on EXPLICIT confirm inputs only: Enter, Space, pad A.
 *  Never on the jump ACTION — ArrowUp/KeyW are jump bindings too, and using
 *  the action made "up" enter the focused item instead of moving focus
 *  (shipped bug: the world map could not select upward nodes). */
const SELECT_CODES: readonly string[] = ['Enter', 'Space', 'Pad0'];
/** Escape on keyboard; Pad1 = right face button (B) on a standard-mapping pad. */
const BACK_CODES: readonly string[] = ['Escape', 'Pad1'];

function anyIn(edges: ReadonlySet<string>, codes: readonly string[]): boolean {
  for (const c of codes) {
    if (edges.has(c)) return true;
  }
  return false;
}

/** Whether each channel is "active" this frame: bindings-derived state OR the
 *  hard-coded raw codes. Used both for priming (a primed channel unprimes the
 *  first frame it reads inactive) and for the direction hold counters. */
function readActivity(s: InputState, e: ReadonlySet<string>): Record<Channel, boolean> {
  return {
    up: s.up || anyIn(e, DIR_CODES.up),
    down: s.down || anyIn(e, DIR_CODES.down),
    left: s.left || anyIn(e, DIR_CODES.left),
    right: s.right || anyIn(e, DIR_CODES.right),
    select: anyIn(e, SELECT_CODES),
    back: s.pausePressed || anyIn(e, BACK_CODES),
  };
}

export class MenuNav {
  private readonly input: InputLike;
  /** Channels muted until seen released once (active at construction). */
  private readonly primed: Record<Channel, boolean>;
  /** Consecutive polls each direction has been active (0 = not held). */
  private readonly held: Record<Dir, number> = { up: 0, down: 0, left: 0, right: 0 };

  constructor(input: InputLike) {
    this.input = input;
    // Snapshot what is already active the moment the menu opens: those
    // channels are primed. This swallows both held keys and the same-frame
    // edge of the press that opened the menu (e.g. Escape into a pause menu).
    this.primed = readActivity(input.state(), input.edges());
  }

  /** Call exactly once per frame. Returns at most one action. */
  poll(): MenuAction {
    const s = this.input.state();
    const e = this.input.edges();
    const active = readActivity(s, e);

    // Unprime every channel seen released. (This frame still emits nothing
    // for it — the NEXT activation is a fresh press.)
    for (const ch of CHANNELS) {
      if (this.primed[ch] && !active[ch]) this.primed[ch] = false;
    }

    // select/back fire on edges only, so they cannot spam while held.
    const selectFire = !this.primed.select && anyIn(e, SELECT_CODES);
    const backFire = !this.primed.back && (s.pausePressed || anyIn(e, BACK_CODES));

    // Directions: advance hold counters and pick the first that fires.
    let dirEmit: MenuAction = null;
    for (const d of DIR_ORDER) {
      if (active[d] && !this.primed[d]) {
        this.held[d] += 1;
        const h = this.held[d];
        const fires = h === 1 || (h > NAV_DELAY && (h - 1 - NAV_DELAY) % NAV_REPEAT === 0);
        if (fires && dirEmit === null) dirEmit = d;
      } else {
        this.held[d] = 0;
      }
    }

    if (selectFire) return 'select';
    if (backFire) return 'back';
    return dirEmit;
  }
}
