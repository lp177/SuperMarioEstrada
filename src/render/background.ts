// ============================================================================
// Parallax backgrounds — one full-screen painter per ThemeId.
// Pure presentation: reads cam/frame, draws to the given ctx, never touches
// module-level DOM state and never calls Math.random. All per-instance
// variation comes from hash01 (a pure integer hash), all motion from `frame`.
// Dispatch is an exhaustive Record<ThemeId, painter>; an unknown id THROWS.
// ============================================================================

import type { CameraState, ThemeId } from '../core/types.ts';
import { VIEW_W, VIEW_H } from '../core/constants.ts';

/** Parallax factors per depth layer (fraction of cam.x). */
const PARALLAX_FAR = 0.2;
const PARALLAX_MID = 0.4;
const PARALLAX_NEAR = 0.7;

/** Castle lightning: deterministic flash window. */
const LIGHTNING_PERIOD = 623;
const LIGHTNING_FRAMES = 6;

type Painter = (ctx: CanvasRenderingContext2D, cam: CameraState, frame: number) => void;

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

/** Pure integer -> [0,1) hash (mulberry32 finalizer). Stable across frames. */
function hash01(n: number): number {
  let t = (n | 0) + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Visit every instance of a horizontally repeating element that can touch the
 *  view, given the layer's scroll offset. cb receives (screenX, index). */
function tiled(ox: number, period: number, margin: number, cb: (sx: number, i: number) => void): void {
  const first = Math.floor((ox - margin) / period);
  const last = Math.floor((ox + VIEW_W + margin) / period);
  for (let i = first; i <= last; i++) cb(i * period - ox, i);
}

function vgrad(ctx: CanvasRenderingContext2D, y0: number, y1: number, stops: readonly (readonly [number, string])[]): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

function fillSky(ctx: CanvasRenderingContext2D, stops: readonly (readonly [number, string])[]): void {
  ctx.fillStyle = vgrad(ctx, 0, VIEW_H, stops);
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

// ---------------------------------------------------------------------------
// MEADOW — warm sky, fat clouds, foreclosed mushroom-house skyline, hills,
// and the TOAD'S BETS blimp slowly trawling for new suckers.
// ---------------------------------------------------------------------------

function drawMeadow(ctx: CanvasRenderingContext2D, cam: CameraState, frame: number): void {
  fillSky(ctx, [[0, '#5aa7e0'], [0.55, '#a8d4ef'], [0.8, '#ffe2a8'], [1, '#ffd489']]);

  // Sun, low and golden — the kingdom's assets set with it.
  ctx.fillStyle = 'rgba(255,240,190,0.9)';
  ctx.beginPath();
  ctx.arc(520, 74, 26, 0, Math.PI * 2);
  ctx.fill();

  // The blimp: screen-space drift right-to-left, towing the grift banner.
  const span = VIEW_W + 560;
  const bx = VIEW_W + 200 - ((frame * 0.3) % span);
  const by = 52 + Math.sin(frame * 0.01) * 4;
  ctx.fillStyle = '#8d97a6';
  ctx.beginPath();
  ctx.ellipse(bx, by, 34, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6f7987';
  ctx.fillRect(bx - 6, by + 9, 12, 5); // gondola
  ctx.beginPath(); // tail fin
  ctx.moveTo(bx + 28, by - 8);
  ctx.lineTo(bx + 42, by - 12);
  ctx.lineTo(bx + 42, by + 4);
  ctx.closePath();
  ctx.fill();
  // Tow rope + banner trailing behind (blimp flies left, banner to the right).
  ctx.strokeStyle = '#5c6470';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bx + 40, by);
  ctx.lineTo(bx + 58, by + 6);
  ctx.stroke();
  ctx.fillStyle = '#fff6e0';
  ctx.fillRect(bx + 58, by - 2, 78, 15);
  ctx.fillStyle = '#c62828';
  ctx.font = 'bold 8px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText("TOAD'S BETS", bx + 97, by + 6);

  // FAR (0.2): fat clouds drifting, then the hazy mushroom-house skyline.
  const oxFar = cam.x * PARALLAX_FAR;
  tiled(oxFar + frame * 0.06, 230, 90, (sx, i) => {
    const h = hash01(i * 31 + 7);
    const cy = 42 + h * 76;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.beginPath();
    ctx.arc(sx, cy, 13 + h * 6, 0, Math.PI * 2);
    ctx.arc(sx + 15, cy - 5, 11 + h * 5, 0, Math.PI * 2);
    ctx.arc(sx + 30, cy + 1, 12 + h * 4, 0, Math.PI * 2);
    ctx.arc(sx + 15, cy + 6, 14, 0, Math.PI * 2);
    ctx.fill();
  });
  const skylineY = 252;
  tiled(oxFar, 96, 60, (sx, i) => {
    const h = hash01(i * 53 + 1);
    const hh = 18 + h * 20; // house height
    const w = 20 + h * 8;
    // stem + cap silhouette in warm haze
    ctx.fillStyle = '#c9a9b8';
    ctx.fillRect(sx - w * 0.32, skylineY - hh, w * 0.64, hh);
    ctx.beginPath();
    ctx.arc(sx, skylineY - hh, w * 0.62, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#b3919f';
    ctx.fillRect(sx - 2, skylineY - 7, 4, 7); // dark doorway
    if (h > 0.45) {
      // FOR SALE sign out front — the whole street is on the market.
      ctx.fillStyle = '#8a7268';
      ctx.fillRect(sx + w * 0.45, skylineY - 9, 1, 9);
      ctx.fillStyle = '#fdf6e3';
      ctx.fillRect(sx + w * 0.45 - 8, skylineY - 15, 17, 7);
      ctx.fillStyle = '#a03030';
      ctx.font = 'bold 5px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('FOR SALE', sx + w * 0.45, skylineY - 11);
    }
  });
  // haze ground line under the skyline
  ctx.fillStyle = '#d9bfa8';
  ctx.fillRect(0, skylineY, VIEW_W, VIEW_H - skylineY);

  // MID (0.4): rolling hills.
  const oxMid = cam.x * PARALLAX_MID;
  ctx.fillStyle = '#8fca62';
  tiled(oxMid, 250, 160, (sx, i) => {
    const h = hash01(i * 71 + 3);
    const r = 110 + h * 60;
    ctx.beginPath();
    ctx.arc(sx, 268 + r * 0.55, r, Math.PI, 0);
    ctx.fill();
  });
  ctx.fillStyle = '#8fca62';
  ctx.fillRect(0, 300, VIEW_W, VIEW_H - 300);

  // NEAR (0.7): darker hill row.
  const oxNear = cam.x * PARALLAX_NEAR;
  ctx.fillStyle = '#5fa844';
  tiled(oxNear, 190, 140, (sx, i) => {
    const h = hash01(i * 97 + 11);
    const r = 80 + h * 50;
    ctx.beginPath();
    ctx.arc(sx, 330 + r * 0.5, r, Math.PI, 0);
    ctx.fill();
  });
  ctx.fillRect(0, 344, VIEW_W, VIEW_H - 344);
}

// ---------------------------------------------------------------------------
// SEWER — the money pipes. Dark vault, arched brickwork, chains, grate light,
// rat eyes, and — recurring, easy to miss — a barred door with a tiny pink
// crown behind it. The real Peach is down here. Nobody is looking.
// ---------------------------------------------------------------------------

function drawSewer(ctx: CanvasRenderingContext2D, cam: CameraState, frame: number): void {
  fillSky(ctx, [[0, '#131a1c'], [0.6, '#0d1214'], [1, '#080c0d']]);

  // FAR (0.2): arched brick wall.
  const oxFar = cam.x * PARALLAX_FAR;
  ctx.fillStyle = '#1c2427';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  // faint mortar courses
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  for (let y = 12; y < VIEW_H; y += 14) ctx.fillRect(0, y, VIEW_W, 1);
  tiled(oxFar, 170, 90, (sx, i) => {
    // dark arched recess
    ctx.fillStyle = '#11171a';
    ctx.beginPath();
    ctx.moveTo(sx - 28, 320);
    ctx.lineTo(sx - 28, 140);
    ctx.arc(sx, 140, 28, Math.PI, 0);
    ctx.lineTo(sx + 28, 320);
    ctx.closePath();
    ctx.fill();
    // Every ~8th arch: the dungeon door. Bars, and a tiny pink crown waiting.
    if (((i % 8) + 8) % 8 === 3) {
      ctx.fillStyle = '#07090b';
      ctx.fillRect(sx - 16, 210, 32, 110);
      ctx.strokeStyle = '#2a3438';
      ctx.lineWidth = 2;
      for (let b = -12; b <= 12; b += 6) {
        ctx.beginPath();
        ctx.moveTo(sx + b, 212);
        ctx.lineTo(sx + b, 318);
        ctx.stroke();
      }
      // the crown: 5px of pink in a kingdom of murk
      ctx.fillStyle = '#ff9ecf';
      ctx.fillRect(sx - 3, 258, 6, 3);
      ctx.fillRect(sx - 3, 255, 1, 3);
      ctx.fillRect(sx - 1, 255, 2, 3);
      ctx.fillRect(sx + 2, 255, 1, 3);
    }
  });

  // MID (0.4): grate light shafts, hanging chains, rat eyes.
  const oxMid = cam.x * PARALLAX_MID;
  tiled(oxMid, 330, 120, (sx, i) => {
    const h = hash01(i * 37 + 5);
    const w = 34 + h * 18;
    // grate slats at the top
    ctx.fillStyle = '#04070a';
    for (let s = 0; s < 5; s++) ctx.fillRect(sx - w / 2 + (s * w) / 5, 0, w / 9, 4);
    // shaft widening downward, breathing slightly with frame
    const sway = Math.sin(frame * 0.008 + i) * 4;
    ctx.fillStyle = 'rgba(150,255,205,0.055)';
    ctx.beginPath();
    ctx.moveTo(sx - w / 2, 0);
    ctx.lineTo(sx + w / 2, 0);
    ctx.lineTo(sx + w * 1.1 + sway, VIEW_H - 30);
    ctx.lineTo(sx - w * 1.1 + sway, VIEW_H - 30);
    ctx.closePath();
    ctx.fill();
  });
  tiled(oxMid, 88, 40, (sx, i) => {
    const h = hash01(i * 59 + 13);
    if (h < 0.35) return; // gaps between chains
    const len = 34 + h * 80;
    const sway = Math.sin(frame * 0.015 + i * 1.3) * 2;
    ctx.strokeStyle = '#2e383d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.quadraticCurveTo(sx + sway, len * 0.6, sx + sway, len);
    ctx.stroke();
    ctx.fillStyle = '#39454b';
    ctx.beginPath();
    ctx.arc(sx + sway, len + 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });
  tiled(oxMid, 270, 40, (sx, i) => {
    const h = hash01(i * 83 + 29);
    if (h < 0.5) return;
    // rat eyes blink: mostly on, briefly off, offset per instance
    if (((frame + i * 137) % 420) > 360) return;
    const ey = 296 + h * 26;
    ctx.fillStyle = '#ffb84d';
    ctx.fillRect(sx, ey, 2, 2);
    ctx.fillRect(sx + 5, ey, 2, 2);
  });

  // NEAR (0.7): fat pipe silhouettes running along the wall.
  const oxNear = cam.x * PARALLAX_NEAR;
  tiled(oxNear, 240, 90, (sx, i) => {
    const h = hash01(i * 101 + 17);
    const px = sx + h * 60;
    ctx.fillStyle = '#232d32';
    ctx.fillRect(px - 9, 0, 18, VIEW_H - 24);
    ctx.fillStyle = '#2b373d';
    ctx.fillRect(px - 11, 40 + h * 60, 22, 6); // flange
    ctx.fillRect(px - 11, 160 + h * 80, 22, 6);
  });

  // Murky water strip at the bottom, sine ripple on the surface.
  const wtop = VIEW_H - 26;
  ctx.fillStyle = 'rgba(24,46,38,0.85)';
  ctx.beginPath();
  ctx.moveTo(0, VIEW_H);
  for (let x = 0; x <= VIEW_W; x += 8) {
    ctx.lineTo(x, wtop + Math.sin((x + cam.x * PARALLAX_NEAR) * 0.05 + frame * 0.06) * 2);
  }
  ctx.lineTo(VIEW_W, VIEW_H);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(140,220,190,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= VIEW_W; x += 8) {
    const y = wtop + Math.sin((x + cam.x * PARALLAX_NEAR) * 0.05 + frame * 0.06) * 2;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// CASINO — the scam made architecture. Night sky, neon skyline, a ferris
// wheel of card suits, spotlights hunting for the last solvent Toad.
// ---------------------------------------------------------------------------

function drawCasino(ctx: CanvasRenderingContext2D, cam: CameraState, frame: number): void {
  fillSky(ctx, [[0, '#0d0b26'], [0.7, '#221040'], [1, '#331550']]);

  const oxFar = cam.x * PARALLAX_FAR;
  // stars, twinkling
  tiled(oxFar, 46, 20, (sx, i) => {
    const h = hash01(i * 43 + 19);
    const sy = 8 + h * 150;
    const tw = 0.35 + 0.55 * Math.abs(Math.sin(frame * 0.04 + h * 6.28));
    ctx.fillStyle = `rgba(255,255,235,${tw.toFixed(2)})`;
    ctx.fillRect(sx + h * 30, sy, 1.5, 1.5);
  });

  // FAR (0.2): skyline with neon.
  tiled(oxFar, 150, 90, (sx, i) => {
    const h = hash01(i * 67 + 23);
    const bw = 54 + h * 40;
    const bh = 70 + h * 90;
    const by = 300 - bh;
    ctx.fillStyle = '#191233';
    ctx.fillRect(sx - bw / 2, by, bw, bh);
    // lit windows
    ctx.fillStyle = 'rgba(255,220,130,0.35)';
    for (let wy = by + 8; wy < 292; wy += 12) {
      for (let wx = sx - bw / 2 + 6; wx < sx + bw / 2 - 6; wx += 10) {
        if (hash01(i * 977 + wy * 31 + wx) > 0.5) ctx.fillRect(wx, wy, 3, 4);
      }
    }
    // neon: flickers off for a beat now and then
    const lit = ((frame + i * 53) % 240) >= 14;
    const sign = ((i % 3) + 3) % 3;
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    if (sign === 0) {
      ctx.fillStyle = lit ? '#ff4fd8' : '#552044';
      ctx.fillText('BETS', sx, by - 5);
    } else if (sign === 1) {
      ctx.fillStyle = lit ? '#54ff9f' : '#1e5537';
      ctx.fillText('☘ WIN', sx, by - 5);
    } else {
      // giant dice on the roof
      const dy = by - 18;
      ctx.save();
      ctx.translate(sx, dy);
      ctx.rotate(0.18);
      ctx.fillStyle = lit ? '#f2f2f6' : '#9a9aa5';
      ctx.fillRect(-8, -8, 16, 16);
      ctx.fillStyle = '#c02040';
      ctx.fillRect(-5, -5, 3, 3);
      ctx.fillRect(2, -5, 3, 3);
      ctx.fillRect(-1.5, -1.5, 3, 3);
      ctx.fillRect(-5, 2, 3, 3);
      ctx.fillRect(2, 2, 3, 3);
      ctx.restore();
    }
  });
  ctx.fillStyle = '#141028';
  ctx.fillRect(0, 300, VIEW_W, VIEW_H - 300);

  // MID (0.4): the ferris wheel of card suits, turning slowly.
  const oxMid = cam.x * PARALLAX_MID;
  tiled(oxMid, 860, 180, (sx, i) => {
    const cy = 196;
    const r = 72;
    const a0 = frame * 0.004 + hash01(i * 7 + 2) * 6.28;
    ctx.strokeStyle = '#7f5fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    const suits = ['♠', '♥', '♦', '♣'] as const;
    for (let s = 0; s < 8; s++) {
      const a = a0 + (s * Math.PI) / 4;
      const px = sx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      ctx.strokeStyle = '#5a44b8';
      ctx.beginPath();
      ctx.moveTo(sx, cy);
      ctx.lineTo(px, py);
      ctx.stroke();
      const suit = suits[s % 4]!;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = s % 2 === 0 ? '#f2f2f6' : '#ff5a6e';
      ctx.fillText(suit, px, py + 4);
    }
    // support legs
    ctx.strokeStyle = '#3d2f80';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx - 26, 330);
    ctx.lineTo(sx, cy);
    ctx.lineTo(sx + 26, 330);
    ctx.stroke();
  });

  // NEAR (0.7): sweeping spotlights + a strip of midway bulbs.
  const oxNear = cam.x * PARALLAX_NEAR;
  tiled(oxNear, 520, 200, (sx, i) => {
    const a = Math.sin(frame * 0.008 + i * 1.7) * 0.55;
    ctx.fillStyle = 'rgba(255,240,180,0.09)';
    ctx.beginPath();
    ctx.moveTo(sx, VIEW_H);
    ctx.lineTo(sx + Math.sin(a - 0.06) * 460, VIEW_H - Math.cos(a - 0.06) * 460);
    ctx.lineTo(sx + Math.sin(a + 0.06) * 460, VIEW_H - Math.cos(a + 0.06) * 460);
    ctx.closePath();
    ctx.fill();
  });
  const bulbColors = ['#ff5a6e', '#ffd23f', '#54ff9f'] as const;
  for (let x = -16; x <= VIEW_W + 16; x += 16) {
    const gi = Math.floor((x + oxNear) / 16);
    const c = bulbColors[(((gi + Math.floor(frame / 20)) % 3) + 3) % 3]!;
    ctx.fillStyle = c;
    ctx.fillRect(x - ((oxNear % 16) + 16) % 16, 336, 3, 3);
  }
}

// ---------------------------------------------------------------------------
// CASTLE — Bowsonaro's Grand Palace. Blood sky, deterministic lightning,
// gold statues of Impeach (the hands, drawn BIG), lava-glow horizon,
// shell-emblem banners.
// ---------------------------------------------------------------------------

function drawCastle(ctx: CanvasRenderingContext2D, cam: CameraState, frame: number): void {
  const flash = (frame % LIGHTNING_PERIOD) < LIGHTNING_FRAMES;
  fillSky(ctx, [[0, '#3d060a'], [0.55, '#611010'], [1, '#7c1d10']]);

  // lava glow horizon, pulsing
  const pulse = 0.35 + 0.15 * Math.sin(frame * 0.02);
  ctx.fillStyle = vgrad(ctx, 250, VIEW_H, [
    [0, 'rgba(255,120,20,0)'],
    [0.6, `rgba(255,120,20,${pulse.toFixed(2)})`],
    [1, `rgba(255,170,40,${(pulse + 0.15).toFixed(2)})`],
  ]);
  ctx.fillRect(0, 250, VIEW_W, VIEW_H - 250);

  if (flash) {
    ctx.fillStyle = 'rgba(255,225,225,0.28)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // one jagged bolt, position stable for the duration of this flash
    const bseed = Math.floor(frame / LIGHTNING_PERIOD);
    let bx = hash01(bseed * 17 + 5) * VIEW_W;
    ctx.strokeStyle = '#fff3f3';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx, 0);
    let by = 0;
    for (let s = 1; by < 230; s++) {
      bx += (hash01(bseed * 131 + s) - 0.5) * 46;
      by += 24 + hash01(bseed * 197 + s) * 22;
      ctx.lineTo(bx, by);
    }
    ctx.stroke();
  }

  // FAR (0.2): obsidian palace skyline.
  const oxFar = cam.x * PARALLAX_FAR;
  tiled(oxFar, 180, 100, (sx, i) => {
    const h = hash01(i * 61 + 9);
    const tw = 40 + h * 34;
    const th = 90 + h * 110;
    const ty = 310 - th;
    ctx.fillStyle = flash ? '#33131b' : '#200609';
    ctx.fillRect(sx - tw / 2, ty, tw, th);
    // crenellated top
    for (let c = 0; c < 5; c++) ctx.fillRect(sx - tw / 2 + (c * tw) / 5, ty - 7, tw / 9, 7);
    // one lit window
    ctx.fillStyle = '#ff9d3c';
    ctx.fillRect(sx - 2, ty + 16 + h * 30, 4, 6);
  });
  ctx.fillStyle = flash ? '#33131b' : '#200609';
  ctx.fillRect(0, 310, VIEW_W, VIEW_H - 310);

  // MID (0.4): gold statues of Princess Impeach on pedestals.
  const oxMid = cam.x * PARALLAX_MID;
  tiled(oxMid, 340, 90, (sx, i) => {
    const h = hash01(i * 89 + 21);
    const baseY = 322;
    const gold = flash ? '#f5c86a' : '#d9a530';
    const goldDark = flash ? '#c99f45' : '#a87c20';
    // pedestal
    ctx.fillStyle = '#2a0f12';
    ctx.fillRect(sx - 16, baseY - 14, 32, 14);
    ctx.fillRect(sx - 12, baseY - 40, 24, 26);
    // dress (triangle skirt + bodice)
    ctx.fillStyle = gold;
    ctx.beginPath();
    ctx.moveTo(sx, baseY - 92);
    ctx.lineTo(sx - 15, baseY - 40);
    ctx.lineTo(sx + 15, baseY - 40);
    ctx.closePath();
    ctx.fill();
    // head + wig puff
    ctx.beginPath();
    ctx.arc(sx, baseY - 99, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = goldDark;
    ctx.fillRect(sx - 8, baseY - 106, 16, 4); // the swoop
    // tiny crown
    ctx.fillStyle = gold;
    ctx.fillRect(sx - 3, baseY - 112, 6, 3);
    ctx.fillRect(sx - 3, baseY - 115, 1, 3);
    ctx.fillRect(sx - 0.5, baseY - 115, 1, 3);
    ctx.fillRect(sx + 2, baseY - 115, 1, 3);
    // thin arms ending in ENORMOUS hands (the sculptor was paid to notice)
    ctx.strokeStyle = gold;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(sx - 6, baseY - 84);
    ctx.lineTo(sx - 20, baseY - 72);
    ctx.moveTo(sx + 6, baseY - 84);
    ctx.lineTo(sx + 20, baseY - 72);
    ctx.stroke();
    ctx.fillStyle = gold;
    ctx.beginPath();
    ctx.arc(sx - 24, baseY - 70, 8 + h * 2, 0, Math.PI * 2);
    ctx.arc(sx + 24, baseY - 70, 8 + h * 2, 0, Math.PI * 2);
    ctx.fill();
  });

  // NEAR (0.7): shell-emblem banners hanging from above, swaying.
  const oxNear = cam.x * PARALLAX_NEAR;
  tiled(oxNear, 260, 60, (sx, i) => {
    const sway = Math.sin(frame * 0.01 + i * 2.1) * 3;
    const bw = 30;
    const bh = 92;
    ctx.fillStyle = '#4a0a10';
    ctx.beginPath();
    ctx.moveTo(sx - bw / 2, 0);
    ctx.lineTo(sx + bw / 2, 0);
    ctx.lineTo(sx + bw / 2 + sway, bh - 16);
    ctx.lineTo(sx + sway, bh - 30); // swallowtail
    ctx.lineTo(sx - bw / 2 + sway, bh - 16);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#6b1016';
    ctx.fillRect(sx - bw / 2, 0, bw, 8);
    // shell emblem: green dome with spikes
    const ex = sx + sway * 0.6;
    const ey = 44;
    ctx.fillStyle = '#2f7a2f';
    ctx.beginPath();
    ctx.arc(ex, ey, 8, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e8e0c8';
    for (let s = -1; s <= 1; s++) {
      ctx.beginPath();
      ctx.moveTo(ex + s * 5 - 2, ey - (s === 0 ? 7 : 5));
      ctx.lineTo(ex + s * 5, ey - (s === 0 ? 12 : 10));
      ctx.lineTo(ex + s * 5 + 2, ey - (s === 0 ? 7 : 5));
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#245c24';
    ctx.fillRect(ex - 8, ey, 16, 3);
  });
}

// ---------------------------------------------------------------------------
// Dispatch — exhaustive by construction; unknown ids throw at runtime too.
// ---------------------------------------------------------------------------

const PAINTERS: Record<ThemeId, Painter> = {
  meadow: drawMeadow,
  sewer: drawSewer,
  casino: drawCasino,
  castle: drawCastle,
};

export function drawBackground(ctx: CanvasRenderingContext2D, theme: ThemeId, cam: CameraState, frame: number): void {
  const painter = PAINTERS[theme];
  if (!painter) throw new Error(`drawBackground: unknown theme '${String(theme)}'`);
  painter(ctx, cam, frame);
}
