# Enemy (AI Opponent) Integration Plan

Stage A recon + integration design for adding a deterministic, seeded AI opponent
to the **Ghost Fighter** robot-sports platform. The opponent must reuse the
existing Move Card type and the existing arena loop/physics, must run **no LLM in
the per-frame inner loop**, and must be replayable.

---

## 1. Language / framework / build / run / test

- **Stack:** Next.js `15.5.19` (App Router, Turbopack) + React `19.1.0` +
  TypeScript `5`, all under `web/`. Path alias `@/*` → `web/*` (`tsconfig.json`).
- **Rendering / 3D:** `three@^0.184` + `urdf-loader` (arena visuals only).
- **Persistence:** JSON file store under `web/data/` (gitignored) via
  `web/lib/storage.ts` (`fs/promises`). No DB, no network services.
- **Commands** (`web/package.json`):
  - `npm install` — deps (must be run; `node_modules` not committed).
  - `npm run dev` — `next dev --turbopack` (http://localhost:3000).
  - `npm run build` / `npm run start`.
  - `npm run lint` — `eslint`.
  - **No test runner exists yet.** There are zero `*.test.ts` files and no
    vitest/jest config. → We add **vitest** (ESM + TS native, zero-config with
    the existing `tsconfig`) and a `test` script. Tests are pure/offline (no
    `fs`, no network, no THREE/DOM) so they run in CI headless.
- **How the arena is launched:**
  - *Live UI arena:* route `web/app/arena/page.tsx` → renders
    `web/components/Arena3D.tsx` (client component, `requestAnimationFrame`
    render loop + a `setInterval(40ms)` ≈ 25 Hz state-decay tick).
  - *Headless physics arena:* `web/lib/arena.ts#simulateFight`, invoked by the
    API route `web/app/api/arena/fight/route.ts` (`POST /api/arena/fight`). This
    is the only arena that runs **offline** and is therefore our test + eval
    target.

## 2. The Move Card / skill model — **REUSED, not redefined**

- **File:** `web/lib/types.ts`.
- `MoveStats` fields (the SAME stats the scorer computes in
  `web/lib/analyze.ts`): `speed`, `power`, `smoothness`, `balance_risk`,
  `recovery`, `deployability`. All on a 0–100 scale.
- `MoveCard` = `{ id, name, source, attack_type, studio_sonic_validated,
  stats: MoveStats, verdict, coach_feedback, …, pipeline }`.
- `MoveRecord = { stats: MotionStats | null, move_card: MoveCard }` (storage unit).
- Derived per-move physics already exists in `web/lib/arena.ts#movePhysics(move)`:
  `range` (≈ **reach**), `impact` (≈ **payoff**), `balanceCost`, `recoveryTicks`
  (≈ **recovery/active frames**), `staminaCost`, `stability`. The enemy consumes
  these exact derivations — it does not invent new ones.
- **Stat-name mapping for the task's vocabulary** (the repo has fewer fields than
  the task's example list — we map, we do **not** add fields to `MoveStats`):
  - `power` → `stats.power`
  - `balance_risk` → `stats.balance_risk`
  - `recovery` → `stats.recovery`
  - `startup/active frames` → `movePhysics().recoveryTicks` (commit-window proxy)
  - `reach` → `movePhysics().range`
  - `expected_reward` → **derived** = f(`stats.power`, `movePhysics().impact`,
    `stats.deployability`). There is no `expected_reward` field; deriving it from
    existing stats honors "reuse, don't redefine".
  - `stamina` (cost) → `movePhysics().staminaCost`; live stamina is on the
    fighter state, not the card.

## 3. The real-time arena loop

There are **two** loops; we map the enemy onto both but **test against the
headless one**.

### 3a. Headless physics sim — `web/lib/arena.ts#simulateFight` (TEST/EVAL TARGET)
- Signature: `simulateFight(fighterA, fighterB, moveMap): Promise<FightResult>`.
- **Tick model:** fixed loop `for (tick = 1; tick <= maxTicks=12 && bothAlive; tick++)`.
  Attacker alternates by `tick % 2 === 1`. Each tick: `recover` both → if attacker
  on cooldown/knockdown emit `recover` → else **pick a move** → if out of range
  `advance` (footwork) → else `applyAttack`.
- **How a fighter "submits an action":** today it is `pick(attackerFighter.move_ids)`
  (`web/lib/arena.ts:185`) — a `Math.random` choice (`arena.ts:40`). This is the
  single decision point and the **per-frame controller hook we replace**.
- **Move commit:** `applyAttack(attacker, defender, move)` (`arena.ts:99`)
  computes in-range, damage, knockback, balance loss, knockdown, cooldown.
- **Events:** `FightRound.event_type` ∈ `advance | hit | miss | knockdown |
  recover | ko`; **match result:** `FightResult.winner` + `final_hp`/`final_state`.
- **Non-determinism today:** narration `pick` and move `pick` both use
  `Math.random` → not replayable. We thread a **seeded RNG** to fix this.

### 3b. Live UI arena — `web/components/Arena3D.tsx`
- rAF render loop (`loop()`, `Arena3D.tsx:366`) + `setInterval(…, 40)` decay tick
  (`:423`, ≈25 Hz).
- **Human input handler (the analog the enemy must satisfy):** `playMove(side, move)`
  (`Arena3D.tsx:440`), fired by `MoveControls` buttons (`onPlay`, `:595`). This is
  the UI **move-commit API**. The enemy's Executor calls the same `playMove`.
- THREE/WebGL/DOM-coupled → cannot run offline → **not** a unit/integration-test
  target. We wire the enemy in for the live demo only.

## 4. Existing fighter / controller / opponent-selection interface

- **Fighter model:** `Fighter = { id, name, move_ids, stats, created_at }`
  (`types.ts:53`), built at `POST /api/fighters` (`web/app/api/fighters/route.ts`)
  from 1–5 move cards (`aggregateStats`). Created via UI
  `web/app/fighters/build/page.tsx`.
- **There is no controller abstraction today.** In the headless sim the
  "controller" is the random `pick`; in the UI it is the human clicking buttons.
- **Opponent selection:**
  - Headless: `POST /api/arena/fight { fighter_a, fighter_b }` → `getFighter` by id.
  - UI: `Arena3D` hard-codes "Player 1"/"Player 2", both human-driven.
- **Integration point for personas:** the opponent (fighter_b / Player 2) is where
  a persona-backed controller drops in.

## 5. Scoring service & Deployability

- **Scorer:** `web/lib/analyze.ts` — `analyzeJointPositions` → `MotionStats`
  (incl. `deploy_score`) → `buildMoveCard` → `MoveStats.deployability`. Pure,
  offline, heuristic (no sim rollout). Deployability already exists per move and
  is aggregated per fighter (`aggregateStats`) and surfaced on the leaderboard
  (`web/app/api/leaderboard/route.ts`).
- **Does the scorer run sim rollouts?** **No.** `simulateFight` exists but is only
  used for the on-demand arena API, not for scoring. → The new **evaluation
  harness** is the first thing to run real sim rollouts; it reports a
  **competition-readiness profile** *alongside* (not overwriting) the existing
  static `deployability`.

## 6. Test framework & offline strategy

- Add **vitest** (`devDependency`) + `"test": "vitest run"` script. Config: a
  minimal `web/vitest.config.ts` with `environment: 'node'`. Tests live in
  `web/lib/enemy/__tests__/`.
- **Offline guarantees:** enemy logic is pure TS over in-memory `MoveCard`
  objects + a seeded RNG. The integration test calls `simulateFight` directly
  with an in-memory `moveMap` and scripted/mocked controllers — no `fs`, no
  `fetch`, no THREE. Fixtures are inline `MoveCard` literals.
- **Fallback if `npm install` is offline:** tests are authored to also run under
  `node --test` via `tsx`; if neither installs, the modules are still
  type-checked by `tsc --noEmit`. (Primary path is vitest.)

## 7. Exact integration points (file + symbol)

| Need | Location | Change |
|---|---|---|
| Per-frame controller hook | `web/lib/arena.ts#simulateFight`, replacing `pick(attackerFighter.move_ids)` (`:185`) | Add optional `opts.controllers?: { a?: FighterController; b?: FighterController }` + `opts.seed`. Ask the active controller for an action each tick; default = seeded `RandomController` (preserves current behavior). |
| Seeded RNG (replayability) | `web/lib/arena.ts#pick` (`:39`) | Replace `Math.random` with a passed-in seeded RNG (new `web/lib/enemy/rng.ts`). Default seed keeps the API working; same seed ⇒ identical fight. |
| "Player committed a move" observation | inside the `simulateFight` loop after a move resolves; UI: after `playMove` | Call `controller.observeOpponentMove(moveId, outcome)` on the *other* controller. Feeds the strategist's online player model. |
| Between-round hook (for the future LLM layer) | new `controller.onRoundEnd(summary)` called at `ko`/end of `simulateFight`; eval harness calls per match | No LLM now — just an empty extension point the meta-coach/persona-author can attach to later. |
| Opponent / persona registration | new `web/lib/enemy/personas.ts` registry; consumed by `simulateFight` opts, the eval harness, and a new persona param on `POST /api/arena/fight`; UI dropdown in `Arena3D` | Personas drop into the existing fighter_b / Player-2 slot. |

---

## Types: reused vs added

**Reused (imported, never redefined):** `MoveCard`, `MoveStats`, `MoveRecord`,
`Fighter`, `FighterPhysicsState`, `FightRound`, `FightResult` (all from
`web/lib/types.ts`); `movePhysics`, `applyAttack`, `simulateFight`,
`loadMovesForFighters` (from `web/lib/arena.ts`); `deployability` from the scorer.

**Added (new, in `web/lib/enemy/`):**
- `FighterController` interface + `ArenaObservation` / `ArenaAction` (the per-frame
  contract; `ArenaAction` = `{kind:'move',moveId} | {kind:'advance'} | {kind:'wait'}`
  — exactly the three things the loop already does).
- `Rng` (seeded mulberry32) — for replayability.
- `Intent` (`'pressure'|'zone'|'counter'|'reset'`) — **style**, orthogonal to…
- `DifficultyConfig` (`reaction_delay`, `optimal_prob`, `mistake_rate`,
  `adaptation`, `noise`) — **skill knobs**.
- `Persona` (`{ id, name, baseIntent, difficulty, biasWeights }`) + registry.
- `PlayerModel` (move-frequency / anti-spam state for the strategist).
- `CompetitionReadiness` (eval-harness output: per-persona win-rate + why-it-loses).

*Why added, not reused:* none of these exist; they are behavior/config, not
domain models. No existing type is duplicated or shadowed.

## Adapter boundary — 3 internal rates → the existing tick model

The enemy thinks at three rates; the arena exposes **one** tick stream. The
adapter expresses each rate as "every N controller-frames", where N derives from
the loop's effective Hz (configurable, default treats one headless tick as the
Executor frame):

