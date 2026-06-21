# Ghost Fighter

Ghost Fighter is a Physical AI / robot-sports platform that turns human movement into structured robot skills.

The demo path is:

```text
human motion → UFB Studio / SONIC export → scored move card → 3D G1 replay → robot-sports arena
```

We score whether a human-created move is clean, expressive, and robot-executable enough to become a reusable robot-athlete skill.

## Run the app

```bash
cd web
npm install
npm run dev
```

Open:

- **App:** http://localhost:3000
- **Move card / Skill Lab:** http://localhost:3000/moves/ghost_jab_combo_sonic
- **3D Arena:** http://localhost:3000/arena

### Optional: arena announcer voice

The arena can call fights with Deepgram TTS. Copy the example env file and add your key:

```bash
cp .env.local.example .env.local
# edit web/.env.local and set DEEPGRAM_API_KEY=...
```

Without a key, the app builds and runs normally — you just see “Announcer off” in the arena.

### Optional: Redis move-memory layer

Redis serves as the move-memory layer: move cards, fighters, leaderboards,
similarity search, and historical fight performance. When Redis is reachable it
becomes the source of truth; otherwise the app falls back to JSON files under
`web/data/` and everything still works.

The app uses a hosted **Redis Cloud** instance. Point it at your database by
setting `REDIS_URL` in `web/.env.local` (see `web/.env.local.example`):

```bash
REDIS_URL=redis://default:<password>@<host>:<port>
```

Grab the host, port, and default-user password from the Redis Cloud console
(Databases → your DB → Security). To run against a local Redis instead, set
`REDIS_URL=redis://127.0.0.1:6379` (e.g. `docker run -p 6379:6379 redis:7`), or
set `REDIS_DISABLED=1` to force the JSON-file fallback.

What lives in Redis (`web/lib/moveMemory.ts`):

- **Move cards / fighters** — `move:{id}` / `fighter:{id}` JSON, indexed by
  creation time in sorted sets for ordered listing.
- **Leaderboards** — `lb:moves` / `lb:fighters` sorted sets keyed by
  deployability (`/leaderboard`, `GET /api/leaderboard`).
- **Similarity search** — each move's stats become a normalized feature vector
  (`moves:vectors`); `GET /api/moves/[id]/similar?k=5` ranks by cosine
  similarity, also surfaced as "Similar moves" on the move page.
- **Historical performance** — finished fights are folded into per-move and
  per-fighter counters plus a recent-fights log (`GET /api/arena/history`;
  written by `POST /api/arena/fight` and the live arena on KO).

### Production build

```bash
cd web
npm install
npm run build
npm start
```

If you see `Can't resolve '@deepgram/sdk'`, run `npm install` in `web/` first. The dependency is already listed in `package.json`.

## What to demo

1. Open `/moves/ghost_jab_combo_sonic`.
2. Show the move card: speed, power, smoothness, balance risk, recovery, deployability, and coach feedback (hover the **i** icons for definitions).
3. Show the 3D SONIC replay: G1 URDF driven by remapped `joint_pos.csv` trajectories.
4. Open `/arena`.
5. Use each player’s move buttons to trigger a 3D robot duel with HP bars, balance bars, hit effects, and knockback.
6. Toggle the announcer if `DEEPGRAM_API_KEY` is configured.
7. Mention the Unitree G1 assets loaded from `web/public/models/g1_description` and `web/public/models/unitree_g1`.

## Routes

- `/` — dashboard and move library
- `/ingest` — upload a SONIC `.zip` or source video
- `/moves/[id]` — skill card, 3D replay, verification ladder
- `/fighters/build` — create a fighter loadout from move cards
- `/arena` — 3D robot-sports duel with health bars and move playback
- `/leaderboard` — top moves and fighters by deployability (Redis sorted sets)
- `GET /api/moves/[id]/similar` — feature-vector similarity search
- `GET /api/arena/history` — recent fights from the move-memory log

## AI opponent ("the enemy")

