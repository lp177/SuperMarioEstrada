import type { SceneLike, SceneParams } from '../core/types.ts';
import { VIEW_H, VIEW_W } from '../core/constants.ts';
import type { Game, Services } from '../game/game.ts';
import { Level } from '../game/level.ts';
import { recordClear } from '../game/progress.ts';
import { LEVELS } from '../levels/index.ts';
import { nextAfter } from '../levels/maps.ts';
import { FxSystem } from '../fx/fx.ts';
import { drawBackground } from '../render/background.ts';
import { buildDecor, drawDecor, type Decor } from '../render/decor.ts';
import { drawBoss, drawEntities, drawGoal, drawPlayer, drawTiles } from '../render/painter.ts';
import { drawHud } from '../ui/hud.ts';
import { MenuNav } from '../ui/menuInput.ts';
import { UI, panel, textShadow } from '../ui/theme.ts';

const PAUSE_ITEMS = ['RESUME', 'RESTART ACT', 'QUIT TO MAP'] as const;

function idHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export class LevelScene implements SceneLike {
  private frame = 0;
  private level: Level;
  private fx: FxSystem;
  private decor: Decor[];
  private paused = false;
  private pauseSel = 0;
  private nav: MenuNav;
  /** Post-goal sting: excuse card. */
  private sting = false;
  private advanced = false;
  private bossMusic = false;

  constructor(
    private readonly game: Game,
    private readonly services: Services,
    private readonly params: SceneParams['level'],
  ) {
    const def = LEVELS.find(d => d.id === params.levelId);
    if (!def) throw new Error(`unknown level id: ${params.levelId}`);
    this.level = new Level(def);
    this.fx = new FxSystem(services.reducedMotion);
    this.decor = buildDecor(def.theme, this.level.map, idHash(def.id));
    this.nav = new MenuNav(services.input);
    // Every act gets its own deterministic arrangement of its world's theme.
    services.music.play(def.theme, { variant: idHash(def.id) });
  }

  update(): void {
    // frame++ stays above every early return: shake jitter and menu pulses
    // are functions of frame and must keep animating while paused/frozen.
    this.frame++;
    const { input, sfx, music } = this.services;
    if (input.edges().size > 0) sfx.ensure();
    const st = input.state();

    if (this.paused) {
      this.updatePause();
      return;
    }
    if (st.pausePressed && !this.level.finished) {
      this.paused = true;
      this.pauseSel = 0;
      sfx.play('ui-select');
      music.playPause(); // the rescue is now ON HOLD (rotating hold muzak)
      return;
    }

    if (this.sting) {
      music.update();
      if (st.jumpPressed || input.edges().has('Enter')) this.advance();
      return;
    }

    if (this.fx.tickFreeze()) {
      this.fx.update(); // trauma/flash decay continues; particle ages gate inside
      music.update();
      return;
    }

    const events = this.level.update(st);
    for (const ev of events) {
      const src = this.level.eventSources.get(ev);
      const x = src ? src.x : this.level.player.x;
      const y = src ? src.y : this.level.player.y;
      sfx.play(ev);
      this.fx.onEvent(ev, x, y);
    }
    this.fx.update();

    // Music: boss takeover and hand-back, intensity from the sim.
    const bossActive = this.level.boss !== null
      && (this.level.boss.phase === 'intro' || this.level.boss.phase === 'fight');
    if (bossActive && !this.bossMusic) { music.takeover('boss'); this.bossMusic = true; }
    if (!bossActive && this.bossMusic) { music.release(); this.bossMusic = false; }
    music.setIntensity(this.level.intensity);
    music.update();

    if (this.level.finished && !this.sting) this.sting = true;
  }

  private updatePause(): void {
    const { sfx, music } = this.services;
    const action = this.nav.poll();
    if (!action) return;
    if (action === 'back') { this.paused = false; sfx.play('ui-back'); music.endPause(); return; }
    if (action === 'up') { this.pauseSel = (this.pauseSel + PAUSE_ITEMS.length - 1) % PAUSE_ITEMS.length; sfx.play('ui-move'); }
    if (action === 'down') { this.pauseSel = (this.pauseSel + 1) % PAUSE_ITEMS.length; sfx.play('ui-move'); }
    if (action === 'select') {
      sfx.play('ui-select');
      const item = PAUSE_ITEMS[this.pauseSel];
      if (item === 'RESUME') { this.paused = false; music.endPause(); }
      else if (item === 'RESTART ACT') this.game.changeScene('level', { levelId: this.params.levelId });
      else this.game.changeScene('worldmap', { focus: this.params.levelId });
    }
  }

  private advance(): void {
    if (this.advanced) return;
    this.advanced = true;
    const { progress, setProgress } = this.services;
    const def = this.level.def;
    const s = this.level.stats;
    setProgress(recordClear(progress, def.id, {
      coins: s.coins,
      goldbars: s.goldbars.filter(Boolean).length,
      secrets: s.secrets.filter(Boolean).length,
      deaths: s.deaths,
      timeFrames: s.frames,
    }));
    // Mario-map flow: back to the corkboard, focused one step forward.
    const focus = nextAfter(def.id);
    if (def.cutsceneAfter) {
      this.game.changeScene('cutscene', {
        id: def.cutsceneAfter,
        then: def.cutsceneAfter === 'ending'
          ? { scene: 'title' }
          : { scene: 'worldmap', focus },
      });
    } else {
      this.game.changeScene('worldmap', { focus });
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const cam = this.level.camera;
    const shake = this.fx.shakeOffset(this.frame);
    const scam = { x: cam.x + shake.x, y: cam.y + shake.y };

    drawBackground(ctx, this.level.def.theme, scam, this.frame);
    // drawDecor subtracts the camera itself — pass cam, do NOT also translate
    // (double-offsetting sent trucks and grass into the sky; one owner only).
    drawDecor(ctx, this.decor, scam, 'back', this.frame);
    drawTiles(ctx, this.level, scam);
    this.fx.renderGround(ctx, scam);
    drawEntities(ctx, this.level, scam, this.frame);
    if (this.level.boss) drawBoss(ctx, this.level.boss, scam, this.frame);
    drawPlayer(ctx, this.level.player, scam, this.frame);
    drawGoal(ctx, this.level, scam, this.frame);
    this.fx.renderAir(ctx, scam);
    drawDecor(ctx, this.decor, scam, 'front', this.frame);

    const flash = this.fx.flash();
    if (flash) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = flash.alpha;
      ctx.fillStyle = flash.color;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.globalAlpha = 1;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawHud(ctx, this.level, this.frame);

    if (this.sting) this.renderSting(ctx);
    if (this.paused) this.renderPause(ctx);
  }

  private renderSting(ctx: CanvasRenderingContext2D): void {
    const def = this.level.def;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    panel(ctx, 60, 90, VIEW_W - 120, 150, { focus: true });
    ctx.font = UI.fontHead;
    textShadow(ctx, 'MISSION FAILED SUCCESSFULLY', 108, 122, UI.accent);
    ctx.font = UI.fontBody;
    textShadow(ctx, 'Official excuse, certified:', 84, 148, UI.textDim);
    // wrap the excuse
    const words = `"${def.excuse}"`.split(' ');
    let line = '';
    let y = 168;
    for (const w of words) {
      const probe = line ? line + ' ' + w : w;
      if (ctx.measureText(probe).width > VIEW_W - 180 && line) {
        textShadow(ctx, line, 84, y, UI.text);
        line = w; y += 16;
      } else line = probe;
    }
    if (line) textShadow(ctx, line, 84, y, UI.text);
    textShadow(ctx, '— S. M. Estrada, hero', VIEW_W - 250, y + 22, UI.accent2);
    if (this.frame % 60 < 40) {
      ctx.font = UI.fontSmall;
      textShadow(ctx, 'JUMP: continue', VIEW_W / 2 - 40, 228, UI.textDim);
    }
    ctx.restore();
  }

  private renderPause(ctx: CanvasRenderingContext2D): void {
    // World painters may leave textAlign centered — the UI owns its own state.
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const pw = 224;
    const ph = 118;
    const px = (VIEW_W - pw) / 2;
    const py = (VIEW_H - ph) / 2 - 20;
    panel(ctx, px, py, pw, ph, { focus: true });
    const cx = VIEW_W / 2;
    ctx.font = UI.fontHead;
    textShadow(ctx, 'ON BREAK', cx, py + 30, UI.accent);
    ctx.font = UI.fontBody;
    let y = py + 58;
    for (let i = 0; i < PAUSE_ITEMS.length; i++) {
      const item = PAUSE_ITEMS[i] ?? '';
      const focus = i === this.pauseSel;
      textShadow(ctx, item, cx, y, focus ? UI.accent : UI.text);
      if (focus) {
        const w = ctx.measureText(item).width;
        textShadow(ctx, '▶', cx - w / 2 - 14, y, UI.accent);
      }
      y += 20;
    }
    ctx.restore();
  }
}