```
Strategist (~3 Hz)  → run every  ceil(rateHz / 3)  frames   (game-plan + player model)
Tactician  (~15 Hz) → run every  ceil(rateHz / 15) frames   (utility scoring of each card)
Executor   (per frame) → every frame                         (footwork / commit / wait)
```

`EnemyController.decide(obs, rng)` is called once per arena tick (the Executor).
It owns frame counters and only re-evaluates the Strategist / Tactician when their
interval elapses, caching the chosen intent + ranked move between evaluations.
This is the entire coupling: the arena stays a plain tick loop and never learns
about Hz; the enemy maps its rates onto frames internally. The same controller
object drives the headless sim *and* `Arena3D` (which calls `decide` on its 25 Hz
interval and routes the resulting action through `playMove`).

**Delayed perception:** a `DelayedPerception` wrapper buffers `ArenaObservation`s
in a ring and hands `decide` an observation `reaction_delay` ticks old, so the
enemy cannot react frame-perfectly. It reads the *same* state the player sees.

## No-LLM-in-loop guarantee

`decide`, the strategist, tactician, executor, player model, and RNG are pure
synchronous TS with zero imports of any model SDK. `grep -riE
'anthropic|openai|llm|fetch|claude' web/lib/enemy` will return nothing. The
`onRoundEnd` between-round hook is the *only* seam for a future LLM layer, and it
runs **outside** the frame loop.

