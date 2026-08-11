// ============================================================================
// The casting department: the five principals + toads, rats and one skeleton.
// Rebuilt for recognizability: 2-3px ink outlines, 2-tone shading (base +
// jaw/side shadow + blush), highlight dots in every open eye. Political-
// cartoon caricature first, costume second — the caricature must read at
// 640x360 in one glance.
// Deterministic — no Math.random; all motion comes from caller-supplied
// clocks. No DOM at module scope: helpers receive a ctx.
// ============================================================================

type Ctx = CanvasRenderingContext2D;

/** Poster ink (outline) color. */
export const INK = '#1b1030';
export const LW = 3;

// --- palette -----------------------------------------------------------------
export const P = {
  skin: '#f2c090',
  skinShade: 'rgba(150,80,45,0.22)',
  blush: 'rgba(235,110,80,0.30)',
  hairDark: '#2e1a0c',
  orange: '#f5942e',       // Impeach complexion
  orangeDark: '#d97a1a',
  orangePale: '#fdc47c',   // the goggle-tan eye mask
  wig: '#ffd94d',
  wigDark: '#d9a51e',
  tie: '#c8262b',
  tieDark: '#8f161e',
  estradaRed: '#d8302f',
  estradaRedDark: '#a82024',
  estradaBlue: '#2b4fa8',
  estradaBlueDark: '#1d3a85',
  mangBlue: '#24427c',     // Mangiani's darker overalls
  mangBlueDark: '#182f5e',
  glove: '#f4f0e6',
  gloveShade: '#cfc8b6',
  shoe: '#6b3d1e',
  shoeDark: '#46270f',
  mangGreen: '#2f9e44',
  mangDark: '#1f6f30',
  mangHair: '#5a3a1c',
  peachPink: '#f7a8c8',
  peachDeep: '#ee8ab5',
  peachDark: '#d1618f',
  peachPale: '#fdd9e8',
  hairGold: '#f7c948',
  hairGoldDark: '#d9a51e',
  brooch: '#3d6fd8',
  toadWhite: '#f5efe0',
  toadRed: '#e04848',
  toadSkin: '#f0c9a0',
  shellY: '#e8d532',
  shellG: '#3a9a3a',
  turtSkin: '#8fca5c',
  turtSkinDark: '#68a038',
  turtBelly: '#e8dcae',
  beret: '#20222c',
  bone: '#d9d4c4',
  wood: '#6b4420',
  woodLight: '#835b2f',
  woodDark: '#4a2f14',
} as const;

export const COIN = '#f6c94b';
export const COIN_DARK = '#c9962a';

