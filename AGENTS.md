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

**The player plays MANGIANI** (settled pivot, playtest-driven) — the only one
genuinely motivated to clear the levels. YOU do all the running, stomping and
rescuing; Estrada merely tags along off-screen and materializes at every castle
door to plant his "MISSION FAILED SUCCESSFULLY" flag, take the credit, and file
the certified excuse — for a failure the player just watched him not prevent.
The comedy is the gap between who does the work and who signs it. Every
player-facing surface must show Mangiani (in-level sprite, world-map token,
respawns); Estrada keeps the title billing, the sting cards, the excuses and
the cutscene theatrics — that IS the joke.

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

**Sprinkle real scandals and catchphrases** into dialogue, excuse lines, decor
text and boss barks — occasionally, as seasoning, never wall-to-wall. Impeach:
"fake news", "witch hunt", "many people are saying", "a very stable genius",
"I know words, I have the best words", "perfect phone call", covfefe as a
magic word. Bowsonaro: "So what?" ("E daí?"), "the system is rigged", the
myth/"mito" chant, refusing a vaccine because it "turns you into a crocodile",
motorcycle parades, "historically, turtles…". Estrada: notary/certification
jargon abused for everything, suspicious coffee breaks, "it is documented".
Each gag lands harder when tied to that world's producer.

## Design pillar: THE WORLD IS A SET (settled)

Every level is a stage production BUILT BY THE CONSPIRATORS — and they are
terrible at stagecraft. The landscape must read as a badly-assembled theatre
set in Mario clothing ("Paper Mario, but the producers are dummies"):

- Bushes/clouds are flat cardboard cutouts on visible wooden prop sticks, some
  upside down, patched with duct-tape crosses.
- The sky is a painted canvas backdrop: visible seams, wrinkles, a curling
  corner, scaffolding poles and sandbags peeking at the edges.
- Badly hidden studio gear: stage lights on tripods, cables taped across the
  ground, a boom mic dipping into frame, a camera dolly in the background,
  clapperboards ("RESCUE ATTEMPT — TAKE 12"), cue cards on the floor.
- Props keep their labels: "CLOUD (PROP)", price stickers, "RENT-A-CASTLE"
  tags, WET PAINT signs, spilled paint buckets.
- Forced perspective done wrong: distant castles are obviously tiny paper
  cutouts, sometimes seen edge-on (paper-thin).
- Crumble platforms are taped cardboard; one-way platforms are planks on
  sawhorses; the paparazzo drone hangs from a visible wire.
- Background "crowds" of Toads are cardboard-cutout audiences.
- The gag intensifies with each world — by the castle they stopped trying.

The REAL kingdom (dungeon backgrounds, the real Peach) is NOT a set — it is
drawn sincerely. The fakeness belongs only to what the conspirators staged.

The world map is their CONSPIRACY CORKBOARD: level polaroids pinned to cork,
routes in red yarn, the castle circled in red marker.

## Two heroes: solo swap + local co-op (settled, playtest-driven)

