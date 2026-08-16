#!/usr/bin/env node
// ============================================================================
// make-cover.mjs — draw the 1200x630 key-art cover (Open Graph / Twitter card).
//
// This is NOT a screenshot of the game. It is a poster: the gold arch wordmark,
// the red strapline, and a bespoke high-detail illustration of Super Mario
// Estrada — the smug notary who turns up after the rescue, plants his flag on
// somebody else's castle, and leaves with the takings while the princess is
// still waving from the tower window.
//
// COMPOSITION
//   One oblique axis runs from the pennant in the upper left, down through the
//   hero's shoulders, to the money sack in the lower right. The flagpole cuts
//   across it. Head is off-centre right; the title owns the top band and never
//   touches the face.
//
// LIGHT
//   Three sources, and every element obeys them:
//     KEY   warm white, up and to the viewer's LEFT  -> lit planes, cast shadows
//           fall down-right (the nose onto the far cheek, the brim onto the brow)
//     RIM   the setting sun, low and BEHIND-RIGHT    -> hot gold edge down every
//           right-hand silhouette, and the glow on the horizon
//     FILL  the dusk sky, cool violet                -> bounce on the lower left
//
// HOW IT WORKS
//   1. Bundles the game's own `src/render/cast.ts` with the repo's esbuild so
//      the cover borrows the REAL palette (`P`). The hero is drawn from scratch
//      at poster detail — the in-game sprite is flat by design and does not
//      survive 8x.
//   2. Serves a throwaway page over HTTP (ES modules are blocked on file://)
//      and drives it with Playwright + the system Chrome.
//   3. Composes at 2400x1260 (2x supersample), then downscales to exactly
//      1200x630 with a high-quality resize. That step is the difference
//      between crisp and ragged on vector art.
//   4. Writes social-card.png to docs/ (GitHub Pages) AND public/ (so a future
//      `vite build` copies it straight back into docs/).
//
// RUN IT
//   node /home/lp177/Code/games/web/SuperMarioEstrada/tools/make-cover.mjs
//
//   Works from any cwd — every path is resolved relative to this file.
//   Set COVER_SCRATCH=/some/dir to ALSO drop the 2400x1260 master and a copy of
//   the final card there for inspection (nothing extra is written to the repo).
//
// DEPENDENCIES ON THIS MACHINE
//   - esbuild: this repo's own devDependency (node_modules/.bin/esbuild).
//   - Playwright: NOT installed here; it lives in the sibling Tribble checkout
//     and the resolver below finds it. Playwright's bundled browsers are absent,
//     so Chrome is referenced explicitly at /usr/bin/google-chrome with
//     --no-sandbox.
//   - optipng (optional) is used to shave the final PNG if it lands over 1 MB.
// ============================================================================

import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const CHROME = '/usr/bin/google-chrome';
const PLAYWRIGHT_FALLBACK = '/home/lp177/Code/games/web/Tribble/node_modules';

const BIG_W = 2400, BIG_H = 1260;
const OUT_W = 1200, OUT_H = 630;

