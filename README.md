# Ghost Fighter

Ghost Fighter is a Physical AI / robot-sports platform that turns human movement into structured robot skills.

The demo path is:

```text
human motion → Studio / SONIC export → scored move card → 3D robot arena → sim / G1 proof
```

We are building the layer before humanoid deployment: score whether a human-created move is clean, expressive, and robot-executable enough to become a reusable robot-athlete skill.

## Run the app

```bash
cd web
npm install
npm run dev
```

Open:

- **App:** http://localhost:3000
- **Move card / Skill Lab:** http://localhost:3000/moves/ghost_jab_combo
- **3D Arena:** http://localhost:3000/arena

## What To Demo

1. Open `/moves/ghost_jab_combo`.
2. Show the move card: speed, power, smoothness, balance risk, recovery, deployability, and coach feedback.
3. Show the 3D SONIC replay: browser preview driven by `joint_pos.csv`.
4. Open `/arena`.
5. Use each player’s move buttons to trigger a 3D robot duel with HP bars, balance bars, hit effects, and knockback.
6. Mention the real Unitree G1 model assets loaded from `web/public/models/g1_description` and `web/public/models/unitree_g1`.
7. If we get a plaza clip, upload it on the move card page as G1 proof.

## Routes

- `/` — dashboard and move library
- `/ingest` — upload a SONIC `.zip` or source video
- `/moves/[id]` — skill card, 3D replay, verification ladder, plaza proof upload
- `/fighters/build` — create a fighter loadout from move cards
- `/arena` — 3D robot-sports duel with health bars and move playback
- `/leaderboard` — top moves and fighters by deployability

## CLI scoring (still works)

```bash
python3 scripts/analyze_motion.py
```

This reads the extracted SONIC CSVs and writes:

```text
move_cards/ghost_jab_combo.json
```

## Plaza

Bring `assets/motions/ghost_jab_combo_sonic.zip` to Lower Sproul, then upload the G1 clip on the move card page.

## Assets

- `assets/motions/ghost_jab_combo_sonic.zip` — Studio SONIC export for G1 deploy
- `assets/motions/ghost_jab_combo_extracted/` — extracted SONIC CSVs
- `web/public/models/unitree_g1/` — MuJoCo Menagerie Unitree G1 reference assets
- `web/public/models/g1_description/` — Unitree ROS G1 URDF + meshes for browser rendering
- `scripts/verify_with_gear_sonic.sh` — prepares the motion folder for official GEAR-SONIC/MuJoCo verification

## Stack

- Next.js 15 + React 19
- Three.js + URDFLoader for the 3D arena
- TypeScript scoring engine ported from `scripts/analyze_motion.py`
- JSON file store in `web/data/` during local dev
- SONIC / G1 motion assets from Ultimate Bots Studio

## Pitch

Ghost Fighter turns human moves into ranked, coachable, deployable robot skills. Studio retargets the motion; Ghost Fighter scores it, visualizes it, turns it into a move card, lets it fight in a robot-sports arena, and tracks the path toward MuJoCo / G1 proof.
