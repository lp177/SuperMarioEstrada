// ============================================================================
// Title screen background: dusk over the Mushroom Kingdom, silhouetted castle,
// giant gold arch logo drawn glyph by glyph, the whole conspiracy on stage.
// Deterministic — no Math.random; all motion from `frame`.
// Lower third (y > ~240) left free for the menu.
// ============================================================================

import { VIEW_W, VIEW_H } from '../core/constants.ts';
import { createRng } from '../core/rng.ts';
import { drawEstrada, drawMangiani, bigHand } from './cutsceneArt.ts';

type Ctx = CanvasRenderingContext2D;

const INK = '#1b1030';

// --- chunky 5x7 glyph font (logo only) --------------------------------------
const GLYPHS: Record<string, readonly string[]> = {
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
};

function glyphCells(ch: string): readonly string[] {
  const g = GLYPHS[ch];
  if (g === undefined) throw new Error(`titleArt: no glyph for '${ch}'`);
  return g;
}

/** One glyph at (x,y), cell size `cell`, in layered 3D-offset gold. */
function drawGlyph(c: Ctx, ch: string, x: number, y: number, cell: number): void {
  const rows = glyphCells(ch);
  const paint = (ox: number, oy: number, color: string, inflate: number): void => {
    c.fillStyle = color;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!;
      for (let k = 0; k < row.length; k++) {
        if (row[k] !== '#') continue;
        c.fillRect(x + k * cell + ox - inflate, y + r * cell + oy - inflate, cell + inflate * 2, cell + inflate * 2);
      }
    }
  };
  const ex = Math.max(2, cell * 0.4); // extrusion depth
  paint(ex, ex, INK, 2);              // outline of the extruded mass
  paint(0, 0, INK, 2);
  paint(ex, ex, '#8a5a10', 0);        // dark gold extrusion
  paint(0, 0, '#f6c94b', 0);          // bright face
  // top-edge highlight: repaint only cells with nothing above them
  c.fillStyle = '#ffe9a0';
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    for (let k = 0; k < row.length; k++) {
      if (row[k] !== '#') continue;
      const above = r > 0 ? rows[r - 1]![k] : '.';
      if (above !== '#') c.fillRect(x + k * cell, y + r * cell, cell, Math.max(1, cell * 0.28));
    }
  }
}

/** A word on an arch: middle letters raised by `archDepth`. cx = center. */
function drawArchWord(c: Ctx, word: string, cx: number, baseY: number, cell: number, archDepth: number): void {
  const adv = 6 * cell; // 5 cells + 1 gap
  const n = word.length;
  const total = n * adv - cell;
  let x = cx - total / 2;
  for (let i = 0; i < n; i++) {
    const ch = word[i]!;
    if (ch !== ' ') {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const dy = -archDepth * (1 - (t * 2 - 1) * (t * 2 - 1));
      drawGlyph(c, ch, x, baseY + dy, cell);
    }
    x += adv;
  }
}

// --- scene pieces ------------------------------------------------------------
function duskSky(c: Ctx, frame: number): void {
  const g = c.createLinearGradient(0, 0, 0, VIEW_H);
  g.addColorStop(0, '#2c1c50');
  g.addColorStop(0.55, '#7c3a68');
  g.addColorStop(1, '#e8845e');
  c.fillStyle = g;
  c.fillRect(0, 0, VIEW_W, VIEW_H);
  // twinkling stars, upper sky
  const rng = createRng(909);
  for (let i = 0; i < 26; i++) {
    const sx = rng() * VIEW_W;
    const sy = rng() * 120;
    const tw = 0.4 + 0.6 * Math.abs(Math.sin(frame * 0.03 + rng() * 6));
    c.fillStyle = `rgba(255,240,200,${(tw * 0.8).toFixed(2)})`;
    c.fillRect(sx, sy, 2, 2);
  }
}

