# Super Mario Estrada — canonical brief

A satirical 2D platformer for the browser. **"The greatest rescue that never
happened."** This file is the source of truth for design rules and architecture.
Inventory numbers drift; verify counts against source. The design *rules* here
are settled — do not relitigate them.

## The scenario (settled)

Donald Trump, Jair Bolsonaro and Mario Estrada run the biggest scam the Mushroom
Kingdom has ever seen. They open a betting platform and convince the whole
kingdom to bet its gold on one "impossible" event: *"Princess Peach will never
be kidnapped."* Mario Estrada, disguised as a royal notary, certifies every bet.
Then they kidnap the real Peach, lock her in a filthy dungeon under the castle,
and stage the crime: Trump becomes **Princess Impeach** (dress, wig, enormous
hands), Bolsonaro becomes **Bowsonaro** (spiked shell), Estrada becomes **Super
Mario Estrada** (red cap, theatrical hero speech: *"I will rescue the princess
MYSELF!"*). The plan: fake rescue missions, always arriving too late, while the
kingdom's money stays certified in their pockets.

The problem is **Mangiani** — Luigi. He lost everything on the bet, he is
genuinely devastated, and he INSISTS on joining the rescue. So every level ends
with Estrada sabotaging his own rescue in front of a witness, and every excuse
gets more ridiculous. Beat by beat, Mangiani notices: Bowsonaro always knows
when they are coming. The princess has a strange accent. Bowser keeps talking
about Brazilian politics. And the princess's hands are considerably larger than
he remembers. Meanwhile, under the castle, the real Peach is still waiting.

**The player plays Estrada** — a fake hero performing heroism. The comedy is the
gap between the performance and the truth.

### Cast
- **Super Mario Estrada** — player. Red cap, pencil moustache, notary stamp.
- **Mangiani** — green, honest, increasingly suspicious. Appears in cutscenes
  and at level ends. The moral center; never the butt of the cruelty.
- **Princess Impeach** — Trump in a Peach dress. Orange skin, yellow wig under
  the crown, tiny crown, huge hands (a running gag — hands are drawn BIG).
- **Bowsonaro** — Bolsonaro in a spiked turtle shell. Rants about ballots and
  "the system".
- **The real Peach** — glimpsed in dungeon backgrounds; freed in the ending.

### Satire voice (settled — do not soften)
Crude, comic-grotesque, real-politics references welcome. The satire targets the
conspirators (grifters), never their victims. Toads are victims of a financial
scam — foreclosure signs, "TOAD'S BETS: IMPOSSIBLE TO LOSE!" billboards, coin
vacuum trucks. Keep the voice in every user-facing string, including menus.
Original art and music only: parody the *genre*, never copy Nintendo assets,
sprites, names ("Estrada", "Mangiani", "Impeach", "Bowsonaro" are the names) or
melodies.

## Campaign shape

**4 worlds x 4 acts = 16 acts.** Act 4 of each world is a castle with a staged
Bowsonaro "fight". Worlds:

| # | World | Theme id | Satire |
|---|-------|----------|--------|
| 1 | Mushroom Heights | `meadow` | The kingdom right after the scam: foreclosure signs, betting billboards |
| 2 | The Money Pipes | `sewer` | Underground coin laundering; rats, skeletons, leaking pipes; the real Peach's dungeon door appears in the background |
| 3 | Casino Peninsula | `casino` | The betting platform made physical: slots, cards, neon, chips |
| 4 | Bowsonaro's Grand Palace | `castle` | Lava, gold statues of Impeach, ballot-box battlements |

Story beats: `intro` cinematic (the scam, played once at campaign start) ->
each act ends with a short **sting** (Estrada plants a "MISSION FAILED
SUCCESSFULLY" flag + one unique excuse line, `LevelDef.excuse`) -> each castle
ends with a full cutscene (`w1-end` … `w3-end`) advancing Mangiani's suspicion
-> world 4 castle ends with `ending` (the wig falls off, hands are measured,
the real Peach is found, Mangiani is vindicated). Cutscenes advance on keypress,
are skippable (Escape), and double as loading screens — never a visible wait.

## Architecture (settled, inherited from 4 shipped house games)

- **Stack**: vanilla TypeScript strict + Canvas 2D, virtual **640x360**, tile
  **16 px**, fixed **60 Hz** accumulator (max 6 steps/rAF), Vite -> `docs/`,
  Vitest in plain Node (no jsdom). Zero runtime deps. **Zero binary assets** —
  every sprite, background, cutscene picture and sound is generated in code.
- **`src/core/types.ts` is the single contract file** — every cross-module
  type, interface and id union lives there, zero imports, zero side effects.
  Extend it FIRST, then implement. **`src/core/constants.ts` is the single
  tuning table.** Do not scatter magic numbers.
- **Determinism**: gameplay code never calls `Math.random`, `Date.now`,
  `performance.now` or touches the DOM. Randomness comes from the seeded RNG in
  `core/rng.ts` (separate streams per concern). The sim must run headless in
  Node — that is what makes the test suite possible.
- **Events are a closed union** (`GameEvent` in types.ts). Sfx, particles,
  shake, flash and hit-stop are **exhaustive `Record<GameEvent, …>` tables** —
  the compiler forces every event to declare its sound and its juice, even if
  the declaration is explicitly `null`. NO silent `default: break` fallbacks
  anywhere: unknown ids throw. This is the house's #1 historical bug class
  (39 dangling ids once shipped unnoticed); we fix it by construction.
- **Theme dispatch is `Record<ThemeId, …>`**, never if-chains with a fallback.
- **One damage path**: only `Level.damagePlayer` may hurt the player; entities
  report contact. A dead player is inert everywhere.
- **Juice policy**: hit-stop ONLY for hits the player lands (stomp, boss hit),
  never for damage taken; global cap `JUICE.maxHitStop`. Reduced motion: shake
  off, particles halved, hit-stop clamped to 2 frames (not zero — freeze reads
  as weight, not motion).
- **Ambient gating**: any event from an entity on its own clock must be gated
  by `Math.abs(x - player.x) < AMBIENT_RANGE`. An idle player hears silence —
  there is a test asserting exactly that.
- **Input binds `KeyboardEvent.code`** (physical position — WASD is ZQSD on
  lp177's AZERTY automatically). Displayed labels come from
  `navigator.keyboard.getLayoutMap()` via `core/keyboardLayout.ts`. Menus are
  fully keyboard drivable through the single `ui/menuInput.ts` owner.
- **Simulation vs presentation**: render/audio/fx read sim state, never write
  it. Draw order: sky -> parallax -> decor behind -> tiles -> ground fx ->
  entities -> player -> airborne fx -> HUD. HUD text drawn after camera
  transform reset.
- **Persistence**: versioned localStorage keys `sme.settings.v1`,
  `sme.progress.v1`. Progress is keyed by **string level id** (`w1a2`), never
  by array index. Always optional-chain storage access (headless/private mode).
- **Save/scene state**: `window.__game` exposes the live game for browser
  probes.
- **Generous tuning** ("it's not a precision game"): coyote time, jump buffer,
  forgiving hitboxes, invulnerability windows on the long side, infinite lives
  (deaths are counted, not punished by progress loss).
- **docs/ is committed build output — NEVER hand-edit it.**

## Design rules learned (do not regress)

1. If it has collision it must be visible; if it is visible and dangerous it
   must hurt. Every entity array needs a draw function — there is a test
   cross-checking entity kinds against the painter.
2. Anything visually continuous must not read a clock that gameplay resets.
3. New scene = register in the `SceneName` union AND the router. A scene not
   reachable from the router is dead code.
4. A declared-but-never-read field is a bug factory: after wiring a feature,
   grep for consumers of every new field.
5. Feel complaints from lp177 ("boring", "unfair", "don't seem work") are
   defect reports with a mechanical cause. Find the mechanism.
6. Match verification to the claim: screenshot for visuals, headless probe for
   reachability, suite for logic. Do not over-verify trivia.
7. Levels are authored via `LevelBuilder` + motifs returning `{endX, endRow}`;
   the act contract test (`tests/actContract.ts`) gates every act: structure
   counts, nothing buried, reachability flood fill, a flow bot that must finish,
   idle silence. When a new rule fails every act, the rule is working — fix the
   content, not the threshold.
8. Music: generative chiptune, pentatonic-safe scales, base tempos in a narrow
   band (104–124 bpm) so intensity modulation reads; big moments may take over
   the score and must hand back to a DIFFERENT track.
9. Every UI surface uses `ui/theme.ts` tokens — including HUD, title cards and
   cutscene text. No stray hex literals.
10. Cutscene beats advance on keypress only, are skippable, and show more than
    they tell.

## Commands

- `npm test` — vitest, plain Node, `tests/**/*.test.ts` only.
- `npm run typecheck` — `tsc --noEmit` (this is the check; `vite build` is not).
- `npm run build` — typecheck + full test run + vite build into `docs/`.
- `npm run dev` — vite dev server.

Release = build, commit source AND `docs/` together, push. GitHub Pages serves
`main`/`docs`. Verify a deploy by comparing the served bundle hash with
`docs/index.html`, never by assumption.
