// ============================================================================
// The settings panel — ONE implementation shared by the title screen and the
// in-level pause menu (playtest ask: rebind keys / adjust volumes mid-game).
// House rule: menu-like surfaces never fork their input logic; this component
// consumes the caller's MenuNav and reads raw edges only while rebinding.
// ============================================================================

import type { ActionId } from '../core/types.ts';
import { VIEW_H, VIEW_W } from '../core/constants.ts';
import { keyLabel } from '../core/keyboardLayout.ts';
import type { Services } from '../game/game.ts';
import type { MenuNav } from './menuInput.ts';
import { UI, panel, textShadow } from './theme.ts';

export const REBINDABLE: ActionId[] = ['left', 'right', 'up', 'down', 'jump', 'run', 'pause', 'swap'];

function bar(v: number): string {
  const n = Math.round(v * 10);
  return '█'.repeat(n) + '░'.repeat(10 - n);
}

export class SettingsPanel {
  private sel = 0;
  /** Action currently waiting for a key, if any. */
  private rebinding: ActionId | null = null;

  constructor(
    private readonly services: Services,
    private readonly nav: MenuNav,
  ) {}

  /** Advance one frame. Returns false the frame the user backs out. */
  update(): boolean {
    const { input, sfx, settings, saveSettings, music } = this.services;

    if (this.rebinding) {
      const code = [...input.edges()][0];
      if (code) {
        if (code !== 'Escape') {
          settings.bindings[this.rebinding] =
            [code, ...settings.bindings[this.rebinding].filter(c => c !== code)].slice(0, 2);
          saveSettings();
        }
        sfx.play('ui-select');
        this.rebinding = null;
      }
      return true;
    }

    const action = this.nav.poll();
    if (!action) return true;

    // rows: 0 music vol, 1 sfx vol, 2 reduced motion, 3.. bindings, last: back
    const rows = 3 + REBINDABLE.length + 1;
    if (action === 'back') { sfx.play('ui-back'); return false; }
    if (action === 'up') { this.sel = (this.sel + rows - 1) % rows; sfx.play('ui-move'); return true; }
    if (action === 'down') { this.sel = (this.sel + 1) % rows; sfx.play('ui-move'); return true; }

    const dir = action === 'left' ? -1 : action === 'right' ? 1 : 0;
    if (this.sel === 0 && dir) {
      settings.musicVol = Math.max(0, Math.min(1, settings.musicVol + dir * 0.1));
      music.setVolume(settings.musicVol);
      saveSettings(); sfx.play('ui-move');
    } else if (this.sel === 1 && dir) {
      settings.sfxVol = Math.max(0, Math.min(1, settings.sfxVol + dir * 0.1));
      sfx.setVolume(settings.sfxVol);
      saveSettings(); sfx.play('coin');
    } else if (this.sel === 2 && (dir || action === 'select')) {
      settings.reducedMotion = settings.reducedMotion === null ? true
        : settings.reducedMotion ? false : null;
      saveSettings(); sfx.play('ui-select');
    } else if (action === 'select') {
      if (this.sel >= 3 && this.sel < 3 + REBINDABLE.length) {
        this.rebinding = REBINDABLE[this.sel - 3] ?? null;
        sfx.play('ui-select');
      } else if (this.sel === rows - 1) {
        sfx.play('ui-back');
        return false;
      }
    }
    return true;
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    panel(ctx, 60, 32, VIEW_W - 120, VIEW_H - 64, {});
    ctx.font = UI.fontHead;
    textShadow(ctx, 'SETTINGS — THE FINE PRINT', 80, 56, UI.accent);
    ctx.font = UI.fontBody;
    const rows: [string, string][] = [
      ['MUSIC', bar(this.services.settings.musicVol)],
      ['SFX', bar(this.services.settings.sfxVol)],
      ['REDUCED MOTION', this.services.settings.reducedMotion === null ? 'SYSTEM' : this.services.settings.reducedMotion ? 'ON' : 'OFF'],
      ...REBINDABLE.map((a): [string, string] => [
        a.toUpperCase(),
        this.rebinding === a ? 'PRESS A KEY…' : (this.services.settings.bindings[a] ?? []).map(keyLabel).join(' / '),
      ]),
      ['BACK', ''],
    ];
    let y = 84;
    for (let i = 0; i < rows.length; i++) {
      const [label, value] = rows[i]!;
      const focus = i === this.sel;
      textShadow(ctx, (focus ? '▶ ' : '  ') + label, 84, y, focus ? UI.accent : UI.text);
      textShadow(ctx, value, 300, y, focus ? UI.text : UI.textDim);
      y += 19;
    }
    ctx.font = UI.fontSmall;
    const pads = this.services.input.padCount();
    textShadow(
      ctx,
      pads > 0 ? `🎮 ${pads} gamepad${pads > 1 ? 's' : ''} connected` : '🎮 no gamepad detected (plug in & press a button)',
      84, VIEW_H - 44, pads > 0 ? UI.ok : UI.textDim,
    );
    textShadow(ctx, 'keys are POSITIONS: labels follow your real layout (AZERTY-safe)', 84, VIEW_H - 56, UI.textDim);
    ctx.restore();
  }
}