- **Characters**: `mangiani` (P1's default — the honest worker) and `estrada`
  (the credit-taker). IDENTICAL physics for now — PHYS is gate calibration;
  differentiating stats requires a re-tune wave and is explicitly future work.
  Only sprite, palette and fiction differ.
- **Solo**: one body on screen; a rebindable `swap` action (default Tab +
  pad button 3/Y-position) morphs the controlled hero in place, with a puff
  effect. The swap action appears in the settings REBIND menu like any other.
- **Local co-op** (chosen from the title menu): TWO bodies in the level.
  P1 = Mangiani on the PRIMARY binding slots (letters block) + gamepad 0;
  P2 = Estrada on the SECONDARY slots (arrows block) + gamepad 1. In co-op
  the shared-slot merging of solo input is split by slot index; pads map by
  index. No swap action in co-op.
- **Camera in co-op**: follows the leading player; a player left behind
  off-screen (or dead) becomes a BUBBLE that drifts to the leader and pops
  back in on their jump press (modern co-op convention — never fight the
  camera). Goal/checkpoints trigger on EITHER player; the backtrack ratchet
  follows the leader; stats are shared (one kingdom, one ledger).
- **Fiction**: in solo, cutscenes/stings unchanged (Estrada takes credit for
  the player's work). In co-op the sting is the same joke played live: P2 IS
  the person taking the credit.
- The act gate stays SOLO (P1 physics) — co-op is additive and never gates
  content.

## Campaign shape

**4 worlds, 30 acts, a branching world-map graph** (see `src/levels/maps.ts`:
7+8+8+7, castle last in each world; branch choices + optional spur acts;
cleared acts replayable from the map). Worlds:

| # | World | Theme id | Set built by | Satire |
|---|-------|----------|--------------|--------|
| 1 | Mushroom Heights | `meadow` | **Mario Estrada** (his hero-movie opening set) | The kingdom right after the scam: foreclosure signs, betting billboards, film-crew gear |
| 2 | The Money Pipes | `sewer` | **Impeach/Trump** (his laundering back office) | Underground coin laundering; rats, skeletons, leaking pipes; the real Peach's dungeon door appears in the background |
| 3 | Casino Peninsula | `casino` | **Impeach/Trump** (he insisted on having TWO areas) | The betting platform made physical: slots, cards, neon, chips |
| 4 | Bowsonaro's Grand Palace | `castle` | **Bowsonaro** (home turf) | Lava, gold statues of Impeach, ballot-box battlements |

### Art direction: CARICATURE FIRST, COSTUME SECOND (settled)

Characters are drawn as political-cartoon caricatures — the exaggerated visual
shorthand every newspaper cartoonist uses: Impeach/Trump = orange skin, yellow
combed-over swoop, pouting lips, long red tie (worn OVER the Peach dress), and
the oversized-hands running gag; Bowsonaro = aviator sunglasses, military
beret, jutting chin, soccer-jersey colors; Estrada = smug half-lid eyes, pencil
moustache, slicked hair under the cap. The caricature is NEVER hidden by a
disguise: costumes are worn over it and fail to cover it (wig gaps, tie
hanging out of the dress, sunglasses over a goomba hood). Rule for every
sprite, boss, cutscene panel and statue: a player who has seen one political
cartoon of the real person must recognize them at 640x360 in one glance —
recognizability beats prettiness.

### Enemies are the owner's entourage in bad costumes (settled)

Every enemy is a friend / relative / lawyer / employee of the world's producer,
badly disguised as a classic Mario-style enemy: visible back zippers, 'HELLO
I'M…' name tags, human shoes under the costume, costume heads under one arm on
break. Mechanics NEVER change per world — only the skin and the joke:

| Kind (mechanic) | W1 Estrada's set | W2 Trump's pipes | W3 Trump's casino | W4 Bowsonaro's palace |
|---|---|---|---|---|
| lobbyist (walker) | Cousin Fabio in a goomba onesie, zipper open | junior lawyer, brown suit | pit-boss nephew, gold chain | army buddy in barrel costume |
| pollster (shell) | Estrada's agent, beret + script-covered shell | campaign volunteer, red cap | croupier turtle, bow tie | son #01 in soccer-jersey shell |
| lawyer (pipe plant) | makeup artist with powder puff | THE lawyer plant, 'OBJECTION!' briefcase jaws | waitress plant serving subpoenas | general plant with medals |
| paparazzo (flyer) | the DOP's camera on a visible wire | 'TOTALLY A BIRD' surveillance drone | winged security camera | military drone in a beret |
| rat (scurrier) | intern in a rat costume | accountant rat, green visor | card-counting rat | a CAPYBARA (real, unbothered) |
| chipstack (hopper) | stack of film cans | stack of coin rolls | stack of poker chips | stack of ballot boxes |
| gavel (crusher) | boom mic slamming into frame | judge's gavel | giant slot-machine lever | giant army boot |

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