// --- primitives --------------------------------------------------------------
export function rect(c: Ctx, x: number, y: number, w: number, h: number, fill: string, lw = LW): void {
  c.fillStyle = fill;
  c.fillRect(x, y, w, h);
  if (lw > 0) { c.lineWidth = lw; c.strokeStyle = INK; c.strokeRect(x, y, w, h); }
}
export function flat(c: Ctx, x: number, y: number, w: number, h: number, fill: string): void {
  c.fillStyle = fill;
  c.fillRect(x, y, w, h);
}
export function disc(c: Ctx, x: number, y: number, r: number, fill: string, lw = LW): void {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = fill;
  c.fill();
  if (lw > 0) { c.lineWidth = lw; c.strokeStyle = INK; c.stroke(); }
}
export function ell(c: Ctx, x: number, y: number, rx: number, ry: number, fill: string, lw = LW): void {
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fillStyle = fill;
  c.fill();
  if (lw > 0) { c.lineWidth = lw; c.strokeStyle = INK; c.stroke(); }
}
export function poly(c: Ctx, pts: readonly (readonly [number, number])[], fill: string, lw = LW): void {
  const p0 = pts[0];
  if (!p0) return;
  c.beginPath();
  c.moveTo(p0[0], p0[1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    c.lineTo(p[0], p[1]);
  }
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  if (lw > 0) { c.lineWidth = lw; c.strokeStyle = INK; c.stroke(); }
}
export function seg(c: Ctx, x1: number, y1: number, x2: number, y2: number, color: string, lw: number): void {
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.strokeStyle = color;
  c.lineWidth = lw;
  c.stroke();
}
export function txt(
  c: Ctx, s: string, x: number, y: number, px: number, fill: string,
  align: CanvasTextAlign = 'center', outline = true,
): void {
  c.font = `bold ${px}px monospace`;
  c.textAlign = align;
  c.textBaseline = 'middle';
  if (outline) {
    c.lineWidth = Math.max(2, Math.floor(px / 5));
    c.strokeStyle = INK;
    c.strokeText(s, x, y);
  }
  c.fillStyle = fill;
  c.fillText(s, x, y);
}

// --- tiny shared shading helpers --------------------------------------------
/** Soft crescent shadow under a round jaw: darkens the lower part of a face. */
function jawShade(c: Ctx, x: number, y: number, rx: number, ry: number): void {
  c.save();
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.clip();
  c.fillStyle = P.skinShade;
  c.beginPath();
  c.ellipse(x, y + ry * 0.72, rx * 1.05, ry * 0.5, 0, 0, Math.PI * 2);
  c.fill();
  c.restore();
}
/** Open eye with white, pupil and the little life-giving highlight dot. */
function eyeBall(c: Ctx, ex: number, ey: number, rx: number, ry: number, px: number, py: number, pr: number): void {
  ell(c, ex, ey, rx, ry, '#fff', 2);
  disc(c, px, py, pr, INK, 0);
  disc(c, px - pr * 0.35, py - pr * 0.4, Math.max(0.7, pr * 0.38), '#fff', 0);
}

// --- shared small props ------------------------------------------------------
export function coin(c: Ctx, x: number, y: number, r: number): void {
  disc(c, x, y, r, COIN, 2);
  c.beginPath();
  c.arc(x, y, r * 0.55, 0, Math.PI * 2);
  c.strokeStyle = COIN_DARK;
  c.lineWidth = 2;
  c.stroke();
}
export function coffeeCup(c: Ctx, x: number, y: number, s: number, frame: number): void {
  rect(c, x - 7 * s, y - 10 * s, 14 * s, 10 * s, P.glove, 2);
  flat(c, x - 5 * s, y - 9 * s, 10 * s, 2.5 * s, '#5c3418'); // the coffee line
  c.beginPath();
  c.arc(x + 8 * s, y - 5 * s, 4 * s, -Math.PI / 2, Math.PI / 2);
  c.strokeStyle = INK;
  c.lineWidth = 2;
  c.stroke();
  steam(c, x, y - 12 * s, s, frame, 0);
}
export function steam(c: Ctx, x: number, y: number, s: number, frame: number, phase: number): void {
  c.strokeStyle = 'rgba(255,255,255,0.75)';
  c.lineWidth = 2;
  for (let i = 0; i < 2; i++) {
    const t = frame * 0.05 + phase + i * 2.1;
    c.beginPath();
    for (let k = 0; k <= 4; k++) {
      const yy = y - k * 5 * s;
      const xx = x + (i - 0.5) * 6 * s + Math.sin(t + k * 0.9) * 3 * s;
      if (k === 0) c.moveTo(xx, yy); else c.lineTo(xx, yy);
    }
    c.stroke();
  }
}
export function sparkle(c: Ctx, x: number, y: number, r: number, frame: number, phase: number): void {
  const a = 0.5 + 0.5 * Math.sin(frame * 0.12 + phase);
  const rr = r * (0.6 + 0.4 * a);
  c.fillStyle = `rgba(255,245,180,${(0.35 + 0.6 * a).toFixed(2)})`;
  c.beginPath();
  c.moveTo(x, y - rr);
  c.lineTo(x + rr * 0.3, y - rr * 0.3);
  c.lineTo(x + rr, y);
  c.lineTo(x + rr * 0.3, y + rr * 0.3);
  c.lineTo(x, y + rr);
  c.lineTo(x - rr * 0.3, y + rr * 0.3);
  c.lineTo(x - rr, y);
  c.lineTo(x - rr * 0.3, y - rr * 0.3);
  c.closePath();
  c.fill();
}
export function sweatDrop(c: Ctx, x: number, y: number, s: number, frame: number): void {
  const t = (frame % 90) / 90;
  const yy = y + t * 10 * s;
  poly(c, [[x, yy - 6 * s], [x + 4 * s, yy + 2 * s], [x, yy + 5 * s], [x - 4 * s, yy + 2 * s]], '#9ed8f7', 2);
}
export function speechSpikes(c: Ctx, x: number, y: number, n: number, frame: number): void {
  c.strokeStyle = INK;
  c.lineWidth = 2;
  for (let i = 0; i < n; i++) {
    const a = -0.6 + i * (1.2 / Math.max(1, n - 1)) + Math.sin(frame * 0.2) * 0.05;
    c.beginPath();
    c.moveTo(x + Math.cos(a) * 10, y + Math.sin(a) * 10);
    c.lineTo(x + Math.cos(a) * 16, y + Math.sin(a) * 16);
    c.stroke();
  }
}
export function rat(c: Ctx, x: number, y: number, s: number, frame: number, phase: number, cheer = false): void {
  const wig = Math.sin(frame * 0.15 + phase);
  ell(c, x, y - 5 * s, 9 * s, 5 * s, '#8a8494', 2);           // body
  disc(c, x + 8 * s, y - 7 * s, 4.5 * s, '#8a8494', 2);        // head
  disc(c, x + 7 * s, y - 11 * s, 2 * s, '#b7aec2', 2);         // ear
  disc(c, x + 7 * s, y - 11 * s, 0.9 * s, '#e0a9c0', 0);       // inner ear
  disc(c, x + 10.5 * s, y - 7.5 * s, 0.9 * s, INK, 0);         // eye
  disc(c, x + 12.3 * s, y - 6.2 * s, 0.7 * s, '#e0a9c0', 0);   // nose
  seg(c, x + 11 * s, y - 5.5 * s, x + 15 * s, y - 6 * s, 'rgba(230,225,240,0.8)', 1); // whisker
  seg(c, x + 11 * s, y - 5 * s, x + 15 * s, y - 4 * s, 'rgba(230,225,240,0.8)', 1);
  c.beginPath();                                               // tail
  c.moveTo(x - 8 * s, y - 4 * s);
  c.quadraticCurveTo(x - 15 * s, y - 4 * s - wig * 4 * s, x - 18 * s, y - 9 * s + wig * 3 * s);
  c.strokeStyle = '#b7aec2';
  c.lineWidth = 2;
  c.stroke();
  if (cheer) {
    const cl = Math.abs(Math.sin(frame * 0.25 + phase));
    disc(c, x + 4 * s - cl * 2, y - 12 * s, 1.6 * s, '#b7aec2', 1);
    disc(c, x + 9 * s + cl * 2, y - 12 * s, 1.6 * s, '#b7aec2', 1);
  }
}

export interface SkeletonOpts {
  pose?: 'slump' | 'salute' | 'poker';
  mood?: 'flat' | 'happy';
}
/** The dungeon cellmate. Still holding his bet slip after all these years. */
export function skeleton(c: Ctx, x: number, y: number, s: number, o: SkeletonOpts = {}): void {
  const pose = o.pose ?? 'slump';
  const hy = y - 56 * s;
  // ribcage
  rect(c, x - 10 * s, y - 46 * s, 20 * s, 30 * s, P.bone, 2.5);
  for (let i = 0; i < 3; i++) seg(c, x - 10 * s, y - 40 * s + i * 8 * s, x + 10 * s, y - 40 * s + i * 8 * s, INK, 2);
  seg(c, x, y - 46 * s, x, y - 16 * s, INK, 2); // sternum
  // little leg bones folded (he sits)
  seg(c, x - 6 * s, y - 16 * s, x - 14 * s, y - 2 * s, P.bone, 4);
  seg(c, x + 6 * s, y - 16 * s, x + 14 * s, y - 2 * s, P.bone, 4);
  disc(c, x - 15 * s, y - 2 * s, 2.5 * s, P.bone, 2);
  disc(c, x + 15 * s, y - 2 * s, 2.5 * s, P.bone, 2);
  // skull
  disc(c, x, hy, 12 * s, P.bone);
  flat(c, x - 8 * s, hy + 5 * s, 16 * s, 6 * s, P.bone);
  disc(c, x - 4.5 * s, hy - 2 * s, 2.6 * s, '#2a2438', 0);   // sockets
  disc(c, x + 4.5 * s, hy - 2 * s, 2.6 * s, '#2a2438', 0);
  disc(c, x - 4 * s, hy - 2.5 * s, 0.8 * s, '#9ed8f7', 0);   // a faint spark of life
  disc(c, x + 5 * s, hy - 2.5 * s, 0.8 * s, '#9ed8f7', 0);
  poly(c, [[x - 1.5 * s, hy + 2 * s], [x + 1.5 * s, hy + 2 * s], [x, hy + 5 * s]], '#2a2438', 0); // nose hole
  if (o.mood === 'happy') {
    c.beginPath(); c.arc(x, hy + 6 * s, 4.5 * s, 0.15 * Math.PI, 0.85 * Math.PI);
    c.strokeStyle = INK; c.lineWidth = 2; c.stroke();
  } else {
    seg(c, x - 4 * s, hy + 8 * s, x + 4 * s, hy + 8 * s, INK, 2);
  }
  for (let i = -1; i <= 2; i++) seg(c, x + i * 2.4 * s - 1 * s, hy + 6.5 * s, x + i * 2.4 * s - 1 * s, hy + 9.5 * s, INK, 1.5); // teeth
  // arm with THE bet slip
  if (pose === 'salute' || pose === 'poker') {
    seg(c, x + 10 * s, y - 40 * s, x + 20 * s, y - 56 * s, P.bone, 4);  // raised arm bone
    disc(c, x + 20 * s, y - 56 * s, 2.5 * s, P.bone, 2);
    if (pose === 'salute') {
      rect(c, x + 14 * s, y - 74 * s, 22 * s, 14 * s, '#f4f0e6', 2);    // slip held in the raised hand
      txt(c, 'BET', x + 25 * s, y - 67 * s, Math.max(7, 7 * s), '#b9412f', 'center', false);
    } else {
      // a fan of three cards held in the raised hand
      for (let i = -1; i <= 1; i++) {
        c.save(); c.translate(x + 22 * s, y - 62 * s); c.rotate(i * 0.28);
        rect(c, -5 * s, -16 * s, 10 * s, 15 * s, '#f4f0e6', 1.5);
        disc(c, 0, -8.5 * s, 1.6 * s, i === 0 ? P.toadRed : INK, 0);
        c.restore();
      }
    }
  } else {
    seg(c, x + 10 * s, y - 42 * s, x + 26 * s, y - 34 * s, P.bone, 4);
    rect(c, x + 22 * s, y - 44 * s, 26 * s, 16 * s, '#f4f0e6', 2);
    txt(c, 'BET', x + 35 * s, y - 36 * s, Math.max(7, 8 * s), '#b9412f', 'center', false);
  }
  seg(c, x - 10 * s, y - 42 * s, x - 22 * s, y - 30 * s, P.bone, 4); // other arm resting
  disc(c, x - 23 * s, y - 29 * s, 2.5 * s, P.bone, 2);
}

// ============================================================================
// THE HANDS. Enormous. White-gloved. Always.
// ============================================================================

/** One HUGE white-gloved hand, palm out, fingers up. cx,cy = palm center. */
export function bigHand(c: Ctx, cx: number, cy: number, r: number, tilt: number): void {
  c.save();
  c.translate(cx, cy);
  c.rotate(tilt);
  // cuff band — the glove is anchored to a sleeve behind it
  rect(c, -r * 0.62, r * 0.8, r * 1.24, r * 0.52, P.glove, Math.max(2, r * 0.05));
  ell(c, 0, 0, r, r * 1.1, P.glove);
  for (let i = 0; i < 4; i++) {
    const fx = -r * 0.72 + i * (r * 0.48);
    ell(c, fx, -r * 0.95, r * 0.22, r * 0.55, P.glove, 2.5);
  }
  ell(c, -r * 0.95, r * 0.25, r * 0.5, r * 0.24, P.glove, 2.5); // thumb
  // palm crease + knuckle stitching (2-tone)
  c.strokeStyle = P.gloveShade;
  c.lineWidth = Math.max(2, r * 0.06);
  c.beginPath(); c.arc(0, r * 0.15, r * 0.55, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
  c.beginPath(); c.arc(0, r * 0.42, r * 0.62, Math.PI * 1.2, Math.PI * 1.8); c.stroke();
  c.restore();
}

// ============================================================================
// ESTRADA — smug fake hero. Feet at (x,y), height ~96*s.
// ============================================================================

export interface EstradaOpts {
  facing?: 1 | -1;
  eyes?: 'smug' | 'wink' | 'wide' | 'closed';
  mouth?: 'grin' | 'flat' | 'open' | 'nervous';
  arms?: 'down' | 'raised' | 'shrug' | 'stamp' | 'recline';
  item?: 'none' | 'stamp' | 'bag';
  masked?: boolean;
  sweatFrame?: number;   // if >= 0, one big animated sweat drop
}

/** White glove with a cuff line, at a wrist point. */
function gloveHand(c: Ctx, x: number, y: number, r: number): void {
  disc(c, x, y, r, P.glove, 2);
  c.strokeStyle = P.gloveShade;
  c.lineWidth = 1.5;
  c.beginPath(); c.arc(x, y, r * 0.6, Math.PI * 0.2, Math.PI * 0.8); c.stroke();
}

export function drawEstrada(c: Ctx, x: number, y: number, s: number, o: EstradaOpts = {}): void {
  const f = o.facing ?? 1;
  const eyes = o.eyes ?? 'smug';
  const mouth = o.mouth ?? 'grin';
  const arms = o.arms ?? 'down';
  const hy = y - 74 * s; // head center
  // legs: two blue trouser legs with a gap line + cuffs
  rect(c, x - 13 * s, y - 34 * s, 12 * s, 28 * s, P.estradaBlue, 2.5);
  rect(c, x + 1 * s, y - 34 * s, 12 * s, 28 * s, P.estradaBlue, 2.5);
  flat(c, x - 12 * s, y - 12 * s, 10 * s, 4 * s, P.estradaBlueDark);   // cuffs
  flat(c, x + 2 * s, y - 12 * s, 10 * s, 4 * s, P.estradaBlueDark);
  // shoes: brown with a lighter toe and dark sole
  ell(c, x - 9 * s + f * 2 * s, y - 3 * s, 9 * s, 4.5 * s, P.shoe, 2);
  ell(c, x + 9 * s + f * 2 * s, y - 3 * s, 9 * s, 4.5 * s, P.shoe, 2);
  flat(c, x - 16 * s + f * 2 * s, y - 1.5 * s, 32 * s, 1.6 * s, P.shoeDark);
  // torso: red shirt with a darker off-side shade
  rect(c, x - 15 * s, y - 58 * s, 30 * s, 26 * s, P.estradaRed);
  flat(c, x - f * 14 * s - (f > 0 ? 0 : -28 * s * 0), y - 57 * s, 6 * s, 24 * s, P.estradaRedDark);
  // overall bib + straps + gold buttons (the notary's little luxuries)
  rect(c, x - 10 * s, y - 50 * s, 20 * s, 18 * s, P.estradaBlue, 2);
  poly(c, [[x - 10 * s, y - 50 * s], [x - 14 * s, y - 57 * s], [x - 10 * s, y - 58 * s], [x - 7 * s, y - 50 * s]], P.estradaBlue, 2);
  poly(c, [[x + 10 * s, y - 50 * s], [x + 14 * s, y - 57 * s], [x + 10 * s, y - 58 * s], [x + 7 * s, y - 50 * s]], P.estradaBlue, 2);
  disc(c, x - 7 * s, y - 47 * s, 2.2 * s, COIN, 1.5);
  disc(c, x + 7 * s, y - 47 * s, 2.2 * s, COIN, 1.5);
  disc(c, x - 7.6 * s, y - 47.7 * s, 0.7 * s, '#fff8d8', 0);
  disc(c, x + 6.4 * s, y - 47.7 * s, 0.7 * s, '#fff8d8', 0);
  flat(c, x - 8 * s, y - 40 * s, 16 * s, 1.6 * s, P.estradaBlueDark);  // bib pocket seam
  // arms
  const shY = y - 54 * s;
  if (arms === 'down') {
    rect(c, x - 20 * s, shY, 6 * s, 22 * s, P.estradaRed, 2);
    rect(c, x + 14 * s, shY, 6 * s, 22 * s, P.estradaRed, 2);
    gloveHand(c, x - 17 * s, shY + 25 * s, 5 * s);
    gloveHand(c, x + 17 * s, shY + 25 * s, 5 * s);
  } else if (arms === 'raised') {
    rect(c, x - f * 20 * s, shY, 6 * s, 20 * s, P.estradaRed, 2);
    gloveHand(c, x - f * 17 * s, shY + 23 * s, 5 * s);
    poly(c, [[x + f * 12 * s, shY + 6 * s], [x + f * 20 * s, shY - 24 * s],
      [x + f * 26 * s, shY - 22 * s], [x + f * 18 * s, shY + 8 * s]], P.estradaRed, 2);
    gloveHand(c, x + f * 23 * s, shY - 26 * s, 6 * s); // fist up
  } else if (arms === 'shrug') {
    poly(c, [[x - 14 * s, shY + 6 * s], [x - 28 * s, shY - 6 * s], [x - 30 * s, shY], [x - 15 * s, shY + 11 * s]], P.estradaRed, 2);
    poly(c, [[x + 14 * s, shY + 6 * s], [x + 28 * s, shY - 6 * s], [x + 30 * s, shY], [x + 15 * s, shY + 11 * s]], P.estradaRed, 2);
    ell(c, x - 30 * s, shY - 6 * s, 5.5 * s, 4.5 * s, P.glove, 2); // palms up
    ell(c, x + 30 * s, shY - 6 * s, 5.5 * s, 4.5 * s, P.glove, 2);
  } else if (arms === 'stamp') {
    rect(c, x - f * 20 * s, shY, 6 * s, 22 * s, P.estradaRed, 2);
    gloveHand(c, x - f * 17 * s, shY + 25 * s, 5 * s);
    poly(c, [[x + f * 12 * s, shY + 4 * s], [x + f * 26 * s, shY - 10 * s],
      [x + f * 31 * s, shY - 5 * s], [x + f * 17 * s, shY + 9 * s]], P.estradaRed, 2);
    gloveHand(c, x + f * 29 * s, shY - 9 * s, 5.5 * s);
  } else { // recline: arms relaxed out (deck chair)
    rect(c, x - 22 * s, shY + 4 * s, 10 * s, 6 * s, P.estradaRed, 2);
    rect(c, x + 12 * s, shY + 4 * s, 10 * s, 6 * s, P.estradaRed, 2);
    gloveHand(c, x - 24 * s, shY + 8 * s, 4.5 * s);
    gloveHand(c, x + 24 * s, shY + 8 * s, 4.5 * s);
  }
  // --- head ---
  disc(c, x, hy, 17 * s, P.skin);
  jawShade(c, x, hy, 17 * s, 17 * s);
  // ear (back side) + slicked sideburn in front of it
  ell(c, x - f * 14 * s, hy + 2 * s, 3.5 * s, 4.5 * s, P.skin, 2);
  c.strokeStyle = P.skinShade; c.lineWidth = 1.5;
  c.beginPath(); c.arc(x - f * 14 * s, hy + 2 * s, 1.8 * s, 0, Math.PI * 2); c.stroke();
  poly(c, [[x - f * 16 * s, hy - 8 * s], [x - f * 11 * s, hy - 9 * s], [x - f * 11.5 * s, hy + 3 * s], [x - f * 15 * s, hy + 1 * s]], P.hairDark, 2);
  // cheek blush + prominent nose (shade under, highlight on top)
  c.fillStyle = P.blush;
  c.beginPath(); c.ellipse(x - f * 5 * s, hy + 6 * s, 4 * s, 2.4 * s, 0, 0, Math.PI * 2); c.fill();
  ell(c, x + f * 10 * s, hy + 3 * s, 6.5 * s, 5 * s, P.skin, 2);
  c.fillStyle = P.skinShade;
  c.beginPath(); c.ellipse(x + f * 10 * s, hy + 5.5 * s, 5 * s, 2 * s, 0, 0, Math.PI); c.fill();
  disc(c, x + f * 8 * s, hy + 1.5 * s, 1.2 * s, 'rgba(255,240,220,0.8)', 0);
  // THE pencil moustache: a thin inked band with flicked ends
  c.fillStyle = P.hairDark;
  c.beginPath();
  c.moveTo(x + f * 2 * s, hy + 9 * s);
  c.quadraticCurveTo(x + f * 9 * s, hy + 7.2 * s, x + f * 16 * s, hy + 8 * s);
  c.quadraticCurveTo(x + f * 18.5 * s, hy + 8.2 * s, x + f * 19 * s, hy + 6.4 * s); // the flick
  c.quadraticCurveTo(x + f * 17 * s, hy + 9.6 * s, x + f * 9 * s, hy + 9.6 * s);
  c.quadraticCurveTo(x + f * 5 * s, hy + 10 * s, x + f * 2 * s, hy + 9 * s);
  c.closePath();
  c.fill();
  // eyes: smug half-lids with pupils + highlights
  const exL = x + f * 2 * s, exR = x + f * 10 * s, ey = hy - 3 * s;
  if (o.masked) ell(c, x + f * 6 * s, ey, 14 * s, 7 * s, '#2c2c3e', 2); // domino mask
  const lidCol = o.masked ? '#2c2c3e' : P.skin;
  const eyeOne = (ex: number, open: boolean): void => {
    if (!open) {
      seg(c, ex - 3 * s, ey, ex + 3 * s, ey, INK, 2);
      seg(c, ex + 2 * s, ey, ex + 3.4 * s, ey + 1.8 * s, INK, 1.5); // little lash
      return;
    }
    eyeBall(c, ex, ey, 3.5 * s, eyes === 'wide' ? 4.8 * s : 3.5 * s, ex + f * 1.2 * s, ey + 0.8 * s, 1.6 * s);
    if (eyes === 'smug') {
      flat(c, ex - 4 * s, ey - 5.4 * s, 8 * s, 4.6 * s, lidCol);
      seg(c, ex - 3.5 * s, ey - 1 * s, ex + 3.5 * s, ey - 1 * s, INK, 2);
    }
  };
  eyeOne(exL, !(eyes === 'closed'));
  eyeOne(exR, !(eyes === 'closed' || eyes === 'wink'));
  // brows: one raised (the salesman's brow)
  if (!o.masked) {
    seg(c, exL - 3.5 * s, ey - 7 * s, exL + 3 * s, ey - 7.6 * s, INK, 2.5);
    seg(c, exR - 3 * s, ey - 9 * s, exR + 3.5 * s, ey - 8 * s, INK, 2.5);
  }
  // mouth
  const my = hy + 13 * s;
  if (mouth === 'grin') {
    c.beginPath(); c.arc(x + f * 5 * s, my - 2 * s, 6 * s, 0.15 * Math.PI, 0.85 * Math.PI);
    c.strokeStyle = INK; c.lineWidth = 2.5; c.stroke();
    seg(c, x + f * 10.5 * s, my + 2 * s, x + f * 12 * s, my + 0.5 * s, INK, 2); // smirk tick
  } else if (mouth === 'open') {
    ell(c, x + f * 5 * s, my, 5 * s, 6 * s, '#7c2230', 2);
    flat(c, x + f * 2.5 * s, my - 4.5 * s, 5 * s, 2 * s, '#fff'); // teeth
    ell(c, x + f * 5 * s, my + 3 * s, 3 * s, 2 * s, '#c85a6a', 0); // tongue
  } else if (mouth === 'nervous') {
    c.beginPath(); c.moveTo(x + f * 0 * s, my);
    for (let i = 0; i <= 6; i++) c.lineTo(x + f * (i * 2) * s, my + (i % 2 === 0 ? 0 : 2 * s));
    c.strokeStyle = INK; c.lineWidth = 2; c.stroke();
  } else {
    seg(c, x + f * 1 * s, my, x + f * 10 * s, my, INK, 2.5);
  }
  // red cap: dome + darker base band + brim + gold 'E' medallion + sheen
  c.beginPath(); c.arc(x, hy - 4 * s, 17 * s, Math.PI, 0); c.closePath();
  c.fillStyle = P.estradaRed; c.fill(); c.lineWidth = LW; c.strokeStyle = INK; c.stroke();
  c.save();
  c.beginPath(); c.arc(x, hy - 4 * s, 17 * s, Math.PI, 0); c.closePath(); c.clip();
  flat(c, x - 17 * s, hy - 8 * s, 34 * s, 4.5 * s, P.estradaRedDark);  // base band
  c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 2.5;
  c.beginPath(); c.arc(x - 2 * s, hy - 2 * s, 13 * s, Math.PI * 1.15, Math.PI * 1.55); c.stroke(); // sheen
  c.restore();
  rect(c, x + f * 8 * s, hy - 8 * s, f > 0 ? 16 * s : -16 * s, 5 * s, P.estradaRed, 2);
  flat(c, x + f * 9 * s, hy - 4.4 * s, f * 14 * s, 1.4 * s, P.estradaRedDark); // brim underside
  disc(c, x, hy - 12 * s, 8 * s, COIN, 2);        // gold medallion ring
  disc(c, x, hy - 12 * s, 5.5 * s, '#fff', 1.5);
  txt(c, 'E', x, hy - 11.4 * s, Math.max(8, 9.5 * s), P.estradaRed, 'center', false);
  disc(c, x, hy - 21 * s, 1.8 * s, P.estradaRedDark, 1.5);  // cap button
  // held item
  if (o.item === 'stamp') {
    const hx = arms === 'stamp' ? x + f * 29 * s : x + f * 17 * s;
    const hyy = arms === 'stamp' ? shY - 14 * s : shY + 18 * s;
    rect(c, hx - 3 * s, hyy - 10 * s, 6 * s, 8 * s, '#8a5a2b', 2);   // handle
    rect(c, hx - 8 * s, hyy - 3 * s, 16 * s, 5 * s, '#3a3a4c', 2);   // base
    flat(c, hx - 7 * s, hyy + 0.5 * s, 14 * s, 1.5 * s, '#b9412f'); // inked pad
  } else if (o.item === 'bag') {
    ell(c, x + f * 26 * s, y - 14 * s, 14 * s, 16 * s, '#c9962a');
    poly(c, [[x + f * 20 * s, y - 28 * s], [x + f * 32 * s, y - 28 * s], [x + f * 26 * s, y - 36 * s]], '#c9962a', 2);
    txt(c, '$', x + f * 26 * s, y - 13 * s, Math.max(8, 12 * s), INK, 'center', false);
  }
  if (o.sweatFrame !== undefined && o.sweatFrame >= 0) sweatDrop(c, x - f * 16 * s, hy - 10 * s, s * 1.2, o.sweatFrame);
}

// ============================================================================
// PRINCESS IMPEACH — Trump in the Peach dress. Feet at (x,y).
// ============================================================================

export interface ImpeachOpts {
  facing?: 1 | -1;
  /** 'hidden' = no oversized hand from the rig (a scene-composed foreground
   *  hand takes over — never draw both). */
  hands?: 'wave' | 'coffee-wave' | 'phone' | 'chalk' | 'down' | 'hidden';
  handScale?: number;    // 1 = merely huge. >1 = colossal.
  waveT?: number;        // animation clock for the wave + hair wisp
  mouth?: 'smug' | 'open' | 'pout';
  wigOn?: boolean;       // false = the reveal
}

export function drawImpeach(c: Ctx, x: number, y: number, s: number, o: ImpeachOpts = {}): void {
  const f = o.facing ?? 1;
  const hs = (o.handScale ?? 1) * 14 * s;   // palm radius — the running gag
  const wt = o.waveT ?? 0;
  const hands = o.hands ?? 'wave';
  const mouth = o.mouth ?? 'pout';
  const hy = y - 78 * s;
  // gown: big pink bell with pleats + scalloped hem frill
  poly(c, [[x - 12 * s, y - 58 * s], [x + 12 * s, y - 58 * s], [x + 30 * s, y], [x - 30 * s, y]], P.peachPink);
  c.strokeStyle = P.peachDark; c.lineWidth = 2;
  for (let i = -1; i <= 1; i++) {   // pleat lines
    c.beginPath();
    c.moveTo(x + i * 7 * s, y - 54 * s);
    c.lineTo(x + i * 20 * s, y - 4 * s);
    c.stroke();
  }
  for (let i = -3; i <= 3; i++) {   // hem scallops sit ON the gown's bottom edge
    c.beginPath(); c.arc(x + i * 8.4 * s, y - 1 * s, 4.6 * s, Math.PI, 0);
    c.fillStyle = P.peachPale; c.fill();
    c.strokeStyle = INK; c.lineWidth = 2; c.stroke();
  }
  seg(c, x - 24 * s, y - 14 * s, x + 24 * s, y - 14 * s, P.peachDark, 3);
  // bodice + puff sleeves
  rect(c, x - 11 * s, y - 66 * s, 22 * s, 12 * s, P.peachPink, 2.5);
  ell(c, x - 14 * s, y - 62 * s, 7 * s, 7 * s, P.peachDeep, 2);
  ell(c, x + 14 * s, y - 62 * s, 7 * s, 7 * s, P.peachDeep, 2);
  // THE TIE — long, red, hanging OVER the gown. Non-negotiable.
  const tieSway = Math.sin(wt * 0.05) * 2.5 * s;
  poly(c, [[x - 4 * s, y - 66 * s], [x + 4 * s, y - 66 * s], [x + 2.5 * s, y - 61 * s], [x - 2.5 * s, y - 61 * s]], P.tie, 2); // knot
  poly(c, [
    [x - 3 * s, y - 61 * s], [x + 3 * s, y - 61 * s],
    [x + 5.5 * s + tieSway, y - 26 * s], [x + tieSway, y - 18 * s], [x - 5.5 * s + tieSway, y - 26 * s],
  ], P.tie, 2);
  poly(c, [[x - 5.5 * s + tieSway, y - 26 * s], [x + 5.5 * s + tieSway, y - 26 * s], [x + tieSway, y - 18 * s]], P.tieDark, 0);
  seg(c, x - 1.5 * s, y - 56 * s, x + 1 * s + tieSway * 0.4, y - 40 * s, P.tieDark, 1.5); // tie sheen line
  // --- head: orange, jowly, goggle-tan ---
  ell(c, x, hy, 15 * s, 14 * s, P.orange);
  ell(c, x - 11 * s, hy + 7 * s, 4.5 * s, 3.6 * s, P.orange, 2);  // jowl L
  ell(c, x + 11 * s, hy + 7 * s, 4.5 * s, 3.6 * s, P.orange, 2);  // jowl R
  c.fillStyle = P.orange; // re-fill over the jowl/face seams
  c.beginPath(); c.ellipse(x, hy + 1 * s, 13.5 * s, 12 * s, 0, 0, Math.PI * 2); c.fill();
  // paler eye-mask zone (the tan line)
  c.fillStyle = P.orangePale;
  c.beginPath(); c.ellipse(x + f * 1 * s, hy - 3.5 * s, 11 * s, 5.5 * s, 0, 0, Math.PI * 2); c.fill();
  // 5 o'clock shadow + chin crease
  c.fillStyle = 'rgba(90,60,40,0.25)';
  c.beginPath(); c.ellipse(x, hy + 8 * s, 10.5 * s, 5.5 * s, 0, 0, Math.PI); c.fill();
  c.strokeStyle = 'rgba(120,70,30,0.5)'; c.lineWidth = 1.5;
  c.beginPath(); c.arc(x + f * 2 * s, hy + 10.5 * s, 4 * s, Math.PI * 1.2, Math.PI * 1.8); c.stroke();
  // angry squint: tiny whites, heavy brows angled in, under-eye squint folds
  const eyL = x - 5 * s + f * 1 * s, eyR = x + 6 * s + f * 1 * s, eyY = hy - 3.5 * s;
  eyeBall(c, eyL, eyY, 2.6 * s, 1.8 * s, eyL + f * 0.8 * s, eyY, 1 * s);
  eyeBall(c, eyR, eyY, 2.6 * s, 1.8 * s, eyR + f * 0.8 * s, eyY, 1 * s);
  seg(c, eyL - 3.5 * s, eyY - 4.5 * s, eyL + 3 * s, eyY - 2.6 * s, INK, 3);   // brows: \  /
  seg(c, eyR - 3 * s, eyY - 2.6 * s, eyR + 3.5 * s, eyY - 4.5 * s, INK, 3);
  seg(c, eyL - 2.5 * s, eyY + 3 * s, eyL + 2.5 * s, eyY + 2.6 * s, 'rgba(120,70,30,0.6)', 1.5); // squint folds
  seg(c, eyR - 2.5 * s, eyY + 2.6 * s, eyR + 2.5 * s, eyY + 3 * s, 'rgba(120,70,30,0.6)', 1.5);
  // mouth: the pout is the default truth of this face
  const mx = x + f * 2 * s, mmy = hy + 6.5 * s;
  if (mouth === 'open') {
    ell(c, mx, mmy + 1 * s, 5 * s, 4 * s, '#7c2230', 2);
    ell(c, mx, mmy + 3 * s, 3 * s, 1.6 * s, '#c85a6a', 0);
  } else if (mouth === 'smug') {
    c.beginPath(); c.arc(mx, mmy - 1 * s, 4.5 * s, 0.2 * Math.PI, 0.8 * Math.PI);
    c.strokeStyle = INK; c.lineWidth = 2.5; c.stroke();
  } else { // pout: puckered lips pushed forward
    ell(c, mx, mmy, 4 * s, 2.6 * s, '#e0885e', 2);
    seg(c, mx - 3 * s, mmy, mx + 3 * s, mmy, '#8f4a2a', 1.5);
    seg(c, mx - 1 * s, mmy - 3.6 * s, mx + 1.5 * s, mmy - 3.4 * s, 'rgba(120,70,30,0.5)', 1.5); // pout crease
  }
  if (o.wigOn !== false) {
    // THE combover: back mass, side wing, the big forehead swoop with upturned
    // flick, darker strand lines, one animated wisp.
    c.beginPath(); c.arc(x, hy - 5 * s, 15.5 * s, Math.PI * 0.95, Math.PI * 2.02); c.closePath();
    c.fillStyle = P.wig; c.fill(); c.lineWidth = LW; c.strokeStyle = INK; c.stroke();
    poly(c, [[x - f * 15 * s, hy - 8 * s], [x - f * 17 * s, hy + 2 * s], [x - f * 12 * s, hy - 2 * s]], P.wig, 2); // side wing
    c.beginPath();  // the swoop
    c.moveTo(x - f * 14 * s, hy - 10 * s);
    c.quadraticCurveTo(x - f * 2 * s, hy - 22 * s, x + f * 12 * s, hy - 13 * s);
    c.quadraticCurveTo(x + f * 22 * s, hy - 8 * s, x + f * 24 * s, hy - 15 * s);   // the flick, up
    c.quadraticCurveTo(x + f * 20 * s, hy - 12 * s, x + f * 12 * s, hy - 16 * s);
    c.quadraticCurveTo(x + f * 2 * s, hy - 21 * s, x - f * 10 * s, hy - 15 * s);
    c.closePath();
    c.fillStyle = P.wig; c.fill(); c.lineWidth = 2.5; c.strokeStyle = INK; c.stroke();
    c.strokeStyle = P.wigDark; c.lineWidth = 1.5;   // strand lines
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      c.moveTo(x - f * (10 - i * 2) * s, hy - (12 + i * 1.5) * s);
      c.quadraticCurveTo(x + f * 2 * s, hy - (17 + i * 1.2) * s, x + f * (14 + i * 2) * s, hy - (11 + i * 1.2) * s);
      c.stroke();
    }
    // the animated wisp, waving off the top of the swoop
    const wisp = Math.sin(wt * 0.07) * 3 * s;
    c.strokeStyle = P.wig; c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(x + f * 6 * s, hy - 19 * s);
    c.quadraticCurveTo(x + f * 12 * s, hy - 25 * s + wisp, x + f * 17 * s, hy - 22 * s + wisp * 1.4);
    c.stroke();
  } else {
    // the reveal: sad thin wisps combed over a bare orange scalp
    c.strokeStyle = P.wig; c.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      c.beginPath();
      c.moveTo(x - 9 * s + i * 5 * s, hy - 12 * s);
      c.quadraticCurveTo(x - 5 * s + i * 5 * s, hy - 19 * s - Math.sin(wt * 0.08 + i) * 1.5 * s, x + i * 5 * s, hy - 13 * s);
      c.stroke();
    }
  }
  // tiny crown, askew (a clip-on, obviously)
  c.save();
  c.translate(x - f * 4 * s, hy - (o.wigOn !== false ? 21 : 16) * s);
  c.rotate(f * 0.22);
  poly(c, [[-5 * s, 0], [5 * s, 0], [5 * s, -5 * s], [2.5 * s, -2.5 * s], [0, -6 * s], [-2.5 * s, -2.5 * s], [-5 * s, -5 * s]], COIN, 2);
  disc(c, 0, -1.5 * s, 0.8 * s, '#e04848', 0);
  c.restore();
  // THE HAND. Enormous, white-gloved — and exactly ONE oversized hand per
  // appearance: the gag is composed, never duplicated. The other arm stays
  // modest (dainty, even — the contrast IS the joke) or tucked away.
  const armCol = P.peachPink;
  /** The modest second arm: pink sleeve down to a normal-sized glove. */
  const smallArm = (wx: number, wy: number): void => {
    poly(c, [[x - f * 10 * s, y - 62 * s], [wx + f * 2 * s, wy - 3 * s], [wx - f * 3 * s, wy - 7 * s], [x - f * 14 * s, y - 65 * s]], armCol, 2.5);
    gloveHand(c, wx, wy, 4.5 * s);
  };
  if (hands === 'wave' || hands === 'coffee-wave') {
    const a = Math.sin(wt * 0.12) * 0.35;
    const hyw = y - 74 * s + Math.sin(wt * 0.12) * 4 * s;
    // sleeve anchors the big glove to the shoulder
    poly(c, [[x + f * 10 * s, y - 62 * s], [x + f * 30 * s, hyw + hs * 0.9], [x + f * 36 * s, hyw + hs * 0.7], [x + f * 16 * s, y - 56 * s]], armCol, 2.5);
    bigHand(c, x + f * 34 * s, hyw, hs, f * (0.3 + a));
    if (hands === 'coffee-wave') {
      smallArm(x - f * 21 * s, y - 46 * s);
      coffeeCup(c, x - f * 21 * s, y - 52 * s, s * 0.8, wt); // dainty espresso in the NORMAL hand
    } else {
      smallArm(x - f * 20 * s, y - 44 * s);
    }
  } else if (hands === 'phone') {
    poly(c, [[x + f * 10 * s, y - 62 * s], [x + f * 24 * s, y - 52 * s], [x + f * 28 * s, y - 56 * s], [x + f * 14 * s, y - 65 * s]], armCol, 2.5);
    bigHand(c, x + f * 26 * s, y - 46 * s, hs, f * 1.35);
    rect(c, x + f * 20 * s, y - 66 * s, 12 * s, 20 * s, '#20222c', 2); // phone pinched in the glove, comically small
    flat(c, x + f * 22 * s, y - 64 * s, 8 * s, 14 * s, '#8fd8ff');
    smallArm(x - f * 20 * s, y - 44 * s);
  } else if (hands === 'chalk') {
    poly(c, [[x + f * 10 * s, y - 64 * s], [x + f * 28 * s, y - 62 * s], [x + f * 30 * s, y - 68 * s], [x + f * 13 * s, y - 68 * s]], armCol, 2.5);
    bigHand(c, x + f * 32 * s, y - 66 * s, hs, f * 0.4);
    seg(c, x + f * 32 * s, y - 78 * s, x + f * 36 * s, y - 86 * s, '#fff', 4); // chalk pinched in the fingers
    smallArm(x - f * 20 * s, y - 44 * s);
  } else if (hands === 'down') {
    // one big glove resting at the gown's side (clear of the tie); the other
    // hand tucked behind the skirt (the one-oversized-hand rule)
    poly(c, [[x + f * 10 * s, y - 62 * s], [x + f * 26 * s, y - 44 * s], [x + f * 31 * s, y - 48 * s], [x + f * 15 * s, y - 65 * s]], armCol, 2.5);
    bigHand(c, x + f * 30 * s, y - 30 * s, hs * 0.95, f * 0.35);
  }
  // hands === 'hidden': both arms behind the gown — the scene composes its
  // own single dramatic hand instead.
}

