// ============================================================================
// Keyboard layout labels — module-level singleton (house pattern).
//
// Bindings store PHYSICAL positions (KeyboardEvent.code); this module renders
// what a position PRINTS on the user's layout. lp177 is on AZERTY: the code
// 'KeyW' must label as 'Z'. Chromium exposes navigator.keyboard.getLayoutMap();
// elsewhere we fall back to a tiny builtin AZERTY table when the browser
// language is French, else US defaults. Fully safe with no navigator (Node).
// ============================================================================

/** code -> printed character. null = US defaults (derive label from the code). */
let layout: Map<string, string> | null = null;

/** Structural type for KeyboardLayoutMap (maplike: forEach(value, key)). */
interface LayoutMapLike {
  forEach(cb: (value: string, key: string) => void): void;
}

/** The builtin AZERTY fallback: only positions whose print differs in a way
 *  the default bindings / menus care about. */
const AZERTY: Record<string, string> = {
  KeyA: 'q',
  KeyQ: 'a',
  KeyW: 'z',
  KeyZ: 'w',
  KeyM: ',',
  Semicolon: 'm',
};

/** Non-printing position keys: labeled the same on every layout. Checked
 *  before the layout map — getLayoutMap only covers printable keys. */
const SPECIAL: Record<string, string> = {
  Space: 'SPACE',
  Enter: 'ENTER',
  Escape: 'ESC',
  Tab: 'TAB',
  Backspace: 'BKSP',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ShiftLeft: 'SHIFT',
  ShiftRight: 'SHIFT',
  ControlLeft: 'CTRL',
  ControlRight: 'CTRL',
  AltLeft: 'ALT',
  AltRight: 'ALT',
  MetaLeft: 'META',
  MetaRight: 'META',
  CapsLock: 'CAPS',
};

/** US punctuation defaults — consulted only when no layout map entry exists
 *  (an AZERTY map overrides these, e.g. Semicolon -> 'm'). */
const US_PUNCT: Record<string, string> = {
  Semicolon: ';',
  Comma: ',',
  Period: '.',
  Quote: "'",
  Slash: '/',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  IntlBackslash: '<',
};

/** Detect the user's layout. Tries navigator.keyboard.getLayoutMap()
 *  (Chromium); falls back to the builtin AZERTY table when the language is
 *  French; else US. Safe no-op with no navigator at all (plain Node). */
export async function initKeyboardLayout(
  nav: unknown = (globalThis as { navigator?: unknown }).navigator,
): Promise<void> {
  if (nav === null || typeof nav !== 'object') {
    layout = null;
    return;
  }
  const kb = (nav as { keyboard?: unknown }).keyboard;
  if (
    kb !== null &&
    typeof kb === 'object' &&
    typeof (kb as { getLayoutMap?: unknown }).getLayoutMap === 'function'
  ) {
    try {
      const m = await (kb as { getLayoutMap(): Promise<LayoutMapLike> }).getLayoutMap();
      const next = new Map<string, string>();
      m.forEach((value, key) => {
        next.set(key, value);
      });
      layout = next;
      return;
    } catch {
      // getLayoutMap exists but failed (permissions, iframe) — use heuristic.
    }
  }
  const lang = (nav as { language?: unknown }).language;
  layout =
    typeof lang === 'string' && lang.toLowerCase().startsWith('fr')
      ? new Map(Object.entries(AZERTY))
      : null;
}

/** Render what `code` PRINTS on the user's layout ('KeyW' -> 'Z' on AZERTY,
 *  'Space' -> 'SPACE', 'ArrowLeft' -> '←'). Never throws: codes are an open
 *  set (this is labeling, not dispatch), unknowns fall back to the raw code. */
export function keyLabel(code: string): string {
  const special = SPECIAL[code];
  if (special !== undefined) return special;
  const mapped = layout?.get(code);
  if (mapped !== undefined && mapped !== '') return mapped.toUpperCase();
  if (code.startsWith('Key') && code.length === 4) return code.slice(3).toUpperCase();
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  if (code.startsWith('Numpad')) return 'NUM ' + code.slice(6).toUpperCase();
  const punct = US_PUNCT[code];
  if (punct !== undefined) return punct;
  return code.toUpperCase();
}

/** Test hook: override the layout map, or reset to US defaults with null.
 *  Tests MUST reset in afterEach — this is module-level singleton state. */
export function setLayoutForTest(entries: Record<string, string> | null): void {
  layout = entries === null ? null : new Map(Object.entries(entries));
}
