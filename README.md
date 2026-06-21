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
- `/leaderboard` — top moves and fighters by deployability

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
- JSON file store in `web/data/` during local dev
- Optional Deepgram TTS for arena announcer (`/api/tts`)
- SONIC / G1 motion assets from [UFB Studio](https://studio.ultimatebots.com/editor)

## Pitch

Ghost Fighter turns human moves into ranked, coachable, deployable robot skills. Studio retargets the motion; Ghost Fighter scores it, visualizes it on a G1 model, turns it into a move card, and lets it fight in a robot-sports arena.
