// ============================================================================
// ui/hud.ts — the in-level heads-up display.
// STATELESS by design: drawHud derives everything from (level, frame) and
// keeps no memory between calls. All colors/fonts come from ui/theme.ts —
// no hex literals here (house rule 9).
//
// CONTRACT WITH THE CALLER: drawHud is called AFTER the camera transform has
// been reset to identity. All coordinates below are raw virtual-screen pixels
// (640x360).
//
// Layout:
//   top strip   — left: coin icon + count, plus the notary's stamp forever
//                 wobbling beside the till (the notary is always watching);
//                 center: "W{world}-{act} {title}"; right: 5 gold-bar pips,
//                 3 secret pips, deaths count with a tiny capped skull.
//   below-left  — powerup badge (stamp = Certified, pen = Gold Pen) and the
//                 Parliamentary Immunity badge with its draining ring.
//   bottom      — Bowsonaro nameplate + HP shells while a boss is on stage.
// ============================================================================

import type { BossPhase, LevelLike, PlayerLike, PlayerSize } from '../core/types.ts';
import { BOSS, PHYS, VIEW_H, VIEW_W } from '../core/constants.ts';
import { UI, panel, textShadow } from './theme.ts';

/** Height of the translucent top strip, px. */
const STRIP_H = 22;

export function drawHud(ctx: CanvasRenderingContext2D, level: LevelLike, frame: number): void {
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  // Translucent top strip so counters read over any sky.
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = UI.bg;
  ctx.fillRect(0, 0, VIEW_W, STRIP_H);
  ctx.globalAlpha = 1;

  drawCoinCounter(ctx, level, frame);
  drawActTitle(ctx, level);
  drawTallyRight(ctx, level);
  drawPowerupState(ctx, level.player);
  drawBossBar(ctx, level, frame);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Top-left: coins + the ever-wobbling notary stamp
// ---------------------------------------------------------------------------

function drawCoinCounter(ctx: CanvasRenderingContext2D, level: LevelLike, frame: number): void {
  drawCoinIcon(ctx, 16, 11);
  ctx.font = UI.fontHead;
  textShadow(ctx, `x${level.stats.coins}`, 26, 3, UI.text);
  // The notary stamp wobbles beside the till at all times — every coin you
  // grab is already certified as somebody else's.
  drawStampIcon(ctx, 96, 10, Math.sin(frame * 0.09) * 0.22);
}

function drawCoinIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fillStyle = UI.accent;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = UI.outline;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
  ctx.stroke();
}

/** Notary stamp: grey knob + stem over a red ink base. `tilt` in radians. */
function drawStampIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, tilt: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  ctx.fillStyle = UI.textDim;
  ctx.beginPath();
  ctx.arc(0, -6, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-1.5, -6, 3, 6);
  ctx.fillStyle = UI.accent2;
  ctx.fillRect(-6, 0, 12, 4);
  ctx.lineWidth = 1;
  ctx.strokeStyle = UI.outline;
  ctx.strokeRect(-6, 0, 12, 4);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Top-center: act identity
// ---------------------------------------------------------------------------

function drawActTitle(ctx: CanvasRenderingContext2D, level: LevelLike): void {
  const d = level.def;
  ctx.font = UI.fontSmall;
  ctx.textAlign = 'center';
  textShadow(ctx, `W${d.world}-${d.act}  ${d.title}`, Math.floor(VIEW_W / 2), 7, UI.textDim);
  ctx.textAlign = 'left';
}

// ---------------------------------------------------------------------------
// Top-right: gold bars, secrets, deaths
// ---------------------------------------------------------------------------

function drawTallyRight(ctx: CanvasRenderingContext2D, level: LevelLike): void {
  const stats = level.stats;
  let x = VIEW_W - 152;
  for (let i = 0; i < 5; i++) {
    drawGoldbarPip(ctx, x, 8, stats.goldbars[i] === true);
    x += 11;
  }
  x += 6;
  for (let i = 0; i < 3; i++) {
    drawSecretPip(ctx, x + 4, 11, stats.secrets[i] === true);
    x += 11;
  }
  x += 6;
  drawSkullIcon(ctx, x, 11);
  ctx.font = UI.fontBody;
  textShadow(ctx, `${stats.deaths}`, x + 9, 5, UI.textDim);
}

function drawGoldbarPip(ctx: CanvasRenderingContext2D, x: number, y: number, filled: boolean): void {
  ctx.fillStyle = filled ? UI.accent : UI.surfaceHi;
  ctx.fillRect(x, y, 8, 5);
  ctx.lineWidth = 1;
  ctx.strokeStyle = UI.outline;
  ctx.strokeRect(x, y, 8, 5);
}

function drawSecretPip(ctx: CanvasRenderingContext2D, cx: number, cy: number, found: boolean): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - 4);
  ctx.lineTo(cx + 4, cy);
  ctx.lineTo(cx, cy + 4);
  ctx.lineTo(cx - 4, cy);
  ctx.closePath();
  ctx.fillStyle = found ? UI.ok : UI.surfaceHi;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = UI.outline;
  ctx.stroke();
}

