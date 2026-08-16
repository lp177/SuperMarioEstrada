#!/usr/bin/env node
// ============================================================================
// make-cover.mjs — draw the 1200x630 key-art cover (Open Graph / Twitter card).
//
// This is NOT a screenshot of the game. It is ENSEMBLE key art: the gold arch
// wordmark, the red strapline, and the whole con staged in one frame.
//
// COMPOSITION (one focal point, four depth planes)
//   PLANE 0  purple dusk sky, sunburst, the sun going down behind the right
//   PLANE 1  the castle he arrived at too late — and, in a barred cellar
//            window nobody is looking at, the REAL Peach, still waiting
//   PLANE 2  the raining coins, and the cast, depth-faded: Mangiani (doing the
//            actual work, pointing at the fraud) and two ruined Toads
//   PLANE 3  the two accomplices, rim-lit and clearly subordinate — a little
//            over half Estrada's height: Princess Impeach on the left (gown,
//            wig, red tie, one obviously fake foam glove at her side), and
//            Bowsonaro further back on the right (spiked jersey shell, beret,
//            aviators, claw raised), sunk into haze and a bank of ground dust
//   PLANE 4  ESTRADA, the focal point — gripping the MISSION FAILED
//            SUCCESSFULLY pennant in one fist and the kingdom's certified
//            savings in the other
//
//   An oblique axis runs pennant (upper left) -> Estrada's shoulders -> money
//   sack (right). The title owns the top band and never touches the cap.
//   Nothing lands on a face: the coin drift is composited BEHIND every figure.
//
// LIGHT
//   KEY   warm white, up and to the viewer's LEFT  -> lit planes, cast shadows
//   RIM   the setting sun at (SUNX,SUNY), low right -> every figure carries a
//         hot edge on the side that faces it, computed per figure
//   FILL  the dusk sky, cool violet                -> bounce on the shadow side
//
// HOW IT WORKS
//   1. Bundles the game's own `src/render/cast.ts` with the repo's esbuild, so
//      Impeach / Bowsonaro / Mangiani / Peach / the Toads are the REAL cast
//      functions at poster scale. Each is rendered to its own offscreen layer
//      and then graded (shadow ramp, atmospheric haze, silhouette-hugging rim)
//      before it is composited — that is what turns flat game art into staged
//      poster art and what makes the depth planes read.
//   2. Estrada is drawn from scratch at poster detail — the in-game sprite is
//      flat by design and does not survive 8x.
//   3. Serves a throwaway page over HTTP (ES modules are blocked on file://)
//      and drives it with Playwright + the system Chrome.
//   4. Composes at 2400x1260 (2x supersample), then downscales to exactly
//      1200x630 with a high-quality resize.
//   5. Writes social-card.png to docs/ (GitHub Pages) AND public/.
//
// RUN IT
//   node /home/lp177/Code/games/web/SuperMarioEstrada/tools/make-cover.mjs
//
//   Works from any cwd — every path is resolved relative to this file.
//   COVER_SCRATCH=/some/dir  also drops the 2400x1260 master + the final card
//                            there for inspection (nothing extra in the repo).
//   HEAD_ONLY=/some/head.png renders ONLY Estrada's head, ~1000 px tall, on a
//                            flat ground. This is the anatomy check: every
//                            feature must own its band and nothing may cross
//                            out of it.  GUIDES=1 overlays the band lines.
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
// the `cast` argument. Estrada's head is drawn in a local space where the
// skull radius is 100 units, which is what keeps the facial numbers legible.
// ---------------------------------------------------------------------------
function drawCover(c, W, H, cast, opt) {
  const P = cast.P;
  const O = opt || {};
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
  const pathOn = (cx, pts) => {
    cx.beginPath();
    cx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (p.length === 6) cx.bezierCurveTo(p[0], p[1], p[2], p[3], p[4], p[5]);
      else if (p.length === 4) cx.quadraticCurveTo(p[0], p[1], p[2], p[3]);
      else cx.lineTo(p[0], p[1]);
    }
    cx.closePath();
  };
  const path = (pts) => pathOn(c, pts);
  const lgOn = (cx, x0, y0, x1, y1, stops) => {
    const g = cx.createLinearGradient(x0, y0, x1, y1);
    for (const s of stops) g.addColorStop(s[0], s[1]);
    return g;
  };
  const lg = (x0, y0, x1, y1, stops) => lgOn(c, x0, y0, x1, y1, stops);
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
  // Rule 2: shading falls off to nothing. Every soft form on this card goes
  // through blurFill or a gradient with a fully transparent outer stop — never
  // a flat-filled ellipse, which reads as an object sitting on the skin.
  const blurFill = (px) => { c.filter = 'blur(' + px + 'px)'; c.fill(); c.filter = 'none'; };
  const softShadow = (x, y, rx, ry, rot, col, blur) => {
    c.save();
    ell(x, y, rx, ry, rot);
    c.fillStyle = col;
    blurFill(blur);
    c.restore();
  };

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
  // STAGING RIG — the game's own cast functions are flat by design. Each one
  // is drawn onto its own full-size offscreen layer, then graded before it is
  // composited: a shadow ramp away from the sun, atmospheric haze for its
  // depth plane, and a rim light that HUGS the silhouette (built by erasing a
  // shifted copy of the layer's own alpha, so it can never become a stripe).
  // ==========================================================================
  const SUNX = 2004, SUNY = 1006;

  const newLayer = () => {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    return cv;
  };
  /** draw -> graded layer. box = [x0,y0,x1,y1] the figure's bounds. */
  const stagedLayer = (draw, o) => {
    const cv = newLayer();
    const x = cv.getContext('2d');
    draw(x);
    const b = o.box;
    const bw = b[2] - b[0], bh = b[3] - b[1];
    const cxm = (b[0] + b[2]) / 2, cym = (b[1] + b[3]) / 2;
    let dx = SUNX - cxm, dy = SUNY - cym;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl; dy /= dl;
    const span = Math.hypot(bw, bh) * 0.6;
    x.save();
    x.globalCompositeOperation = 'source-atop';
    // shadow ramp: darkest on the side pointing away from the sun
    x.fillStyle = lgOn(x, cxm + dx * span, cym + dy * span, cxm - dx * span, cym - dy * span, [
      [0, 'rgba(58,20,74,0)'], [0.45, 'rgba(40,14,62,' + (o.dark * 0.35).toFixed(3) + ')'],
      [1, 'rgba(22,8,42,' + o.dark.toFixed(3) + ')'],
    ]);
    x.fillRect(b[0] - 60, b[1] - 60, bw + 120, bh + 120);
    // atmospheric haze for the depth plane
    if (o.haze > 0) {
      x.fillStyle = lgOn(x, 0, b[1], 0, b[3], [
        [0, 'rgba(126,84,152,' + (o.haze * 0.7).toFixed(3) + ')'],
        [1, 'rgba(104,62,132,' + o.haze.toFixed(3) + ')'],
      ]);
      x.fillRect(b[0] - 60, b[1] - 60, bw + 120, bh + 120);
    }
    x.restore();
    // rim: silhouette minus silhouette-shifted-away-from-the-sun
    const rim = newLayer();
    const rc = rim.getContext('2d');
    rc.drawImage(cv, 0, 0);
    rc.globalCompositeOperation = 'source-in';
    rc.fillStyle = o.rim;
    rc.fillRect(0, 0, W, H);
    rc.globalCompositeOperation = 'destination-out';
    rc.drawImage(cv, -dx * o.rimW, -dy * o.rimW);
    x.save();
    x.globalCompositeOperation = 'source-atop';
    x.filter = 'blur(' + (o.rimW * 0.34).toFixed(1) + 'px)';
    x.drawImage(rim, 0, 0);
    x.restore();
    return cv;
  };
  /** ground contact shadow + the composited figure */
  const place = (cv, o) => {
    if (o.shadow) {
      c.save();
      c.globalAlpha = o.shadow[3];
      c.fillStyle = 'rgba(12,4,24,1)';
      ell(o.shadow[0], o.shadow[1], o.shadow[2], o.shadow[2] * 0.19, -0.03);
      blurFill(o.shadow[2] * 0.16);
      c.restore();
    }
    c.save();
    c.globalAlpha = o.alpha === undefined ? 1 : o.alpha;
    c.drawImage(cv, 0, 0);
    c.restore();
  };

  // ==========================================================================
  // 1. SKY — the game's own purple dusk, pushed to poster contrast
  // ==========================================================================
  const GROUND = 1122;

  const paintSky = () => {
    c.fillStyle = lg(0, 0, 0, H, [
      [0, '#120a2c'], [0.18, '#26184a'], [0.42, '#4e2860'],
      [0.62, '#87386c'], [0.80, '#c25a5c'], [0.93, '#ee9b5c'], [1, '#f6bf76'],
    ]);
    c.fillRect(0, 0, W, H);

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
  };

  // ==========================================================================
  // ESTRADA'S HEAD — drawn in its own unit space so the anatomy stays legible.
  //    Skull radius = 100 units; skull top -112, chin +140.
  //
  //    BANDS (rule 3 — nothing may cross out of its own band):
  //      cap band      -196 .. -46   (dome + headband + bill)
  //      forehead       -46 .. -32
  //      brows          -32 ..  -6
  //      eyes           -10 ..  26
  //      nose           -14 ..  52   (bridge stays narrow at eye level)
  //      lit philtrum    52 ..  55   (bare skin — the separator)
  //      moustache       55 ..  82
  //      mouth + teeth   84 .. 117
  //      lower lip      110 .. 126
  //      chin           126 .. 138
  //
  //    VALUES (rule 4 — neighbours differ in value AND stroke weight):
  //      brow      near-black shape        | nose contour  mid-brown, 5.5 px
  //      philtrum  LIT SKIN, no line       | moustache     darkest, sculpted
  //      teeth     near-white              | lower lip     lit, warm
  //    so the ladder alternates dark / light all the way down the face and no
  //    two adjacent features can fuse into one squiggle.
  //
  //    The head is turned ~13 deg to the viewer's right: the NEAR cheek is on
  //    the left (big, lit by the key), the FAR side on the right (compressed,
  //    in shadow, sun rim on the silhouette). The visible ear is the near one.
  // ==========================================================================
  const RED = P.estradaRed, RED_D = P.estradaRedDark, RED_HI = '#f4776a';
  const RED_INK = '#530b14';
  const BLU = P.estradaBlue, BLU_D = P.estradaBlueDark, BLU_HI = '#4d76dc';
  const BLU_INK = '#0b1740';
  const WARM = 'rgba(255,198,120,';
  const COOL = 'rgba(150,132,240,';
  const SKIN_INK = 'rgba(92,40,14,0.88)';
  const GLOVE = '#f4efe4', GLOVE_INK = 'rgba(88,78,62,0.8)';

  // every facial number lives here once (rule 1: one shape, one definition)
  const NC = 22;    // nose centreline — the face is turned, so it is off-axis
  const PH = 22;    // philtrum centreline
  const EYE_N = [-38, 6, 36, 19];    // near eye  cx, cy, halfW, halfH
  const EYE_F = [62, 1, 27, 16.5];   // far eye   (compressed by the turn)
  const BROW_N = [-40, -22, 38];     // near brow cx, cy, halfW
  const BROW_F = [64, -28, 28];

  // The lower face was a long taper — an egg, narrow end down, with a big
  // blank expanse between the lip and the point of the chin. The jaw corners
  // are now squarer and the chin comes up 9 units, so the mask below the mouth
  // is a jaw and not a muzzle.
  const skull = () => {
    path([
      [6, -112],
      [68, -112, 108, -78, 112, -32],               // far temple
      [113, -6, 111, 28, 102, 56],                  // far cheekbone
      [97, 84, 82, 106, 58, 118],                   // far jaw, with a corner
      [36, 128, 12, 131, -12, 128],                 // chin
      [-50, 123, -84, 103, -102, 66],               // near jaw
      [-113, 44, -117, 4, -115, -32],               // near cheekbone (widest)
      [-113, -80, -56, -112, 6, -112],
    ]);
  };

  const drawHead = (guides) => {
    // --- near ear (viewer left) -------------------------------------------
    // An auricle, not a disc: helix rim sweeping back from the top-front, an
    // antihelix ridge inside it, a soft concha bowl and a lobe on the jaw
    // hinge. It runs brow (-26) to nose-base (50) and clears the skull by only
    // ~20 units; the skull is filled over its front edge, which is what
    // attaches it. Its outline is warm and light — a heavy ink ring round an
    // ellipse is what read as a doorknob glued to the cheek.
    {
      const earOuter = () => {
        path([
          [-104, -32],
          [-132, -34, -148, -6, -145, 16],
          [-142, 38, -128, 52, -114, 51],
          [-106, 50, -103, 30, -104, 10],
        ]);
      };
      earOuter();
      c.fillStyle = lg(-146, -26, -100, 46, [[0, '#e7b184'], [0.5, '#c98a53'], [1, '#8f5626']]);
      c.fill();
      c.save();
      earOuter();
      c.clip();
      // The internal forms are pushed OUT past the skull's edge (x < -115),
      // because everything inboard of that is covered by the cheek and the ear
      // then reads as a smooth lit lump — a mushroom cap, not an ear.
      c.fillStyle = 'rgba(92,38,10,0.55)';
      ell(-127, 12, 13, 20, 0.16);
      blurFill(6);
      // antihelix ridge inside the bowl, then the helix rim over the top
      stroke([[-131, -14], [-140, 10, -131, 32], [-125, 42, -118, 45]], 6, 'rgba(255,226,186,0.38)');
      stroke([[-112, -29], [-136, -24, -142, 4]], 5.5, 'rgba(255,232,196,0.36)');
      // the lobe's own shadow, so the bottom of the ear has weight
      c.fillStyle = 'rgba(96,40,10,0.34)';
      ell(-124, 44, 12, 7, 0.1);
      blurFill(4);
      c.restore();
      earOuter();
      ink(4.4, 'rgba(96,44,12,0.58)');
      softShadow(-107, 30, 11, 20, 0.1, 'rgba(226,110,70,0.24)', 9);
    }

    // --- skull: base, form light, an actual shadow shape, rims -------------
    skull();
    c.fillStyle = '#e8ab74';
    c.fill();
    c.save();
    skull();
    c.clip();

    // form light from the upper left; note the vertical falloff too, so the
    // near cheek is modelled rather than one broad flat pool
    c.fillStyle = rg(-52, -28, 6, -20, 12, 245, [
      [0, '#fff6e2'], [0.20, '#ffe0b6'], [0.48, '#f4bc84'], [0.76, '#c07a3c'], [1, '#824416'],
    ]);
    c.fillRect(-160, -160, 320, 360);
    c.fillStyle = lg(0, 10, 0, 170, [[0, 'rgba(120,50,12,0)'], [1, 'rgba(104,40,10,0.36)']]);
    c.fillRect(-160, -160, 320, 360);

    // the shadow half — an explicit shape with a soft terminator
    c.fillStyle = 'rgba(106,38,8,0.52)';
    path([[76, -116], [96, -40, 106, 26, 98, 76], [88, 108, 70, 128, 48, 142], [180, 142], [180, -116]]);
    blurFill(26);
    // occlusion under the cheekbone, on the shadow side
    c.fillStyle = 'rgba(104,38,8,0.26)';
    path([[48, 46], [72, 50, 92, 40], [88, 74, 66, 88, 46, 82]]);
    blurFill(15);
    // under-jaw occlusion
    c.fillStyle = 'rgba(88,28,6,0.5)';
    path([[-72, 104], [-24, 138, 32, 134, 88, 94], [88, 200], [-72, 200]]);
    blurFill(15);
    // cheekbone plane on the near side + blush
    softShadow(-60, 6, 36, 24, -0.28, 'rgba(255,248,226,0.46)', 15);
    softShadow(-66, 48, 30, 17, -0.1, 'rgba(226,104,72,0.26)', 11);
    softShadow(-84, 92, 26, 22, -0.2, 'rgba(104,40,10,0.24)', 16);
    softShadow(2, 120, 26, 14, 0, 'rgba(255,246,222,0.34)', 12);
    // the bill's cast shadow, kept in the forehead band so the eyes stay open
    c.fillStyle = 'rgba(64,20,50,0.5)';
    path([[-118, -120], [180, -120], [180, -46], [96, -30, -30, -28, -118, -50]]);
    blurFill(9);

    // skin tooth — the single thing that stops canvas gradients reading as wax
    {
      const rr = rngFrom(2029);
      for (let i = 0; i < 2200; i++) {
        const gx = -125 + rr() * 250, gy = -125 + rr() * 275;
        const a = 0.016 + rr() * 0.026;
        c.fillStyle = rr() > 0.46
          ? 'rgba(122,58,20,' + a.toFixed(3) + ')'
          : 'rgba(255,234,202,' + a.toFixed(3) + ')';
        const s = 0.9 + rr() * 1.5;
        c.fillRect(gx, gy, s, s);
      }
      for (let i = 0; i < 14; i++) {
        softShadow(-100 + rr() * 200, -80 + rr() * 210, 10 + rr() * 22, 8 + rr() * 16, rr() * 3,
          rr() > 0.5 ? 'rgba(196,104,54,0.08)' : 'rgba(255,232,198,0.08)', 11);
      }
    }

    // rims: hot gold from the sun on the right, cool sky bounce on the left.
    // Narrow. A wide rim stops being a rim and becomes a plastic overlay.
    c.fillStyle = lg(90, 0, 117, 0, [[0, WARM + '0)'], [1, 'rgba(255,232,172,0.95)']]);
    c.fillRect(86, -80, 36, 220);
    c.fillStyle = lg(0, 110, 0, 142, [[0, WARM + '0)'], [1, WARM + '0.34)']]);
    c.fillRect(14, 110, 92, 36);
    c.fillStyle = lg(-116, 0, -78, 0, [[0, COOL + '0.5)'], [1, COOL + '0)']]);
    c.fillRect(-120, -100, 46, 265);
    c.restore();

    // contour: heavy where the form turns away, nearly gone on the lit rim
    skull();
    ink(7.5, lg(-114, 0, 114, 0, [
      [0, 'rgba(150,74,26,0.30)'], [0.28, 'rgba(70,26,6,0.92)'],
      [0.74, 'rgba(70,26,6,0.88)'], [1, 'rgba(186,100,34,0.28)'],
    ]));
    // an explicit hot edge, clipped to the head so it stays a silhouette edge
    c.save();
    skull();
    c.clip();
    stroke([[107, -58], [115, -4, 112, 34], [106, 70, 90, 102, 68, 124]], 9,
      'rgba(255,236,186,0.9)');
    c.restore();
    // jaw / chin structure, and a plane break on the far cheek
    stroke([[-92, 78], [-60, 108, -14, 118]], 4.6, 'rgba(104,46,12,0.34)');
    c.save();
    skull();
    c.clip();
    stroke([[84, 8], [90, 44, 76, 78], [64, 100, 42, 114]], 12, 'rgba(126,52,14,0.16)');
    stroke([[78, 16], [82, 46, 70, 76]], 5, 'rgba(255,226,182,0.16)');
    c.restore();

    // --- hair: sideburn + the lock escaping the cap ------------------------
    // drawn before the face features so nothing dark ever lands on top of them
    {
      c.save();
      skull();
      c.clip();
      const HAIR = lg(-110, -46, -50, 60, [[0, '#573713'], [0.5, '#2f1c08'], [1, '#180e04']]);
      // near sideburn: a narrow blade in FRONT of the ear, tapering to a point
      path([[-106, -44], [-110, 4, -103, 34, -95, 50],
        [-88, 30, -90, -8, -86, -44]]);
      c.fillStyle = HAIR;
      c.fill();
      ink(3.5, 'rgba(20,10,2,0.55)');
      // far sideburn, thinner still
      path([[105, -44], [107, -20, 103, -6, 98, -2], [96, -14, 97, -30, 95, -44]]);
      c.fillStyle = lg(112, -44, 88, 20, [[0, '#3a2410'], [1, '#160d04']]);
      c.fill();
      // The forelock that escapes under the band: ONE swept mass, slicked
      // right. RULE 4 — it used to run to x=86, straight into the far brow
      // (x 36..92) at the same near-black value, and the two fused into one
      // dark mass over the right eye. It now stops at x=30 and the receding
      // far temple is bare LIT skin, which is also better character: the
      // hairline is going, and he combs what is left across it.
      path([
        [-104, -50],
        [-96, -26, -62, -18, -24, -26],
        [-2, -31, 16, -37, 30, -37],
        [30, -49, -4, -55, -26, -53],
        [-58, -50, -92, -58, -104, -50],
      ]);
      c.fillStyle = HAIR;
      c.fill();
      ink(3, 'rgba(20,10,2,0.5)');
      c.strokeStyle = 'rgba(210,172,128,0.30)';
      c.lineWidth = 2.6;
      c.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        c.beginPath();
        c.moveTo(-96 + i * 6, -44 + i * 4);
        c.quadraticCurveTo(-46 + i * 8, -30 + i * 3, 4 + i * 7, -34 + i * 2);
        c.stroke();
      }
      c.lineCap = 'butt';
      stroke([[-102, -30], [-106, 2, -99, 34]], 3.4, 'rgba(206,168,124,0.30)');
      c.restore();
    }

    // --- nose --------------------------------------------------------------
    // Drawn BEFORE the eyes: if the bridge ever grazes the far socket the LID
    // wins, and an opaque nose can never be painted over an eye (rule 3).
    // Its ink is deliberately a mid warm brown at 5.5 px — the moustache below
    // it is near-black at 3 px, so the two cannot merge (rule 4).
    {
      // RULE 1 — ONE SHAPE, ONE DEFINITION, and this one was live. The nose's
      // near wing was written in the fill path as -15 / -19 / -25 / -40 and
      // then typed out AGAIN as a contour stroke reading -16 / -21 / -29 / -39.
      // Two independent copies of one edge, differing by up to four units: the
      // exact bug that left MountainFighters with a filled lump and a smaller
      // outlined nose stroked across the middle of it for three review rounds.
      // The edge is now cut into three named segments; the fill concatenates
      // them and every contour stroke walks the same arrays. Nothing can drift.
      const N_BRIDGE = [[NC - 11, -14], [NC - 15, 6, NC - 19, 22, NC - 25, 31]];
      const N_BASE = [[NC - 40, 40, NC - 35, 51, NC - 15, 52], [NC + 2, 53, NC + 18, 50, NC + 26, 42]];
      const N_FAR = [[NC + 36, 33, NC + 31, 11, NC + 21, 0], [NC + 13, -7, NC + 3, -11, NC - 1, -14]];
      const nose = () => path(N_BRIDGE.concat(N_BASE, N_FAR));
      // the shadow it throws down-right, because the key is up-left
      c.save();
      skull();
      c.clip();
      c.fillStyle = 'rgba(98,32,4,0.56)';
      path([[NC + 4, 0], [NC + 34, 22, NC + 48, 48, NC + 44, 72],
        [NC + 38, 86, NC + 18, 90, NC + 4, 82], [NC + 18, 62, NC + 18, 30, NC, 4]]);
      blurFill(16);
      c.restore();
      nose();
      c.fillStyle = '#f6c48f';
      c.fill();
      c.save();
      nose();
      c.clip();
      c.fillStyle = lg(NC - 14, 0, NC + 38, 0, [[0, 'rgba(150,72,22,0)'], [1, 'rgba(92,30,2,0.9)']]);
      c.fillRect(NC - 60, -30, 120, 120);
      c.fillStyle = lg(0, -14, 0, 26, [[0, 'rgba(150,72,22,0.46)'], [1, 'rgba(150,72,22,0)']]);
      c.fillRect(NC - 60, -30, 120, 70);
      // the bulb, as a crescent of light rather than a dot
      softShadow(NC - 8, 31, 19, 13, -0.24, 'rgba(255,248,230,0.62)', 9);
      softShadow(NC - 13, 25, 10, 7, -0.34, 'rgba(255,252,240,0.7)', 5);
      softShadow(NC - 3, 43, 19, 10, 0, 'rgba(224,102,68,0.26)', 9);
      // occlusion under the ball of the nose — this is what makes it project
      softShadow(NC - 2, 51, 26, 8, -0.02, 'rgba(96,32,4,0.45)', 8);
      const rr = rngFrom(771);
      for (let i = 0; i < 120; i++) {
        const gx = NC - 44 + rr() * 86, gy = -20 + rr() * 86;
        const a = 0.02 + rr() * 0.026;
        c.fillStyle = rr() > 0.5 ? 'rgba(120,56,18,' + a.toFixed(3) + ')' : 'rgba(255,238,210,' + a.toFixed(3) + ')';
        c.fillRect(gx, gy, 0.9 + rr() * 1.3, 0.9 + rr() * 1.3);
      }
      c.restore();
      // contour: warm mid brown, HEAVIER than the moustache's ink but three
      // full steps lighter in value, so the two can never fuse (rule 4)
      // Each contour walks the SAME segment arrays the fill was built from, and
      // straddles the edge rather than being clipped by it — a contour line
      // that only shows its inner half stops describing the silhouette.
      stroke([[NC + 26, 42]].concat(N_FAR), 7, 'rgba(112,44,8,0.98)');
      stroke([[NC - 25, 31]].concat(N_BASE), 5.2, 'rgba(128,54,12,0.85)');
      stroke(N_BRIDGE, 3.4, 'rgba(164,90,36,0.5)');
      // wing creases
      stroke([[NC - 38, 40], [NC - 30, 30, NC - 19, 29]], 3, 'rgba(126,54,14,0.42)');
      stroke([[NC + 26, 43], [NC + 23, 34, NC + 15, 31]], 2.8, 'rgba(126,54,14,0.36)');
      // Nostrils. They are OPENINGS ON THE UNDERSIDE, so they live low on the
      // base plane, run along it as narrow slots, and their edges are blurred.
      // The first pass had two hard-edged discs on the FRONT of the ball, which
      // is a snout, not a nose (rule 2: if you can trace its edge it is a form).
      c.save();
      nose();
      c.clip();
      c.fillStyle = 'rgba(74,26,6,0.80)';
      ell(NC - 19, 46, 9, 3.6, 0.28);
      blurFill(2.6);
      c.fillStyle = 'rgba(74,26,6,0.66)';
      ell(NC + 15, 42, 7.4, 3.0, -0.24);
      blurFill(2.6);
      c.restore();
      // shadow under the nose base — soft, and it STOPS before the philtrum
      c.save();
      skull();
      c.clip();
      softShadow(NC - 4, 58, 30, 7, -0.03, 'rgba(92,32,8,0.42)', 8);
      c.restore();
      // specular on the ball: a soft smear INSIDE the lit crescent. A flat
      // white ellipse here is a sticker, not light (rule 2).
      c.save();
      nose();
      c.clip();
      ell(NC - 12, 28, 7.4, 4.6, -0.42);
      c.fillStyle = 'rgba(255,252,242,0.80)';
      blurFill(3.2);
      c.restore();
    }

    // --- eyes ---------------------------------------------------------------
    // Both look slightly out at the viewer even though the head is turned away.
    const eye = (ex, ey, w, h, lid, gaze) => {
      // socket / brow-ridge shadow
      softShadow(ex + 2, ey - h * 0.5, w * 1.34, h * 2.1, 0, 'rgba(128,58,22,0.26)', 13);
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
    eye(EYE_N[0], EYE_N[1], EYE_N[2], EYE_N[3], 0.28, 4);
    eye(EYE_F[0], EYE_F[1], EYE_F[2], EYE_F[3], 0.34, 2);

    // --- brows: bold shapes, the far one arched. The smugness lives here. ---
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
      stroke([[-w * 0.6, -6 - lift], [0, -11 - lift, w * 0.6, -8 - lift]], 2.4, 'rgba(196,150,102,0.3)');
      c.restore();
    };
    brow(BROW_N[0], BROW_N[1], BROW_N[2], 0.10, 2, 13);
    brow(BROW_F[0], BROW_F[1], BROW_F[2], 0.30, 12, 11);

    // --- mouth: the salesman's grin, upper teeth showing --------------------
    // This is the value break that stops the lower face fusing (rule 4): the
    // near-white teeth sit between the near-black moustache above and the warm
    // lit lower lip below, so no two neighbours share a value.
    {
      const LIP = 88;                                   // the upper lip line
      // ASYMMETRIC on purpose. The first pass was a level lens showing a full
      // row of teeth, which at thumbnail size reads as a grimace — wrong man.
      // The far corner now rides 20 units higher than the near one: a one-sided
      // salesman's smirk, and the asymmetry is what stops the face reading as a
      // generic cartoon head.
      const mouth = () => {
        path([
          [PH - 46, LIP + 15],
          [PH - 20, LIP + 3, PH + 16, LIP - 2, PH + 48, LIP + 2],   // upper lip, hooked up the far side
          [PH + 51, LIP + 12, PH + 34, LIP + 22, PH + 8, LIP + 25],
          [PH - 16, LIP + 27, PH - 40, LIP + 25, PH - 46, LIP + 15],
        ]);
      };
      // the dark inside
      mouth();
      c.fillStyle = lg(0, LIP, 0, LIP + 30, [[0, '#57182a'], [0.55, '#7a2839'], [1, '#3f1019']]);
      c.fill();
      // teeth: an upper row only, following the lip line
      c.save();
      mouth();
      c.clip();
      const teeth = () => {
        path([
          [PH - 44, LIP + 15],
          [PH - 19, LIP + 4, PH + 16, LIP - 1, PH + 46, LIP + 3],
          [PH + 43, LIP + 14, PH + 10, LIP + 18, PH - 20, LIP + 19],
          [PH - 34, LIP + 19, PH - 42, LIP + 18, PH - 44, LIP + 15],
        ]);
      };
      teeth();
      c.fillStyle = lg(0, LIP - 4, 0, LIP + 20, [[0, '#fffef8'], [0.55, '#faf1de'], [1, '#dcc8a8']]);
      c.fill();
      c.save();
      teeth();
      c.clip();
      // four soft divisions, not six hard ones — six at this scale is a comb
      c.strokeStyle = 'rgba(150,116,80,0.26)';
      c.lineWidth = 2.0;
      for (let i = -1; i <= 2; i++) {
        c.beginPath();
        c.moveTo(PH + i * 19 - 2, LIP - 6);
        c.lineTo(PH + i * 19 + 2, LIP + 20);
        c.stroke();
      }
      // gum shadow along the top of the row
      c.fillStyle = 'rgba(92,32,32,0.42)';
      c.filter = 'blur(4px)';
      c.fillRect(PH - 60, LIP - 8, 120, 12);
      c.filter = 'none';
      c.restore();
      // the shadow the upper lip drops into the mouth corner
      softShadow(PH - 41, LIP + 19, 12, 13, 0, 'rgba(30,6,10,0.6)', 8);
      softShadow(PH + 46, LIP + 8, 10, 11, 0, 'rgba(30,6,10,0.5)', 8);
      c.restore();
      mouth();
      ink(6, 'rgba(96,36,14,0.85)');
      // lower lip: a lit warm form under the opening
      path([[PH - 42, LIP + 21], [PH - 12, LIP + 47, PH + 26, LIP + 40, PH + 48, LIP + 8],
        [PH + 24, LIP + 31, PH - 12, LIP + 33, PH - 42, LIP + 21]]);
      c.fillStyle = lg(0, LIP + 20, 0, LIP + 50, [[0, '#f7bb92'], [0.5, '#d78c62'], [1, '#9e5c3c']]);
      c.fill();
      ink(3.4, 'rgba(122,54,22,0.5)');
      softShadow(PH - 6, LIP + 29, 20, 6, -0.07, 'rgba(255,246,226,0.7)', 4);
      // corner dimple, nasolabial folds and the mentolabial crease — all
      // CLIPPED to the skull. The crease sat at y 142-148 against a chin that
      // ends at ~137, so it was a loose brown stroke lying on the background.
      c.save();
      skull();
      c.clip();
      stroke([[PH - 30, 48], [PH - 46, 70, PH - 52, 96]], 5, 'rgba(112,48,16,0.34)');
      stroke([[PH + 32, 44], [PH + 47, 62, PH + 49, 82]], 3.6, 'rgba(112,48,16,0.24)');
      stroke([[PH - 28, LIP + 46], [PH - 4, LIP + 52, PH + 20, LIP + 44]], 5, 'rgba(108,44,14,0.3)');
      softShadow(PH - 8, LIP + 48, 28, 8, -0.04, 'rgba(112,46,16,0.26)', 7);
      c.restore();
    }

    // --- the pencil moustache ----------------------------------------------
    // Drawn AFTER the mouth so it closes over the top lip rather than being
    // sliced by it, and it stops 8 units short of the nose base so a band of
    // lit philtrum always separates the two.
    {
      // Thinner than the first pass (12-18 units deep, not 27) and both tips
      // flick UP. A uniformly thick near-black lozenge 46% as wide as the face
      // stops reading as hair and starts reading as a bar laid on the lip.
      // ONE continuous chevron, thickest under the philtrum and tapering to a
      // flicked-up point at each end. The first pass cut a deep notch out of
      // the middle, which split it into two lobes joined by a bridge — i.e. a
      // pair of sunglasses lying on his lip. The lit separator above it is now
      // the 12-unit band of bare skin under the nose base, not the notch.
      const must = () => {
        path([
          [PH - 60, 60],
          [PH - 40, 63, PH - 20, 65, PH - 2, 67],       // top edge, dipping under the nose
          [PH + 18, 63, PH + 38, 59, PH + 55, 57],      // and rising to the far tip
          [PH + 51, 69, PH + 30, 77, PH + 6, 79],       // bottom edge
          [PH - 18, 81, PH - 44, 73, PH - 60, 60],
        ]);
      };
      // its own soft drop shadow, so it sits ON the lip instead of in it
      c.save();
      skull();
      c.clip();
      c.fillStyle = 'rgba(88,32,10,0.34)';
      c.save();
      c.translate(3, 6);
      must();
      c.restore();
      blurFill(6);
      c.restore();
      must();
      c.fillStyle = lg(PH - 56, 54, PH + 52, 82, [[0, '#4a2c12'], [0.42, '#241305'], [1, '#120903']]);
      c.fill();
      ink(2.6, 'rgba(20,10,3,0.7)');
      // one clean wax sheen running the whole top edge — no hatching
      stroke([[PH - 48, 65], [PH - 22, 68, PH - 2, 70]], 2.8, 'rgba(236,206,166,0.40)');
      stroke([[PH + 6, 68], [PH + 30, 63, PH + 46, 60]], 2.4, 'rgba(236,206,166,0.34)');
    }

    // --- THE CAP -----------------------------------------------------------
    // Built as three connected parts that share edges, so it sits ON the head:
    //   dome   the crown, rising off the headband
    //   bill   a curved bill seen slightly from below — dark underside, a lit
    //          sliver of top surface along its upper edge, hot leading rim
    //   band   drawn LAST, across the bottom of the dome AND over the bill's
    //          root, which is what straps the two together (no floating slab)
    {
      // RULE 1 — ONE SHAPE, ONE DEFINITION. The headband's two edges are
      // written here once. The first pass declared `bandLow`, never used it,
      // and then re-typed the same six numbers inline inside `band()` while
      // `dome()` re-typed `bandHigh` a third time. Nothing had drifted yet, but
      // that is precisely the latent bug that left MountainFighters with two
      // noses for three review rounds: edit one copy, miss the others.
      const bandHigh = [[-120, -96], [-58, -78, 2, -76], [62, -82, 120, -102]];
      const bandLow = [[-118, -66], [-58, -48, 2, -46], [62, -52, 118, -72]];
      // reverse a moveTo + quad-segment list so an edge can be walked backwards
      const revQ = (pts) => {
        const end = (p) => [p[p.length - 2], p[p.length - 1]];
        const out = [end(pts[pts.length - 1])];
        for (let i = pts.length - 1; i >= 1; i--) out.push([pts[i][0], pts[i][1]].concat(end(pts[i - 1])));
        return out;
      };
      const dome = () => {
        path([
          [-120, -96],
          [-134, -164, -60, -200, 6, -200],
          [80, -200, 134, -160, 120, -102],
        ].concat(revQ(bandHigh).slice(1)));
      };
      const band = () => path(bandHigh.concat(revQ(bandLow)));
      // The bill's leading edge is written ONCE and shared by the silhouette
      // and by the lit sliver of top surface (rule 1: one shape, one
      // definition — two copies is how a resize leaves you with two noses).
      const BILL_EDGE = [
        [40, -94],
        [120, -128, 200, -122, 240, -88],          // root -> tip, along the top
      ];
      const bill = () => path(BILL_EDGE.concat([
        [252, -78, 246, -62, 228, -56],            // the rounded tip, curling down
        [166, -34, 84, -36, 34, -56],              // underside back to the root
      ]));
      const billTop = () => path(BILL_EDGE.concat([
        [246, -82, 244, -76, 240, -73],
        [198, -104, 122, -110, 44, -80],
      ]));

      // --- bill (drawn first: the dome and band overlap its root) ----------
      bill();
      c.fillStyle = lg(40, -100, 200, -40, [[0, '#8e1a26'], [0.45, '#6c1220'], [1, '#3c0812']]);
      c.fill();
      c.save();
      bill();
      c.clip();
      // the underside is darkest along its bottom edge
      c.fillStyle = lg(0, -80, 0, -34, [[0, 'rgba(60,8,18,0)'], [1, 'rgba(44,4,14,0.85)']]);
      c.fillRect(20, -140, 250, 120);
      // bounced warmth off the forehead
      c.fillStyle = rg(96, -66, 6, 96, -60, 130, [
        [0, 'rgba(255,150,110,0.30)'], [1, 'rgba(255,150,110,0)']]);
      c.fillRect(20, -140, 250, 120);
      c.restore();
      billTop();
      c.fillStyle = lg(40, -122, 220, -74, [[0, '#f0685a'], [0.5, RED], [1, '#a51f24']]);
      c.fill();
      bill();
      ink(6, RED_INK);
      // hot leading edge from the sun, clipped so it stays on the silhouette
      c.save();
      bill();
      c.clip();
      stroke(BILL_EDGE.concat([[252, -78, 246, -62]]), 8, 'rgba(255,214,146,0.85)');
      c.restore();

      // --- dome ------------------------------------------------------------
      dome();
      c.fillStyle = lg(-118, -200, 118, -76, [[0, '#f88073'], [0.2, '#e55046'], [0.54, RED], [1, '#7c141c']]);
      c.fill();
      dome();
      ink(7.5, RED_INK);
      c.save();
      dome();
      c.clip();
      // panel seams running to the button
      c.strokeStyle = 'rgba(110,12,24,0.42)';
      c.lineWidth = 4.5;
      c.beginPath();
      c.moveTo(-70, -80);
      c.quadraticCurveTo(-42, -166, 6, -198);
      c.moveTo(76, -84);
      c.quadraticCurveTo(56, -166, 6, -198);
      c.stroke();
      // sheen across the crown
      c.strokeStyle = 'rgba(255,224,214,0.26)';
      c.lineWidth = 17;
      c.beginPath();
      c.arc(-6, -134, 82, Math.PI * 1.06, Math.PI * 1.5);
      c.stroke();
      c.fillStyle = lg(62, 0, 126, 0, [[0, WARM + '0)'], [1, 'rgba(255,214,146,0.98)']]);
      c.fillRect(54, -206, 82, 140);
      c.fillStyle = lg(-126, 0, -80, 0, [[0, COOL + '0.55)'], [1, COOL + '0)']]);
      c.fillRect(-132, -202, 56, 136);
      // the bill's contact shadow ON the dome, so they are one object
      c.fillStyle = 'rgba(58,4,16,0.55)';
      path([[30, -108], [110, -136, 190, -130, 240, -96], [240, -76], [30, -84]]);
      blurFill(11);
      c.restore();

      // --- band (last: it straps the dome to the bill) ---------------------
      band();
      c.fillStyle = lg(-118, -96, 118, -46, [[0, '#a8202c'], [0.42, RED_D], [1, '#6d1018']]);
      c.fill();
      band();
      ink(6, RED_INK);
      c.save();
      band();
      c.clip();
      c.fillStyle = lg(0, -96, 0, -46, [[0, 'rgba(255,190,180,0.28)'], [0.5, 'rgba(255,190,180,0)'],
        [1, 'rgba(52,4,14,0.5)']]);
      c.fillRect(-130, -100, 260, 60);
      c.fillStyle = lg(62, 0, 122, 0, [[0, WARM + '0)'], [1, 'rgba(255,208,142,0.9)']]);
      c.fillRect(56, -104, 74, 64);
      c.restore();
      // stitch line: DERIVED from the band's own lower edge (rule 1 — this was
      // a fourth hand-typed copy of that curve), lerped a fifth of the way up
      const lerpQ = (a, b, t) => a.map((p, i) => p.map((v, k) => v + (b[i][k] - v) * t));
      stroke(lerpQ(bandLow, bandHigh, 0.20), 2.6, 'rgba(255,196,180,0.34)');

      // the gold 'E' patch, in the game's own logo font — an embroidered oval
      // on the front panel, not a dinner plate bolted to his forehead
      const mx = 44, my = -136, mrx = 31, mry = 27;
      c.save();
      c.translate(mx, my);
      c.rotate(-0.06);
      ell(0, 0, mrx, mry, 0);
      c.fillStyle = lg(-mrx, -mry, mrx, mry, [[0, '#fff9e6'], [0.55, '#f6ecd2'], [1, '#cbb188']]);
      c.fill();
      ink(4.5, 'rgba(150,96,14,0.85)');
      ell(0, 0, mrx - 6, mry - 6, 0);
      ink(2.6, 'rgba(206,150,40,0.55)');
      {
        const rows = ['#####', '#....', '#....', '####.', '#....', '#....', '#####'];
        const cell = 4.2;
        const ox = -cell * 2.5, oy = -cell * 3.5;
        c.fillStyle = RED;
        for (let r0 = 0; r0 < rows.length; r0++) {
          for (let k = 0; k < 5; k++) {
            if (rows[r0][k] === '#') c.fillRect(ox + k * cell, oy + r0 * cell, cell + 0.4, cell + 0.4);
          }
        }
      }
      c.strokeStyle = 'rgba(255,252,224,0.7)';
      c.lineWidth = 3;
      c.beginPath();
      c.ellipse(0, 0, mrx - 3, mry - 3, 0, Math.PI * 1.08, Math.PI * 1.46);
      c.stroke();
      c.restore();
      // cap button
      ell(6, -200, 10, 7.5, 0);
      c.fillStyle = RED_D;
      c.fill();
      ink(4, RED_INK);
      ell(4, -202, 4.5, 2.8, -0.3);
      c.fillStyle = 'rgba(255,192,182,0.5)';
      c.fill();
    }

    if (guides) {
      const bands = [[-196, '#59f'], [-46, '#59f'], [-32, '#5f9'], [-6, '#5f9'],
        [-14, '#ff5'], [26, '#ff5'], [52, '#f95'], [55, '#0ff'], [82, '#0ff'],
        [84, '#f5f'], [117, '#f5f'], [126, '#fa0'], [138, '#fff']];
      for (const [y, col] of bands) {
        c.strokeStyle = col;
        c.lineWidth = 1.6;
        c.beginPath();
        c.moveTo(-190, y);
        c.lineTo(270, y);
        c.stroke();
      }
    }
  };


  // ==========================================================================
  // THE HERO'S ANCHOR POINTS + THE GRIPPING HANDS
  // Declared up here because the flag is drawn before the figure but has to
  // hang off the same fist.
  //
  //    PROPORTION (rule 9): head 238 x 278; shoulder span 492 = 2.07 head
  //    widths; the silhouette is widest at the deltoids and TAPERS to the
  //    waist. Nothing below the shoulders may ever be wider than the
  //    shoulders — that is what read as "really really fat".
  // ==========================================================================
  const HX = 1372, HY = 656, R = 106;
  const u = R / 100;
  const SH_R = [HX + 226, 936];    // viewer-right deltoid (sack arm)
  const FIST_R = [1848, 884];
  const FIST_RAD = 72;
  const ARM_R = Math.atan2(SH_R[1] - FIST_R[1], SH_R[0] - FIST_R[0]);
  const NECK_ANG = 1.50;           // the sack's neck runs (almost) straight down
  const SACK_HALF = 34;            // half-thickness of that neck — one definition
  // filled in when the pole / the sack's neck are drawn, so each grip can show
  // its own object again through the gap between thumb and index finger
  let poleRedraw = null, neckRedraw = null;

  // Rule 7, in three passes:
  //   (a) 'far'  — the fingertip pads that come round past the object's far
  //                edge, drawn BEFORE the object so it overlaps their roots
  //   (b)          the object, drawn in between — and then shown again THROUGH
  //                the gap between the thumb and the index finger, which is
  //                the one detail that makes a grip unambiguous
  //   (c) 'near' — the fist closing over the front, the thumb across it, and a
  //                contact shadow where the object leaves the grip
  // The fist lives in the OBJECT's frame (local +x runs along the object, the
  // knuckles ride its far edge); the cuff lives in the FOREARM's frame,
  // because a wrist is not square to what it holds.
  // RULE 11 — "the hand's axis must follow the forearm's direction; derive the
  // hand's rotation from the forearm vector, do not hand-pick an angle."
  // The fist's frame is the OBJECT's, but a frame and its 180-degree flip hold
  // the same object equally well, and only one of the two puts the WRIST end
  // toward the arm. The pole grip had picked the wrong one: its wrist pointed
  // 134 degrees away from the shoulder, so the knuckles faced the sleeve and
  // the sleeve butted into the back of the hand. Pick the sign, never the angle.
  const gripAng = (objAng, armAng) => {
    const wristX = -Math.sin(objAng), wristY = Math.cos(objAng);   // local +y in world
    return (wristX * Math.cos(armAng) + wristY * Math.sin(armAng) >= 0) ? objAng : objAng + Math.PI;
  };
  // The wrist point a grip presents to its forearm. Rule 1: ONE definition,
  // consumed both by the sleeve that has to arrive there and by the cuff that
  // closes the joint. Two hand-tuned copies is how the sleeve ended up ending
  // 116 units short of the hand it was supposed to be attached to.
  const WRIST_T = 0.78;
  const wristOf = (hx, hy, objAng, armAng, r, half) => {
    const a = gripAng(objAng, armAng);
    const d = (half + r * 0.92) * WRIST_T;
    return [hx - Math.sin(a) * d, hy + Math.cos(a) * d];
  };

  const gripHand = (hx, hy, angIn, armAng, r, half, phase, redraw) => {
    const ang = gripAng(angIn, armAng);
    const KY = -(half + r * 0.26);      // knuckle ridge, just past the far edge
    const BASE = half + r * 0.92;       // the wrist end
    const K0 = -r * 0.82, KS = r * 0.42;
    const WIN0 = r * 0.30, WIN1 = r * 0.80;   // the see-through gap
    if (phase === 'far') {
      c.save();
      c.translate(hx, hy);
      c.rotate(ang);
      // Pads that crest the knuckle ridge by a HAIR. The first pass pushed them
      // 0.17r past a ridge that only peaks at 0.14r, in a value two steps
      // darker than the glove and ringed with its own ink — so at 300% the
      // money-sack hand had four grey nubs standing outside the white fist and
      // read as eight digits on one hand.
      for (let i = 0; i < 4; i++) {
        const fx = K0 + i * KS + KS * 0.5;
        ell(fx, KY - r * 0.05, r * 0.145, r * 0.115, 0);
        c.fillStyle = lgOn(c, fx, KY - r * 0.22, fx, KY, [[0, '#f3ecdd'], [1, '#c8bfae']]);
        c.fill();
        ink(r * 0.045, 'rgba(88,78,62,0.42)');
      }
      c.restore();
      return;
    }
    c.save();
    c.translate(hx, hy);
    c.rotate(ang);
    // contact shadows, where the object comes out of the fist
    c.fillStyle = 'rgba(20,8,4,0.55)';
    ell(-r * 1.0, 0, r * 0.19, half * 1.12, 0);
    blurFill(r * 0.13);
    ell(r * 1.0, 0, r * 0.21, half * 1.18, 0);
    blurFill(r * 0.14);

    const fist = () => {
      c.beginPath();
      c.moveTo(-r * 0.96, half * 0.55);
      c.bezierCurveTo(-r * 1.04, -half * 0.2, -r * 1.00, KY + r * 0.20, K0, KY);
      for (let i = 0; i < 4; i++) {
        const x0 = K0 + i * KS;
        c.quadraticCurveTo(x0 + r * 0.10, KY - r * 0.28, x0 + KS, KY + (i === 3 ? -r * 0.02 : 0));
      }
      c.bezierCurveTo(r * 1.02, KY + r * 0.16, r * 1.06, half * 0.4, r * 0.94, BASE * 0.58);
      c.bezierCurveTo(r * 0.84, BASE * 0.94, r * 0.30, BASE * 1.08, -r * 0.24, BASE);
      c.bezierCurveTo(-r * 0.66, BASE * 0.96, -r * 0.94, BASE * 0.58, -r * 0.96, half * 0.55);
      c.closePath();
    };
    fist();
    c.fillStyle = GLOVE;
    c.fill();
    c.save();
    fist();
    c.clip();
    c.fillStyle = lgOn(c, -r * 0.5, KY, -r * 0.05, BASE,
      [[0, '#fffdf6'], [0.30, GLOVE], [0.70, '#bab19f'], [1, '#756c5c']]);
    c.fillRect(-r * 1.4, KY - r * 0.6, r * 2.8, BASE - KY + r * 1.4);
    // four digits: one dark split between each pair, running the full depth of
    // the finger, and one lit crown on each knuckle. Anything more and the
    // whole glove turns into a ball of yarn at card size.
    for (let i = 1; i < 4; i++) {
      const vx = K0 + i * KS;
      stroke([[vx, KY + r * 0.02], [vx - r * 0.05, half * 0.4, vx - r * 0.02, BASE * 0.72]],
        r * 0.10, 'rgba(92,80,62,0.75)');
    }
    for (let i = 0; i < 4; i++) {
      ell(K0 + i * KS + KS * 0.5, KY + r * 0.13, r * 0.15, r * 0.11, 0);
      c.fillStyle = 'rgba(255,255,252,0.7)';
      blurFill(r * 0.05);
    }
    // the back of the hand falls away below the knuckles
    c.fillStyle = lgOn(c, 0, half * 0.5, 0, BASE,
      [[0, 'rgba(104,92,74,0)'], [1, 'rgba(104,92,74,0.42)']]);
    c.fillRect(-r * 1.2, half * 0.4, r * 2.4, BASE);
    c.restore();
    fist();
    ink(r * 0.085, GLOVE_INK);

    // (b) THE OBJECT, SEEN THROUGH THE GRIP — clipped to the slot between the
    // thumb and the index finger, then redrawn in world space
    if (redraw) {
      c.save();
      // the slot is a gap between two fingers, so its ends bow with them — a
      // rectangle here reads as a window cut in the glove
      c.beginPath();
      c.moveTo(WIN0, -half * 1.04);
      c.quadraticCurveTo((WIN0 + WIN1) / 2, -half * 1.30, WIN1, -half * 1.04);
      c.lineTo(WIN1, half * 1.04);
      c.quadraticCurveTo((WIN0 + WIN1) / 2, half * 1.30, WIN0, half * 1.04);
      c.closePath();
      c.clip();
      c.setTransform(1, 0, 0, 1, 0, 0);
      redraw();
      c.restore();
      // the slot is recessed: darken both of its walls
      c.save();
      c.fillStyle = 'rgba(46,32,16,0.5)';
      c.filter = 'blur(' + (r * 0.09).toFixed(1) + 'px)';
      c.fillRect(WIN0 - r * 0.05, -half * 1.3, r * 0.12, half * 2.6);
      c.fillRect(WIN1 - r * 0.07, -half * 1.3, r * 0.12, half * 2.6);
      c.filter = 'none';
      c.restore();
    }

    // the thumb, lying across the front and closing the slot from below
    const thumb = () => {
      limbShape([r * 0.02, BASE * 0.98], [r * 0.42, half * 1.15],
        [r * 0.74, half * 0.22], r * 0.44, r * 0.31);
    };
    c.save();
    c.translate(-r * 0.04, r * 0.12);
    thumb();
    c.fillStyle = 'rgba(84,72,58,0.45)';
    blurFill(r * 0.11);
    c.restore();
    thumb();
    c.fillStyle = lgOn(c, -r * 0.6, BASE, r * 0.6, -half, [[0, '#d6cdbb'], [0.45, '#fbf7ec'], [1, '#fffdf6']]);
    c.fill();
    thumb();
    ink(r * 0.08, 'rgba(112,100,82,0.8)');
    stroke([[r * 0.14, BASE * 0.78], [r * 0.44, half * 1.0, r * 0.64, half * 0.3]],
      r * 0.045, 'rgba(255,255,252,0.4)');
    // sun rim down the whole grip
    c.save();
    fist();
    c.clip();
    c.fillStyle = lgOn(c, r * 0.40, 0, r * 1.06, 0, [[0, WARM + '0)'], [1, WARM + '0.75)']]);
    c.fillRect(r * 0.36, KY - r * 0.4, r * 0.8, BASE - KY + r * 0.8);
    c.restore();
    c.restore();

    // --- THE WRIST ---------------------------------------------------------
    // Rule 11: "overlap the cuff so sleeve and hand share pixels; a gap between
    // them reads as amputation." The previous pass delegated this to `sleeve`,
    // which drops its cuff a third of a width back from p2 — i.e. inside its
    // own rounded end cap. On BOTH arms that landed completely behind the fist,
    // so the shipped card had a red tube butting into a white fist along a hard
    // diagonal seam and no wrist anywhere. The cuff is placed here instead: at
    // the fist's BASE, rotated into the FOREARM's frame (not the object's,
    // because a wrist is not square to what it holds), and drawn LAST so it
    // sits over the heel of the hand.
    {
      const w = wristOf(hx, hy, angIn, armAng, r, half);
      const CW = r * 0.54, CT = r * 0.32;
      c.save();
      c.translate(w[0], w[1]);
      c.rotate(armAng);
      // contact shadow where the cloth meets the heel of the hand
      c.fillStyle = 'rgba(24,10,6,0.40)';
      ell(CT * 0.1, 0, CT * 1.22, CW * 1.04, 0);
      blurFill(r * 0.10);
      // A ROLLED cuff: both short edges bow outward, so it reads as a tube of
      // cloth turned back on itself rather than a flat red card laid on a glove.
      path([
        [-CT * 0.95, -CW * 0.84],
        [-CT * 0.2, -CW * 1.06, CT * 0.7, -CW * 1.04, CT * 1.14, -CW * 0.78],
        [CT * 1.2, CW * 0.78],
        [CT * 0.7, CW * 1.06, -CT * 0.2, CW * 1.06, -CT * 0.95, CW * 0.84],
      ]);
      c.fillStyle = lgOn(c, 0, -CW, 0, CW, [[0, '#f2796a'], [0.42, RED_D], [1, '#5f0e18']]);
      c.fill();
      ink(r * 0.09, RED_INK);
      stroke([[CT * 0.52, -CW * 0.8], [CT * 0.9, 0, CT * 0.52, CW * 0.8]], r * 0.07,
        'rgba(255,150,132,0.40)');
      c.restore();
    }
  };

  // head-only anatomy check (rule 3): render big, on a flat ground, and LOOK
  if (O.headOnly) {
    c.fillStyle = '#3b2b46';
    c.fillRect(0, 0, W, H);
    const HR = 300;
    c.save();
    c.translate(W / 2 - 80, H / 2 + 60);
    c.scale(HR / 100 * 0.95, HR / 100 * 1.04);
    drawHead(!!O.guides);
    c.restore();
    return;
  }

  paintSky();

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
  block(1852, 566, 74, 0.46);
  block(2288, 690, 54, 0.32);

  // Two ridges, each drawn twice — once as mass, once as the lit crest. The
  // CREST is defined once and both passes reuse it (rule 1).
  const FAR_CREST = [[-40, 1040], [300, 918, 700, 986, 1080, 962],
    [1520, 934, 1980, 1002, W + 40, 950]];
  const MID_CREST = [[-40, 1092], [420, 1000, 900, 1064, 1290, 1040],
    [1700, 1016, 2080, 1082, W + 40, 1032]];
  const ridge = (crest, tail, fill) => {
    path(crest.concat(tail));
    c.fillStyle = fill;
    c.fill();
  };
  ridge(FAR_CREST, [[W + 40, 1200], [-40, 1200]], 'rgba(120,62,116,0.55)');
  ridge(FAR_CREST, [[W + 40, 980], [-40, 1064]], 'rgba(255,186,124,0.30)');
  ridge(MID_CREST, [[W + 40, 1240], [-40, 1240]], 'rgba(64,32,88,0.94)');
  ridge(MID_CREST, [[W + 40, 1050], [-40, 1110]], 'rgba(255,168,110,0.20)');

  // --- the castle he arrived at too late, with the real princess still in it -
  const CASTLE_X = 196, CASTLE_S = 1.15;
  // the cellar window, in castle-local units — defined ONCE and reused for the
  // glow, the clip, the bars and the sill (rule 1)
  const CELL = { x: 118, y: -176, w: 96, h: 168 };
  const cellRect = () => [
    CASTLE_X + CELL.x * CASTLE_S, GROUND + 4 + CELL.y * CASTLE_S,
    CELL.w * CASTLE_S, CELL.h * CASTLE_S,
  ];
  {
    const by = GROUND + 4;
    c.save();
    c.translate(CASTLE_X, by);
    c.scale(CASTLE_S, CASTLE_S);
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
    path([[268, 0], [268, -90, 326, -90, 326, 0]]);
    c.fill();
    c.fillStyle = 'rgba(255,206,120,0.55)';
    path([[280, 0], [280, -78, 314, -78, 314, 0]]);
    c.fill();
    // the tower window, lit and EMPTY — the staged kidnap has no princess in it
    c.fillStyle = 'rgba(255,214,140,0.5)';
    path([[172, -300], [172, -338, 200, -338, 200, -300]]);
    c.fill();
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
  }

  // ground shelf
  c.fillStyle = lg(0, GROUND, 0, H, [[0, 'rgba(40,20,64,0.80)'], [1, 'rgba(18,8,34,0.98)']]);
  c.fillRect(0, GROUND, W, H - GROUND);
  c.fillStyle = lg(0, 0, W, 0, [
    [0, 'rgba(255,164,108,0.22)'], [0.62, 'rgba(255,186,120,0.62)'], [1, 'rgba(255,164,108,0.28)']]);
  c.fillRect(0, GROUND - 5, W, 6);
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
  // 3. COINS — the kingdom's certified savings, on their way down. Drawn here,
  //    BEHIND every figure: a drifting coin that lands on somebody's face is a
  //    compositing bug, not weather.
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
  {
    const r = rngFrom(4711);
    for (let i = 0; i < 30; i++) {
      const x = r() * (W + 200) - 100;
      const y = 440 + r() * (H - 380);
      const rad = 10 + r() * 12;
      c.save();
      c.globalAlpha = 0.6;
      glow(rad * 1.3, 'rgba(255,200,96,0.55)');
      coin(x, y, rad, r() * 6.28, r() > 0.55);
      c.restore();
    }
    noGlow();
  }


  // ==========================================================================
  // 4. THE REAL PEACH — in the cellar, behind bars, while they pose out front.
  //    Nobody on this poster is looking at her. That is the whole joke.
  // ==========================================================================
  {
    const [wx, wy, ww, wh] = cellRect();
    // the cell's own dim light, so she is not a black hole in the wall
    c.fillStyle = rg(wx + ww * 0.5, wy + wh * 0.5, 4, wx + ww * 0.5, wy + wh * 0.5, wh * 1.3, [
      [0, 'rgba(255,206,140,0.62)'], [0.5, 'rgba(210,130,120,0.2)'], [1, 'rgba(210,130,120,0)']]);
    c.fillRect(wx - wh, wy - wh, ww + wh * 2, wh * 3);
    c.fillStyle = lg(0, wy, 0, wy + wh, [[0, '#3a2044'], [1, '#1c0e26']]);
    c.fillRect(wx, wy, ww, wh);
    const peach = stagedLayer((x) => {
      cast.drawPeach(x, wx + ww * 0.5, wy + wh - 10, 1.28, { facing: 1, pose: 'stand', mood: 'sad' });
    }, { box: [wx - 60, wy - 30, wx + ww + 60, wy + wh + 20], dark: 0.3, haze: 0.18, rim: 'rgba(255,206,140,0.85)', rimW: 6 });
    c.save();
    c.beginPath();
    c.rect(wx, wy, ww, wh);
    c.clip();
    c.globalAlpha = 0.92;
    c.drawImage(peach, 0, 0);
    c.restore();
    // Bars + sill. COMPOSITING BUG, caught at 700%: the bars ran at i/4 for
    // i=1..3, and Peach stands at exactly ww*0.5 — so the middle bar came down
    // the centre of her face and split her into two mirrored halves. She read
    // as two blobs, not a prisoner, which killed the one story beat the whole
    // poster is built on. The bars now straddle her instead, and the cross-bar
    // has moved down off her face onto her skirt.
    c.strokeStyle = 'rgba(14,6,26,0.95)';
    c.lineWidth = 7;
    for (const f of [0.26, 0.74]) {
      c.beginPath();
      c.moveTo(wx + ww * f, wy + 2);
      c.lineTo(wx + ww * f, wy + wh - 2);
      c.stroke();
    }
    c.beginPath();
    c.moveTo(wx + 2, wy + wh * 0.66);
    c.lineTo(wx + ww - 2, wy + wh * 0.66);
    c.stroke();
    c.lineWidth = 10;
    c.strokeStyle = 'rgba(16,7,30,0.98)';
    c.strokeRect(wx, wy, ww, wh);
    c.fillStyle = 'rgba(255,178,120,0.30)';
    c.fillRect(wx - 8, wy + wh - 4, ww + 16, 7);
  }

  // ==========================================================================
  // 5. THE BACK PLANE — Mangiani, who is doing all the actual work, and three
  //    Toads who bet the farm. Small, hazy, sitting behind everything.
  // ==========================================================================
  {
    const mx = 196, my = 1118, ms = 2.35;
    place(stagedLayer((x) => {
      // backpack OFF: at 2.35x the rig's pack is a brown rectangle standing
      // clear of his flank with daylight between them — an orphan (rule 11)
      cast.drawMangiani(x, mx, my, ms, {
        facing: 1, eyes: 'narrow', brows: 'determined', mouth: 'grim', pose: 'point', backpack: false,
      });
    }, {
      box: [mx - 90, my - 270, mx + 130, my + 10],
      dark: 0.46, haze: 0.30, rim: 'rgba(255,190,130,0.75)', rimW: 7,
    }), { alpha: 0.94, shadow: [mx + 8, my + 6, 84, 0.5] });

    const toads = [
      [826, 1160, 2.9, 'despair', '#e04848', '#5f76d8'],
      [1052, 1180, 2.6, 'shock', '#e8c23a', '#3f8f6a'],
    ];
    for (const [tx, ty, ts, mood, spot, vest] of toads) {
      place(stagedLayer((x) => {
        cast.drawToad(x, tx, ty, ts, { facing: 1, mood, spot, vest, coin: mood === 'despair' });
      }, {
        box: [tx - 46 * ts * 0.6, ty - 46 * ts, tx + 46 * ts * 0.6, ty + 6],
        dark: 0.5, haze: 0.36, rim: 'rgba(255,192,132,0.7)', rimW: 5,
      }), { alpha: 0.9, shadow: [tx, ty + 3, 30 * ts, 0.44] });
    }
  }

  // ==========================================================================
  // 6. THE ACCOMPLICES — clearly subordinate: about half Estrada's height,
  //    a step back, a step darker, each with its own silhouette (rule 8):
  //    Impeach is a wide pink BELL with one absurd foam glove up; Bowsonaro is
  //    a spiked DOME with a jutting jaw and a raised claw.
  // ==========================================================================
  {
    // -- Princess Impeach, left ------------------------------------------
    const ix = 600, iy = 1146, is = 3.7;
    place(stagedLayer((x) => {
      // 'down', not 'wave'. The rig's second arm is a near-degenerate sliver
      // ending short of its own glove disc, and at poster scale that shipped as
      // a grey ball floating clear of a pink stub — a textbook rule-11 orphan.
      // 'down' routes through the cast's own one-fake-glove rule: the modest
      // hand goes behind the skirt and only the foam glove shows. It also gets
      // that glove off Estrada's fist, where two white blobs sat side by side.
      cast.drawImpeach(x, ix, iy, is, {
        facing: 1, hands: 'down', handScale: 1.15, waveT: 13, mouth: 'smug', wigOn: true,
      });
    }, {
      box: [ix - 36 * is, iy - 112 * is, ix + 48 * is, iy + 8],
      dark: 0.46, haze: 0.19, rim: 'rgba(255,206,146,0.95)', rimW: 9,
    }), { alpha: 1, shadow: [ix + 14, iy + 6, 150, 0.55] });

    // -- Bowsonaro, right, looming ---------------------------------------
    // RULE 11 — he is the game's 30px sprite at 5.2x, and it shows: the ammo
    // sash overhangs the shell into open air at both ends, the jersey's hem is
    // a hard horizontal cut, the legs are two rectangles with no knee and the
    // boots are flat ellipses. The art module is game logic and stays untouched,
    // so the poster answer is the one brief rule 1 already asks for — an
    // antagonist who is smaller, DARKER and FURTHER BACK. He drops a notch in
    // scale and takes nearly three times the atmospheric haze, which sinks the
    // sprite artefacts into the dusk and makes the depth planes read harder.
    const bx2 = 2110, by2 = 1150, bs = 4.9;
    place(stagedLayer((x) => {
      cast.drawBowsonaro(x, bx2, by2, bs, { facing: -1, pose: 'rant', mouth: 'open', shellOn: true });
    }, {
      box: [bx2 - 40 * bs, by2 - 80 * bs, bx2 + 30 * bs, by2 + 8],
      dark: 0.52, haze: 0.20, rim: 'rgba(255,214,150,0.95)', rimW: 11,
    }), { alpha: 1, shadow: [bx2 - 14, by2 + 6, 176, 0.58] });

    // A bank of lit dust rolling along the ground in front of both accomplices.
    // It is drawn AFTER them and BEFORE the hero, so it buries the two weakest
    // things on the card — Bowsonaro's stick legs and the flat dark ellipses
    // the rig uses for boots — behind atmosphere instead of leaving them to be
    // read as anatomy. Motion and depth, not a patch.
    {
      const dust = (x0, y0, rx, ry, a) => {
        c.fillStyle = 'rgba(255,180,120,' + a + ')';
        ell(x0, y0, rx, ry, -0.03);
        blurFill(ry * 0.9);
      };
      dust(2090, 1152, 300, 46, 0.20);
      dust(1980, 1176, 220, 34, 0.16);
      dust(620, 1156, 260, 40, 0.15);
      dust(360, 1176, 200, 30, 0.12);
      c.fillStyle = lg(0, GROUND + 10, 0, GROUND + 150,
        [[0, 'rgba(40,18,58,0)'], [1, 'rgba(24,10,40,0.55)']]);
      c.fillRect(0, GROUND + 10, W, 160);
    }
  }

  // ==========================================================================
  // 7. THE FLAG he plants over work he did not do
  // ==========================================================================
  const POLE_T = [700, 424];
  const FIST_L = [806, 760];
  const POLE_DX = FIST_L[0] - POLE_T[0], POLE_DY = FIST_L[1] - POLE_T[1];
  const POLE_ANG = Math.atan2(POLE_DY, POLE_DX);
  const POLE_R = 17;
  const poleAt = (t) => [POLE_T[0] + POLE_DX * t, POLE_T[1] + POLE_DY * t];
  const POLE_B = poleAt(2.42);
  const SH_L = [HX - 222, 946];    // viewer-left deltoid (flag arm)
  const ARM_L = Math.atan2(SH_L[1] - FIST_L[1], SH_L[0] - FIST_L[0]);
  // (a) the far fingertips go down FIRST, so the pole can be drawn over their
  //     roots: the object then visibly passes THROUGH the fingers (rule 7)
  gripHand(FIST_L[0], FIST_L[1], POLE_ANG, ARM_L, FIST_RAD, POLE_R, 'far');
  {
    // disturbed earth where he planted it, and a shadow thrown from the sun
    c.save();
    c.globalAlpha = 0.5;
    c.fillStyle = 'rgba(10,4,22,1)';
    ell(POLE_B[0] - 80, POLE_B[1] + 6, 190, 24, -0.05);
    blurFill(16);
    c.restore();
    const px = (y) => POLE_T[0] + POLE_DX * ((y - POLE_T[1]) / POLE_DY);
    const band = (a, b, col) => {
      path([[POLE_B[0] + a, POLE_B[1]], [POLE_T[0] + a, POLE_T[1]],
        [POLE_T[0] + b, POLE_T[1]], [POLE_B[0] + b, POLE_B[1]]]);
      c.fillStyle = col;
      c.fill();
    };
    // ONE definition of the shaft, used for the first pass and again for the
    // sliver that shows through the fist (rule 1: one shape, one definition)
    poleRedraw = () => {
      band(-POLE_R, -POLE_R * 0.4, '#2c1832');
      band(-POLE_R * 0.4, POLE_R * 0.28, '#5e3c3c');
      band(POLE_R * 0.28, POLE_R * 0.76, '#a8754f');
      band(POLE_R * 0.76, POLE_R, '#ffcf98');
      path([[POLE_B[0] - POLE_R, POLE_B[1]], [POLE_T[0] - POLE_R, POLE_T[1]],
        [POLE_T[0] + POLE_R, POLE_T[1]], [POLE_B[0] + POLE_R, POLE_B[1]]]);
      ink(5, 'rgba(20,8,28,0.7)');
    };
    poleRedraw();
    c.fillStyle = 'rgba(255,170,112,0.24)';
    ell(POLE_B[0] + 18, POLE_B[1] - 4, 44, 10, 0);
    blurFill(6);
    // finial
    c.save();
    glow(26, 'rgba(255,204,110,0.85)');
    ell(POLE_T[0] + 1, POLE_T[1] - 12, 16, 16, 0);
    c.fillStyle = GOLD;
    c.fill();
    noGlow();
    c.restore();
    ell(POLE_T[0] + 1, POLE_T[1] - 12, 16, 16, 0);
    c.fillStyle = rg(POLE_T[0] - 5, POLE_T[1] - 18, 2, POLE_T[0] + 1, POLE_T[1] - 12, 22,
      [[0, '#fff6d4'], [0.4, GOLD_HI], [1, '#8a5a10']]);
    c.fill();
    ink(4.5, 'rgba(96,58,6,0.8)');

    // pennant: two waved edges and a swallow tail, so it reads as cloth
    const y0 = POLE_T[1] + 14;
    const yB = y0 + 152;
    const pen = () => {
      path([
        [px(y0) + 6, y0],
        [860, y0 - 22, 1010, y0 + 6, 1172, y0 + 30],
        [1092, y0 + 86],
        [1176, y0 + 150],
        [1014, y0 + 168, 862, y0 + 152, px(yB) + 6, yB],
      ]);
    };
    c.save();
    glow(32, 'rgba(255,140,100,0.45)');
    pen();
    c.fillStyle = lg(620, y0, 1114, y0 + 155, [[0, '#c14152'], [0.55, '#93283c'], [1, '#59122a']]);
    c.fill();
    noGlow();
    c.restore();
    c.save();
    pen();
    c.clip();
    c.fillStyle = 'rgba(30,6,20,0.34)';
    path([[936, y0 - 40], [980, y0 + 56, 952, y0 + 210], [1006, y0 + 210], [992, y0 + 56, 980, y0 - 40]]);
    blurFill(14);
    c.fillStyle = 'rgba(255,180,140,0.20)';
    path([[1006, y0 - 40], [1050, y0 + 56, 1022, y0 + 210], [1062, y0 + 210], [1054, y0 + 56, 1046, y0 - 40]]);
    blurFill(16);
    c.fillStyle = 'rgba(255,200,146,0.26)';
    c.fillRect(680, y0 - 12, 520, 16);
    c.restore();
    pen();
    ink(6, 'rgba(24,6,18,0.75)');
    for (let i = 0; i < 3; i++) {
      const yy = y0 + 20 + i * 56;
      stroke([[px(yy) - 14, yy], [px(yy) + 18, yy]], 7, 'rgba(240,208,160,0.75)');
    }

    // the line, auto-fitted so it can never run off the cloth
    const L1 = 'MISSION FAILED', L2 = 'SUCCESSFULLY';
    const boxL = 792, boxR = 1104;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.letterSpacing = '2px';
    let fs = 60;
    for (;;) {
      c.font = '900 ' + fs + 'px "Lato", sans-serif';
      const w = Math.max(c.measureText(L1).width, c.measureText(L2).width);
      if (w <= boxR - boxL || fs <= 20) break;
      fs -= 1;
    }
    c.font = '900 ' + fs + 'px "Lato", sans-serif';
    const ly1 = y0 + 50, ly2 = y0 + 50 + fs * 1.12;
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
  // 8. THE HERO — Super Mario Estrada, drawn for the poster, not the sprite
  //
  //    PROPORTION (rule 9): head 238 x 278; shoulder span 492 = 2.07 head
  //    widths; the silhouette is widest at the deltoids and TAPERS to the
  //    waist. Nothing below the shoulders may ever be wider than the
  //    shoulders — that is what read as "really really fat".
  // ==========================================================================
  const TB = H + 40;

  // backlight halo: separates the whole figure from the dusk
  c.fillStyle = rg(HX + 40, HY + 240, 60, HX + 40, HY + 260, 640, [
    [0, 'rgba(255,198,124,0.34)'], [0.5, 'rgba(255,150,110,0.13)'], [1, 'rgba(255,150,110,0)'],
  ]);
  c.fillRect(0, 0, W, H);

  // his shadow, thrown away from the sun
  c.save();
  c.globalAlpha = 0.5;
  c.fillStyle = 'rgba(14,5,28,1)';
  ell(HX - 210, GROUND + 106, 560, 66, -0.05);
  blurFill(30);
  c.restore();

  // ---- neck ---------------------------------------------------------------
  // RULE 11, and the user's own words: "neck of mario seem to a tree stump with
  // a head deposit on him". The previous pass drew the neck AFTER the torso,
  // closed its path at y=990 and stroked the closed path — so a flat, outlined,
  // constant-width tan bottom edge sat on the red shirt above the bib, which is
  // a stump however you shade it. The neck is now drawn HERE, before the torso,
  // so the trapezius occludes its base; it runs off to y=1080 where nothing can
  // see it; and only its two side contours are ever stroked. There is no bottom
  // edge left to show.
  {
    // narrower under the jaw than the jaw is (the sprite's constant-width
    // cylinder is what read as a stump), flaring hard into the trapezius
    const NL = [[HX - 42, 738], [HX - 52, 796, HX - 84, 856, HX - 134, 1000], [HX - 158, 1080]];
    const NR = [[HX + 158, 1080], [HX + 136, 1000], [HX + 92, 856, HX + 60, 796, HX + 50, 738]];
    const neck = () => path(NL.concat(NR));
    neck();
    c.fillStyle = lg(HX - 58, 780, HX + 74, 900, [[0, '#e0a473'], [0.45, '#c07f49'], [1, '#7a4c26']]);
    c.fill();
    c.save();
    neck();
    c.clip();
    // the jaw's cast shadow — this is what sets the head ON the neck
    c.fillStyle = 'rgba(80,30,8,0.78)';
    path([[HX - 96, 706], [HX + 104, 706], [HX + 86, 824, HX - 82, 828, HX - 96, 706]]);
    blurFill(13);
    // sternocleidomastoid: the cord that runs from behind the ear to the pit,
    // so the neck has an internal form instead of being one smooth taper
    stroke([[HX - 40, 786], [HX - 20, 844, HX + 10, 902]], 11, 'rgba(126,66,26,0.26)');
    stroke([[HX - 48, 782], [HX - 30, 840, HX - 4, 898]], 5, 'rgba(255,222,180,0.20)');
    c.fillStyle = lg(HX + 26, 0, HX + 74, 0, [[0, WARM + '0)'], [1, WARM + '0.85)']]);
    c.fillRect(HX + 20, 730, 100, 300);
    c.fillStyle = lg(HX - 60, 0, HX - 22, 0, [[0, COOL + '0.4)'], [1, COOL + '0)']]);
    c.fillRect(HX - 64, 730, 60, 300);
    c.restore();
    // SIDES ONLY — never the bottom
    stroke(NL, 7, SKIN_INK);
    stroke(NR, 7, SKIN_INK);
  }

  // ---- torso --------------------------------------------------------------
  const torso = () => {
    path([
      [HX - 244, 962],
      [HX - 232, 892, HX - 128, 856, HX - 6, 852],
      [HX + 118, 848, HX + 218, 878, HX + 232, 950],
      [HX + 234, 1046, HX + 216, 1140, HX + 202, 1210],
      [HX + 222, TB],
      [HX - 236, TB],
      [HX - 220, 1206, HX - 246, 1046, HX - 244, 962],
    ]);
  };
  torso();
  c.fillStyle = lg(HX - 250, 852, HX + 246, 1220, [
    [0, RED_HI], [0.24, RED], [0.62, RED_D], [1, '#5c0e18'],
  ]);
  c.fill();
  torso();
  ink(9, RED_INK);
  c.save();
  torso();
  c.clip();
  // key light on the near shoulder
  c.fillStyle = rg(HX - 140, 900, 20, HX - 110, 960, 360, [
    [0, 'rgba(255,168,150,0.36)'], [0.6, 'rgba(255,168,150,0.05)'], [1, 'rgba(255,168,150,0)'],
  ]);
  c.fillRect(HX - 260, 830, 520, 460);
  // sun rim down the right edge
  c.fillStyle = lg(HX + 130, 0, HX + 242, 0, [[0, WARM + '0)'], [1, WARM + '0.9)']]);
  c.fillRect(HX + 120, 830, 140, 470);
  // cool bounce on the left
  c.fillStyle = lg(HX - 250, 0, HX - 178, 0, [[0, COOL + '0.4)'], [1, COOL + '0)']]);
  c.fillRect(HX - 256, 850, 90, 440);
  // shirt folds
  c.strokeStyle = 'rgba(74,6,16,0.3)';
  c.lineWidth = 12;
  for (let i = 0; i < 3; i++) {
    c.beginPath();
    c.moveTo(HX - 206 + i * 26, 1010 + i * 24);
    c.quadraticCurveTo(HX - 130 + i * 30, 1112 + i * 22, HX - 196 + i * 30, 1234);
    c.stroke();
  }
  c.restore();

  // ---- arms ---------------------------------------------------------------
  const sleeve = (p0, p1, p2, w0, w1, rimSide) => {
    limbShape(p0, p1, p2, w0 + 13, w1 + 13);
    c.fillStyle = RED_INK;
    c.fill();
    limbShape(p0, p1, p2, w0, w1);
    c.fillStyle = lg(p0[0], p0[1] - 120, p2[0], p2[1] + 120,
      [[0, RED_HI], [0.34, RED], [1, RED_D]]);
    c.fill();
    c.save();
    limbShape(p0, p1, p2, w0, w1);
    c.clip();
    const mx = (p0[0] + p2[0]) / 2, my = (p0[1] + p2[1]) / 2;
    c.fillStyle = rg(mx - 40, my - 70, 10, mx, my, Math.max(w0, w1) * 2.1,
      [[0, 'rgba(255,170,152,0.16)'], [0.5, 'rgba(120,10,22,0.0)'], [1, 'rgba(90,6,18,0.6)']]);
    c.fillRect(Math.min(p0[0], p2[0]) - 260, Math.min(p0[1], p2[1]) - 260,
      Math.abs(p2[0] - p0[0]) + 520, Math.abs(p2[1] - p0[1]) + 520);
    c.restore();
    c.save();
    limbShape(p0, p1, p2, w0, w1);
    c.clip();
    // The rim must be offset PERPENDICULAR to the limb. The first pass shifted
    // it along world +x, which only lands on an edge when the arm is vertical:
    // on the near-horizontal sack arm the shift ran ALONG the limb and laid a
    // pale streak straight down the middle of the sleeve. A rim light that is
    // not on the rim is just a stripe.
    let nx = -(p2[1] - p0[1]), ny = p2[0] - p0[0];
    const nm = Math.hypot(nx, ny) || 1;
    nx = (nx / nm) * rimSide * 0.64;
    ny = (ny / nm) * rimSide * 0.64;
    limbShape([p0[0] + w0 * nx, p0[1] + w0 * ny], [p1[0] + w0 * nx, p1[1] + w0 * ny],
      [p2[0] + w1 * nx, p2[1] + w1 * ny], w0 * 0.16, w1 * 0.16);
    c.fillStyle = WARM + '0.9)';
    blurFill(5);
    c.restore();
    limbShape(p0, p1, p2, w0, w1);
    ink(7, RED_INK);
    // an elbow: a soft crease on the inside of the bend, so the arm is two
    // segments hinged rather than one macaroni tube
    c.save();
    limbShape(p0, p1, p2, w0, w1);
    c.clip();
    const ex = (p0[0] + 2 * p1[0] + p2[0]) / 4, ey = (p0[1] + 2 * p1[1] + p2[1]) / 4;
    c.fillStyle = 'rgba(74,6,16,0.34)';
    ell(ex, ey + w0 * 0.16, w0 * 0.62, w0 * 0.24, 0.2);
    blurFill(w0 * 0.12);
    c.fillStyle = 'rgba(255,166,148,0.20)';
    ell(ex, ey - w0 * 0.30, w0 * 0.50, w0 * 0.20, 0.2);
    blurFill(w0 * 0.14);
    c.restore();
    // NOTE: the wrist cuff is NOT drawn here. It belongs to the grip, which
    // knows where the hand actually presents its wrist — see `gripHand`.
  };
  // Each sleeve ENDS on the wrist point its own grip presents — computed, not
  // hand-picked. The shipped card had the right sleeve stopping 116 units
  // short of the hand and the left one arriving at the back of the knuckles.
  sleeve(SH_L, [HX - 300, 1010],
    wristOf(FIST_L[0], FIST_L[1], POLE_ANG, ARM_L, FIST_RAD, POLE_R), 118, 92, 1);
  // The old control at (HX+322, 1074) sagged 151 units off a 196-unit chord:
  // radius of curvature ~32 against a half-width of 50, so `limbShape`'s inner
  // offset curve folded through itself and the sleeve filled as a bow tie. Keep
  // the sag under the half-width or the arm tears.
  sleeve(SH_R, [HX + 316, 968],
    wristOf(FIST_R[0], FIST_R[1], NECK_ANG, ARM_R, FIST_RAD, SACK_HALF), 116, 92, 1);

  // ---- the takings ---------------------------------------------------------
  // The sack's NECK is one continuous column: a twisted knot ABOVE the fist,
  // the shaft THROUGH it, and the gathered mouth of the sack below. Rule 7 —
  // a fist parked on top of a bag is never holding it.
  const SNX = FIST_R[0] - 4;
  const SACKX = 1898, SACKY = 1126;
  gripHand(FIST_R[0], FIST_R[1], NECK_ANG, ARM_R, FIST_RAD, SACK_HALF, 'far');
  {
    const CANVASGOLD = (y0, y1) => lg(SNX - 60, y0, SNX + 60, y1,
      [[0, '#f4d795'], [0.45, '#c79b40'], [1, '#79581a']]);
    const knot = () => {
      path([
        [SNX - 30, 812],
        [SNX - 48, 782, SNX - 30, 756, SNX - 6, 754],
        [SNX + 26, 756, SNX + 46, 784, SNX + 32, 812],
      ]);
    };
    const neckCol = () => {
      path([
        [SNX - 27, 802],
        [SNX - 32, 862, SNX - 42, 924, SNX - 58, 992],
        [SNX + 62, 992],
        [SNX + 45, 924, SNX + 34, 862, SNX + 29, 802],
      ]);
    };
    const sack = () => {
      path([
        [SNX - 58, 960],
        [SACKX - 196, SACKY - 96, SACKX - 172, SACKY + 6, SACKX - 146, SACKY + 92],
        [SACKX - 120, SACKY + 178, SACKX + 118, SACKY + 184, SACKX + 148, SACKY + 90],
        [SACKX + 180, SACKY - 4, SACKX + 158, SACKY - 104, SNX + 62, SNY_TOP],
      ]);
    };
    const SNY_TOP = 960;
    knot();
    c.fillStyle = CANVASGOLD(754, 812);
    c.fill();
    ink(6, 'rgba(56,34,4,0.9)');
    stroke([[SNX - 20, 800], [SNX - 2, 784, SNX + 20, 780]], 5, 'rgba(80,50,8,0.5)');
    stroke([[SNX - 14, 784], [SNX + 6, 770]], 4, 'rgba(255,238,186,0.5)');
    neckRedraw = () => {
      neckCol();
      c.fillStyle = CANVASGOLD(802, 992);
      c.fill();
      c.save();
      neckCol();
      c.clip();
      c.fillStyle = lg(SNX - 30, 0, SNX + 30, 0, [[0, 'rgba(60,38,4,0.55)'], [0.45, 'rgba(60,38,4,0)'],
        [1, 'rgba(255,232,180,0.4)']]);
      c.fillRect(SNX - 80, 780, 170, 230);
      for (let i = -1; i <= 1; i++) {
        stroke([[SNX + i * 22, 806], [SNX + i * 28, 900, SNX + i * 34, 990]], 7, 'rgba(70,44,8,0.28)');
      }
      c.restore();
      neckCol();
      ink(6.5, 'rgba(56,34,4,0.9)');
    };
    neckRedraw();

    c.save();
    glow(58, 'rgba(255,178,80,0.5)');
    sack();
    c.fillStyle = '#a8802f';
    c.fill();
    noGlow();
    c.restore();
    c.save();
    sack();
    c.clip();
    c.fillStyle = rg(SACKX - 110, SACKY - 112, 14, SACKX - 28, SACKY - 6, 320, [
      [0, '#ffeeb8'], [0.22, '#dcb464'], [0.54, '#a67d31'], [0.82, '#6a4c16'], [1, '#3a2708'],
    ]);
    c.fillRect(SACKX - 340, SACKY - 360, 680, 720);
    const fold = (x0, y0, x1, y1, x2, y2, w) => {
      stroke([[x0, y0], [x1, y1, x2, y2]], w, 'rgba(62,38,6,0.40)');
      stroke([[x0 + w * 0.72, y0], [x1 + w * 0.72, y1, x2 + w * 0.72, y2]], w * 0.32, 'rgba(255,238,186,0.28)');
    };
    fold(SACKX - 96, SACKY - 116, SACKX - 166, SACKY + 18, SACKX - 122, SACKY + 166, 24);
    fold(SACKX - 30, SACKY - 122, SACKX - 60, SACKY + 24, SACKX - 26, SACKY + 178, 19);
    fold(SACKX + 50, SACKY - 118, SACKX + 88, SACKY + 14, SACKX + 56, SACKY + 172, 21);
    fold(SACKX + 110, SACKY - 100, SACKX + 158, SACKY + 24, SACKX + 124, SACKY + 150, 17);
    c.fillStyle = lg(0, SACKY + 24, 0, SACKY + 214, [[0, 'rgba(34,20,4,0)'], [1, 'rgba(28,16,3,0.78)']]);
    c.fillRect(SACKX - 260, SACKY - 340, 520, 700);
    c.fillStyle = lg(SACKX + 56, 0, SACKX + 190, 0, [[0, WARM + '0)'], [1, WARM + '0.98)']]);
    c.fillRect(SACKX + 40, SACKY - 360, 240, 720);
    c.fillStyle = lg(SACKX - 190, 0, SACKX - 96, 0, [[0, COOL + '0.30)'], [1, COOL + '0)']]);
    c.fillRect(SACKX - 240, SACKY - 360, 160, 720);
    const rr = rngFrom(5521);
    for (let i = 0; i < 1400; i++) {
      const gx = SACKX - 210 + rr() * 420, gy = SACKY - 170 + rr() * 400;
      c.fillStyle = rr() > 0.5 ? 'rgba(70,44,6,0.10)' : 'rgba(255,240,200,0.09)';
      c.fillRect(gx, gy, 1.3 + rr() * 2.1, 1.3 + rr() * 2.1);
    }
    c.save();
    c.translate(SACKX - 6, SACKY + 44);
    c.rotate(0.07);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = '900 186px "Lato", sans-serif';
    c.fillStyle = 'rgba(58,34,2,0.55)';
    c.fillText('$', 9, 9);
    c.fillStyle = 'rgba(255,244,204,0.5)';
    c.fillText('$', 0, 0);
    c.restore();
    c.restore();
    sack();
    ink(9, 'rgba(56,34,4,0.9)');
    // the rope biting the gathered mouth shut, well below the fist
    stroke([[SNX - 62, 968], [SNX + 2, 996, SNX + 66, 966]], 26, '#5f3c0b');
    stroke([[SNX - 60, 956], [SNX + 2, 984, SNX + 64, 954]], 16, '#8a5a10');
    stroke([[SNX - 56, 954], [SNX + 2, 978, SNX + 60, 952]], 5, 'rgba(255,224,158,0.6)');
    stroke([[SNX + 56, 974], [SNX + 92, 1000, SNX + 82, 1040]], 10, '#5f3c0b');
  }

  // coins tumbling out of the sack and bouncing away
  {
    const r = rngFrom(31337);
    const spill = [
      [1706, 1216, 27], [1626, 1250, 22], [2114, 1240, 24], [2186, 1204, 19],
      [1782, 1254, 20], [566, 1204, 21], [684, 1244, 17],
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
    const bx = HX - 4, by = 1104;
    const bib = () => path([[bx - 180, by - 66], [bx + 180, by - 66], [bx + 214, TB], [bx - 214, TB]]);
    bib();
    c.fillStyle = lg(bx - 210, by - 66, bx + 214, by + 280, [
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
    c.moveTo(bx - 164, by - 48); c.lineTo(bx + 164, by - 48);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = lg(bx + 128, 0, bx + 216, 0, [[0, WARM + '0)'], [1, WARM + '0.72)']]);
    c.fillRect(bx + 118, by - 80, 110, 380);
    c.fillStyle = lg(bx - 214, 0, bx - 146, 0, [[0, COOL + '0.32)'], [1, COOL + '0)']]);
    c.fillRect(bx - 216, by - 80, 90, 380);
    // the bib pocket, with the kingdom's savings not quite fitting in it
    coin(bx + 84, by + 82, 36, 0.5, true);
    coin(bx + 146, by + 66, 40, 5.6, true);
    // the certified excuse, half out of the bib pocket
    c.save();
    c.translate(bx + 108, by + 104);
    c.rotate(0.17);
    c.scale(0.82, 0.82);
    c.fillStyle = lg(0, -34, 0, 120, [[0, '#fdf4dc'], [0.6, '#e8d9b4'], [1, '#bda87e']]);
    path([[-94, -34], [94, -34], [88, 122], [-88, 122]]);
    c.fill();
    ink(6, 'rgba(78,58,20,0.85)');
    c.strokeStyle = 'rgba(120,96,54,0.55)';
    c.lineWidth = 5;
    for (let i = 0; i < 4; i++) {
      c.beginPath();
      c.moveTo(-66, 4 + i * 22);
      c.lineTo(i === 3 ? 6 : 62, 4 + i * 22);
      c.stroke();
    }
    ell(-40, 96, 22, 20, 0);
    c.fillStyle = '#b9302f';
    c.fill();
    ink(4, 'rgba(96,16,20,0.9)');
    c.restore();
    c.restore();
    // straps — they run up under the collar, which is drawn later and hides
    // their tops, so they read as straps and not as blue epaulettes
    const strap = (sx, dir, topX, topY) => {
      const pts = [[sx + dir * 6, by - 54], [sx + dir * 22, topY + 70, topX, topY]];
      stroke(pts, 46, BLU_INK, 'butt');
      stroke(pts, 36, lg(sx, by - 66, topX, topY, [[0, BLU], [1, BLU_HI]]), 'butt');
      stroke([[sx + dir * 6 + dir * 12, by - 54], [sx + dir * 22 + dir * 12, topY + 70, topX + dir * 12, topY]],
        8, dir > 0 ? WARM + '0.6)' : COOL + '0.35)', 'butt');
    };
    strap(bx - 180, -1, bx - 106, 894);
    strap(bx + 180, 1, bx + 106, 910);
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
    button(bx - 142, by - 34, 29);
    button(bx + 142, by - 34, 29);
  }

  // -- the two grips: (c) the near fingers + thumb close over the front ----
  gripHand(FIST_L[0], FIST_L[1], POLE_ANG, ARM_L, FIST_RAD, POLE_R, 'near', poleRedraw);
  gripHand(FIST_R[0], FIST_R[1], NECK_ANG, ARM_R, FIST_RAD, SACK_HALF, 'near', neckRedraw);

  // ---- collar (on top of the shirt, wrapping the neck drawn far above) -----
  {
    path([[HX - 128, 836], [HX - 52, 878, HX + 58, 878, HX + 132, 836],
      [HX + 152, 886], [HX + 56, 946, HX - 54, 946, HX - 148, 882]]);
    c.fillStyle = lg(HX - 120, 0, HX + 120, 0, [[0, '#8d1620'], [0.5, RED_D], [1, '#e8695c']]);
    c.fill();
    ink(8, RED_INK);
    stroke([[HX - 108, 862], [HX - 34, 908, HX + 58, 904]], 6, 'rgba(255,150,130,0.3)');
  }

  // ---- the head -----------------------------------------------------------
  c.save();
  c.translate(HX, HY);
  c.rotate(-0.05);
  c.scale(u * 0.95, u * 1.04);
  drawHead(false);
  c.restore();

  // ==========================================================================
  // 9. TITLE LOCKUP — the game's own gold arch wordmark, at poster size
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
  c.fillStyle = lg(0, 0, 0, 420, [[0, 'rgba(10,4,26,0.56)'], [0.7, 'rgba(10,4,26,0.18)'], [1, 'rgba(10,4,26,0)']]);
  c.fillRect(0, 0, W, 420);
  wordmark('SUPER MARIO', 1200, 22, 13, 21);
  wordmark('ESTRADA', 1200, 118, 25, 19);

  // ==========================================================================
  // 10. STRAPLINE BANNER
  // ==========================================================================
  {
    const y0 = 318, y1 = 392, x0 = 452, x1 = 1948, notch = 38;
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
    let px = 60;
    for (;;) {
      c.font = '900 ' + px + 'px "Lato", sans-serif';
      if (c.measureText(label).width <= (x1 - x0) - 190 || px <= 24) break;
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
  // 11. FOREGROUND — out-of-focus coins, dust in the light, vignette, grade
  // ==========================================================================
  {
    const r = rngFrom(88117);
    const spots = [[2288, 1214, 62], [788, 1230, 46]];
    for (const [x, y, rad] of spots) {
      c.save();
      c.filter = 'blur(' + (7 + r() * 4).toFixed(1) + 'px)';
      c.globalAlpha = 0.92;
      coin(x, y, rad, 0.35 + r(), true);
      c.restore();
    }
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
  const headOnly = process.env.HEAD_ONLY ? resolve(process.env.HEAD_ONLY) : null;
  const guides = process.env.GUIDES === '1';
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
        document.getElementById('big').getContext('2d'), ${BIG_W}, ${BIG_H}, window.__cast,
        ${JSON.stringify({ headOnly: !!headOnly, guides })})`);

      if (headOnly) {
        const png = await page.evaluate(() => document.getElementById('big').toDataURL('image/png'));
        mkdirSync(dirname(headOnly), { recursive: true });
        writeFileSync(headOnly, Buffer.from(png.split(',')[1], 'base64'));
        process.stdout.write('head written: ' + headOnly + '\n');
        return;
      }

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