## File-by-file change list

**New files (`web/lib/enemy/`):**
- `rng.ts` — seeded mulberry32 `Rng`.
- `types.ts` — `FighterController`, `ArenaObservation`, `ArenaAction`, `Intent`,
  `DifficultyConfig`, `Persona`, `PlayerModel`, `CompetitionReadiness`.
- `strategist.ts` — ~3 Hz game-plan + online player model (move-frequency,
  anti-spam counter-bias, intent selection).
- `tactician.ts` — ~15 Hz Utility-AI: scores each `MoveCard` NOW from existing
  stats (range fit, whiff-punish/interrupt timing, safety, intent match, payoff
  − stamina − balance_risk − recovery) + seeded noise.
- `executor.ts` — per-frame footwork-toward-range else commit.
- `controller.ts` — `EnemyController` (rate scheduler binding the three above) +
  `RandomController` (default, seeded) + `DelayedPerception` wrapper.
- `personas.ts` — `Rusher`, `Zoner`, `CounterPuncher`, `AdapterBoss` registry +
  `getPersona(id)`.
- `evaluate.ts` — `evaluateDeck(playerFighter, moveMap, opts)` → runs the deck vs
  the full persona pool through `simulateFight`, returns `CompetitionReadiness`.
- `__tests__/tactician.test.ts`, `__tests__/strategist.test.ts`,
  `__tests__/arena-integration.test.ts`.

