import type { SceneLike, SceneParams } from '../core/types.ts';
import { VIEW_H, VIEW_W } from '../core/constants.ts';
import type { Game, Services } from '../game/game.ts';
import { SCRIPTS } from '../game/story.ts';
import { markSeen } from '../game/progress.ts';
import { drawCutsceneArt } from '../render/cutsceneArt.ts';
import { UI, panel, textShadow } from '../ui/theme.ts';

const CHARS_PER_STEP = 2;

/** Keypress-advanced, skippable, doubles as the loading screen for whatever
 *  comes next (the next scene builds after the fade — never a visible wait). */
export class CutsceneScene implements SceneLike {
  private beat = 0;
  private shown = 0;
  private frame = 0;
  private done = false;

  constructor(
    private readonly game: Game,
    private readonly services: Services,
    private readonly params: SceneParams['cutscene'],
  ) {
    services.music.play(SCRIPTS[params.id].music);
  }

  private get script() {
    return SCRIPTS[this.params.id];
  }

  update(): void {
    this.frame++;
    const { input, sfx } = this.services;
    const st = input.state();
    const edges = input.edges();
    if (edges.size > 0) sfx.ensure();

    const beat = this.script.beats[this.beat];
    if (!beat || this.done) return;

    const full = beat.text.length;
    if (this.shown < full) {
      this.shown = Math.min(full, this.shown + CHARS_PER_STEP);
      if (this.shown % 6 < CHARS_PER_STEP) sfx.play('text-blip');
    }

    if (edges.has('Escape')) {
      this.finish();
      return;
    }
    if (st.jumpPressed || edges.has('Enter')) {
      if (this.shown < full) {
        this.shown = full; // first press completes the line
      } else {
        sfx.play('ui-select');
        this.beat++;
        this.shown = 0;
        if (this.beat >= this.script.beats.length) this.finish();
      }
    }
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.services.setProgress(markSeen(this.services.progress, this.params.id));
    const next = this.params.then;
    if (next.scene === 'level') this.game.changeScene('level', { levelId: next.levelId });
    else if (next.scene === 'worldmap') this.game.changeScene('worldmap', { focus: next.focus });
    else this.game.changeScene('title', {});
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = UI.bg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const beat = this.script.beats[Math.min(this.beat, this.script.beats.length - 1)];
    if (!beat) return;
    drawCutsceneArt(ctx, beat.art, this.frame);

    // Letterbox dialog box over the bottom.
    const boxH = 84;
    panel(ctx, 8, VIEW_H - boxH - 8, VIEW_W - 16, boxH, {});
    if (beat.speaker) {
      ctx.fillStyle = UI.accent2;
      ctx.fillRect(20, VIEW_H - boxH - 16, 8 + beat.speaker.length * 8, 16);
      ctx.font = UI.fontBody;
      textShadow(ctx, beat.speaker, 24, VIEW_H - boxH - 4, '#fff');
    }
    ctx.font = UI.fontBody;
    const text = beat.text.slice(0, this.shown);
    wrapText(ctx, text, 22, VIEW_H - boxH + 14, VIEW_W - 44, 15);

    if (this.shown >= beat.text.length && this.frame % 60 < 40) {
      ctx.font = UI.fontSmall;
      textShadow(ctx, 'JUMP: next    ESC: skip', VIEW_W - 170, VIEW_H - 16, UI.textDim);
    }
  }
}

function wrapText(
  ctx: CanvasRenderingContext2D, text: string,
  x: number, y: number, maxW: number, lineH: number,
): void {
  const words = text.split(' ');
  let line = '';
  let yy = y;
  for (const w of words) {
    const probe = line ? line + ' ' + w : w;
    if (ctx.measureText(probe).width > maxW && line) {
      textShadow(ctx, line, x, yy, UI.text);
      line = w;
      yy += lineH;
    } else {
      line = probe;
    }
  }
  if (line) textShadow(ctx, line, x, yy, UI.text);
}