function castleSilhouette(c: Ctx, x: number, y: number, s: number): void {
  // y = ground line; a blocky keep with three towers, pure silhouette
  c.fillStyle = '#2a1638';
  c.strokeStyle = INK;
  c.lineWidth = 3;
  const body = (bx: number, bw: number, bh: number): void => {
    c.fillRect(x + bx * s, y - bh * s, bw * s, bh * s);
    c.strokeRect(x + bx * s, y - bh * s, bw * s, bh * s);
    // crenellations
    for (let k = 0; k < Math.floor(bw / 14); k++) {
      c.fillRect(x + bx * s + k * 14 * s, y - bh * s - 7 * s, 8 * s, 7 * s);
    }
  };
  body(0, 130, 70);
  body(-24, 30, 96);
  body(124, 30, 96);
  body(46, 38, 110);
  // cone roofs on towers
  const cone = (tx: number, tw: number, th: number, topY: number): void => {
    c.beginPath();
    c.moveTo(x + tx * s, y - topY * s);
    c.lineTo(x + (tx + tw) * s, y - topY * s);
    c.lineTo(x + (tx + tw / 2) * s, y - (topY + th) * s);
    c.closePath();
    c.fill();
    c.stroke();
  };
  cone(-28, 38, 30, 96);
  cone(120, 38, 30, 96);
  cone(42, 46, 36, 110);
  // one lit window
  c.fillStyle = '#ffcf6a';
  c.fillRect(x + 60 * s, y - 84 * s, 8 * s, 12 * s);
}

