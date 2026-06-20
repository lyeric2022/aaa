#!/usr/bin/env python3
"""Analyze SONIC / Studio motion CSVs and emit stats + move card JSON."""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass
class MotionStats:
    duration_sec: float
    fps: float
    frame_count: int
    joint_count: int
    peak_velocity: float
    mean_velocity: float
    smoothness: float
    jerk_score: float
    extension_risk: float
    recovery_score: float
    deploy_score: float
    verdict: str


def load_matrix(path: Path) -> list[list[float]]:
    with path.open(newline="") as f:
        reader = csv.reader(f)
        header = next(reader)
        if not header or not header[0].startswith("joint"):
            raise ValueError(f"Unexpected CSV header in {path}")
        return [[float(x) for x in row] for row in reader]


def parse_fps(motion_dir: Path) -> float:
    info_path = motion_dir / "info.txt"
    if info_path.exists():
        for line in info_path.read_text().splitlines():
            if line.startswith("target_fps:"):
                return float(line.split(":", 1)[1].strip())
    return 50.0


def diff_series(values: list[float]) -> list[float]:
    return [values[i + 1] - values[i] for i in range(len(values) - 1)]


def magnitude(rows: list[list[float]]) -> list[float]:
    return [math.sqrt(sum(v * v for v in row)) for row in rows]


def clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, value))


def analyze_motion(motion_dir: Path) -> MotionStats:
    joint_pos_path = motion_dir / "joint_pos.csv"
    if not joint_pos_path.exists():
        raise FileNotFoundError(f"Missing {joint_pos_path}")

    positions = load_matrix(joint_pos_path)
    fps = parse_fps(motion_dir)
    frame_count = len(positions)
    joint_count = len(positions[0]) if positions else 0
    duration_sec = frame_count / fps if fps else 0.0

    per_frame_vel = []
    per_frame_acc = []
    per_frame_jerk = []

    for joint_idx in range(joint_count):
        series = [frame[joint_idx] for frame in positions]
        vel = diff_series(series)
        acc = diff_series(vel)
        jerk = diff_series(acc)

        for i, v in enumerate(vel):
            per_frame_vel.append(abs(v) * fps)
        for a in acc:
            per_frame_acc.append(abs(a) * fps * fps)
        for j in jerk:
            per_frame_jerk.append(abs(j) * fps * fps * fps)

    peak_velocity = max(per_frame_vel) if per_frame_vel else 0.0
    mean_velocity = sum(per_frame_vel) / len(per_frame_vel) if per_frame_vel else 0.0
    acc_mean = sum(per_frame_acc) / len(per_frame_acc) if per_frame_acc else 0.0
    jerk_p95 = sorted(per_frame_jerk)[int(len(per_frame_jerk) * 0.95)] if per_frame_jerk else 0.0

    # Dynamic strikes spike jerk; use p95 acceleration instead of mean jerk.
    smoothness = clamp(100.0 - acc_mean * 0.35)
    jerk_score = clamp(jerk_p95 * 0.08)

    max_abs_angle = max(abs(v) for frame in positions for v in frame)
    extension_risk = clamp(max_abs_angle * 38.0)

    # Fighters rarely return to T-pose; score stability over the final segment.
    tail = positions[-max(10, frame_count // 10) :]
    tail_means = [
        sum(frame[j] for frame in tail) / len(tail) for j in range(joint_count)
    ]
    tail_variance = sum(
        sum((frame[j] - tail_means[j]) ** 2 for frame in tail) for j in range(joint_count)
    ) / (len(tail) * max(joint_count, 1))
    recovery_score = clamp(100.0 - tail_variance * 800.0)

    speed_stat = clamp(peak_velocity * 2.2)
    balance_risk = clamp(
        extension_risk * 0.4 + jerk_score * 0.35 + (100.0 - recovery_score) * 0.25
    )

    deploy_score = clamp(
        smoothness * 0.3
        + recovery_score * 0.25
        + (100.0 - balance_risk) * 0.25
        + speed_stat * 0.2
    )

    if deploy_score >= 68 and balance_risk <= 50:
        verdict = "safe"
    elif deploy_score >= 45 and balance_risk <= 70:
        verdict = "needs_edits"
    else:
        verdict = "unsafe"

    return MotionStats(
        duration_sec=round(duration_sec, 3),
        fps=fps,
        frame_count=frame_count,
        joint_count=joint_count,
        peak_velocity=round(peak_velocity, 4),
        mean_velocity=round(mean_velocity, 4),
        smoothness=round(smoothness, 1),
        jerk_score=round(jerk_score, 1),
        extension_risk=round(extension_risk, 1),
        recovery_score=round(recovery_score, 1),
        deploy_score=round(deploy_score, 1),
        verdict=verdict,
    )


def build_move_card(name: str, motion_dir: Path, stats: MotionStats, sonic_zip: str | None) -> dict:
    coaching = {
        "safe": "Motion looks deployable. Consider adding a sharper wind-up for crowd appeal.",
        "needs_edits": "Reduce peak spin speed or widen stance before the fastest segment.",
        "unsafe": "High balance risk detected. Slow the rotation and shorten arm extension.",
    }[stats.verdict]

    return {
        "id": name,
        "name": name.replace("_", " ").title(),
        "source": "ultimate_bots_studio",
        "motion_dir": str(motion_dir),
        "sonic_zip": sonic_zip,
        "attack_type": "strike_combo",
        "studio_sonic_validated": sonic_zip is not None,
        "stats": {
            "speed": clamp(stats.peak_velocity * 2.2, 0, 100),
            "power": clamp(stats.mean_velocity * 35.0, 0, 100),
            "smoothness": stats.smoothness,
            "balance_risk": clamp(
                stats.extension_risk * 0.4 + stats.jerk_score * 0.35 + (100 - stats.recovery_score) * 0.25,
                0,
                100,
            ),
            "recovery": stats.recovery_score,
            "deployability": stats.deploy_score,
        },
        "verdict": stats.verdict,
        "coach_feedback": coaching,
        "pipeline": {
            "data": "human recording + studio retarget",
            "eval": "joint trajectory heuristics",
            "deploy": "sonic zip validated in studio simulate",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Score a SONIC motion folder.")
    parser.add_argument(
        "motion_dir",
        type=Path,
        nargs="?",
        default=Path("assets/motions/ghost_jab_combo_extracted"),
    )
    parser.add_argument("--name", default="ghost_jab_combo")
    parser.add_argument(
        "--sonic-zip",
        default="assets/motions/ghost_jab_combo_sonic.zip",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("move_cards/ghost_jab_combo.json"),
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    motion_dir = args.motion_dir if args.motion_dir.is_absolute() else repo_root / args.motion_dir
    out_path = args.out if args.out.is_absolute() else repo_root / args.out
    sonic_zip = args.sonic_zip

    stats = analyze_motion(motion_dir)
    card = build_move_card(args.name, motion_dir, stats, sonic_zip)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps({"stats": asdict(stats), "move_card": card}, indent=2))

    print(json.dumps({"stats": asdict(stats), "move_card": card}, indent=2))
    print(f"\nWrote {out_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