**New shared module (implementation detail):**
- `web/lib/arena-physics.ts` — `movePhysics` extracted here (single source of
  truth) so both `arena.ts` and the enemy brain import it **without** pulling in
  `storage.ts`/`fs`. This keeps the enemy controller browser-safe so it can also
  drive Player 2 live in `Arena3D` (a client component) — not just the server-side
  `simulateFight`.

**Modified files:**
- `web/lib/arena.ts` — import `movePhysics` from `./arena-physics`; thread seeded
  RNG through `pick`; add
  `opts: { controllers?, seed?, maxTicks? }` to `simulateFight`; call the active
  controller for the move decision; fire `observeOpponentMove` / `onRoundEnd`.
  **Default behavior unchanged** when no controllers are passed (existing API +
  route stay green).
- `web/app/api/arena/fight/route.ts` — accept optional
  `{ persona_b?: string, seed?: number }`; when set, build the persona controller
  for fighter_b. Backward compatible.
- `web/app/api/arena/evaluate/route.ts` *(new)* — `POST` runs `evaluateDeck`
  for a fighter id and returns the readiness profile.
- `web/components/Arena3D.tsx` — add a persona `<select>` for Player 2; on the
  existing 25 Hz interval, call the enemy controller's `decide` and route the
  action through `playMove`. (Additive; manual play still works.)
- `web/package.json` — add `vitest` devDep + `"test"` script.
- `web/vitest.config.ts` *(new)*.
- `README.md` — "AI Opponent" section: persona list, how to select one, how to
  run the eval harness, how to run tests.

## Test plan

1. **`tactician.test.ts` (deterministic, seeded):** with two hand-built
   `MoveCard`s (a long-reach poke vs a high-power risky move) and a fixed
   `ArenaObservation`, assert the utility ranking is deterministic for a seed,
   that range-fit picks the in-range move, that `pressure` vs `zone` intents flip
   the winner, and that `balance_risk`/`recovery` penalties demote the risky move
   when safety matters.
2. **`strategist.test.ts` (deterministic, seeded):** feed a stream of
   `observeOpponentMove` calls dominated by one move → assert the player model
   raises that move's frequency and the anti-spam counter-bias flips intent toward
   `counter`; assert reproducibility under a fixed seed.
3. **`arena-integration.test.ts` (REAL arena, offline):** call `simulateFight`
   with an in-memory `moveMap`, a **scripted/mocked player controller** vs an
   `EnemyController(persona)` and a fixed seed; assert it produces a
   `FightResult` with a winner and that **the same seed reproduces the identical
   round-by-round transcript** (replayability). A second case asserts the legacy
   no-controller call still returns a valid `FightResult`.
4. **Determinism guard:** same-seed-equal / different-seed-different-ish assertions
   so regressions in seeding fail loudly.
5. Run `npm run lint` and `tsc --noEmit`; existing routes/build stay green.

## Definition-of-done mapping

- ✅ Reuses `MoveCard`/`MoveStats` + `simulateFight` loop + `movePhysics`; no
  duplicate models or loops.
- ✅ `grep` confirms no LLM/SDK/`fetch` in `web/lib/enemy` per-frame path.
- ✅ Seeded deterministic unit tests (tactician + strategist) + one integration
  test driving the real `simulateFight` with a scripted player; all offline.
- ✅ Existing tests (none) stay green; build/lint unaffected by default-path
  preservation.
- ✅ This plan committed; README updated with persona selection + eval harness.
- ⛔ **Out of scope (follow-up):** LLM meta-coach / persona-author / narrator. The
  `onRoundEnd` hook is the attach point; no LLM is wired now.

## Assumptions & open questions

- **A1 — "real arena" for tests = `lib/arena.ts#simulateFight`.** It is the only
  offline-runnable physics loop; `Arena3D` is THREE/DOM-bound. The enemy controller
  is loop-agnostic and also drives `Arena3D` live, so this does not fork the loop.
  *(Proceeding; not blocking.)*
- **A2 — Seeding `simulateFight` changes the default fight from random to
  seeded-deterministic.** This is desirable (replayability) and keeps the route
  working. *(Proceeding.)*
- **A3 — `expected_reward` is derived from existing stats** (no such field
  exists). *(Proceeding; documented above.)*
- **A4 — vitest is the test runner** (none existed). Lowest-friction, ESM/TS
  native. *(Proceeding; node:test fallback noted.)*
- **A5 — Personas are controllers, not persisted `Fighter`s.** The eval harness
  pairs a persona controller against the player `Fighter`'s deck; a persona only
  needs a deck to throw punches, so the harness lends it the player's `moveMap`
  (or a default deck) rather than minting fake `Fighter` records. *(Proceeding.)*

None of these block Stage B, so implementation proceeds.