// ---------------------------------------------------------------------------
// The poster. Stringified and evaluated inside the page, so it must be
// self-contained: every helper is nested, and the game's art module arrives as
// the `cast` argument. The head is drawn in a local space where the skull
// radius is 100 units, which is what keeps the facial numbers legible.
// ---------------------------------------------------------------------------
function drawCover(c, W, H, cast) {
  const P = cast.P;
  const INK = '#180d28';
  const GOLD = '#f6c94b';
  const GOLD_HI = '#ffeda6';
  const GOLD_LO = '#8a5a10';
  const TAU = Math.PI * 2;

  // --- tiny utilities ------------------------------------------------------
  const rngFrom = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  // pts[0] = moveTo; later points: 2 = lineTo, 4 = quadratic, 6 = bezier
  const path = (pts) => {
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (p.length === 6) c.bezierCurveTo(p[0], p[1], p[2], p[3], p[4], p[5]);
      else if (p.length === 4) c.quadraticCurveTo(p[0], p[1], p[2], p[3]);
      else c.lineTo(p[0], p[1]);
    }
    c.closePath();
  };
  const lg = (x0, y0, x1, y1, stops) => {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    for (const s of stops) g.addColorStop(s[0], s[1]);
    return g;
  };
  const rg = (x0, y0, r0, x1, y1, r1, stops) => {
    const g = c.createRadialGradient(x0, y0, r0, x1, y1, r1);
    for (const s of stops) g.addColorStop(s[0], s[1]);
    return g;
  };
  const ell = (x, y, rx, ry, rot) => {
    c.beginPath();
    c.ellipse(x, y, rx, ry, rot || 0, 0, TAU);
  };
  const ink = (w, col) => { c.lineJoin = 'round'; c.lineWidth = w; c.strokeStyle = col; c.stroke(); };
  const stroke = (pts, w, col, cap) => {
    c.lineCap = cap || 'round';
    c.lineJoin = 'round';
    c.lineWidth = w;
    c.strokeStyle = col;
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (p.length === 6) c.bezierCurveTo(p[0], p[1], p[2], p[3], p[4], p[5]);
      else if (p.length === 4) c.quadraticCurveTo(p[0], p[1], p[2], p[3]);
      else c.lineTo(p[0], p[1]);
    }
    c.stroke();
    c.lineCap = 'butt';
  };
  const glow = (blur, col) => { c.shadowColor = col; c.shadowBlur = blur; };
  const noGlow = () => { c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetX = 0; c.shadowOffsetY = 0; };
  const blurFill = (px) => { c.filter = 'blur(' + px + 'px)'; c.fill(); c.filter = 'none'; };

  // a limb with real taper and rounded ends: quadratic spine, width w0 -> w1
  const qpt = (p0, p1, p2, t) => [
    (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
    (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1],
  ];
  const limbShape = (p0, p1, p2, w0, w1) => {
    const N = 26, A = [], B = [];
    let ta = [1, 0], tb = [1, 0];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const q = qpt(p0, p1, p2, t);
      const e = qpt(p0, p1, p2, Math.min(1, t + 0.002));
      const s = qpt(p0, p1, p2, Math.max(0, t - 0.002));
      let dx = e[0] - s[0], dy = e[1] - s[1];
      const m = Math.hypot(dx, dy) || 1;
      dx /= m; dy /= m;
      if (i === 0) ta = [dx, dy];
      if (i === N) tb = [dx, dy];
      const w = (w0 + (w1 - w0) * t) / 2;
      A.push([q[0] - dy * w, q[1] + dx * w]);
      B.push([q[0] + dy * w, q[1] - dx * w]);
    }
    const cap = (cx, cy, r, tan, sign) => {
      const a0 = Math.atan2(tan[0], -tan[1]) + (sign > 0 ? 0 : Math.PI);
      for (let k = 1; k < 12; k++) {
        const a = a0 - (Math.PI * k) / 11;
        c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
    };
    c.beginPath();
    c.moveTo(A[0][0], A[0][1]);
    for (const p of A) c.lineTo(p[0], p[1]);
    cap(p2[0], p2[1], w1 / 2, tb, 1);
    for (let i = B.length - 1; i >= 0; i--) c.lineTo(B[i][0], B[i][1]);
    cap(p0[0], p0[1], w0 / 2, ta, -1);
    c.closePath();
  };

  // ==========================================================================
  // 1. SKY — the game's own purple dusk, pushed to poster contrast
  // ==========================================================================
  const GROUND = 1122;
  const SUNX = 1616, SUNY = 946;

  c.fillStyle = lg(0, 0, 0, H, [
    [0, '#120a2c'], [0.18, '#26184a'], [0.42, '#4e2860'],
    [0.62, '#87386c'], [0.80, '#c25a5c'], [0.93, '#ee9b5c'], [1, '#f6bf76'],
  ]);
  c.fillRect(0, 0, W, H);

  {
    const r = rngFrom(909);
    for (let i = 0; i < 210; i++) {
      const sx = r() * W, sy = Math.pow(r(), 1.7) * H * 0.62;
      const a = (1 - sy / (H * 0.62)) * (0.25 + 0.75 * r());
      const s = 1.2 + r() * 2.4;
      c.fillStyle = 'rgba(255,244,214,' + (a * 0.8).toFixed(3) + ')';
      c.fillRect(sx, sy, s, s);
      if (r() > 0.94) {
        c.fillStyle = 'rgba(255,244,214,' + (a * 0.3).toFixed(3) + ')';
        c.fillRect(sx - s * 1.8, sy + s * 0.3, s * 5.6, s * 0.4);
        c.fillRect(sx + s * 0.3, sy - s * 1.8, s * 0.4, s * 5.6);
      }
    }
  }

  // the sunburst he stages for his own arrival — behind everything, very faint
  c.save();
  c.translate(SUNX, SUNY);
  for (let i = 0; i < 22; i++) {
    c.rotate(TAU / 22);
    c.fillStyle = 'rgba(255,206,132,0.05)';
    path([[0, 0], [Math.cos(-0.042) * 1700, Math.sin(-0.042) * 1700],
      [Math.cos(0.042) * 1700, Math.sin(0.042) * 1700]]);
    c.fill();
  }
  c.restore();

  // the sun going down behind his right shoulder — the source of every rim
  c.fillStyle = rg(SUNX, SUNY, 20, SUNX, SUNY, 940, [
    [0, 'rgba(255,232,176,0.86)'], [0.16, 'rgba(255,182,112,0.52)'],
    [0.46, 'rgba(214,104,112,0.22)'], [1, 'rgba(160,70,120,0)'],
  ]);
  c.fillRect(0, 0, W, H);

  // ==========================================================================
  // 2. MIDGROUND — three tonal steps back to front, so depth actually reads
  // ==========================================================================

  // two question blocks, floating where nobody maintains them any more
  const block = (bx, by, s, alpha) => {
    c.save();
    c.globalAlpha = alpha;
    c.fillStyle = 'rgba(38,18,60,1)';
    c.fillRect(bx, by, s, s);
    c.fillStyle = 'rgba(255,178,116,0.6)';
    c.fillRect(bx, by, s, s * 0.10);
    c.fillRect(bx + s * 0.90, by, s * 0.10, s);
    c.fillStyle = 'rgba(255,206,132,0.55)';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = '900 ' + (s * 0.72).toFixed(0) + 'px "Lato", sans-serif';
    c.fillText('?', bx + s * 0.5, by + s * 0.54);
    c.restore();
  };
  block(2072, 606, 78, 0.5);
  block(2276, 730, 56, 0.36);

  // far ridge — pale, hazy, catching the last of the sun
  c.fillStyle = 'rgba(120,62,116,0.55)';
  path([[-40, 1040], [300, 918, 700, 986, 1080, 962],
    [1520, 934, 1980, 1002, W + 40, 950], [W + 40, 1200], [-40, 1200]]);
  c.fill();
  c.fillStyle = 'rgba(255,186,124,0.30)';
  path([[-40, 1040], [300, 918, 700, 986, 1080, 962],
    [1520, 934, 1980, 1002, W + 40, 950], [W + 40, 980], [-40, 1064]]);
  c.fill();

  // mid ridge
  c.fillStyle = 'rgba(64,32,88,0.94)';
  path([[-40, 1092], [420, 1000, 900, 1064, 1290, 1040],
    [1700, 1016, 2080, 1082, W + 40, 1032], [W + 40, 1240], [-40, 1240]]);
  c.fill();
  c.fillStyle = 'rgba(255,168,110,0.20)';
  path([[-40, 1092], [420, 1000, 900, 1064, 1290, 1040],
    [1700, 1016, 2080, 1082, W + 40, 1032], [W + 40, 1050], [-40, 1110]]);
  c.fill();

  // --- the castle he arrived at too late -----------------------------------
  {
    const bx = 210, by = GROUND + 4, cs = 1.15;
    c.save();
    c.translate(bx, by);
    c.scale(cs, cs);
    // midground, so it must sit LIGHTER than the hero's darks or the depth
    // ordering inverts and the castle jumps forward
    const wall = 'rgba(50,26,76,0.99)';
    const body = (x, w, h) => {
      c.fillStyle = wall;
      c.fillRect(x, -h, w, h);
      for (let k = 0; k * 42 < w - 14; k++) c.fillRect(x + k * 42, -h - 22, 26, 22);
    };
    const cone = (x, w, h, topY) => {
      c.fillStyle = wall;
      path([[x, -topY], [x + w, -topY], [x + w / 2, -(topY + h)]]);
      c.fill();
      c.fillStyle = 'rgba(255,158,110,0.26)';
      path([[x + w / 2, -topY], [x + w, -topY], [x + w / 2, -(topY + h)]]);
      c.fill();
    };
    body(0, 366, 214);
    body(-70, 88, 300);
    body(348, 88, 300);
    body(132, 112, 348);
    cone(-84, 116, 90, 300);
    cone(334, 116, 90, 300);
    cone(120, 136, 106, 348);
    // sun-side edges
    c.fillStyle = 'rgba(255,170,112,0.36)';
    c.fillRect(428, -300, 8, 300);
    c.fillRect(236, -348, 7, 348);
    c.fillRect(358, -214, 6, 214);
    // gate
    c.fillStyle = 'rgba(12,5,24,1)';
    path([[158, 0], [158, -90, 216, -90, 216, 0]]);
    c.fill();
    c.fillStyle = 'rgba(255,206,120,0.55)';
    path([[170, 0], [170, -78, 204, -78, 204, 0]]);
    c.fill();
    c.fillStyle = 'rgba(20,8,32,0.9)';
    c.fillRect(180, -46, 14, 46);
    // held up by a prop stick and a sandbag, like everything else here
    c.fillStyle = 'rgba(22,10,38,0.95)';
    c.fillRect(400, -76, 10, 78);
    ell(408, 2, 32, 13, 0);
    c.fill();
    // ground haze creeping up the base, so the mass is not one flat value
    c.fillStyle = lg(0, -360, 0, 4, [[0, 'rgba(150,80,130,0.16)'], [0.55, 'rgba(90,44,100,0.06)'],
      [1, 'rgba(10,4,22,0.5)']]);
    c.fillRect(-100, -460, 560, 466);
    c.restore();

    // Princess Impeach, still in the tower, still waving. The whole joke, in
    // a window 48 px wide.
    const wx = bx + 202, wy = by - 320;
    const win = () => path([[wx - 29, wy + 54], [wx - 29, wy - 38, wx + 29, wy - 38, wx + 29, wy + 54]]);
    c.save();
    glow(46, 'rgba(255,206,120,0.95)');
    win();
    c.fillStyle = '#ffd995';
    c.fill();
    noGlow();
    c.save();
    win();
    c.clip();
    c.fillStyle = 'rgba(255,250,226,0.95)';
    c.fillRect(wx - 30, wy - 40, 60, 34);
    // a small figure, still in there, still waving. Keep it small: a head that
    // fills the window reads as a doorway, not as somebody at a window.
    c.fillStyle = 'rgba(36,12,40,0.95)';
    ell(wx - 4, wy + 16, 10, 11, 0);
    c.fill();
    path([[wx - 18, wy + 58], [wx - 15, wy + 30, wx - 4, wy + 29], [wx + 7, wy + 29, wx + 10, wy + 58]]);
    c.fill();
    stroke([[wx + 7, wy + 30], [wx + 20, wy + 16, wx + 17, wy - 2]], 6, 'rgba(36,12,40,0.95)');
    ell(wx + 17, wy - 6, 5, 5, 0);
    c.fill();
    c.fillStyle = 'rgba(36,12,40,0.95)';
    path([[wx - 13, wy + 6], [wx - 10, wy - 5], [wx - 6, wy + 5], [wx - 3, wy - 7],
      [wx + 1, wy + 5], [wx + 5, wy - 5], [wx + 8, wy + 6]]);
    c.fill();                          // crown
    c.restore();
    c.strokeStyle = 'rgba(14,5,26,0.95)';
    c.lineWidth = 9;
    win();
    c.stroke();
    c.restore();
  }

  // ground shelf
  c.fillStyle = lg(0, GROUND, 0, H, [[0, 'rgba(40,20,64,0.80)'], [1, 'rgba(18,8,34,0.98)']]);
  c.fillRect(0, GROUND, W, H - GROUND);
  c.fillStyle = lg(0, 0, W, 0, [
    [0, 'rgba(255,164,108,0.22)'], [0.62, 'rgba(255,186,120,0.62)'], [1, 'rgba(255,164,108,0.28)']]);
  c.fillRect(0, GROUND - 5, W, 6);
  // a little tuft of scenery so the ground is not a flat shelf
  {
    const r = rngFrom(20117);
    c.fillStyle = 'rgba(12,4,26,0.85)';
    for (let i = 0; i < 26; i++) {
      const gx = r() * W, gy = GROUND + 8 + r() * 118, s = 6 + r() * 16;
      path([[gx, gy], [gx + s * 0.5, gy - s * 1.5, gx + s, gy], [gx + s * 0.5, gy - s * 0.4, gx, gy]]);
      c.fill();
    }
  }

  // ==========================================================================
  // 3. THE FLAG he plants over work he did not do
  // ==========================================================================
  const POLE_B = [1014, 1182], POLE_T = [642, 500];
  {
    const dx = POLE_T[0] - POLE_B[0], dy = POLE_T[1] - POLE_B[1];
    const px = (y) => POLE_B[0] + dx * ((y - POLE_B[1]) / dy);
    // disturbed earth at the base + a shadow thrown away from the sun
    c.save();
    c.globalAlpha = 0.55;
    c.fillStyle = 'rgba(10,4,22,1)';
    ell(918, 1188, 200, 26, -0.06);
    blurFill(16);
    c.restore();
    c.fillStyle = 'rgba(16,7,30,0.95)';
    ell(1014, 1184, 66, 19, 0);
    c.fill();
    c.fillStyle = 'rgba(255,170,112,0.22)';
    ell(1034, 1178, 42, 9, 0);
    c.fill();

    // pole: a real wooden shaft. Banded by hand rather than with a gradient —
    // a horizontal gradient clamps at the far end of a leaning shaft and the
    // whole top goes flat.
    const band = (a, b, col) => {
      path([[POLE_B[0] + a, POLE_B[1]], [POLE_T[0] + a, POLE_T[1]],
        [POLE_T[0] + b, POLE_T[1]], [POLE_B[0] + b, POLE_B[1]]]);
      c.fillStyle = col;
      c.fill();
    };
    band(-19, -7, '#2c1832');
    band(-7, 5, '#5e3c3c');
    band(5, 14, '#a8754f');
    band(14, 19, '#ffcf98');
    path([[POLE_B[0] - 19, POLE_B[1]], [POLE_T[0] - 19, POLE_T[1]],
      [POLE_T[0] + 19, POLE_T[1]], [POLE_B[0] + 19, POLE_B[1]]]);
    ink(5, 'rgba(20,8,28,0.7)');
    // finial
    c.save();
    glow(26, 'rgba(255,204,110,0.85)');
    ell(POLE_T[0] + 1, POLE_T[1] - 14, 18, 18, 0);
    c.fillStyle = GOLD;
    c.fill();
    noGlow();
    c.restore();
    ell(POLE_T[0] + 1, POLE_T[1] - 14, 18, 18, 0);
    c.fillStyle = rg(POLE_T[0] - 6, POLE_T[1] - 21, 2, POLE_T[0] + 1, POLE_T[1] - 14, 24,
      [[0, '#fff6d4'], [0.4, GOLD_HI], [1, '#8a5a10']]);
    c.fill();
    ink(4.5, 'rgba(96,58,6,0.8)');

    // pennant: two waved edges and a swallow tail, so it reads as cloth
    const y0 = POLE_T[1] + 10;
    const yB = y0 + 168;
    const pen = () => {
      path([
        [px(y0) + 6, y0],
        [840, y0 - 24, 986, y0 + 6, 1148, y0 + 32],
        [1068, y0 + 94],
        [1152, y0 + 164],
        [990, y0 + 184, 838, y0 + 166, px(yB) + 6, yB],
      ]);
    };
    c.save();
    glow(32, 'rgba(255,140,100,0.45)');
    pen();
    c.fillStyle = lg(650, y0, 1150, y0 + 170, [[0, '#c14152'], [0.55, '#93283c'], [1, '#59122a']]);
    c.fill();
    noGlow();
    c.restore();
    c.save();
    pen();
    c.clip();
    // a fold running through it
    c.fillStyle = 'rgba(30,6,20,0.34)';
    path([[912, y0 - 40], [956, y0 + 60, 928, y0 + 230], [982, y0 + 230], [968, y0 + 60, 956, y0 - 40]]);
    blurFill(14);
    c.fillStyle = 'rgba(255,180,140,0.20)';
    path([[982, y0 - 40], [1026, y0 + 60, 998, y0 + 230], [1038, y0 + 230], [1030, y0 + 60, 1022, y0 - 40]]);
    blurFill(16);
    c.fillStyle = 'rgba(255,200,146,0.26)';
    c.fillRect(620, y0 - 12, 560, 18);
    c.restore();
    pen();
    ink(6, 'rgba(24,6,18,0.75)');
    // hoist ties, so the cloth is actually attached to the pole
    for (let i = 0; i < 3; i++) {
      const yy = y0 + 22 + i * 62;
      stroke([[px(yy) - 16, yy], [px(yy) + 20, yy]], 7, 'rgba(240,208,160,0.75)');
    }

    // the line, auto-fitted so it can never run off the cloth
    const L1 = 'MISSION FAILED', L2 = 'SUCCESSFULLY';
    const boxL = 726, boxR = 1062;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.letterSpacing = '2px';
    let fs = 62;
    for (;;) {
      c.font = '900 ' + fs + 'px "Lato", sans-serif';
      const w = Math.max(c.measureText(L1).width, c.measureText(L2).width);
      if (w <= boxR - boxL || fs <= 20) break;
      fs -= 1;
    }
    c.font = '900 ' + fs + 'px "Lato", sans-serif';
    const ly1 = y0 + 58, ly2 = y0 + 58 + fs * 1.12;
    c.fillStyle = 'rgba(40,4,16,0.7)';
    c.fillText(L1, boxL + 3, ly1 + 4);
    c.fillText(L2, boxL + 13, ly2 + 4);
    c.fillStyle = '#ffe6ae';
    c.fillText(L1, boxL, ly1);
    c.fillStyle = '#ffc45c';
    c.fillText(L2, boxL + 10, ly2);
    c.letterSpacing = '0px';
  }

  // ==========================================================================
  // 4. COINS — the kingdom's certified savings, on their way down
  // ==========================================================================
  const coin = (x, y, r, tilt, hot) => {
    const rx = Math.max(r * 0.2, Math.abs(Math.cos(tilt)) * r);
    c.save();
    c.translate(x, y);
    c.rotate(Math.sin(tilt * 0.5) * 0.32);
    ell(0, 0, rx, r, 0);
    c.fillStyle = lg(-rx, -r, rx, r, [[0, '#fff5cc'], [0.34, GOLD], [1, '#a26c16']]);
    c.fill();
    ink(Math.max(1.6, r * 0.15), 'rgba(92,52,6,0.88)');
    ell(0, 0, rx * 0.56, r * 0.56, 0);
    ink(Math.max(1, r * 0.09), 'rgba(255,238,172,0.55)');
    if (hot) {
      ell(-rx * 0.32, -r * 0.38, rx * 0.3, r * 0.2, -0.5);
      c.fillStyle = 'rgba(255,255,238,0.95)';
      c.fill();
    }
    c.restore();
  };
  // a sparse drift behind him, kept clear of the pennant and the title
  {
    const r = rngFrom(4711);
    for (let i = 0; i < 20; i++) {
      const x = r() * (W + 200) - 100;
      const y = 500 + r() * (H - 440);
      if (x < 1180 && y < 740) continue;
      const rad = 11 + r() * 12;
      c.save();
      c.globalAlpha = 0.6;
      glow(rad * 1.3, 'rgba(255,200,96,0.55)');
      coin(x, y, rad, r() * 6.28, r() > 0.55);
      c.restore();
    }
    noGlow();
  }

  // ==========================================================================
  // 5. THE HERO — Super Mario Estrada, drawn for the poster, not the sprite
  // ==========================================================================
  const HX = 1414, HY = 742, R = 160;
  const u = R / 100;

  const RED = P.estradaRed, RED_D = P.estradaRedDark, RED_HI = '#f4776a';
  const RED_INK = '#530b14';
  const BLU = P.estradaBlue, BLU_D = P.estradaBlueDark, BLU_HI = '#4d76dc';
  const BLU_INK = '#0b1740';
  const WARM = 'rgba(255,198,120,';
  const COOL = 'rgba(150,132,240,';
  const SKIN_INK = 'rgba(92,40,14,0.88)';
  const GLOVE = '#f4efe4', GLOVE_INK = 'rgba(88,78,62,0.8)';

  const SH_L = [HX - 300, 998];    // viewer-left deltoid (flag arm)
  const SH_R = [HX + 288, 1030];   // viewer-right deltoid (sack arm)
  const FIST_L = [778, 746];       // sits exactly on the pole
  const FIST_R = [1946, 926];

  // backlight halo: separates the whole figure from the dusk
  c.fillStyle = rg(HX + 60, HY + 200, 60, HX + 60, HY + 220, 700, [
    [0, 'rgba(255,198,124,0.34)'], [0.5, 'rgba(255,150,110,0.13)'], [1, 'rgba(255,150,110,0)'],
  ]);
  c.fillRect(0, 0, W, H);

  // his shadow, thrown away from the sun
  c.save();
  c.globalAlpha = 0.5;
  c.fillStyle = 'rgba(14,5,28,1)';
  ell(HX - 190, GROUND + 108, 620, 74, -0.05);
  blurFill(30);
  c.restore();

  // ---- torso --------------------------------------------------------------
  const TB = H + 40;
  const torso = () => {
    path([
      [HX - 322, 1058],
      [HX - 342, 976, HX - 212, 920, HX - 30, 916],
      [HX + 160, 912, HX + 326, 962, HX + 310, 1056],
      [HX + 340, 1156, HX + 360, TB, HX + 360, TB],
      [HX - 370, TB],
      [HX - 370, 1164, HX - 338, 1118, HX - 322, 1058],
    ]);
  };
  torso();
  c.fillStyle = lg(HX - 370, 916, HX + 360, 1244, [
    [0, RED_HI], [0.24, RED], [0.62, RED_D], [1, '#5c0e18'],
  ]);
  c.fill();
  torso();
  ink(9, RED_INK);
  c.save();
  torso();
  c.clip();
  // key light on the near shoulder
  c.fillStyle = rg(HX - 190, 954, 20, HX - 150, 1014, 400, [
    [0, 'rgba(255,168,150,0.36)'], [0.6, 'rgba(255,168,150,0.05)'], [1, 'rgba(255,168,150,0)'],
  ]);
  c.fillRect(HX - 384, 894, 764, 420);
  // sun rim down the right edge
  c.fillStyle = lg(HX + 190, 0, HX + 354, 0, [[0, WARM + '0)'], [1, WARM + '0.9)']]);
  c.fillRect(HX + 180, 894, 194, 420);
  // cool bounce on the left
  c.fillStyle = lg(HX - 370, 0, HX - 284, 0, [[0, COOL + '0.4)'], [1, COOL + '0)']]);
  c.fillRect(HX - 376, 914, 100, 400);
  // shirt folds
  c.strokeStyle = 'rgba(74,6,16,0.3)';
  c.lineWidth = 13;
  for (let i = 0; i < 3; i++) {
    c.beginPath();
    c.moveTo(HX - 290 + i * 30, 1060 + i * 26);
    c.quadraticCurveTo(HX - 190 + i * 34, 1166 + i * 24, HX - 278 + i * 34, 1278);
    c.stroke();
  }
  c.restore();

  // ---- arms ---------------------------------------------------------------
  const sleeve = (p0, p1, p2, w0, w1, rimSide) => {
    limbShape(p0, p1, p2, w0 + 14, w1 + 14);
    c.fillStyle = RED_INK;
    c.fill();
    limbShape(p0, p1, p2, w0, w1);
    c.fillStyle = lg(p0[0], p0[1] - 120, p2[0], p2[1] + 120,
      [[0, RED_HI], [0.34, RED], [1, RED_D]]);
    c.fill();
    c.save();
    limbShape(p0, p1, p2, w0, w1);
    c.clip();
    // form shadow along the underside
    const mx = (p0[0] + p2[0]) / 2, my = (p0[1] + p2[1]) / 2;
    c.fillStyle = rg(mx - 40, my - 70, 10, mx, my, Math.max(w0, w1) * 2.1,
      [[0, 'rgba(255,170,152,0.16)'], [0.5, 'rgba(120,10,22,0.0)'], [1, 'rgba(90,6,18,0.6)']]);
    c.fillRect(Math.min(p0[0], p2[0]) - 260, Math.min(p0[1], p2[1]) - 260,
      Math.abs(p2[0] - p0[0]) + 520, Math.abs(p2[1] - p0[1]) + 520);
    c.restore();
    // the sun rim: a narrow edge, hugging the silhouette, not a stripe
    c.save();
    limbShape(p0, p1, p2, w0, w1);
    c.clip();
    const off = rimSide * 0.64;
    limbShape([p0[0] + w0 * off, p0[1]], [p1[0] + w0 * off, p1[1]], [p2[0] + w1 * off, p2[1]],
      w0 * 0.16, w1 * 0.16);
    c.fillStyle = WARM + '0.9)';
    blurFill(3);
    c.restore();
    limbShape(p0, p1, p2, w0, w1);
    ink(7, RED_INK);
  };
  // flag arm: long, near-straight, reaching up and to the left
  sleeve(SH_L, [HX - 490, 984], FIST_L, 138, 96, 1);
  // sack arm: short and bent, taking the weight
  sleeve(SH_R, [HX + 448, 1092], FIST_R, 134, 96, 1);

  // ---- the takings --------------------------------------------------------
  const SACKX = 2046, SACKY = 1146, SNX = 1950, SNY = 1046;
  {
    const sack = () => {
      path([
        [SNX - 44, SNY + 10],
        [SACKX - 206, SACKY - 118, SACKX - 174, SACKY + 14, SACKX - 148, SACKY + 106],
        [SACKX - 122, SACKY + 200, SACKX + 120, SACKY + 206, SACKX + 152, SACKY + 102],
        [SACKX + 186, SACKY, SACKX + 166, SACKY - 120, SNX + 54, SNY + 10],
      ]);
    };
    c.save();
    glow(58, 'rgba(255,178,80,0.5)');
    sack();
    c.fillStyle = '#a8802f';
    c.fill();
    noGlow();
    c.save();
    sack();
    c.clip();
    // warm canvas — rich, but a step cooler and duller than the coins, so the
    // coins stay the hottest thing on the card
    c.fillStyle = rg(SACKX - 116, SACKY - 128, 14, SACKX - 30, SACKY - 10, 330, [
      [0, '#ffeeb8'], [0.22, '#dcb464'], [0.54, '#a67d31'], [0.82, '#6a4c16'], [1, '#3a2708'],
    ]);
    c.fillRect(SACKX - 340, SACKY - 360, 680, 720);
    // folds: a dark crease with a lit edge riding alongside it reads as cloth
    const fold = (x0, y0, x1, y1, x2, y2, w) => {
      stroke([[x0, y0], [x1, y1, x2, y2]], w, 'rgba(62,38,6,0.40)');
      stroke([[x0 + w * 0.72, y0], [x1 + w * 0.72, y1, x2 + w * 0.72, y2]], w * 0.32, 'rgba(255,238,186,0.28)');
    };
    fold(SACKX - 104, SACKY - 128, SACKX - 174, SACKY + 24, SACKX - 130, SACKY + 186, 26);
    fold(SACKX - 34, SACKY - 136, SACKX - 66, SACKY + 30, SACKX - 30, SACKY + 200, 20);
    fold(SACKX + 52, SACKY - 132, SACKX + 92, SACKY + 20, SACKX + 58, SACKY + 194, 22);
    fold(SACKX + 116, SACKY - 112, SACKX + 166, SACKY + 30, SACKX + 130, SACKY + 168, 18);
    // heavy underside
    c.fillStyle = lg(0, SACKY + 30, 0, SACKY + 240, [[0, 'rgba(34,20,4,0)'], [1, 'rgba(28,16,3,0.78)']]);
    c.fillRect(SACKX - 260, SACKY - 340, 520, 700);
    // sun rim
    c.fillStyle = lg(SACKX + 60, 0, SACKX + 200, 0, [[0, WARM + '0)'], [1, WARM + '0.98)']]);
    c.fillRect(SACKX + 40, SACKY - 360, 240, 720);
    // cool bounce on the shadow side
    c.fillStyle = lg(SACKX - 200, 0, SACKX - 100, 0, [[0, COOL + '0.30)'], [1, COOL + '0)']]);
    c.fillRect(SACKX - 240, SACKY - 360, 160, 720);
    // canvas tooth
    const rr = rngFrom(5521);
    for (let i = 0; i < 1600; i++) {
      const gx = SACKX - 220 + rr() * 440, gy = SACKY - 190 + rr() * 430;
      c.fillStyle = rr() > 0.5 ? 'rgba(70,44,6,0.10)' : 'rgba(255,240,200,0.09)';
      c.fillRect(gx, gy, 1.3 + rr() * 2.1, 1.3 + rr() * 2.1);
    }
    // the '$' the kingdom's money is stencilled with
    c.save();
    c.translate(SACKX - 10, SACKY + 46);
    c.rotate(0.07);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = '900 200px "Lato", sans-serif';
    c.fillStyle = 'rgba(58,34,2,0.55)';
    c.fillText('$', 9, 9);
    c.fillStyle = 'rgba(255,244,204,0.5)';
    c.fillText('$', 0, 0);
    c.restore();
    c.restore();
    sack();
    ink(9, 'rgba(56,34,4,0.9)');

    // gathered neck: the fabric bunches out of the rope just under the fist
    const gather = (ox, w, lean) => {
      path([[SNX + ox, SNY + 8], [SNX + ox + lean - 5, SNY - 44, SNX + ox + lean, SNY - 56],
        [SNX + ox + lean + w, SNY - 46, SNX + ox + w, SNY + 8]]);
      c.fillStyle = lg(SNX + ox, SNY - 56, SNX + ox + w, SNY + 8, [[0, '#eccb84'], [1, '#7d5b1c']]);
      c.fill();
      ink(6, 'rgba(56,34,4,0.85)');
    };
    gather(-54, 38, -12);
    gather(-19, 38, -2);
    gather(16, 40, 10);
    c.fillStyle = 'rgba(255,236,180,0.45)';
    path([[SNX + 24, SNY + 6], [SNX + 36, SNY - 42, SNX + 50, SNY - 48],
      [SNX + 56, SNY - 24, SNX + 54, SNY + 6]]);
    c.fill();
    // rope
    stroke([[SNX - 58, SNY + 4], [SNX + 2, SNY + 30, SNX + 62, SNY + 4]], 28, '#5f3c0b');
    stroke([[SNX - 56, SNY - 9], [SNX + 2, SNY + 16, SNX + 60, SNY - 9]], 18, '#8a5a10');
    stroke([[SNX - 52, SNY - 11], [SNX + 2, SNY + 10, SNX + 56, SNY - 11]], 5, 'rgba(255,224,158,0.6)');
    stroke([[SNX + 52, SNY + 12], [SNX + 88, SNY + 38, SNX + 76, SNY + 78]], 11, '#5f3c0b');
    c.restore();
  }

  // coins tumbling out of the sack and bouncing away
  {
    const r = rngFrom(31337);
    const spill = [
      [1874, 1102, 30], [1816, 1162, 25], [1744, 1210, 33], [1672, 1250, 22],
      [1890, 1180, 20], [1800, 1246, 27], [1928, 1238, 24],
      // a couple that made it all the way across the courtyard
      [566, 1204, 21], [684, 1244, 17],
    ];
    for (const [x, y, rad] of spill) {
      c.save();
      glow(34, 'rgba(255,206,110,0.85)');
      coin(x, y, rad, r() * 6.28, true);
      c.restore();
    }
    noGlow();
  }

  // ---- overalls: bib, straps, gold buttons, the deed in the pocket ---------
  {
    const bx = HX - 4, by = 1146;
    const bib = () => path([[bx - 218, by - 76], [bx + 218, by - 76], [bx + 250, TB], [bx - 250, TB]]);
    bib();
    c.fillStyle = lg(bx - 246, by - 76, bx + 250, by + 300, [
      [0, BLU_HI], [0.28, BLU], [0.74, BLU_D], [1, '#0c1840'],
    ]);
    c.fill();
    bib();
    ink(9, BLU_INK);
    c.save();
    bib();
    c.clip();
    c.strokeStyle = 'rgba(214,226,255,0.24)';
    c.lineWidth = 6;
    c.setLineDash([20, 15]);
    c.beginPath();
    c.moveTo(bx - 198, by - 56); c.lineTo(bx + 198, by - 56);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = lg(bx + 150, 0, bx + 252, 0, [[0, WARM + '0)'], [1, WARM + '0.72)']]);
    c.fillRect(bx + 140, by - 90, 120, 400);
    c.fillStyle = lg(bx - 250, 0, bx - 170, 0, [[0, COOL + '0.32)'], [1, COOL + '0)']]);
    c.fillRect(bx - 252, by - 90, 100, 400);
    // the bib pocket, with the kingdom's savings not quite fitting in it
    coin(bx + 96, by + 88, 40, 0.5, true);
    coin(bx + 168, by + 70, 44, 5.6, true);
    c.save();
    c.translate(bx + 138, by + 116);
    c.rotate(0.05);
    c.fillStyle = lg(0, -22, 0, 120, [[0, '#2a3f88'], [1, '#0f1a48']]);
    path([[-118, -22], [118, -22], [110, 130], [-110, 130]]);
    c.fill();
    ink(7, 'rgba(5,8,26,0.9)');
    c.fillStyle = 'rgba(214,226,255,0.3)';
    c.fillRect(-118, -22, 236, 9);
    c.restore();
    c.restore();
    // straps — they run up under the collar, which is drawn later and hides
    // their tops, so they read as straps and not as blue epaulettes
    const strap = (sx, dir, topX, topY) => {
      const pts = [[sx + dir * 6, by - 62], [sx + dir * 24, topY + 78, topX, topY]];
      stroke(pts, 50, BLU_INK, 'butt');
      stroke(pts, 39, lg(sx, by - 76, topX, topY, [[0, BLU], [1, BLU_HI]]), 'butt');
      stroke([[sx + dir * 6 + dir * 13, by - 62], [sx + dir * 24 + dir * 13, topY + 78, topX + dir * 13, topY]],
        9, dir > 0 ? WARM + '0.6)' : COOL + '0.35)', 'butt');
    };
    strap(bx - 218, -1, bx - 128, 952);
    strap(bx + 218, 1, bx + 128, 972);
    // gold buttons
    const button = (x, y, rr) => {
      glow(30, 'rgba(255,198,90,0.85)');
      ell(x, y, rr, rr, 0);
      c.fillStyle = GOLD;
      c.fill();
      noGlow();
      ell(x, y, rr, rr, 0);
      c.fillStyle = rg(x - rr * 0.4, y - rr * 0.45, 2, x, y, rr * 1.5, [[0, '#fff8d8'], [0.34, GOLD_HI], [1, '#8a5a10']]);
      c.fill();
      ink(4.5, 'rgba(96,58,6,0.8)');
      ell(x - rr * 0.34, y - rr * 0.38, rr * 0.3, rr * 0.22, -0.6);
      c.fillStyle = 'rgba(255,255,240,0.95)';
      c.fill();
    };
    button(bx - 172, by - 40, 33);
    button(bx + 172, by - 40, 33);
  }

  // ---- gloves -------------------------------------------------------------
  // A fist, actually built: knuckle ridge, three finger bands with creases,
  // the thumb lying across them, and a cuff. Lit up-left, gold rim right.
  // Knuckles scalloped along the TOP edge, fingers as VERTICAL columns, and a
  // thumb lying across the front. Horizontal finger bands were what made the
  // first pass read as a volleyball.
  const fist = (x, y, r, rot, flip) => {
    c.save();
    c.translate(x, y);
    c.rotate(rot);
    c.scale(flip || 1, 1);
    const K0 = -r * 0.80, KS = r * 0.42, KY = -r * 0.60;
    const hand = () => {
      c.beginPath();
      c.moveTo(-r * 0.94, r * 0.14);
      c.bezierCurveTo(-r * 1.02, -r * 0.16, -r * 0.98, -r * 0.50, K0, KY);
      for (let i = 0; i < 4; i++) {
        const x0 = K0 + i * KS;
        c.quadraticCurveTo(x0 + r * 0.10, KY - r * 0.30, x0 + KS, KY + (i === 3 ? -r * 0.02 : 0));
      }
      c.bezierCurveTo(r * 1.04, -r * 0.42, r * 1.06, r * 0.02, r * 0.94, r * 0.34);
      c.bezierCurveTo(r * 0.84, r * 0.66, r * 0.30, r * 0.90, -r * 0.22, r * 0.86);
      c.bezierCurveTo(-r * 0.64, r * 0.82, -r * 0.92, r * 0.54, -r * 0.94, r * 0.14);
      c.closePath();
    };
    hand();
    c.fillStyle = GLOVE;
    c.fill();
    c.save();
    hand();
    c.clip();
    c.fillStyle = rg(-r * 0.46, -r * 0.62, r * 0.06, -r * 0.06, r * 0.05, r * 1.85,
      [[0, '#fffdf6'], [0.30, GLOVE], [0.70, '#c1b8a6'], [1, '#877e6e']]);
    c.fillRect(-r * 1.4, -r * 1.4, r * 2.8, r * 2.8);
    // the light sitting on each knuckle
    for (let i = 0; i < 4; i++) {
      ell(K0 + i * KS + KS * 0.5, KY - r * 0.10, r * 0.17, r * 0.13, 0);
      c.fillStyle = 'rgba(255,255,252,0.6)';
      blurFill(4);
    }
    // fingers: vertical columns with a crease between each
    for (let i = 1; i < 4; i++) {
      const vx = K0 + i * KS;
      stroke([[vx, KY + r * 0.02], [vx - r * 0.05, r * 0.16, vx - r * 0.02, r * 0.5]],
        r * 0.065, 'rgba(122,110,92,0.5)');
      stroke([[vx + r * 0.07, KY + r * 0.04], [vx + r * 0.02, r * 0.16, vx + r * 0.05, r * 0.5]],
        r * 0.05, 'rgba(255,255,250,0.42)');
    }
    // the knuckle shelf: one soft shadow under the ridge
    c.fillStyle = 'rgba(112,100,84,0.22)';
    path([[-r, KY + r * 0.18], [0, KY + r * 0.34, r, KY + r * 0.16],
      [r, KY + r * 0.4], [-r, KY + r * 0.42]]);
    blurFill(8);
    // the thumb, lying across the front
    const thumb = () => {
      path([[-r * 0.34, r * 0.72],
        [r * 0.04, r * 0.58, r * 0.42, r * 0.40, r * 0.70, r * 0.04],
        [r * 0.92, r * 0.22, r * 0.80, r * 0.54],
        [r * 0.46, r * 0.84, r * 0.02, r * 0.92, -r * 0.34, r * 0.72]]);
    };
    c.save();
    c.translate(-r * 0.04, -r * 0.10);
    thumb();
    c.fillStyle = 'rgba(112,100,84,0.34)';
    blurFill(9);
    c.restore();
    thumb();
    c.fillStyle = '#fbf7ec';
    c.fill();
    ink(r * 0.07, 'rgba(116,104,86,0.7)');
    stroke([[r * 0.06, r * 0.66], [r * 0.4, r * 0.5, r * 0.66, r * 0.2]], r * 0.06,
      'rgba(255,255,252,0.5)');
    // rims
    c.fillStyle = lg(r * 0.34, 0, r * 1.05, 0, [[0, WARM + '0)'], [1, WARM + '0.95)']]);
    c.fillRect(r * 0.2, -r * 1.4, r * 1.3, r * 2.8);
    c.fillStyle = lg(-r * 1.0, 0, -r * 0.52, 0, [[0, COOL + '0.45)'], [1, COOL + '0)']]);
    c.fillRect(-r * 1.4, -r * 1.4, r * 0.8, r * 2.8);
    c.restore();
    hand();
    ink(r * 0.085, GLOVE_INK);
    // cuff
    c.save();
    c.translate(-r * 0.06, r * 0.9);
    c.rotate(0.1);
    path([[-r * 0.74, -r * 0.06], [0, r * 0.16, r * 0.74, -r * 0.08],
      [r * 0.78, r * 0.2], [0, r * 0.44, -r * 0.78, r * 0.2]]);
    c.fillStyle = lg(-r * 0.8, 0, r * 0.8, 0, [[0, '#b3aa9a'], [0.4, '#ded6c6'], [1, '#fbe6c0']]);
    c.fill();
    ink(r * 0.075, GLOVE_INK);
    stroke([[-r * 0.6, r * 0.06], [0, r * 0.24, r * 0.6, r * 0.02]], r * 0.05, 'rgba(255,255,250,0.5)');
    c.restore();
    c.restore();
  };
  fist(FIST_L[0], FIST_L[1], 90, -0.5, -1);
  fist(FIST_R[0], FIST_R[1], 86, 0.34, 1);

  // ---- neck & collar ------------------------------------------------------
  {
    const ny = HY + 162;
    path([[HX - 74, ny - 36], [HX + 82, ny - 36], [HX + 100, 1012], [HX - 96, 1012]]);
    c.fillStyle = lg(HX - 70, ny, HX + 90, ny + 120, [[0, '#e9b27c'], [0.5, '#c9884f'], [1, '#84532a']]);
    c.fill();
    ink(8, SKIN_INK);
    c.save();
    c.beginPath();
    c.rect(HX - 128, ny - 42, 258, 132);
    c.clip();
    // the jaw's cast shadow — this is what detaches the head from the body
    c.fillStyle = 'rgba(86,34,10,0.72)';
    path([[HX - 98, ny - 42], [HX + 102, ny - 42], [HX + 86, ny + 62, HX - 80, ny + 62, HX - 98, ny - 42]]);
    blurFill(11);
    // sternocleidomastoid
    stroke([[HX - 48, ny - 20], [HX - 26, ny + 30, HX + 6, ny + 74]], 9, 'rgba(126,66,26,0.22)');
    c.fillStyle = lg(HX + 44, 0, HX + 102, 0, [[0, WARM + '0)'], [1, WARM + '0.92)']]);
    c.fillRect(HX + 36, ny - 42, 80, 190);
    c.restore();
    // collar
    path([[HX - 166, 950], [HX - 62, 1014, HX + 68, 1014, HX + 170, 950],
      [HX + 174, 1000], [HX + 64, 1062, HX - 62, 1062, HX - 170, 998]]);
    c.fillStyle = lg(HX - 144, 0, HX + 144, 0, [[0, '#8d1620'], [0.5, RED_D], [1, '#e8695c']]);
    c.fill();
    ink(8, RED_INK);
    stroke([[HX - 134, 976], [HX - 42, 1032, HX + 72, 1028]], 6, 'rgba(255,150,130,0.3)');
  }

  // ==========================================================================
  // 6. THE HEAD
  // Local space: skull radius = 100 units. The head is turned ~13 degrees to
  // the viewer's right, so the NEAR cheek is on the left (big, lit by the key)
  // and the FAR side is on the right (compressed, in shadow, sun rim on the
  // silhouette). Eye spacing follows that turn: near-eye-to-nose is 1.5x
  // nose-to-far-eye. The visible ear is the near one, on the left.
  // ==========================================================================
  c.save();
  c.translate(HX, HY);
  c.rotate(-0.055);
  c.scale(u * 0.94, u * 1.03);   // a shade narrower than tall: no pumpkin

  const skull = () => {
    path([
      [4, -110],
      [64, -110, 104, -76, 108, -32],               // far temple
      [112, -8, 110, 22, 100, 46],                  // far cheekbone
      [90, 68, 72, 90, 48, 102],                    // far jaw
      [30, 112, 8, 118, -12, 116],                  // chin
      [-42, 111, -76, 92, -96, 60],                 // near jaw
      [-108, 38, -114, 4, -112, -32],               // near cheekbone (widest)
      [-110, -78, -58, -110, 4, -110],
    ]);
  };

  // near ear (viewer left), behind the jaw
  {
    path([[-102, -34], [-134, -40, -140, 22, -110, 34], [-100, 38, -96, 12, -98, -20]]);
    c.fillStyle = lg(-140, -20, -96, 20, [[0, '#e3ab77'], [1, '#a06430']]);
    c.fill();
    ink(7, 'rgba(72,28,6,0.9)');
    stroke([[-118, -22], [-126, 0, -116, 16, -106, 18]], 4.2, 'rgba(120,58,22,0.6)');
    stroke([[-122, 14], [-116, 24, -108, 26]], 3.4, 'rgba(120,58,22,0.4)');
    c.fillStyle = 'rgba(226,110,70,0.30)';
    ell(-118, 4, 12, 18, 0.1);
    blurFill(8);
  }

  // --- skull: base, form light, an actual shadow shape, rims ---------------
  skull();
  c.fillStyle = '#e8ab74';
  c.fill();
  c.save();
  skull();
  c.clip();

  // form light from the upper left; note the vertical falloff too, so the
  // near cheek is modelled rather than one broad flat pool
  c.fillStyle = rg(-56, -52, 6, -30, -14, 168, [
    [0, '#fff6e2'], [0.18, '#ffdfb4'], [0.42, '#f1b47c'], [0.70, '#b96f34'], [1, '#7a3d12'],
  ]);
  c.fillRect(-150, -150, 300, 300);
  c.fillStyle = lg(0, -40, 0, 130, [[0, 'rgba(120,50,12,0)'], [1, 'rgba(104,40,10,0.42)']]);
  c.fillRect(-150, -150, 300, 300);

  // the shadow half — an explicit shape with a soft terminator
  c.fillStyle = 'rgba(106,38,8,0.56)';
  path([[46, -116], [70, -50, 84, 10, 74, 60], [64, 92, 44, 110, 22, 120], [160, 120], [160, -116]]);
  blurFill(27);
  // occlusion under the cheekbone, on the shadow side
  c.fillStyle = 'rgba(104,38,8,0.30)';
  path([[26, 30], [58, 34, 82, 24], [78, 54, 52, 70, 26, 62]]);
  blurFill(15);
  // under-jaw occlusion
  c.fillStyle = 'rgba(88,28,6,0.62)';
  path([[-70, 84], [-24, 118, 30, 116, 84, 76], [84, 170], [-70, 170]]);
  blurFill(13);
  // cheekbone plane on the near side + blush
  ell(-58, -4, 34, 21, -0.28);
  c.fillStyle = 'rgba(255,248,226,0.42)';
  blurFill(15);
  ell(-62, 26, 30, 16, -0.1);
  c.fillStyle = 'rgba(226,104,72,0.24)';
  blurFill(11);
  ell(4, 108, 24, 14, 0);
  c.fillStyle = 'rgba(255,246,222,0.26)';
  blurFill(12);
  // the brim's cast shadow, kept above the brows so the eyes stay open
  c.fillStyle = 'rgba(64,20,50,0.55)';
  path([[-118, -118], [160, -118], [160, -52], [78, -40, -40, -38, -118, -60]]);
  blurFill(8);

  // skin tooth — the single thing that stops canvas gradients reading as wax
  {
    const rr = rngFrom(2029);
    for (let i = 0; i < 2400; i++) {
      const gx = -125 + rr() * 250, gy = -125 + rr() * 250;
      const a = 0.035 + rr() * 0.055;
      c.fillStyle = rr() > 0.46
        ? 'rgba(122,58,20,' + a.toFixed(3) + ')'
        : 'rgba(255,234,202,' + a.toFixed(3) + ')';
      const s = 0.9 + rr() * 1.5;
      c.fillRect(gx, gy, s, s);
    }
    for (let i = 0; i < 14; i++) {
      ell(-100 + rr() * 200, -90 + rr() * 190, 10 + rr() * 22, 8 + rr() * 16, rr() * 3);
      c.fillStyle = rr() > 0.5 ? 'rgba(196,104,54,0.10)' : 'rgba(255,232,198,0.10)';
      blurFill(11);
    }
  }

  // rims: hot gold from the sun on the right, cool sky bounce on the left.
  // Narrow. A wide rim stops being a rim and becomes a plastic overlay.
  c.fillStyle = lg(88, 0, 115, 0, [[0, WARM + '0)'], [1, 'rgba(255,232,172,0.95)']]);
  c.fillRect(84, -80, 36, 200);
  c.fillStyle = lg(0, 96, 0, 122, [[0, WARM + '0)'], [1, WARM + '0.34)']]);
  c.fillRect(14, 96, 92, 30);
  c.fillStyle = lg(-114, 0, -78, 0, [[0, COOL + '0.5)'], [1, COOL + '0)']]);
  c.fillRect(-118, -100, 44, 226);
  c.restore();

  // contour: heavy where the form turns away, nearly gone on the lit rim
  skull();
  ink(7.5, lg(-112, 0, 112, 0, [
    [0, 'rgba(150,74,26,0.30)'], [0.28, 'rgba(70,26,6,0.92)'],
    [0.74, 'rgba(70,26,6,0.88)'], [1, 'rgba(186,100,34,0.28)'],
  ]));
  // an explicit hot edge, clipped to the head so it stays a silhouette edge
  c.save();
  skull();
  c.clip();
  stroke([[105, -58], [113, -8, 109, 24], [103, 50, 87, 74, 65, 92]], 9,
    'rgba(255,236,186,0.9)');
  c.restore();
  // jaw / chin structure
  stroke([[-88, 66], [-58, 96, -14, 104]], 4.6, 'rgba(104,46,12,0.34)');
  stroke([[-4, 100], [-4, 110]], 4.2, 'rgba(112,52,16,0.4)');

  // --- eyes ----------------------------------------------------------------
  // Both look slightly out at the viewer even though the head is turned away.
  const eye = (ex, ey, w, h, lid, gaze) => {
    // socket / brow-ridge shadow
    c.save();
    ell(ex + 2, ey - h * 0.5, w * 1.34, h * 2.1, 0);
    c.fillStyle = 'rgba(128,58,22,0.26)';
    blurFill(13);
    c.restore();
    const almond = () => {
      path([
        [ex - w, ey + 3],
        [ex - w * 0.56, ey - h * 1.36, ex + w * 0.6, ey - h * 1.30, ex + w, ey - 5],
        [ex + w * 0.56, ey + h * 1.18, ex - w * 0.58, ey + h * 1.26, ex - w, ey + 3],
      ]);
    };
    almond();
    c.fillStyle = '#f7f1e4';
    c.fill();
    c.save();
    almond();
    c.clip();
    c.fillStyle = lg(0, ey - h * 1.3, 0, ey + h * 1.3,
      [[0, 'rgba(104,66,42,0.62)'], [0.44, 'rgba(104,66,42,0.05)'], [1, 'rgba(146,100,66,0.24)']]);
    c.fillRect(ex - w * 1.4, ey - h * 2.6, w * 2.8, h * 5.2);
    const ir = h * 1.12, icx = ex + gaze, icy = ey + 2;
    ell(icx, icy, ir, ir, 0);
    c.fillStyle = rg(icx - ir * 0.32, icy - ir * 0.36, ir * 0.06, icx, icy, ir * 1.24,
      [[0, '#d09c53'], [0.46, '#84532a'], [0.86, '#3a220d'], [1, '#201206']]);
    c.fill();
    c.strokeStyle = 'rgba(232,186,120,0.4)';
    c.lineWidth = 1.7;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU + 0.2;
      c.beginPath();
      c.moveTo(icx + Math.cos(a) * ir * 0.34, icy + Math.sin(a) * ir * 0.34);
      c.lineTo(icx + Math.cos(a) * ir * 0.88, icy + Math.sin(a) * ir * 0.88);
      c.stroke();
    }
    ell(icx, icy, ir, ir, 0);
    ink(4.2, 'rgba(26,10,3,0.9)');                    // limbal ring
    ell(icx, icy, ir * 0.42, ir * 0.42, 0);
    c.fillStyle = '#0f0803';
    c.fill();
    // catchlight from the key, and the warm bounce from the sunset
    ell(icx - ir * 0.42, icy - ir * 0.44, ir * 0.32, ir * 0.25, -0.5);
    c.fillStyle = 'rgba(255,255,253,1)';
    c.fill();
    ell(icx + ir * 0.5, icy + ir * 0.4, ir * 0.17, ir * 0.13, 0);
    c.fillStyle = 'rgba(255,204,142,0.66)';
    c.fill();
    // the dropped lid — smug, not sleepy
    c.fillStyle = lg(0, ey - h * 2, 0, ey - h * lid, [[0, '#c07c48'], [1, '#f0bb88']]);
    c.fillRect(ex - w * 1.4, ey - h * 2.8, w * 2.8, h * 2.8 - h * lid);
    c.restore();
    almond();
    ink(5, 'rgba(62,22,6,0.88)');
    // lash line, thickening outward
    stroke([[ex - w * 1.04, ey - h * lid + 5], [ex, ey - h * lid - 8, ex + w * 1.05, ey - h * lid - 2]],
      8.5, '#221104');
    // lid crease and the wet line under the eye
    stroke([[ex - w * 0.88, ey - h * 1.62], [ex, ey - h * 2.12, ex + w * 0.94, ey - h * 1.54]],
      3.6, 'rgba(134,68,28,0.5)');
    stroke([[ex - w * 0.82, ey + h * 1.02], [ex, ey + h * 1.46, ex + w * 0.88, ey + h * 0.86]],
      3.6, 'rgba(255,236,208,0.5)');
    // the bag underneath — he has not slept, he has been counting
    stroke([[ex - w * 0.76, ey + h * 1.5], [ex, ey + h * 2.1, ex + w * 0.86, ey + h * 1.3]],
      3.4, 'rgba(128,60,22,0.42)');
  };
  eye(-30, -2, 31, 17, 0.28, 4);
  eye(54, -8, 25, 15, 0.34, 2);

  // --- brows: bold shapes, the far one arched. The smugness lives here. ----
  const brow = (bx, by, w, tilt, lift, thick) => {
    c.save();
    c.translate(bx, by);
    c.rotate(tilt);
    path([[-w, 7], [-w * 0.42, -10 - lift, w * 0.44, -13 - lift, w, -5],
      [w * 0.4, -3 - lift + thick, -w * 0.44, 4 - lift + thick, -w, 7 + thick]]);
    c.fillStyle = lg(-w, -14, w, 12, [[0, '#3a2210'], [0.5, '#221307'], [1, '#160c04']]);
    c.fill();
    // a few hairs breaking the edge, so it is hair and not a sticker
    c.strokeStyle = 'rgba(58,34,14,0.55)';
    c.lineWidth = 2.1;
    c.lineCap = 'round';
    for (let i = -3; i <= 3; i++) {
      const t = i / 3.4;
      c.beginPath();
      c.moveTo(t * w * 0.9, 4 - lift * 0.5);
      c.lineTo(t * w * 0.9 + 5, -14 - lift * 0.8);
      c.stroke();
    }
    c.lineCap = 'butt';
    // a hint of sheen along the top
    stroke([[-w * 0.6, -6 - lift], [0, -11 - lift, w * 0.6, -8 - lift]], 2.4, 'rgba(196,150,102,0.3)');
    c.restore();
  };
  brow(-32, -40, 36, 0.10, 2, 13);
  brow(56, -48, 27, 0.30, 12, 11);

  // --- nose: bridge, bulb and wings as one caricature form ----------------
  {
    const NC = 20;                                   // face centreline at the nose
    const nose = () => {
      path([
        [NC - 12, -30],
        [NC - 16, -12, NC - 20, 4, NC - 26, 16],
        [NC - 42, 27, NC - 38, 45, NC - 17, 47],
        [NC, 49, NC + 18, 46, NC + 27, 37],
        [NC + 37, 24, NC + 32, 6, NC + 22, -6],
        [NC + 14, -16, NC + 3, -24, NC - 2, -30],
      ]);
    };
    // the shadow it throws down-right, because the key is up-left
    c.save();
    skull();
    c.clip();
    c.fillStyle = 'rgba(110,40,8,0.30)';
    path([[NC + 2, -10], [NC + 26, 12, NC + 36, 34, NC + 32, 52],
      [NC + 26, 62, NC + 14, 66, NC + 4, 62], [NC + 14, 46, NC + 14, 20, NC, -8]]);
    blurFill(14);
    c.restore();
    nose();
    c.fillStyle = '#f4c08a';
    c.fill();
    c.save();
    nose();
    c.clip();
    c.fillStyle = lg(NC - 10, 0, NC + 42, 0, [[0, 'rgba(150,72,22,0)'], [1, 'rgba(106,40,8,0.74)']]);
    c.fillRect(NC - 60, -46, 120, 110);
    c.fillStyle = lg(0, -30, 0, 20, [[0, 'rgba(150,72,22,0.42)'], [1, 'rgba(150,72,22,0)']]);
    c.fillRect(NC - 60, -46, 120, 80);
    // the bulb, as a crescent of light rather than a dot
    ell(NC - 8, 22, 19, 14, -0.24);
    c.fillStyle = 'rgba(255,244,222,0.55)';
    blurFill(9);
    ell(NC - 12, 16, 11, 7.5, -0.34);
    c.fillStyle = 'rgba(255,250,236,0.7)';
    blurFill(5);
    // warmth in the tip
    ell(NC - 4, 34, 20, 11, 0);
    c.fillStyle = 'rgba(224,102,68,0.22)';
    blurFill(10);
    // tooth on the nose too
    const rr = rngFrom(771);
    for (let i = 0; i < 320; i++) {
      const gx = NC - 46 + rr() * 92, gy = -34 + rr() * 90;
      const a = 0.04 + rr() * 0.05;
      c.fillStyle = rr() > 0.5 ? 'rgba(120,56,18,' + a.toFixed(3) + ')' : 'rgba(255,238,210,' + a.toFixed(3) + ')';
      c.fillRect(gx, gy, 0.9 + rr() * 1.3, 0.9 + rr() * 1.3);
    }
    c.restore();
    // ink only where the form turns away from the key
    stroke([[NC - 2, -28], [NC + 20, -6, NC + 25, 12], [NC + 36, 27, NC + 23, 39]],
      8, 'rgba(56,18,4,0.95)');
    stroke([[NC - 43, 25], [NC - 40, 43, NC - 16, 46], [NC + 8, 48, NC + 25, 38]],
      7.6, 'rgba(56,18,4,0.92)');
    stroke([[NC - 16, -8], [NC - 21, 4, NC - 29, 14], [NC - 34, 20, NC - 40, 26]],
      4.6, 'rgba(104,42,10,0.5)');
    // wing creases
    stroke([[NC - 40, 22], [NC - 32, 12, NC - 22, 10]], 3.8, 'rgba(120,52,14,0.42)');
    stroke([[NC + 26, 34], [NC + 22, 24, NC + 14, 20]], 3.4, 'rgba(120,52,14,0.35)');
    // nostrils, tucked under the wings
    c.fillStyle = 'rgba(44,12,3,0.96)';
    path([[NC - 27, 36], [NC - 22, 27, NC - 11, 31, NC - 12, 39], [NC - 17, 43, NC - 25, 42, NC - 27, 36]]);
    c.fill();
    path([[NC + 22, 31], [NC + 18, 24, NC + 9, 27, NC + 11, 34], [NC + 15, 38, NC + 21, 37, NC + 22, 31]]);
    c.fill();
    // shadow under the nose base
    c.save();
    skull();
    c.clip();
    c.fillStyle = 'rgba(92,32,8,0.5)';
    ell(NC - 4, 54, 34, 10, -0.03);
    blurFill(8);
    c.restore();
    // specular on the very tip
    ell(NC - 14, 14, 8, 5.5, -0.42);
    c.fillStyle = 'rgba(255,255,250,0.92)';
    c.fill();
  }

  // --- the pencil moustache: two thin waxed blades, notched at the philtrum -
  {
    const PH = 20;
    // one continuous shape with a philtrum notch — two floating dashes read as
    // a smudge, a single sculpted bar reads as a moustache
    path([
      [PH - 60, 38],
      [PH - 38, 50, PH - 14, 56, PH - 1, 57],
      [PH + 13, 55, PH + 32, 47, PH + 44, 35],
      [PH + 44, 50, PH + 28, 63, PH + 9, 68],
      [PH + 4, 63, PH - 4, 63, PH - 9, 69],
      [PH - 28, 71, PH - 50, 58, PH - 60, 38],
    ]);
    c.fillStyle = lg(PH - 60, 36, PH + 46, 70, [[0, '#5c3818'], [0.4, '#2b1809'], [1, '#130a04']]);
    c.fill();
    ink(3.4, 'rgba(24,12,3,0.75)');
    // one clean wax sheen along the top of each blade — no hatching
    stroke([[PH - 52, 42], [PH - 32, 52, PH - 12, 57]], 3.4, 'rgba(228,198,160,0.32)');
    stroke([[PH + 10, 57], [PH + 28, 50, PH + 39, 40]], 3, 'rgba(228,198,160,0.26)');
    // the shadow it drops on the lip
    c.save();
    skull();
    c.clip();
    c.fillStyle = 'rgba(90,34,10,0.32)';
    ell(PH - 6, 71, 42, 6, -0.05);
    blurFill(6);
    c.restore();
  }

  // --- mouth: a closed, entirely insincere smirk, raised on the far side ---
  {
    const PH = 20;
    // lower lip mass
    path([[PH - 46, 88], [PH - 14, 108, PH + 26, 102, PH + 44, 80],
      [PH + 24, 98, PH - 12, 101, PH - 46, 88]]);
    c.fillStyle = lg(0, 86, 0, 110, [[0, '#e39d78'], [1, '#8f4c32']]);
    c.fill();
    ink(3.8, 'rgba(112,48,20,0.55)');
    c.fillStyle = 'rgba(255,242,220,0.6)';
    ell(PH - 9, 95, 18, 4.6, -0.07);
    c.fill();
    // the lip line: heavy and low at the near corner, hooked up at the far one
    stroke([[PH - 52, 82], [PH - 12, 98, PH + 20, 92], [PH + 38, 88, PH + 48, 71]],
      11, '#2e1108');
    // a shadow just under it, so the smirk has depth rather than being a line
    c.save();
    skull();
    c.clip();
    c.fillStyle = 'rgba(86,30,8,0.34)';
    path([[PH - 50, 90], [PH - 12, 106, PH + 22, 100], [PH + 44, 96, PH - 50, 100]]);
    blurFill(7);
    c.restore();
    // corner dimple + folds
    c.fillStyle = 'rgba(118,50,18,0.6)';
    path([[PH + 45, 70], [PH + 53, 75, PH + 51, 85], [PH + 45, 83, PH + 42, 76, PH + 45, 70]]);
    c.fill();
    stroke([[PH - 27, 45], [PH - 43, 62, PH - 49, 84]], 5.4, 'rgba(110,46,14,0.44)');
    stroke([[PH + 30, 41], [PH + 45, 55, PH + 47, 70]], 4, 'rgba(110,46,14,0.3)');
    // mentolabial crease + chin
    stroke([[PH - 31, 105], [PH - 5, 111, PH + 22, 104]], 5, 'rgba(108,44,14,0.34)');
    c.save();
    skull();
    c.clip();
    c.fillStyle = 'rgba(112,46,16,0.3)';
    ell(PH - 8, 106, 30, 8, -0.04);
    blurFill(7);
    c.restore();
  }

  // --- hair: sideburn, a lock escaping the cap, volume and a sheen ---------
  {
    c.save();
    skull();
    c.clip();
    const HAIR = lg(-110, -60, -56, 40, [[0, '#43290f'], [0.5, '#251504'], [1, '#120a03']]);
    // near sideburn: narrow, tapering to a point, clear of the ear
    path([[-110, -52], [-114, -6, -106, 26, -96, 40],
      [-90, 20, -92, -16, -88, -52]]);
    c.fillStyle = HAIR;
    c.fill();
    ink(3.5, 'rgba(20,10,2,0.55)');
    // far sideburn, thinner still
    path([[110, -50], [113, -14, 105, 6, 96, 14], [93, -8, 94, -30, 92, -50]]);
    c.fillStyle = lg(112, -52, 88, 12, [[0, '#3a2410'], [1, '#160d04']]);
    c.fill();
    // the forelock that escapes under the brim, in three separated strands
    const lock = (x0, y0, x1, y1, x2, y2, x3, y3, w) => {
      path([[x0, y0], [x1, y1, x2, y2], [x2 + w * 0.3, y2 + w], [x1 + w * 0.2, y1 + w * 1.3, x3, y3]]);
      c.fillStyle = lg(x0, y0, x2, y2 + w, [[0, '#43290f'], [1, '#1a0f05']]);
      c.fill();
    };
    lock(-92, -56, -70, -40, -40, -38, -90, -42, 15);
    lock(-52, -58, -34, -44, -6, -46, -52, -46, 13);
    lock(-16, -58, 6, -48, 30, -52, -14, -48, 11);
    // strand sheen
    stroke([[-104, -40], [-108, -10, -100, 22]], 3.4, 'rgba(206,168,124,0.32)');
    stroke([[-82, -50], [-58, -38, -40, -40]], 2.8, 'rgba(206,168,124,0.28)');
    stroke([[-42, -52], [-20, -44, 0, -46]], 2.4, 'rgba(206,168,124,0.22)');
    c.restore();
  }

  // --- THE CAP -------------------------------------------------------------
  {
    const dome = () => {
      path([
        [-116, -40],
        [-127, -112, -72, -162, 6, -162],
        [86, -162, 128, -110, 116, -40],
      ]);
    };
    const brim = () => {
      path([
        [-14, -64],
        [58, -96, 148, -94, 188, -58],
        [198, -48, 188, -32, 164, -26],
        [112, -8, 34, -22, -16, -38],
      ]);
    };
    brim();
    c.fillStyle = lg(20, -96, 100, -24, [[0, '#ea5b50'], [0.4, RED], [1, '#6b0f18']]);
    c.fill();
    brim();
    ink(6.5, RED_INK);
    c.save();
    brim();
    c.clip();
    c.fillStyle = 'rgba(56,6,18,0.62)';
    c.fillRect(-18, -44, 236, 46);
    c.fillStyle = lg(104, 0, 200, 0, [[0, WARM + '0)'], [1, 'rgba(255,214,146,0.98)']]);
    c.fillRect(98, -104, 112, 100);
    c.restore();

    dome();
    c.fillStyle = lg(-118, -162, 118, -40, [[0, '#f88073'], [0.2, '#e55046'], [0.54, RED], [1, '#711119']]);
    c.fill();
    dome();
    ink(7.5, RED_INK);
    c.save();
    dome();
    c.clip();
    c.strokeStyle = 'rgba(110,12,24,0.42)';
    c.lineWidth = 4.5;
    c.beginPath();
    c.moveTo(-66, -38);
    c.quadraticCurveTo(-38, -132, 6, -162);
    c.moveTo(76, -40);
    c.quadraticCurveTo(54, -132, 6, -162);
    c.stroke();
    c.fillStyle = RED_D;
    c.fillRect(-130, -70, 260, 32);
    c.fillStyle = 'rgba(76,6,18,0.45)';
    c.fillRect(-130, -48, 260, 12);
    c.strokeStyle = 'rgba(255,224,214,0.28)';
    c.lineWidth = 17;
    c.beginPath();
    c.arc(-6, -98, 82, Math.PI * 1.06, Math.PI * 1.5);
    c.stroke();
    c.fillStyle = lg(60, 0, 124, 0, [[0, WARM + '0)'], [1, 'rgba(255,214,146,0.98)']]);
    c.fillRect(52, -170, 82, 134);
    c.fillStyle = lg(-124, 0, -78, 0, [[0, COOL + '0.55)'], [1, COOL + '0)']]);
    c.fillRect(-130, -166, 56, 130);
    c.restore();
    stroke([[-14, -42], [40, -28, 116, -36]], 5, 'rgba(66,6,18,0.55)');

    // the gold 'E' medallion, in the game's own logo font
    const mx = -2, my = -110, mr = 40;
    glow(34, 'rgba(255,200,90,0.9)');
    ell(mx, my, mr, mr, 0);
    c.fillStyle = GOLD;
    c.fill();
    noGlow();
    ell(mx, my, mr, mr, 0);
    c.fillStyle = rg(mx - 15, my - 17, 3, mx, my, mr * 1.5,
      [[0, '#fff8d8'], [0.32, GOLD_HI], [0.6, GOLD], [1, '#8a5a10']]);
    c.fill();
    ink(4, 'rgba(110,66,8,0.85)');
    ell(mx, my, mr * 0.72, mr * 0.72, 0);
    c.fillStyle = '#fdf8ea';
    c.fill();
    ink(3, 'rgba(150,96,14,0.6)');
    {
      const rows = ['#####', '#....', '#....', '####.', '#....', '#....', '#####'];
      const cell = mr * 0.148;
      const ox = mx - cell * 2.5, oy = my - cell * 3.5;
      c.fillStyle = RED;
      for (let r0 = 0; r0 < rows.length; r0++) {
        for (let k = 0; k < 5; k++) {
          if (rows[r0][k] === '#') c.fillRect(ox + k * cell, oy + r0 * cell, cell + 0.4, cell + 0.4);
        }
      }
    }
    c.strokeStyle = 'rgba(255,252,224,0.85)';
    c.lineWidth = 4.5;
    c.beginPath();
    c.arc(mx, my, mr - 4, Math.PI * 1.05, Math.PI * 1.42);
    c.stroke();
    // cap button
    ell(6, -164, 10, 7.5, 0);
    c.fillStyle = RED_D;
    c.fill();
    ink(4, RED_INK);
    ell(4, -166, 4.5, 2.8, -0.3);
    c.fillStyle = 'rgba(255,192,182,0.5)';
    c.fill();
  }

  c.restore();   // end head space

  // ==========================================================================
  // 7. TITLE LOCKUP — the game's own gold arch wordmark, at poster size
  // ==========================================================================
  const GLYPHS = {
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
  const cells = (x, y, cell, rows, cb) => {
    for (let r0 = 0; r0 < rows.length; r0++) {
      for (let k = 0; k < rows[r0].length; k++) {
        if (rows[r0][k] === '#') cb(x + k * cell, y + r0 * cell, r0, k, rows);
      }
    }
  };
  const archWord = (word, cx, baseY, cell, archDepth, pass) => {
    const adv = 6 * cell;
    const total = word.length * adv - cell;
    let x = cx - total / 2;
    for (let i = 0; i < word.length; i++) {
      const ch = word[i];
      if (ch !== ' ') {
        const t = word.length === 1 ? 0.5 : i / (word.length - 1);
        const dy = -archDepth * (1 - Math.pow(t * 2 - 1, 2));
        pass(GLYPHS[ch], x, baseY + dy, cell);
      }
      x += adv;
    }
  };
  const wordmark = (word, cx, baseY, cell, archDepth) => {
    const ex = cell * 0.42;
    const infl = cell * 0.16;
    const h = cell * 7;
    const box = (x, y, cl) => c.fillRect(x - infl, y - infl, cl + infl * 2, cl + infl * 2);
    c.save();
    glow(52, 'rgba(255,172,70,0.62)');
    archWord(word, cx, baseY, cell, archDepth, (rows, x, y, cl) => {
      c.fillStyle = 'rgba(28,12,42,1)';
      cells(x, y, cl, rows, (gx, gy) => box(gx, gy, cl));
    });
    c.restore();
    archWord(word, cx, baseY, cell, archDepth, (rows, x, y, cl) => {
      c.fillStyle = 'rgba(12,4,24,0.45)';
      cells(x + ex * 2.1, y + ex * 2.3, cl, rows, (gx, gy) => box(gx, gy, cl));
    });
    archWord(word, cx, baseY, cell, archDepth, (rows, x, y, cl) => {
      c.fillStyle = INK;
      cells(x + ex, y + ex, cl, rows, (gx, gy) => box(gx, gy, cl));
      cells(x, y, cl, rows, (gx, gy) => box(gx, gy, cl));
    });
    archWord(word, cx, baseY, cell, archDepth, (rows, x, y, cl) => {
      c.fillStyle = GOLD_LO;
      cells(x + ex, y + ex, cl, rows, (gx, gy) => c.fillRect(gx, gy, cl, cl));
    });
    archWord(word, cx, baseY, cell, archDepth, (rows, x, y, cl) => {
      c.fillStyle = lg(0, y, 0, y + h, [[0, '#fff4c8'], [0.32, GOLD_HI], [0.6, GOLD], [1, '#d9971e']]);
      cells(x, y, cl, rows, (gx, gy) => c.fillRect(gx, gy, cl, cl));
    });
    archWord(word, cx, baseY, cell, archDepth, (rows, x, y, cl) => {
      c.fillStyle = '#fffbe4';
      cells(x, y, cl, rows, (gx, gy, r0, k) => {
        if (r0 === 0 || rows[r0 - 1][k] !== '#') c.fillRect(gx, gy, cl, Math.max(1, cl * 0.26));
      });
    });
    c.save();
    c.beginPath();
    c.rect(cx - 950, baseY - archDepth - 6, 1900, h * 0.32);
    c.clip();
    archWord(word, cx, baseY, cell, archDepth, (rows, x, y, cl) => {
      c.fillStyle = 'rgba(255,255,255,0.26)';
      cells(x, y, cl, rows, (gx, gy) => c.fillRect(gx, gy, cl, cl));
    });
    c.restore();
  };
  // a soft scrim so the gold always has something to sit on
  c.fillStyle = lg(0, 0, 0, 430, [[0, 'rgba(10,4,26,0.5)'], [0.7, 'rgba(10,4,26,0.16)'], [1, 'rgba(10,4,26,0)']]);
  c.fillRect(0, 0, W, 430);
  wordmark('SUPER MARIO', 1200, 34, 14, 22);
  wordmark('ESTRADA', 1200, 142, 27, 20);

  // ==========================================================================
  // 8. STRAPLINE BANNER
  // ==========================================================================
  {
    const y0 = 348, y1 = 426, x0 = 452, x1 = 1948, notch = 40;
    const ribbon = () => {
      path([
        [x0, y0 + 4], [x1, y0 - 6], [x1 - notch, (y0 + y1) / 2 - 5], [x1, y1 - 8],
        [x0, y1 + 2], [x0 + notch, (y0 + y1) / 2 + 2],
      ]);
    };
    c.save();
    glow(34, 'rgba(10,4,20,0.75)');
    c.shadowOffsetY = 16;
    ribbon();
    c.fillStyle = lg(0, y0, 0, y1, [[0, '#cf4550'], [0.5, '#ab3342'], [1, '#6c1728']]);
    c.fill();
    noGlow();
    ribbon();
    ink(8, INK);
    c.save();
    ribbon();
    c.clip();
    c.fillStyle = 'rgba(255,192,152,0.22)';
    c.fillRect(x0, y0 - 6, x1 - x0, 16);
    c.restore();
    path([
      [x0 + 18, y0 + 17], [x1 - 18, y0 + 7], [x1 - notch - 14, (y0 + y1) / 2 - 5], [x1 - 18, y1 - 21],
      [x0 + 18, y1 - 11], [x0 + notch + 14, (y0 + y1) / 2 + 2],
    ]);
    ink(3, 'rgba(255,214,140,0.42)');
    const label = 'THE GREATEST RESCUE THAT NEVER HAPPENED';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.letterSpacing = '7px';
    let px = 62;
    for (;;) {
      c.font = '900 ' + px + 'px "Lato", sans-serif';
      if (c.measureText(label).width <= (x1 - x0) - 200 || px <= 24) break;
      px -= 1;
    }
    const tx = (x0 + x1) / 2, ty = (y0 + y1) / 2 - 1;
    c.fillStyle = 'rgba(64,8,22,0.75)';
    c.fillText(label, tx + 3, ty + 5);
    c.fillStyle = '#ffe9a0';
    c.fillText(label, tx, ty);
    c.letterSpacing = '0px';
    c.restore();
  }

  // ==========================================================================
  // 9. FOREGROUND — out-of-focus coins, dust in the light, vignette, grade
  // ==========================================================================
  {
    const r = rngFrom(88117);
    const spots = [[2288, 1210, 64], [844, 1226, 44]];
    for (const [x, y, rad] of spots) {
      c.save();
      c.filter = 'blur(' + (7 + r() * 4).toFixed(1) + 'px)';
      c.globalAlpha = 0.92;
      coin(x, y, rad, 0.35 + r(), true);
      c.restore();
    }
    // motes drifting in the sun
    for (let i = 0; i < 46; i++) {
      const x = 900 + r() * 1500, y = 560 + r() * 640;
      const s = 1.6 + r() * 4.2;
      c.fillStyle = 'rgba(255,224,168,' + (0.10 + r() * 0.24).toFixed(3) + ')';
      ell(x, y, s, s, 0);
      c.fill();
    }
  }

  c.fillStyle = rg(1200, 600, 460, 1200, 600, 1580, [
    [0, 'rgba(8,3,18,0)'], [0.56, 'rgba(8,3,18,0.10)'], [1, 'rgba(8,3,18,0.80)'],
  ]);
  c.fillRect(0, 0, W, H);
  c.fillStyle = lg(0, 0, 0, 320, [[0, 'rgba(255,190,120,0.05)'], [1, 'rgba(255,190,120,0)']]);
  c.fillRect(0, 0, W, 320);
}


// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------
function bundleCast(outFile) {
  const esbuild = join(REPO, 'node_modules', '.bin', 'esbuild');
  if (!existsSync(esbuild)) throw new Error('esbuild not found at ' + esbuild + ' — run npm install in ' + REPO);
  execFileSync(esbuild, [
    join(REPO, 'src', 'render', 'cast.ts'),
    '--bundle', '--format=esm', '--platform=browser', '--outfile=' + outFile,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
}

function serve(root) {
  const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript' };
  const server = createServer((req, res) => {
    const name = (req.url || '/').split('?')[0];
    if (name === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const file = join(root, name === '/' ? 'index.html' : name.replace(/^\/+/, ''));
    if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try { return req('playwright'); } catch { /* fall through */ }
  const req2 = createRequire(join(PLAYWRIGHT_FALLBACK, 'index.js'));
  return req2('playwright');
}

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#000}canvas{display:block}</style>
</head><body>
<canvas id="big" width="${BIG_W}" height="${BIG_H}"></canvas>
<canvas id="small" width="${OUT_W}" height="${OUT_H}"></canvas>
<script type="module">
import * as cast from './cast.mjs';
window.__cast = cast;
await document.fonts.load('900 60px "Lato"');
await document.fonts.ready;
window.__ready = true;
</script>
</body></html>`;

async function main() {
  const work = mkdtempSync(join(tmpdir(), 'sme-cover-'));
  const scratch = process.env.COVER_SCRATCH ? resolve(process.env.COVER_SCRATCH) : null;
  try {
    bundleCast(join(work, 'cast.mjs'));
    writeFileSync(join(work, 'index.html'), PAGE);
    const { server, port } = await serve(work);
    const { chromium } = loadPlaywright();
    const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
      page.on('pageerror', (e) => process.stderr.write('page error: ' + e.message + '\n'));
      page.on('console', (m) => { if (m.type() === 'error') process.stderr.write('console: ' + m.text() + '\n'); });
      await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load' });
      await page.waitForFunction('window.__ready === true', null, { timeout: 20000 });

      await page.evaluate(`(${drawCover.toString()})(
        document.getElementById('big').getContext('2d'), ${BIG_W}, ${BIG_H}, window.__cast)`);

      const [master, card] = await page.evaluate(async ([ow, oh]) => {
        const big = document.getElementById('big');
        const small = document.getElementById('small');
        const bmp = await createImageBitmap(big, { resizeWidth: ow, resizeHeight: oh, resizeQuality: 'high' });
        const sc = small.getContext('2d');
        sc.clearRect(0, 0, ow, oh);
        sc.drawImage(bmp, 0, 0);
        return [big.toDataURL('image/png'), small.toDataURL('image/png')];
      }, [OUT_W, OUT_H]);

      const buf = (d) => Buffer.from(d.split(',')[1], 'base64');
      for (const dest of [join(REPO, 'docs', 'social-card.png'), join(REPO, 'public', 'social-card.png')]) {
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, buf(card));
      }
      if (scratch) {
        mkdirSync(scratch, { recursive: true });
        writeFileSync(join(scratch, 'cover-master.png'), buf(master));
        writeFileSync(join(scratch, 'cover-1200.png'), buf(card));
      }
      // keep it comfortably under the 1 MB social-preview budget
      const dest = join(REPO, 'docs', 'social-card.png');
      try { execFileSync('/usr/bin/optipng', ['-quiet', '-o2', '-strip', 'all', dest]); } catch { /* optional */ }
      writeFileSync(join(REPO, 'public', 'social-card.png'), readFileSync(dest));
      const kb = (readFileSync(dest).length / 1024).toFixed(0);
      process.stdout.write('cover written: docs/social-card.png + public/social-card.png (' + kb + ' KB)\n');
    } finally {
      await browser.close();
      server.close();
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((e) => { process.stderr.write(String(e && e.stack ? e.stack : e) + '\n'); process.exit(1); });