// ============================================================================
// BOWSONARO — Bolsonaro in a spiked jersey shell. Feet at (x,y).
// ============================================================================

export interface BowsonaroOpts {
  facing?: 1 | -1;
  pose?: 'stand' | 'carry' | 'rant' | 'struggle';
  mouth?: 'flat' | 'open' | 'grin';
  shellOn?: boolean;
}

export function drawBowsonaro(c: Ctx, x: number, y: number, s: number, o: BowsonaroOpts = {}): void {
  const f = o.facing ?? 1;
  const pose = o.pose ?? 'stand';
  const mouth = o.mouth ?? 'grin';
  const hy = y - 62 * s;
  // legs + army boots (beret up top, boots below — the uniform)
  rect(c, x - 14 * s, y - 18 * s, 10 * s, 14 * s, P.turtSkin, 2.5);
  rect(c, x + 4 * s, y - 18 * s, 10 * s, 14 * s, P.turtSkin, 2.5);
  seg(c, x - 11 * s, y - 14 * s, x - 7 * s, y - 14 * s, P.turtSkinDark, 1.5); // scale lines
  seg(c, x + 7 * s, y - 14 * s, x + 11 * s, y - 14 * s, P.turtSkinDark, 1.5);
  ell(c, x - 9 * s, y - 3 * s, 8.5 * s, 4.5 * s, '#2c3024', 2);
  ell(c, x + 9 * s, y - 3 * s, 8.5 * s, 4.5 * s, '#2c3024', 2);
  seg(c, x - 12 * s, y - 5 * s, x - 6 * s, y - 5 * s, '#4c5440', 1.5);  // boot laces
  seg(c, x + 6 * s, y - 5 * s, x + 12 * s, y - 5 * s, '#4c5440', 1.5);
  // shell: dome painted like a yellow-green soccer jersey, big 10, spiked
  if (o.shellOn !== false) {
    c.beginPath(); c.arc(x, y - 30 * s, 26 * s, Math.PI, 0); c.closePath();
    c.fillStyle = P.shellY; c.fill(); c.lineWidth = LW; c.strokeStyle = INK; c.stroke();
    c.save(); c.beginPath(); c.arc(x, y - 30 * s, 26 * s, Math.PI, 0); c.closePath(); c.clip();
    flat(c, x - 26 * s, y - 47 * s, 52 * s, 7 * s, P.shellG);
    flat(c, x - 26 * s, y - 36 * s, 52 * s, 4 * s, '#2b6fb8');       // the flag-blue band
    flat(c, x - 26 * s, y - 32 * s, 52 * s, 2 * s, P.shellG);
    c.restore();
    txt(c, '10', x, y - 41 * s, Math.max(9, 12 * s), '#fff');        // the big 10
    // rim band along the shell's bottom edge
    flat(c, x - 26 * s, y - 31 * s, 52 * s, 3 * s, P.turtBelly);
    seg(c, x - 26 * s, y - 28 * s, x + 26 * s, y - 28 * s, INK, 2);
    for (let i = -1; i <= 1; i++) {  // spikes with base rings
      poly(c, [[x + i * 16 * s - 4.5 * s, y - 50 * s], [x + i * 16 * s + 4.5 * s, y - 50 * s], [x + i * 16 * s, y - 61 * s]], '#d9d4c4', 2);
      ell(c, x + i * 16 * s, y - 50 * s, 4.5 * s, 1.6 * s, '#b9b2a0', 1.5);
    }
    // ammo-belt sash slung across the shell front
    poly(c, [[x - 22 * s, y - 30 * s], [x + 10 * s, y - 52 * s], [x + 16 * s, y - 48 * s], [x - 16 * s, y - 28 * s]], '#5c4322', 2);
    for (let i = 0; i < 4; i++) {
      const bx = x - 16 * s + i * 8 * s, by = y - (33 + i * 5.4) * s;
      rect(c, bx - 1.6 * s, by - 4 * s, 3.2 * s, 6 * s, COIN, 1.5);
    }
  } else {
    rect(c, x - 16 * s, y - 48 * s, 32 * s, 32 * s, P.turtSkin, 2.5); // shell-less torso
    flat(c, x - 10 * s, y - 44 * s, 20 * s, 24 * s, P.turtBelly);     // belly plate
    for (let i = 0; i < 3; i++) seg(c, x - 10 * s, y - 38 * s + i * 8 * s, x + 10 * s, y - 38 * s + i * 8 * s, '#c4b684', 1.5);
  }
  // arms (scaly, clawed)
  const claw = (cx: number, cy: number): void => {
    disc(c, cx, cy, 5 * s, P.turtSkin, 2);
    for (let i = -1; i <= 1; i++) poly(c, [[cx + i * 3 * s - 1.2 * s, cy + 3 * s], [cx + i * 3 * s + 1.2 * s, cy + 3 * s], [cx + i * 3 * s, cy + 6.5 * s]], '#e8e4d4', 1.5);
  };
  if (pose === 'carry') {
    poly(c, [[x - f * 6 * s, y - 44 * s], [x - f * 2 * s, y - 66 * s], [x + f * 6 * s, y - 64 * s], [x + f * 2 * s, y - 44 * s]], P.turtSkin, 2.5);
    poly(c, [[x + f * 12 * s, y - 42 * s], [x + f * 24 * s, y - 60 * s], [x + f * 30 * s, y - 55 * s], [x + f * 18 * s, y - 38 * s]], P.turtSkin, 2.5);
  } else if (pose === 'rant') {
    poly(c, [[x + f * 14 * s, y - 40 * s], [x + f * 30 * s, y - 62 * s], [x + f * 36 * s, y - 57 * s], [x + f * 20 * s, y - 36 * s]], P.turtSkin, 2.5);
    claw(x + f * 33 * s, y - 62 * s); // raised fist-claw
  } else if (pose === 'struggle') {
    poly(c, [[x - 10 * s, y - 40 * s], [x - 26 * s, y - 54 * s], [x - 20 * s, y - 60 * s], [x - 6 * s, y - 46 * s]], P.turtSkin, 2.5);
    poly(c, [[x + 10 * s, y - 40 * s], [x + 26 * s, y - 50 * s], [x + 22 * s, y - 58 * s], [x + 6 * s, y - 46 * s]], P.turtSkin, 2.5);
    claw(x - 24 * s, y - 58 * s);
    claw(x + 25 * s, y - 55 * s);
  } else {
    rect(c, x - f * 24 * s, y - 42 * s, 8 * s, 18 * s, P.turtSkin, 2.5);
    claw(x - f * 20 * s, y - 22 * s);
  }
  // --- head: LONG jaw, jutting chin, grin teeth, aviators, beret ---
  ell(c, x + f * 6 * s, hy, 13 * s, 11 * s, P.turtSkin);
  // the long jaw + chin, pushed forward
  poly(c, [
    [x + f * 0 * s, hy + 6 * s], [x + f * 12 * s, hy + 4 * s],
    [x + f * 21 * s, hy + 7 * s], [x + f * 22 * s, hy + 12 * s],
    [x + f * 14 * s, hy + 15 * s], [x + f * 2 * s, hy + 12 * s],
  ], P.turtSkin, 2.5);
  c.fillStyle = 'rgba(70,110,40,0.25)'; // jaw underside shade
  c.beginPath(); c.ellipse(x + f * 11 * s, hy + 13 * s, 9 * s, 2.6 * s, 0, 0, Math.PI); c.fill();
  // snout ridge + nostrils
  ell(c, x + f * 16 * s, hy + 1 * s, 5.5 * s, 3.6 * s, '#b9e08e', 2);
  disc(c, x + f * 17.5 * s, hy + 0.5 * s, 0.9 * s, INK, 0);
  disc(c, x + f * 14.5 * s, hy + 1.2 * s, 0.9 * s, INK, 0);
  // the grin: wide mouth line with a row of big teeth
  if (mouth === 'open') {
    poly(c, [[x + f * 4 * s, hy + 6.5 * s], [x + f * 20 * s, hy + 6 * s], [x + f * 17 * s, hy + 12 * s], [x + f * 6 * s, hy + 12 * s]], '#5c1f2c', 2);
    flat(c, x + f * 5.5 * s, hy + 6.6 * s, f * 13.5 * s, 2.6 * s, '#fff');   // upper teeth row
    for (let i = 1; i < 4; i++) seg(c, x + f * (5.5 + i * 3.4) * s, hy + 6.6 * s, x + f * (5.5 + i * 3.4) * s, hy + 9.2 * s, INK, 1.2);
  } else if (mouth === 'grin') {
    seg(c, x + f * 4 * s, hy + 7 * s, x + f * 20 * s, hy + 7.5 * s, INK, 2);
    flat(c, x + f * 5 * s, hy + 7.6 * s, f * 14 * s, 3.4 * s, '#fff');       // the teeth
    seg(c, x + f * 5 * s, hy + 11 * s, x + f * 19 * s, hy + 11 * s, INK, 2);
    for (let i = 1; i < 4; i++) seg(c, x + f * (5 + i * 3.5) * s, hy + 7.6 * s, x + f * (5 + i * 3.5) * s, hy + 11 * s, INK, 1.2);
  } else {
    seg(c, x + f * 8 * s, hy + 8 * s, x + f * 18 * s, hy + 8.5 * s, INK, 2.5);
  }
  // AVIATORS. Always. Teardrop lenses, gold bar + bridge, temple line.
  const lensCol = '#23242e';
  ell(c, x + f * 2 * s, hy - 2 * s, 5.2 * s, 5 * s, lensCol, 2);
  ell(c, x + f * 12 * s, hy - 2 * s, 5.2 * s, 5 * s, lensCol, 2);
  seg(c, x + f * 0 * s - f * 3 * s, hy - 5.5 * s, x + f * 17 * s, hy - 5.5 * s, '#d9a51e', 2.5); // top bar
  seg(c, x + f * 6.5 * s, hy - 3 * s, x + f * 7.5 * s, hy - 3 * s, '#d9a51e', 2);               // bridge
  seg(c, x - f * 3 * s, hy - 5 * s, x - f * 7 * s, hy - 3 * s, '#d9a51e', 2);                   // temple
  seg(c, x + f * -0.5 * s, hy - 3.5 * s, x + f * 3.5 * s, hy + 0.5 * s, 'rgba(160,200,255,0.55)', 1.8); // lens sheen
  seg(c, x + f * 9.5 * s, hy - 3.5 * s, x + f * 13.5 * s, hy + 0.5 * s, 'rgba(160,200,255,0.55)', 1.8);
  // beret, tilted, with a tiny gold star badge
  c.save();
  c.translate(x + f * 4 * s, hy - 9.5 * s);
  c.rotate(-f * 0.18);
  ell(c, 0, 0, 12.5 * s, 5.2 * s, P.beret, 2.5);
  poly(c, [[-12 * s, 1 * s], [12 * s, 1 * s], [10 * s, 3.6 * s], [-10 * s, 3.6 * s]], '#31333f', 1.5); // band
  disc(c, 0, -4 * s, 1.6 * s, P.beret, 1);
  sparkleStar(c, f * 6 * s, 0.5 * s, 2.2 * s, COIN);
  c.restore();
}

