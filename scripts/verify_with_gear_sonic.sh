#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOTION_DIR="${1:-$REPO_ROOT/assets/motions/ghost_jab_combo_extracted}"
OUT_DIR="$REPO_ROOT/web/data/gear_sonic_reference/ghost_fighter"
GEAR_ROOT="${GEAR_SONIC_ROOT:-}"

mkdir -p "$OUT_DIR"
rm -rf "$OUT_DIR/$(basename "$MOTION_DIR")"
cp -R "$MOTION_DIR" "$OUT_DIR/"

echo "Prepared SONIC reference motion:"
echo "  $OUT_DIR/$(basename "$MOTION_DIR")"
echo

if [[ -z "$GEAR_ROOT" ]]; then
  echo "Set GEAR_SONIC_ROOT to run the official visualizer, e.g."
  echo "  export GEAR_SONIC_ROOT=/path/to/GR00T-WholeBodyControl/gear_sonic_deploy"
  echo "  scripts/verify_with_gear_sonic.sh"
  exit 0
fi

if [[ ! -f "$GEAR_ROOT/visualize_motion.py" ]]; then
  echo "Could not find visualize_motion.py in: $GEAR_ROOT" >&2
  exit 1
fi

cd "$GEAR_ROOT"
python visualize_motion.py --motion_dir "$OUT_DIR/$(basename "$MOTION_DIR")"