/** Tiny skull wearing the hero's little red cap. Heroes die too — allegedly. */
function drawSkullIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.fillStyle = UI.text;
  ctx.beginPath();
  ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(cx - 2, cy + 2, 4, 3);
  ctx.fillStyle = UI.outline;
  ctx.fillRect(cx - 2.5, cy - 1, 1.5, 2);
  ctx.fillRect(cx + 1, cy - 1, 1.5, 2);
  ctx.fillStyle = UI.accent2;
  ctx.beginPath();
  ctx.arc(cx, cy - 2, 3.5, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(cx, cy - 5, 5, 1.5);
}

// ---------------------------------------------------------------------------
// Below-left: powerup state
// ---------------------------------------------------------------------------

type IconDrawer = (ctx: CanvasRenderingContext2D, cx: number, cy: number) => void;

/** Exhaustive over PlayerSize — a new size does not compile until it declares
 *  its HUD badge here (explicitly null = "no badge", the small default). */
const SIZE_ICON: Record<PlayerSize, IconDrawer | null> = {
  small: null,
  certified: (ctx, cx, cy) => drawStampIcon(ctx, cx, cy + 3, 0),
  goldpen: drawPenIcon,
};

function drawPowerupState(ctx: CanvasRenderingContext2D, player: PlayerLike): void {
  const icon = SIZE_ICON[player.size];
  if (icon === undefined) {
    throw new Error(`hud: unknown player size '${String(player.size)}'`);
  }
  const x = 16;
  const y = STRIP_H + 16;
  if (icon !== null) {
    panel(ctx, x - 10, y - 10, 20, 20);
    icon(ctx, x, y);
  }
  if (player.immunityT > 0) {
    drawImmunityBadge(ctx, icon !== null ? x + 28 : x, y, player.immunityT / PHYS.immunity);
  }
}

function drawPenIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 4);
  ctx.fillStyle = UI.accent;
  ctx.fillRect(-1.5, -7, 3, 10);
  ctx.lineWidth = 1;
  ctx.strokeStyle = UI.outline;
  ctx.strokeRect(-1.5, -7, 3, 10);
  ctx.beginPath();
  ctx.moveTo(-1.5, 3);
  ctx.lineTo(1.5, 3);
  ctx.lineTo(0, 7);
  ctx.closePath();
  ctx.fillStyle = UI.text;
  ctx.fill();
  ctx.restore();
}

/** Parliamentary Immunity: gold badge, ring drains as the immunity runs out.
 *  `frac` = remaining fraction (player.immunityT / PHYS.immunity). */
function drawImmunityBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  frac: number,
): void {
  const f = Math.max(0, Math.min(1, frac));
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fillStyle = UI.accent;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = UI.outline;
  ctx.stroke();
  ctx.font = UI.fontSmall;
  ctx.textAlign = 'center';
  ctx.fillStyle = UI.outline;
  ctx.fillText('P', cx, cy - 4);
  ctx.textAlign = 'left';
  ctx.beginPath();
  ctx.arc(cx, cy, 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f);
  ctx.strokeStyle = UI.accent;
  ctx.lineWidth = 2;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Bottom-center: Bowsonaro on stage
// ---------------------------------------------------------------------------

/** Exhaustive over BossPhase — a new phase does not compile until it declares
 *  whether the HP bar shows during it. */
const BOSS_BAR_VISIBLE: Record<BossPhase, boolean> = {
  off: false,
  intro: true,
  fight: true,
  escape: false,
  defeated: false,
};

function drawBossBar(ctx: CanvasRenderingContext2D, level: LevelLike, frame: number): void {
  const boss = level.boss;
  if (boss === null) return;
  const visible = BOSS_BAR_VISIBLE[boss.phase];
  if (visible === undefined) {
    throw new Error(`hud: unknown boss phase '${String(boss.phase)}'`);
  }
  if (!visible) return;

  const maxHp = level.def.bossRage === true ? BOSS.rageHp : BOSS.hp;
  const shells = Math.max(maxHp, boss.hp);
  const cx = Math.floor(VIEW_W / 2);

  const plateW = 148;
  const plateH = 20;
  const plateY = VIEW_H - 48;
  panel(ctx, cx - plateW / 2, plateY, plateW, plateH);
  ctx.font = UI.fontHead;
  ctx.textAlign = 'center';
  textShadow(ctx, 'BOWSONARO', cx, plateY + 2, UI.accent2);
  ctx.textAlign = 'left';

  const gap = 16;
  let x = cx - ((shells - 1) * gap) / 2;
  const y = VIEW_H - 16;
  for (let i = 0; i < shells; i++) {
    drawShellPip(ctx, x, y, i < boss.hp, frame);
    x += gap;
  }
}

/** One HP pip: a spiked shell dome. Filled shells breathe slightly. */
function drawShellPip(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  filled: boolean,
  frame: number,
): void {
  const r = filled ? 5 + Math.sin(frame * 0.12) * 0.6 : 5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 0);
  ctx.closePath();
  ctx.fillStyle = filled ? UI.ok : UI.surfaceHi;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = UI.outline;
  ctx.stroke();
  if (filled) {
    ctx.fillStyle = UI.text;
    for (let i = -1; i <= 1; i++) {
      const sx = cx + i * 3;
      ctx.beginPath();
      ctx.moveTo(sx - 1, cy - r + 2);
      ctx.lineTo(sx + 1, cy - r + 2);
      ctx.lineTo(sx, cy - r - 1);
      ctx.closePath();
      ctx.fill();
    }
  }
}