The arena ships with a deterministic, seeded AI opponent. It satisfies the same
per-frame controller contract as the human input handler, reuses the existing
Move Card stats and arena loop/physics, and runs **no LLM in the frame loop**.

It thinks at three internal rates (mapped onto the arena tick by an adapter):

- **Strategist (~3 Hz)** — game-plan + online player-modeling (move-frequency,
  anti-spam counter-bias, intent: `pressure` / `zone` / `counter` / `reset`).
- **Tactician (~15 Hz)** — Utility-AI scoring of every Move Card *now* from the
  existing stats (range fit, whiff-punish/interrupt timing, safety, intent
  match, payoff − stamina − balance_risk − recovery) with seeded noise.
- **Executor (per frame)** — footwork toward preferred range, else commit the
  move via the arena's move-commit API.

Difficulty knobs (`reaction_delay`, `optimal_prob`, `mistake_rate`,
`adaptation`, `noise`) are orthogonal to style (intent). Code lives in
`web/lib/enemy/`.

### Personas

`Rusher`, `Zoner`, `Counter-Puncher`, `Adapter-Boss` (`web/lib/enemy/personas.ts`).

**Select one in the UI:** open `/arena` and use the **Player 2 AI** dropdown.
Choose a persona to let it pilot Player 2; "Manual (human)" returns control.

**Headless:** `POST /api/arena/fight` with `{ fighter_a, fighter_b, persona_b,
seed }` — when `persona_b` is set, that persona drives fighter_b. `seed` makes
the match replayable.

### Evaluation harness (competition-readiness)

Run a fighter's deck against the full persona pool through the **real** arena and
get a win-rate + why-it-loses profile (and a readiness score blended with the
existing Deployability):

```bash
curl -X POST http://localhost:3000/api/arena/evaluate \
  -H 'Content-Type: application/json' \
  -d '{ "fighter": "<fighter_id>", "matches": 5, "seed": 1 }'
```

### Tests

```bash
cd web
npm test          # vitest, fully offline (seeded unit + real-arena integration)
```

## Motion replay notes

SONIC zip exports store joints in **IsaacLab/internal order** (`joint_0`…`joint_28`). The web replay and trajectory API remap that to **MuJoCo / Unitree SDK order** before driving the G1 URDF (`web/lib/g1Motion.ts`).

Lafan CSV exports use a different layout (`XYZ` + `QX QY QZ QW` + 29 joints at 30fps). Use those for training pipelines like mjlab; the in-app replay expects the SONIC zip CSVs.

## CLI scoring

```bash
python3 scripts/analyze_motion.py
```

This reads the extracted SONIC CSVs and writes:

```text
move_cards/ghost_jab_combo.json
```

## Assets

- `assets/motions/ghost_jab_combo_sonic.zip` — Studio SONIC export for G1 deploy
- `assets/motions/ghost_jab_combo_extracted/` — extracted SONIC CSVs
- `web/public/models/unitree_g1/` — MuJoCo Menagerie Unitree G1 reference assets
- `web/public/models/g1_description/` — Unitree ROS G1 URDF + meshes for browser rendering
- `scripts/verify_with_gear_sonic.sh` — prepares the motion folder for official GEAR-SONIC/MuJoCo verification

## Stack

- Next.js 15 + React 19
- Three.js + URDFLoader for 3D replay and arena
- TypeScript scoring engine ported from `scripts/analyze_motion.py`
- Redis Cloud move-memory layer (move cards, leaderboards, similarity search,
  fight history) with a JSON file store in `web/data/` as the automatic fallback
- Optional Deepgram TTS for arena announcer (`/api/tts`)
- SONIC / G1 motion assets from [UFB Studio](https://studio.ultimatebots.com/editor)

## Pitch

Ghost Fighter turns human moves into ranked, coachable, deployable robot skills. Studio retargets the motion; Ghost Fighter scores it, visualizes it on a G1 model, turns it into a move card, and lets it fight in a robot-sports arena.