/** Tiny 4-point star (badges, glints). */
function sparkleStar(c: Ctx, x: number, y: number, r: number, fill: string): void {
  c.fillStyle = fill;
  c.beginPath();
  c.moveTo(x, y - r);
  c.lineTo(x + r * 0.3, y - r * 0.3);
  c.lineTo(x + r, y);
  c.lineTo(x + r * 0.3, y + r * 0.3);
  c.lineTo(x, y + r);
  c.lineTo(x - r * 0.3, y + r * 0.3);
  c.lineTo(x - r, y);
  c.lineTo(x - r * 0.3, y - r * 0.3);
  c.closePath();
  c.fill();
}

// ============================================================================
// MANGIANI — the honest one. Taller and lankier; feet at (x,y), height ~110*s.
// ============================================================================

export interface MangianiOpts {
  facing?: 1 | -1;
  eyes?: 'honest' | 'squint' | 'narrow';
  brows?: 'worried' | 'determined' | 'raised';
  mouth?: 'concern' | 'open' | 'grim' | 'smile';
  pose?: 'stand' | 'point' | 'run' | 'offer' | 'measure' | 'magnify' | 'fist';
  backpack?: boolean;
}

export function drawMangiani(c: Ctx, x: number, y: number, s: number, o: MangianiOpts = {}): void {
  const f = o.facing ?? 1;
  const eyes = o.eyes ?? 'honest';
  const brows = o.brows ?? 'worried';
  const mouth = o.mouth ?? 'concern';
  const pose = o.pose ?? 'stand';
  const hy = y - 92 * s; // taller than Estrada
  // legs: long and thin, darker blue
  if (pose === 'run') {
    poly(c, [[x - 4 * s, y - 40 * s], [x - 26 * s, y - 10 * s], [x - 20 * s, y - 4 * s], [x + 2 * s, y - 36 * s]], P.mangBlue, 2.5);
    poly(c, [[x + 2 * s, y - 40 * s], [x + 24 * s, y - 16 * s], [x + 18 * s, y - 8 * s], [x - 2 * s, y - 36 * s]], P.mangBlue, 2.5);
    ell(c, x - 25 * s, y - 5 * s, 8 * s, 4 * s, P.shoe, 2);
    ell(c, x + 24 * s, y - 10 * s, 8 * s, 4 * s, P.shoe, 2);
  } else {
    rect(c, x - 9 * s, y - 42 * s, 8 * s, 38 * s, P.mangBlue, 2.5);
    rect(c, x + 1 * s, y - 42 * s, 8 * s, 38 * s, P.mangBlue, 2.5);
    flat(c, x - 8 * s, y - 10 * s, 6 * s, 3 * s, P.mangBlueDark);  // cuffs
    flat(c, x + 2 * s, y - 10 * s, 6 * s, 3 * s, P.mangBlueDark);
    ell(c, x - 6 * s, y - 3 * s, 8 * s, 4 * s, P.shoe, 2);
    ell(c, x + 6 * s, y - 3 * s, 8 * s, 4 * s, P.shoe, 2);
    flat(c, x - 13 * s, y - 1.5 * s, 26 * s, 1.5 * s, P.shoeDark);
  }
  // tiny backpack (behind torso) with flap + buckle
  if (o.backpack !== false) {
    rect(c, x - f * 22 * s, y - 68 * s, 12 * s, 16 * s, '#8a5a2b', 2.5);
    rect(c, x - f * 22 * s, y - 68 * s, 12 * s, 6 * s, '#6b4420', 2);
    disc(c, x - f * 16 * s, y - 63 * s, 1.6 * s, COIN, 1);
    seg(c, x - f * 16 * s, y - 68 * s, x - f * 8 * s, y - 72 * s, '#6b4420', 2.5); // strap to shoulder
  }
  // thin torso: green shirt + darker blue bib with straps + buttons
  rect(c, x - 11 * s, y - 74 * s, 22 * s, 34 * s, P.mangGreen);
  flat(c, x - f * 10 * s, y - 73 * s, 4 * s, 32 * s, P.mangDark);   // side shade
  rect(c, x - 7 * s, y - 62 * s, 14 * s, 22 * s, P.mangBlue, 2);
  poly(c, [[x - 7 * s, y - 62 * s], [x - 10 * s, y - 72 * s], [x - 7 * s, y - 73 * s], [x - 4.5 * s, y - 62 * s]], P.mangBlue, 2);
  poly(c, [[x + 7 * s, y - 62 * s], [x + 10 * s, y - 72 * s], [x + 7 * s, y - 73 * s], [x + 4.5 * s, y - 62 * s]], P.mangBlue, 2);
  disc(c, x - 5 * s, y - 59.5 * s, 1.8 * s, COIN, 1.5);
  disc(c, x + 5 * s, y - 59.5 * s, 1.8 * s, COIN, 1.5);
  // arms by pose
  const shY = y - 70 * s;
  if (pose === 'point') {
    poly(c, [[x + f * 8 * s, shY + 4 * s], [x + f * 34 * s, shY - 8 * s], [x + f * 34 * s, shY - 2 * s], [x + f * 9 * s, shY + 10 * s]], P.mangGreen, 2.5);
    gloveHand(c, x + f * 36 * s, shY - 5 * s, 4.5 * s);
    seg(c, x + f * 38 * s, shY - 6 * s, x + f * 46 * s, shY - 9 * s, P.glove, 4);
    rect(c, x - f * 16 * s, shY, 6 * s, 20 * s, P.mangGreen, 2.5);
  } else if (pose === 'offer') {
    poly(c, [[x + f * 8 * s, shY + 4 * s], [x + f * 30 * s, shY + 14 * s], [x + f * 29 * s, shY + 20 * s], [x + f * 8 * s, shY + 10 * s]], P.mangGreen, 2.5);
    ell(c, x + f * 32 * s, shY + 17 * s, 5.5 * s, 4 * s, P.glove, 2); // open palm
    rect(c, x - f * 16 * s, shY, 6 * s, 20 * s, P.mangGreen, 2.5);
  } else if (pose === 'measure') {
    poly(c, [[x + f * 8 * s, shY + 2 * s], [x + f * 30 * s, shY - 4 * s], [x + f * 30 * s, shY + 2 * s], [x + f * 9 * s, shY + 8 * s]], P.mangGreen, 2.5);
    gloveHand(c, x + f * 32 * s, shY - 1 * s, 4.5 * s);
    poly(c, [[x - f * 8 * s, shY + 2 * s], [x - f * 26 * s, shY + 8 * s], [x - f * 26 * s, shY + 14 * s], [x - f * 8 * s, shY + 8 * s]], P.mangGreen, 2.5);
    gloveHand(c, x - f * 28 * s, shY + 11 * s, 4.5 * s);
  } else if (pose === 'magnify') {
    poly(c, [[x + f * 8 * s, shY + 4 * s], [x + f * 26 * s, shY - 12 * s], [x + f * 31 * s, shY - 7 * s], [x + f * 12 * s, shY + 9 * s]], P.mangGreen, 2.5);
    gloveHand(c, x + f * 29 * s, shY - 10 * s, 4.5 * s);
    disc(c, x + f * 38 * s, shY - 20 * s, 9 * s, 'rgba(190,230,255,0.55)', 3); // magnifying glass
    seg(c, x + f * 32 * s, shY - 13 * s, x + f * 29 * s, shY - 10 * s, INK, 4);
    seg(c, x + f * 34 * s, shY - 25 * s, x + f * 38 * s, shY - 27 * s, 'rgba(255,255,255,0.8)', 2); // lens glint
    rect(c, x - f * 16 * s, shY, 6 * s, 20 * s, P.mangGreen, 2.5);
  } else if (pose === 'fist' || pose === 'run') {
    poly(c, [[x + f * 8 * s, shY + 6 * s], [x + f * 21 * s, shY - 16 * s], [x + f * 27 * s, shY - 14 * s], [x + f * 14 * s, shY + 8 * s]], P.mangGreen, 2.5);
    gloveHand(c, x + f * 25 * s, shY - 19 * s, 5 * s);
    poly(c, [[x - f * 8 * s, shY + 6 * s], [x - f * 20 * s, shY + 18 * s], [x - f * 16 * s, shY + 22 * s], [x - f * 6 * s, shY + 12 * s]], P.mangGreen, 2.5);
    gloveHand(c, x - f * 18 * s, shY + 21 * s, 4.5 * s);
  } else {
    rect(c, x - 17 * s, shY, 6 * s, 22 * s, P.mangGreen, 2.5);
    rect(c, x + 11 * s, shY, 6 * s, 22 * s, P.mangGreen, 2.5);
    gloveHand(c, x - 14 * s, shY + 25 * s, 4.5 * s);
    gloveHand(c, x + 14 * s, shY + 25 * s, 4.5 * s);
  }
  // --- head: narrower, HUGE honest eyes, big round nose ---
  ell(c, x, hy, 14 * s, 16 * s, P.skin);
  jawShade(c, x, hy, 14 * s, 16 * s);
  ell(c, x - f * 12 * s, hy + 3 * s, 3 * s, 4 * s, P.skin, 2);  // ear
  // brown swept hair peeking out under the cap + sideburn
  poly(c, [[x - f * 13 * s, hy - 8 * s], [x + f * 10 * s, hy - 10 * s], [x + f * 13 * s, hy - 5 * s],
    [x + f * 6 * s, hy - 7 * s], [x - f * 6 * s, hy - 5.5 * s], [x - f * 13 * s, hy - 4 * s]], P.mangHair, 2);
  poly(c, [[x - f * 14 * s, hy - 6 * s], [x - f * 10.5 * s, hy - 6 * s], [x - f * 11 * s, hy + 4 * s], [x - f * 13.5 * s, hy + 2 * s]], P.mangHair, 2);
  // blush + big round nose (shade + highlight)
  c.fillStyle = P.blush;
  c.beginPath(); c.ellipse(x - f * 4 * s, hy + 7 * s, 3.4 * s, 2 * s, 0, 0, Math.PI * 2); c.fill();
  disc(c, x + f * 8 * s, hy + 4 * s, 5.8 * s, P.skin, 2);
  c.fillStyle = P.skinShade;
  c.beginPath(); c.ellipse(x + f * 8 * s, hy + 6.6 * s, 4.4 * s, 1.8 * s, 0, 0, Math.PI); c.fill();
  disc(c, x + f * 6.2 * s, hy + 2.4 * s, 1.3 * s, 'rgba(255,240,220,0.85)', 0);
  // full honest moustache (contrast with the pencil one)
  ell(c, x + f * 7 * s, hy + 10 * s, 8.5 * s, 3.2 * s, P.mangHair, 2);
  seg(c, x + f * 7 * s, hy + 8 * s, x + f * 7 * s, hy + 12 * s, 'rgba(0,0,0,0.25)', 1.2);
  // HUGE honest eyes
  const exL = x + f * 0 * s, exR = x + f * 9.5 * s, ey = hy - 2.5 * s;
  if (eyes === 'honest') {
    eyeBall(c, exL, ey, 4.4 * s, 6 * s, exL + f * 1.4 * s, ey + 1 * s, 2.3 * s);
    eyeBall(c, exR, ey, 4.4 * s, 6 * s, exR + f * 1.4 * s, ey + 1 * s, 2.3 * s);
    seg(c, exL - 3 * s, ey + 6.8 * s, exL + 3 * s, ey + 7 * s, 'rgba(120,70,30,0.4)', 1.4); // under-eye worry line
    seg(c, exR - 3 * s, ey + 6.8 * s, exR + 3 * s, ey + 7 * s, 'rgba(120,70,30,0.4)', 1.4);
  } else if (eyes === 'squint') {
    seg(c, exL - 3.5 * s, ey, exL + 3.5 * s, ey - 1 * s, INK, 3);
    seg(c, exR - 3.5 * s, ey - 1 * s, exR + 3.5 * s, ey, INK, 3);
  } else { // narrow: thin slits with pupils
    ell(c, exL, ey, 4 * s, 2 * s, '#fff', 2);
    ell(c, exR, ey, 4 * s, 2 * s, '#fff', 2);
    disc(c, exL + f * 1.4 * s, ey, 1.4 * s, INK, 0);
    disc(c, exR + f * 1.4 * s, ey, 1.4 * s, INK, 0);
  }
  // brows: thick, expressive
  if (brows === 'worried') {
    seg(c, exL - 4.5 * s, ey - 8 * s, exL + 3 * s, ey - 10.5 * s, INK, 3.5);
    seg(c, exR - 3 * s, ey - 10.5 * s, exR + 4.5 * s, ey - 8 * s, INK, 3.5);
  } else if (brows === 'determined') {
    seg(c, exL - 4.5 * s, ey - 10.5 * s, exL + 3 * s, ey - 7.5 * s, INK, 3.5);
    seg(c, exR - 3 * s, ey - 7.5 * s, exR + 4.5 * s, ey - 10.5 * s, INK, 3.5);
  } else {
    seg(c, exL - 4.5 * s, ey - 10 * s, exL + 3 * s, ey - 10 * s, INK, 3.5);
    seg(c, exR - 3 * s, ey - 12 * s, exR + 4.5 * s, ey - 12 * s, INK, 3.5);
  }
  // mouth
  const my = hy + 14 * s;
  if (mouth === 'open') {
    ell(c, x + f * 4 * s, my, 4.5 * s, 5 * s, '#7c2230', 2);
    ell(c, x + f * 4 * s, my + 2.5 * s, 2.6 * s, 1.6 * s, '#c85a6a', 0);
  } else if (mouth === 'smile') {
    c.beginPath(); c.arc(x + f * 4 * s, my - 2 * s, 4.5 * s, 0.15 * Math.PI, 0.85 * Math.PI);
    c.strokeStyle = INK; c.lineWidth = 2.5; c.stroke();
  } else if (mouth === 'grim') {
    seg(c, x + f * 0 * s, my + 1 * s, x + f * 9 * s, my - 1 * s, INK, 3);
  } else { // concern: small downturned
    c.beginPath(); c.arc(x + f * 4.5 * s, my + 3 * s, 3.6 * s, 1.15 * Math.PI, 1.85 * Math.PI);
    c.strokeStyle = INK; c.lineWidth = 2.5; c.stroke();
  }
  // green cap with 'M' medallion
  c.beginPath(); c.arc(x, hy - 8 * s, 14 * s, Math.PI, 0); c.closePath();
  c.fillStyle = P.mangGreen; c.fill(); c.lineWidth = LW; c.strokeStyle = INK; c.stroke();
  c.save();
  c.beginPath(); c.arc(x, hy - 8 * s, 14 * s, Math.PI, 0); c.closePath(); c.clip();
  flat(c, x - 14 * s, hy - 11.5 * s, 28 * s, 3.5 * s, P.mangDark);
  c.strokeStyle = 'rgba(255,255,255,0.3)'; c.lineWidth = 2;
  c.beginPath(); c.arc(x - 2 * s, hy - 6 * s, 10.5 * s, Math.PI * 1.15, Math.PI * 1.55); c.stroke();
  c.restore();
  rect(c, x + (f > 0 ? 6 : -20) * s, hy - 12 * s, 14 * s, 4.5 * s, P.mangGreen, 2);
  disc(c, x, hy - 15 * s, 6.5 * s, '#fff', 2);
  txt(c, 'M', x, hy - 14.4 * s, Math.max(7, 9 * s), P.mangDark, 'center', false);
}