// --- main --------------------------------------------------------------------
export function drawTitleArt(ctx: CanvasRenderingContext2D, frame: number): void {
  const c = ctx;
  c.save();
  duskSky(c, frame);

  // far hills
  c.fillStyle = '#3c2454';
  c.beginPath();
  c.ellipse(120, 260, 220, 60, 0, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.ellipse(540, 268, 260, 70, 0, 0, Math.PI * 2);
  c.fill();
  // ground band (menu sits on this)
  c.fillStyle = '#241640';
  c.fillRect(0, 240, VIEW_W, VIEW_H - 240);

  // Impeach's HUGE hand waving from behind the castle (the gag never rests).
  // Drawn BEFORE the castle: its sleeve angles down-left and is swallowed by
  // the tower silhouette — the arm is attached to a body hidden behind it.
  const wt = Math.sin(frame * 0.06);
  bigHand(c, 588, 108 + wt * 8, 34, 0.55 + wt * 0.12, 110);
  // the castle, right of center
  castleSilhouette(c, 420, 240, 1.0);

  // Bowsonaro's spiked jersey shell "hiding" in a bush, left
  c.fillStyle = '#2f5230';
  c.beginPath();
  c.ellipse(80, 238, 52, 24, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = INK;
  c.lineWidth = 3;
  c.stroke();
  c.beginPath();
  c.arc(80, 236, 24, Math.PI, 0);
  c.closePath();
  c.fillStyle = '#e8d532';
  c.fill();
  c.stroke();
  c.fillStyle = '#3a9a3a';
  c.fillRect(58, 222, 44, 6);
  for (let i = -1; i <= 1; i++) {
    c.beginPath();
    c.moveTo(80 + i * 15 - 4, 214);
    c.lineTo(80 + i * 15 + 4, 214);
    c.lineTo(80 + i * 15, 206);
    c.closePath();
    c.fillStyle = '#d9d4c4';
    c.fill();
    c.stroke();
  }

  // THE LOGO — giant gold arch lettering
  drawArchWord(c, 'SUPER MARIO', 320, 44, 7, 14);
  drawArchWord(c, 'ESTRADA', 320, 112, 11, 12);

  // subtitle banner, gently swaying
  const sway = Math.sin(frame * 0.04) * 3;
  c.beginPath();
  c.moveTo(120 + sway, 200);
  c.lineTo(520 + sway, 200);
  c.lineTo(508 + sway, 226);
  c.lineTo(132 + sway, 226);
  c.closePath();
  c.fillStyle = '#a83240';
  c.fill();
  c.strokeStyle = INK;
  c.lineWidth = 3;
  c.stroke();
  c.font = 'bold 12px monospace';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = '#ffe9a0';
  c.fillText('THE GREATEST RESCUE THAT NEVER HAPPENED', 320 + sway, 213);

  // Estrada front-center: winking, hugging the takings
  const bob = Math.sin(frame * 0.05) * 3;
  const wink = (frame % 160) < 24;
  drawEstrada(c, 320, 238 + bob * 0.3, 0.62, {
    facing: 1,
    eyes: wink ? 'wink' : 'smug',
    mouth: 'grin',
    arms: 'down',
    item: 'bag',
  });

  // Mangiani tiny in the corner, already suspicious — with an UNMISTAKABLE
  // magnifying glass: fat face-on lens held over his face, and behind it his
  // eye HUGELY magnified (the cue that sells the prop at this scale).
  drawMangiani(c, 606, 244, 0.42, {
    facing: -1,
    eyes: 'narrow',
    brows: 'worried',
    pose: 'magnify',
    backpack: true,
  });
  // wipe the cast's tiny edge-on lens; the face-on redraw below replaces it
  c.fillStyle = '#3c2454'; // far-hill color behind the old prop
  c.beginPath(); c.arc(590, 206, 5.5, 0, Math.PI * 2); c.fill();
  const LX = 600, LY = 200, LR = 10;
  // stubby rounded handle leaving the rim on the lower diagonal, into his fist
  c.lineCap = 'round';
  c.strokeStyle = INK; c.lineWidth = 6.5;
  c.beginPath(); c.moveTo(594.9, 208.6); c.lineTo(589.6, 217.8); c.stroke();
  c.strokeStyle = '#8a5a2b'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(594.3, 209.6); c.lineTo(589.9, 217.3); c.stroke();
  c.lineCap = 'butt';
  // pale glass fill
  c.beginPath(); c.arc(LX, LY, LR, 0, Math.PI * 2);
  c.fillStyle = 'rgba(190,230,255,0.30)'; c.fill();
  // the giant magnified eye + one glass streak, clipped INSIDE the lens
  c.save();
  c.beginPath(); c.arc(LX, LY, LR - 1, 0, Math.PI * 2); c.clip();
  c.beginPath(); c.ellipse(600.5, 200.5, 6.6, 7.2, 0, 0, Math.PI * 2);
  c.fillStyle = '#fff'; c.fill();
  c.strokeStyle = INK; c.lineWidth = 2; c.stroke();
  c.beginPath(); c.arc(599.2, 201.2, 3.4, 0, Math.PI * 2); c.fillStyle = '#7a4a26'; c.fill(); // iris
  c.beginPath(); c.arc(598.9, 201.5, 1.9, 0, Math.PI * 2); c.fillStyle = INK; c.fill();       // pupil
  c.beginPath(); c.arc(600.3, 199.6, 1.05, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill();   // highlight
  c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 2.4; c.lineCap = 'round';
  c.beginPath(); c.moveTo(593.6, 197.2); c.lineTo(598.8, 191.8); c.stroke();
  c.lineCap = 'butt';
  c.restore();
  // the fat rim, face-on to camera
  c.beginPath(); c.arc(LX, LY, LR, 0, Math.PI * 2);
  c.strokeStyle = INK; c.lineWidth = 3; c.stroke();
  // his glove re-gripping the handle (handle visible both above and below it)
  c.beginPath(); c.arc(592.4, 212.9, 2.6, 0, Math.PI * 2);
  c.fillStyle = '#f4f0e6'; c.fill(); c.strokeStyle = INK; c.lineWidth = 1.5; c.stroke();

  c.restore();
}
