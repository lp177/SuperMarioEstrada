// ============================================================================
// ui/theme.ts — THE design token table.
// Every UI surface (scenes, HUD, title cards, cutscene text) pulls colors and
// fonts from here. House rule: no stray hex literals anywhere else — if a
// surface needs a color, it needs a token in this object.
//
// Dark Material-inspired: near-black ground, elevated grey surfaces, scam-gold
// accent (the only color the conspirators respect) and Estrada red for danger
// and drama. Dependency-free by design — importable from anywhere, including
// plain Node (no DOM access at module level; helpers receive a ctx).
// ============================================================================

export const UI = {
  /** Page / letterbox ground (Material dark baseline). */
  bg: '#121212',
  /** Elevated panel surface. */
  surface: '#1e1e1e',
  /** Higher-elevation / focused surface. */
  surfaceHi: '#2a2a2a',
  /** Primary text. */
  text: '#e0e0e0',
  /** Secondary / de-emphasized text. */
  textDim: '#9e9e9e',
  /** Scam gold — coins, focus rings, everything the grifters certify. */
  accent: '#ffca28',
  /** Estrada red — the cap, the brand, the fraud. */
  accent2: '#ef5350',
  /** Success / confirmation. */
  ok: '#66bb6a',
  /** Damage / destructive actions. */
  danger: '#ef5350',
  /** The 1px retro outline behind everything legible. */
  outline: '#000',
  fontTitle: 'bold 28px monospace',
  fontHead: 'bold 16px monospace',
  fontBody: '12px monospace',
  fontSmall: '9px monospace',
} as const;

/** Default corner radius for panels, px. */
const PANEL_RADIUS = 4;

/** Trace a rounded-rect path. Hand-rolled with arcTo so we do not depend on
 *  CanvasRenderingContext2D.roundRect availability. */
function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/** Rounded dark surface with a 1px outline. `focus` adds the gold glow ring
 *  (and lifts the fill one elevation step) — the single focus treatment every
 *  menu shares. */
export function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  opts?: { focus?: boolean },
): void {
  const focus = opts?.focus === true;
  ctx.save();
  roundedRectPath(ctx, x, y, w, h, PANEL_RADIUS);
  ctx.fillStyle = focus ? UI.surfaceHi : UI.surface;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = UI.outline;
  ctx.stroke();
  if (focus) {
    ctx.shadowColor = UI.accent;
    ctx.shadowBlur = 8;
    ctx.strokeStyle = UI.accent;
    ctx.lineWidth = 2;
    roundedRectPath(ctx, x - 1.5, y - 1.5, w + 3, h + 3, PANEL_RADIUS + 1);
    ctx.stroke();
  }
  ctx.restore();
}

/** Retro-legibility text: 1px black offset shadow, then the fill on top.
 *  Uses the ctx's current font / textAlign / textBaseline. */
export function textShadow(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string = UI.text,
): void {
  ctx.fillStyle = UI.outline;
  ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}