// ============================================================================
// THE REAL PEACH — elegant, sincere, never mocked. Feet at (x,y).
// ============================================================================

export interface PeachOpts {
  facing?: 1 | -1;
  pose?: 'sit' | 'stand' | 'step';
  mood?: 'sad' | 'hope' | 'happy' | 'deadpan';
  holding?: 'none' | 'cards';
}

export function drawPeach(c: Ctx, x: number, y: number, s: number, o: PeachOpts = {}): void {
  const f = o.facing ?? 1;
  const pose = o.pose ?? 'stand';
  const mood = o.mood ?? 'sad';
  const sit = pose === 'sit';
  const hy = y - (sit ? 58 : 76) * s;
  const gownTop = y - (sit ? 44 : 60) * s;
  // gown bell + pannier side bulges + hem frill
  if (sit) {
    poly(c, [[x - 10 * s, gownTop], [x + 10 * s, gownTop], [x + 22 * s, y], [x - 22 * s, y]], P.peachPink);
  } else {
    poly(c, [[x - 10 * s, gownTop], [x + 10 * s, gownTop], [x + 24 * s, y], [x - 24 * s, y]], P.peachPink);
    if (pose === 'step') ell(c, x + f * 12 * s, y - 2 * s, 6 * s, 3.5 * s, P.peachDark, 2); // slipper forward
  }
  ell(c, x - (sit ? 16 : 18) * s, gownTop + 12 * s, 7 * s, 5 * s, P.peachDeep, 2);  // panniers
  ell(c, x + (sit ? 16 : 18) * s, gownTop + 12 * s, 7 * s, 5 * s, P.peachDeep, 2);
  // overskirt V-panel (lighter) + pleats
  poly(c, [[x - 7 * s, gownTop + 4 * s], [x + 7 * s, gownTop + 4 * s], [x + 13 * s, y - 2 * s], [x - 13 * s, y - 2 * s]], P.peachPale, 2);
  c.strokeStyle = P.peachDark; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(x - 10 * s, gownTop + 8 * s); c.lineTo(x - 18 * s, y - 3 * s); c.stroke();
  c.beginPath(); c.moveTo(x + 10 * s, gownTop + 8 * s); c.lineTo(x + 18 * s, y - 3 * s); c.stroke();
  for (let i = -2; i <= 2; i++) {  // hem scallops on the bottom edge
    c.beginPath(); c.arc(x + i * 9 * s, y - 1 * s, 4.6 * s, Math.PI, 0);
    c.fillStyle = P.peachDeep; c.fill(); c.strokeStyle = INK; c.lineWidth = 2; c.stroke();
  }
  // bodice + puff sleeves + the blue brooch
  rect(c, x - 8 * s, gownTop - 8 * s, 16 * s, 10 * s, P.peachPink, 2.5);
  disc(c, x - 11 * s, gownTop - 5 * s, 5 * s, P.peachDeep, 2);
  disc(c, x + 11 * s, gownTop - 5 * s, 5 * s, P.peachDeep, 2);
  ell(c, x, gownTop - 3 * s, 3 * s, 3.6 * s, P.brooch, 2);
  disc(c, x - 1 * s, gownTop - 4 * s, 0.9 * s, '#bcd8ff', 0);
  // arms
  if (pose === 'step') {
    poly(c, [[x + f * 6 * s, gownTop - 6 * s], [x + f * 22 * s, y - 56 * s], [x + f * 21 * s, y - 50 * s], [x + f * 6 * s, y - 58 * s]], P.peachPink, 2);
    disc(c, x + f * 24 * s, y - 54 * s, 3.5 * s, P.skin, 2);
  } else if (o.holding === 'cards') {
    // both hands raised in front holding a fan of cards
    poly(c, [[x - 6 * s, gownTop - 6 * s], [x - 14 * s, gownTop - 14 * s], [x - 10 * s, gownTop - 17 * s], [x - 3 * s, gownTop - 8 * s]], P.peachPink, 2);
    disc(c, x - f * 11 * s, gownTop - 16 * s, 3.2 * s, P.skin, 2);
    for (let i = -2; i <= 1; i++) {   // the fan, held in that hand
      c.save(); c.translate(x - f * 10 * s, gownTop - 18 * s); c.rotate(i * 0.26 * f);
      rect(c, -4.5 * s, -15 * s, 9 * s, 14 * s, '#f4f0e6', 1.5);
      disc(c, 0, -8 * s, 1.4 * s, (i % 2 === 0) ? P.toadRed : INK, 0);
      c.restore();
    }
  } else {
    disc(c, x - 6 * s, gownTop + 4 * s, 3.5 * s, P.skin, 2);
    disc(c, x + 6 * s, gownTop + 4 * s, 3.5 * s, P.skin, 2);
  }
  // --- head: kind, composed ---
  disc(c, x, hy, 12 * s, P.skin);
  c.fillStyle = P.blush;
  c.beginPath(); c.ellipse(x - f * 5 * s, hy + 4 * s, 2.6 * s, 1.6 * s, 0, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(x + f * 7 * s, hy + 4 * s, 2.6 * s, 1.6 * s, 0, 0, Math.PI * 2); c.fill();
  disc(c, x + f * 1 * s, hy + 2 * s, 1.4 * s, P.skin, 1.5); // small nose
  // golden updo: frame + high bun + side locks with strand lines
  c.beginPath(); c.arc(x, hy - 3 * s, 13 * s, Math.PI * 0.9, Math.PI * 2.1); c.closePath();
  c.fillStyle = P.hairGold; c.fill(); c.lineWidth = 2.5; c.strokeStyle = INK; c.stroke();
  ell(c, x, hy - 14 * s, 7.5 * s, 6 * s, P.hairGold, 2.5);   // the bun
  poly(c, [[x - 13 * s, hy - 1 * s], [x - 10 * s, hy + 16 * s], [x - 5 * s, hy + 5 * s]], P.hairGold, 2); // side locks
  poly(c, [[x + 13 * s, hy - 1 * s], [x + 10 * s, hy + 16 * s], [x + 5 * s, hy + 5 * s]], P.hairGold, 2);
  c.strokeStyle = P.hairGoldDark; c.lineWidth = 1.4;
  c.beginPath(); c.arc(x, hy - 14 * s, 4.5 * s, Math.PI * 0.2, Math.PI * 1.3); c.stroke();  // bun swirl
  c.beginPath(); c.moveTo(x - 11 * s, hy + 1 * s); c.quadraticCurveTo(x - 10 * s, hy + 8 * s, x - 9 * s, hy + 13 * s); c.stroke();
  c.beginPath(); c.moveTo(x + 11 * s, hy + 1 * s); c.quadraticCurveTo(x + 10 * s, hy + 8 * s, x + 9 * s, hy + 13 * s); c.stroke();
  // earrings
  disc(c, x - 11.5 * s, hy + 6 * s, 1.3 * s, P.brooch, 1);
  disc(c, x + 11.5 * s, hy + 6 * s, 1.3 * s, P.brooch, 1);
  // composed face per mood
  if (mood === 'happy') {
    c.strokeStyle = INK; c.lineWidth = 2;
    c.beginPath(); c.arc(x - 4 * s, hy, 2.5 * s, Math.PI, 0); c.stroke();
    c.beginPath(); c.arc(x + 4 * s, hy, 2.5 * s, Math.PI, 0); c.stroke();
    c.beginPath(); c.arc(x, hy + 5 * s, 3.5 * s, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
  } else if (mood === 'deadpan') {
    // unimpressed: half-lidded, level mouth. She has seen the hands too.
    ell(c, x - 4 * s, hy, 2.4 * s, 2.6 * s, '#fff', 1.5);
    ell(c, x + 4 * s, hy, 2.4 * s, 2.6 * s, '#fff', 1.5);
    disc(c, x - 4 * s + f * 0.8 * s, hy + 0.6 * s, 1.3 * s, INK, 0);
    disc(c, x + 4 * s + f * 0.8 * s, hy + 0.6 * s, 1.3 * s, INK, 0);
    flat(c, x - 6.5 * s, hy - 2.8 * s, 5 * s, 2.2 * s, P.skin);
    flat(c, x + 1.5 * s, hy - 2.8 * s, 5 * s, 2.2 * s, P.skin);
    seg(c, x - 6.4 * s, hy - 0.6 * s, x - 1.6 * s, hy - 0.6 * s, INK, 1.8);
    seg(c, x + 1.6 * s, hy - 0.6 * s, x + 6.4 * s, hy - 0.6 * s, INK, 1.8);
    seg(c, x - 2.5 * s, hy + 6 * s, x + 2.5 * s, hy + 6 * s, INK, 2);
  } else {
    // soft eyes: no heavy ink ring (it reads as spectacles at cutscene scale)
    ell(c, x - 4 * s, hy, 2.6 * s, 3.2 * s, '#fff', 0);
    ell(c, x + 4 * s, hy, 2.6 * s, 3.2 * s, '#fff', 0);
    disc(c, x - 3.7 * s, hy + 0.5 * s, 1.1 * s, INK, 0);
    disc(c, x + 4.3 * s, hy + 0.5 * s, 1.1 * s, INK, 0);
    disc(c, x - 4.1 * s, hy, 0.45 * s, '#fff', 0);
    disc(c, x + 3.9 * s, hy, 0.45 * s, '#fff', 0);
    c.strokeStyle = INK; c.lineWidth = 1.6;   // upper lid + lash
    c.beginPath(); c.arc(x - 4 * s, hy - 0.4 * s, 2.7 * s, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
    c.beginPath(); c.arc(x + 4 * s, hy - 0.4 * s, 2.7 * s, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
    seg(c, x - 6.4 * s, hy - 1.6 * s, x - 7.3 * s, hy - 2.4 * s, INK, 1.4);
    seg(c, x + 6.4 * s, hy - 1.6 * s, x + 7.3 * s, hy - 2.4 * s, INK, 1.4);
    if (mood === 'sad') {
      seg(c, x - 6 * s, hy - 4.5 * s, x - 2 * s, hy - 5.5 * s, INK, 2);
      seg(c, x + 2 * s, hy - 5.5 * s, x + 6 * s, hy - 4.5 * s, INK, 2);
      seg(c, x - 2.5 * s, hy + 6 * s, x + 2.5 * s, hy + 6 * s, INK, 2);
    } else { // hope
      c.beginPath(); c.arc(x, hy + 5 * s, 3 * s, 0.2 * Math.PI, 0.8 * Math.PI);
      c.strokeStyle = INK; c.lineWidth = 2; c.stroke();
    }
  }
  // proper crown with gems (not tiny — hers is real)
  poly(c, [[x - 6 * s, hy - 20 * s], [x + 6 * s, hy - 20 * s], [x + 6 * s, hy - 27 * s],
    [x + 3 * s, hy - 23 * s], [x, hy - 28 * s], [x - 3 * s, hy - 23 * s], [x - 6 * s, hy - 27 * s]], COIN, 2);
  disc(c, x, hy - 21.5 * s, 1 * s, '#e04848', 0);
  disc(c, x - 4 * s, hy - 21.5 * s, 0.8 * s, P.brooch, 0);
  disc(c, x + 4 * s, hy - 21.5 * s, 0.8 * s, P.brooch, 0);
}

// ============================================================================
// TOADS — the victims. Small, round, expressive. Feet at (x,y).
// ============================================================================

export interface ToadOpts {
  facing?: 1 | -1;
  mood?: 'despair' | 'faint' | 'adore' | 'shock' | 'cheer';
  camera?: boolean;
  coin?: boolean;
  /** Cap spot color — crowds get variety. */
  spot?: string;
  /** Vest color — crowds get variety. */
  vest?: string;
}

export function drawToad(c: Ctx, x: number, y: number, s: number, o: ToadOpts = {}): void {
  const f = o.facing ?? 1;
  const mood = o.mood ?? 'despair';
  const spot = o.spot ?? P.toadRed;
  const vest = o.vest ?? '#5f76d8';
  if (mood === 'faint') {
    // flat on the back, little legs up, spiral eyes
    ell(c, x, y - 6 * s, 14 * s, 6 * s, P.toadWhite, 2.5);
    disc(c, x - 12 * s, y - 8 * s, 4 * s, spot, 2);
    disc(c, x + 8 * s, y - 8 * s, 4 * s, spot, 2);
    rect(c, x - 4 * s, y - 16 * s, 3 * s, 8 * s, P.toadSkin, 2);
    rect(c, x + 2 * s, y - 14 * s, 3 * s, 6 * s, P.toadSkin, 2);
    c.strokeStyle = INK; c.lineWidth = 1.5;
    for (const ex of [x - 4 * s, x + 3 * s]) {
      c.beginPath();
      for (let a = 0; a < Math.PI * 3; a += 0.4) c.lineTo(x + (ex - x) + Math.cos(a) * a * 0.5 * s * 0.5, y - 3 * s + Math.sin(a) * a * 0.5 * s * 0.5);
      c.stroke();
    }
    return;
  }
  const hy = y - 26 * s;
  // little body: colored vest with gold trim over a pale shirt
  rect(c, x - 8 * s, y - 18 * s, 16 * s, 16 * s, vest, 2.5);
  flat(c, x - 3 * s, y - 17 * s, 6 * s, 14 * s, P.toadWhite);    // shirt front
  seg(c, x - 8 * s, y - 16 * s, x - 8 * s, y - 3 * s, COIN, 1.4); // vest trim
  seg(c, x + 8 * s, y - 16 * s, x + 8 * s, y - 3 * s, COIN, 1.4);
  ell(c, x - 5 * s, y - 2 * s, 5 * s, 3 * s, P.shoe, 2);
  ell(c, x + 5 * s, y - 2 * s, 5 * s, 3 * s, P.shoe, 2);
  // arms
  if (mood === 'cheer' || mood === 'adore') {
    seg(c, x - 8 * s, y - 14 * s, x - 15 * s, y - 24 * s, P.toadSkin, 3.5);
    seg(c, x + 8 * s, y - 14 * s, x + 15 * s, y - 24 * s, P.toadSkin, 3.5);
    disc(c, x - 15 * s, y - 25 * s, 2 * s, P.toadSkin, 1.5);
    disc(c, x + 15 * s, y - 25 * s, 2 * s, P.toadSkin, 1.5);
  } else if (mood === 'despair') {
    seg(c, x - 8 * s, y - 14 * s, x - 9 * s, hy - 6 * s, P.toadSkin, 3.5); // hands on head
    seg(c, x + 8 * s, y - 14 * s, x + 9 * s, hy - 6 * s, P.toadSkin, 3.5);
  } else {
    seg(c, x - 8 * s, y - 14 * s, x - 13 * s, y - 8 * s, P.toadSkin, 3.5);
    seg(c, x + 8 * s, y - 14 * s, x + 13 * s, y - 8 * s, P.toadSkin, 3.5);
  }
  // face with blush
  disc(c, x, hy, 9 * s, P.toadSkin);
  c.fillStyle = P.blush;
  c.beginPath(); c.ellipse(x - 5 * s, hy + 2.5 * s, 2 * s, 1.2 * s, 0, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(x + 5 * s, hy + 2.5 * s, 2 * s, 1.2 * s, 0, 0, Math.PI * 2); c.fill();
  if (mood === 'shock') {
    eyeBall(c, x - 3 * s, hy - 1 * s, 2.2 * s, 2.6 * s, x - 3 * s, hy - 1 * s, 0.9 * s);
    eyeBall(c, x + 3 * s, hy - 1 * s, 2.2 * s, 2.6 * s, x + 3 * s, hy - 1 * s, 0.9 * s);
    ell(c, x, hy + 4.5 * s, 2.5 * s, 3.5 * s, '#7c2230', 1.5);
  } else if (mood === 'adore' || mood === 'cheer') {
    c.strokeStyle = INK; c.lineWidth = 1.8;
    c.beginPath(); c.arc(x - 3 * s, hy - 1 * s, 1.8 * s, Math.PI, 0); c.stroke();
    c.beginPath(); c.arc(x + 3 * s, hy - 1 * s, 1.8 * s, Math.PI, 0); c.stroke();
    c.beginPath(); c.arc(x, hy + 3 * s, 3 * s, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
  } else { // despair
    seg(c, x - 4.5 * s, hy - 2 * s, x - 1.5 * s, hy - 1 * s, INK, 2);
    seg(c, x + 1.5 * s, hy - 1 * s, x + 4.5 * s, hy - 2 * s, INK, 2);
    c.beginPath(); c.arc(x, hy + 6 * s, 3 * s, 1.15 * Math.PI, 1.85 * Math.PI);
    c.strokeStyle = INK; c.lineWidth = 2; c.stroke();
    disc(c, x - 5 * s, hy + 3 * s, 1.2 * s, '#9ed8f7', 1); // tears
    disc(c, x + 5 * s, hy + 3 * s, 1.2 * s, '#9ed8f7', 1);
  }
  // mushroom cap with big spots + underside band
  c.beginPath(); c.arc(x, hy - 4 * s, 12 * s, Math.PI * 0.95, Math.PI * 2.05); c.closePath();
  c.fillStyle = P.toadWhite; c.fill(); c.lineWidth = 2.5; c.strokeStyle = INK; c.stroke();
  c.save();
  c.beginPath(); c.arc(x, hy - 4 * s, 12 * s, Math.PI * 0.95, Math.PI * 2.05); c.closePath(); c.clip();
  flat(c, x - 12 * s, hy - 6.5 * s, 24 * s, 2.6 * s, '#ddd4bc');   // cap underside band
  disc(c, x - 6.5 * s, hy - 10 * s, 3.4 * s, spot, 1.5);
  disc(c, x + 6.5 * s, hy - 10 * s, 3.4 * s, spot, 1.5);
  disc(c, x, hy - 15 * s, 3.6 * s, spot, 1.5);
  c.restore();
  // props (always held or worn — nothing floats)
  if (o.coin) coin(c, x + f * 14 * s, y - 20 * s, 5 * s);  // clutched in the outstretched arm
  if (o.camera) {
    rect(c, x + f * 10 * s, hy - 4 * s, 12 * s, 9 * s, '#3d3f52', 2);
    disc(c, x + f * 16 * s, hy + 0.5 * s, 3 * s, '#8fd8ff', 1.5);
    disc(c, x + f * 12 * s, hy - 6 * s, 1.5 * s, '#f4f0e6', 1); // flash bulb
  }
}
