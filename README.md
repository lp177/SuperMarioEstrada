# Super Mario Estrada 🍄📜

**Super Mario Estrada** is a satirical 2D platformer about **the greatest rescue that never
happened**. Trump, Bolsonaro and a moustachioed grifter named Mario Estrada convince the whole
Mushroom Kingdom to bet its gold on one "impossible" event — *"Princess Peach will never be
kidnapped"* — certify every coin through a very respectable royal notary, then kidnap her
themselves. Trump squeezes into the dress and becomes **Princess Impeach** (enormous hands,
suspicious accent), Bolsonaro straps on a spiked shell as **Bowsonaro**, and Estrada plays the
hero who always arrives *just* too late. **You play Mangiani** — the honest brother who lost
everything on the bet and is the only one actually fighting through the kingdom. Estrada
"leads" the rescue from somewhere behind you, arrives at every castle just in time to plant a
*MISSION FAILED SUCCESSFULLY* flag over work you did, and files a certified excuse. A swap key
lets you take Estrada for a stroll yourself, and in local co-op a second player IS Estrada —
secondary keys (the arrows) on a shared keyboard, or a second gamepad. Level after level, the
excuses stop adding up — and Mangiani is starting to notice things.

**▶ Play it: <https://lp177.github.io/SuperMarioEstrada/>**

## How it works

- **A 30-act campaign across 4 worlds**, laid out on the conspirators' own **corkboard map** —
  polaroids, pins and red yarn. Paths branch, some acts are optional bonuses, and every
  cleared act can be replayed from the board.
- **Every world is a set built by one conspirator** — and they are terrible at stagecraft.
  Estrada's meadow is his hero-movie set; Impeach runs the coin-laundering sewers *and* the
  casino (he insisted on two); the final palace is Bowsonaro's. Expect bushes on visible prop
  sticks, duct-taped backdrop seams, boom mics dipping into frame, clapperboards, cardboard
  Toad audiences — and it only gets lazier the deeper you go.
- **Every enemy is somebody's cousin, lawyer or army buddy** in a bad Mario-enemy costume:
  back zippers, "HELLO I'M…" name tags, human shoes. The castle's "rat" is just a capybara.
  Nobody is fooled. Everybody pretends.
- **Classic platforming, tuned generous**: run, variable jumps with coyote time and jump
  buffering, stomps, shell kicks, ?-blocks, springs, crumbling IOU-note bridges. Power-ups:
  the **Notary Stamp** (grow Certified), the **Golden Pen** (throw exploding pens) and
  **Parliamentary Immunity** (exactly what it sounds like).
- **Staged boss "fights"** at every castle: bounce Bowsonaro three times and watch him escape
  by jetpack while Estrada plants a **MISSION FAILED SUCCESSFULLY** flag and files a unique
  certified excuse. The last castle, with Mangiani watching, goes differently.
- **Five cutscenes** advance the con — the scam, the warm coffee cup, the accent, the
  forty-centimeter hands, the wig. Keypress-advanced, always skippable.
- **Chiptune score that serves the fiction**: an ersatz spaghetti-western for the movie set, a
  dripping laundromat groove for the pipes, swing for the casino, and a military parade with
  exactly one sour brass note per loop (the pit orchestra came with the set). Every act gets
  its own arrangement of its world's theme, the title screen rotates three con-man tunes, and
  pausing plays genuine hold muzak — *"Your Rescue Is Important to Us."* Music pauses when
  the tab loses focus.
- **Game feel everywhere**: screen shake, hit-stop on landed hits only, particles, squash and
  stretch, confetti — all synthesized and drawn in code, zero asset files. Honors
  `prefers-reduced-motion` (plus a Settings override).
- **Progress auto-saves** locally: per-act bests (coins, gold bars, secrets, deaths, time),
  no lives, no punishment — deaths just go on your permanent record.

## Controls

Keyboard bindings follow **physical key positions**, so the movement block is automatically
**ZQSD on AZERTY** (the Settings screen shows the real labels for *your* layout). Everything
is rebindable; arrows always work as secondary movement keys.

| Action | Default |
| --- | --- |
| Move | `A` / `D` position (ZQSD on AZERTY) or `←` / `→` |
| Jump | `Space` (also `W` position / `↑`) |
| Run / throw pen | `Shift` or `F` |
| Duck | `S` position / `↓` |
| Pause | `Escape` or `Enter` |

**Gamepad**: plug in and press a button — bottom face button jumps, left/right face buttons
run and throw, start pauses, and the pad drives every menu too.

## Development

```sh
npm install
npm run dev        # local dev server
npm test           # simulation + campaign-gate tests (vitest, no browser needed)
npm run build      # typecheck + full test run + production build into docs/
```

Stack: vanilla TypeScript (strict) + a single Canvas 2D at 640×360, Vite, Vitest. No
frameworks, no game engine, no binary assets — every sprite, backdrop, cutscene panel and
sound is generated in code. The simulation is deterministic and runs headless in Node, which
is how all 30 acts are machine-gated: structure counts, reachability, an immortal flow bot
that must clear every mandatory route, and a strict idle-silence rule. The production build
is committed under `docs/` and served by GitHub Pages.

The canonical design brief (story bible, satire rules, architecture invariants) lives in
[AGENTS.md](AGENTS.md); `src/core/types.ts` holds the frozen contracts between the simulation
(`src/game/`), presentation (`src/render/`, `src/fx/`, `src/audio/`, `src/ui/`) and the
scenes (`src/scenes/`).

## Credits & disclaimer

A **parody**. Political satire of public figures; not affiliated with, endorsed by, or
imitating Nintendo — no Nintendo assets, sprites, names or melodies are used. Inspired by the
platformers everyone already loves and by every heist that certified its own paperwork.
Built with [Claude Code](https://claude.com/claude-code).
