"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

type Trajectory = {
  fps: number;
  frames: number[][];
  joint_order: string;
};

type JointPoints = {
  pelvis: THREE.Vector3;
  chest: THREE.Vector3;
  head: THREE.Vector3;
  lShoulder: THREE.Vector3;
  rShoulder: THREE.Vector3;
  lElbow: THREE.Vector3;
  rElbow: THREE.Vector3;
  lHand: THREE.Vector3;
  rHand: THREE.Vector3;
  lHip: THREE.Vector3;
  rHip: THREE.Vector3;
  lKnee: THREE.Vector3;
  rKnee: THREE.Vector3;
  lFoot: THREE.Vector3;
  rFoot: THREE.Vector3;
};

const SEGMENTS: [keyof JointPoints, keyof JointPoints][] = [
  ["pelvis", "chest"],
  ["chest", "head"],
  ["chest", "lShoulder"],
  ["chest", "rShoulder"],
  ["lShoulder", "lElbow"],
  ["lElbow", "lHand"],
  ["rShoulder", "rElbow"],
  ["rElbow", "rHand"],
  ["pelvis", "lHip"],
  ["pelvis", "rHip"],
  ["lHip", "lKnee"],
  ["lKnee", "lFoot"],
  ["rHip", "rKnee"],
  ["rKnee", "rFoot"],
];

function limb(
  origin: THREE.Vector3,
  length: number,
  pitch: number,
  roll: number,
  yaw = 0,
  downward = true,
) {
  const dir = new THREE.Vector3(
    Math.sin(roll + yaw) * 0.65,
    downward ? -Math.cos(pitch) : Math.cos(pitch),
    Math.sin(pitch + yaw * 0.4),
  ).normalize();
  return origin.clone().add(dir.multiplyScalar(length));
}

function pointsFromFrame(frame: number[], t: number): JointPoints {
  // G1/SONIC rough order: legs 0-11, waist 12-14, left arm 15-21, right arm 22-28.
  const step = Math.sin(t * 0.09) * 0.06;
  const pelvis = new THREE.Vector3(step, 1.05, 0);
  const waistYaw = frame[12] ?? 0;
  const waistRoll = frame[13] ?? 0;
  const waistPitch = frame[14] ?? 0;
  const chest = pelvis
    .clone()
    .add(
      new THREE.Vector3(
        Math.sin(waistRoll) * 0.16,
        0.58,
        Math.sin(waistPitch) * 0.22,
      ),
    );
  const head = chest
    .clone()
    .add(new THREE.Vector3(Math.sin(waistYaw) * 0.08, 0.36, 0.04));

  const lShoulder = chest.clone().add(new THREE.Vector3(-0.34, 0.15, 0));
  const rShoulder = chest.clone().add(new THREE.Vector3(0.34, 0.15, 0));
  const lHip = pelvis.clone().add(new THREE.Vector3(-0.18, -0.04, 0));
  const rHip = pelvis.clone().add(new THREE.Vector3(0.18, -0.04, 0));

  const lKnee = limb(lHip, 0.48, frame[0] ?? 0, frame[1] ?? 0, frame[2] ?? 0);
  const lFoot = limb(lKnee, 0.46, (frame[3] ?? 0) * 0.7, frame[4] ?? 0);
  const rKnee = limb(rHip, 0.48, frame[6] ?? 0, frame[7] ?? 0, frame[8] ?? 0);
  const rFoot = limb(rKnee, 0.46, (frame[9] ?? 0) * 0.7, frame[10] ?? 0);

  const lElbow = limb(
    lShoulder,
    0.42,
    (frame[15] ?? 0) + 0.25,
    (frame[16] ?? 0) - 0.7,
    frame[17] ?? 0,
  );
  const lHand = limb(lElbow, 0.38, (frame[18] ?? 0) + 0.45, frame[19] ?? 0);
  const rElbow = limb(
    rShoulder,
    0.42,
    (frame[22] ?? 0) + 0.25,
    -(frame[23] ?? 0) + 0.7,
    frame[24] ?? 0,
  );
  const rHand = limb(rElbow, 0.38, (frame[25] ?? 0) + 0.45, -(frame[26] ?? 0));

  return {
    pelvis,
    chest,
    head,
    lShoulder,
    rShoulder,
    lElbow,
    rElbow,
    lHand,
    rHand,
    lHip,
    rHip,
    lKnee,
    rKnee,
    lFoot,
    rFoot,
  };
}

function updateBone(mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3) {
  const mid = start.clone().add(end).multiplyScalar(0.5);
  const dir = end.clone().sub(start);
  const length = Math.max(dir.length(), 0.001);
  mesh.position.copy(mid);
  mesh.scale.set(1, length, 1);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.normalize(),
  );
}

export function RobotReplay3D({ moveId }: { moveId: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef(0);
  const playingRef = useRef(true);
  const [trajectory, setTrajectory] = useState<Trajectory | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/moves/${moveId}/trajectory`)
      .then((r) => {
        if (!r.ok) throw new Error("No SONIC trajectory available");
        return r.json();
      })
      .then(setTrajectory)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "No trajectory"),
      );
  }, [moveId]);

  useEffect(() => {
    if (!trajectory || !hostRef.current) return;

    const activeTrajectory = trajectory;
    const host = hostRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#05050a");

    const camera = new THREE.PerspectiveCamera(
      42,
      host.clientWidth / 520,
      0.1,
      100,
    );
    camera.position.set(2.4, 1.75, 4.1);
    camera.lookAt(0, 1.05, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(host.clientWidth, 520);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight("#ffffff", 1.35));
    const key = new THREE.DirectionalLight("#a78bfa", 3.2);
    key.position.set(2, 4, 3);
    scene.add(key);
    const fill = new THREE.DirectionalLight("#3dd68c", 1.2);
    fill.position.set(-3, 2, -2);
    scene.add(fill);

    const grid = new THREE.GridHelper(5, 20, "#3a345f", "#171729");
    scene.add(grid);

    const robot = new THREE.Group();
    scene.add(robot);

    const boneGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 14);
    const torsoGeo = new THREE.CapsuleGeometry(0.11, 0.46, 6, 16);
    const headGeo = new THREE.SphereGeometry(0.12, 20, 20);
    const jointGeo = new THREE.SphereGeometry(0.055, 14, 14);
    const trailGeo = new THREE.SphereGeometry(0.024, 8, 8);
    const purple = new THREE.MeshStandardMaterial({
      color: "#7c5cff",
      emissive: "#1d124f",
      metalness: 0.2,
      roughness: 0.35,
    });
    const green = new THREE.MeshStandardMaterial({
      color: "#3dd68c",
      emissive: "#0d3b27",
      metalness: 0.15,
      roughness: 0.3,
    });
    const orange = new THREE.MeshStandardMaterial({
      color: "#f5a623",
      emissive: "#4a2b05",
      metalness: 0.1,
      roughness: 0.4,
    });

    const bones = SEGMENTS.map((_, i) => {
      const mesh = new THREE.Mesh(boneGeo, i < 4 ? purple : green);
      robot.add(mesh);
      return mesh;
    });
    const joints = Object.keys(pointsFromFrame(activeTrajectory.frames[0], 0)).map(() => {
      const mesh = new THREE.Mesh(jointGeo, orange);
      robot.add(mesh);
      return mesh;
    });
    const torso = new THREE.Mesh(torsoGeo, purple);
    robot.add(torso);
    const head = new THREE.Mesh(headGeo, orange);
    robot.add(head);

    const trail = Array.from({ length: 18 }, () => {
      const mesh = new THREE.Mesh(trailGeo, green);
      mesh.material = green.clone();
      robot.add(mesh);
      return mesh;
    });

    const clock = new THREE.Clock();
    let raf = 0;
    const matrixUp = new THREE.Vector3(0, 1, 0);

    function renderLoop() {
      raf = requestAnimationFrame(renderLoop);
      const elapsed = clock.getElapsedTime();
      if (playingRef.current) {
        frameRef.current =
          Math.floor(elapsed * activeTrajectory.fps) % activeTrajectory.frames.length;
      }

      const frame = activeTrajectory.frames[frameRef.current];
      const pts = pointsFromFrame(frame, frameRef.current);
      const values = Object.values(pts);

      SEGMENTS.forEach(([a, b], i) => updateBone(bones[i], pts[a], pts[b]));
      values.forEach((p, i) => joints[i].position.copy(p));

      const torsoDir = pts.head.clone().sub(pts.pelvis).normalize();
      torso.position.copy(pts.pelvis.clone().lerp(pts.chest, 0.58));
      torso.quaternion.setFromUnitVectors(matrixUp, torsoDir);
      head.position.copy(pts.head);

      trail.forEach((dot, i) => {
        const idx =
          (frameRef.current - i * 4 + activeTrajectory.frames.length) %
          activeTrajectory.frames.length;
        const hand = pointsFromFrame(activeTrajectory.frames[idx], idx).rHand;
        dot.position.copy(hand);
        dot.scale.setScalar(1 - i / trail.length);
      });

      robot.rotation.y = Math.sin(elapsed * 0.28) * 0.25;
      renderer.render(scene, camera);
      setFrameIndex(frameRef.current);
    }

    renderLoop();

    function onResize() {
      if (!hostRef.current) return;
      camera.aspect = hostRef.current.clientWidth / 520;
      camera.updateProjectionMatrix();
      renderer.setSize(hostRef.current.clientWidth, 520);
    }
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, [trajectory]);

  if (error) {
    return (
      <div className="rounded-2xl border border-dashed border-[#2a2a3d] p-6 text-sm text-[#8888a0]">
        3D replay unavailable: {error}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[#2a2a3d] bg-[#101018] shadow-2xl shadow-[#7c5cff]/10">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#2a2a3d] p-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[#3dd68c]">
            3D Kinematic Replay
          </p>
          <h2 className="text-lg font-semibold">
            SONIC joint trajectory on a robot body
          </h2>
          <p className="mt-1 text-xs text-[#8888a0]">
            Visual preview from `joint_pos.csv`; MuJoCo/GEAR is the next
            verification step.
          </p>
        </div>
        <button
          onClick={() => {
            playingRef.current = !playingRef.current;
          }}
          className="rounded-lg bg-[#7c5cff] px-3 py-1.5 text-sm font-semibold"
        >
          Play / Pause
        </button>
      </div>
      <div className="relative">
        {!trajectory && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-[#05050a] text-sm text-[#8888a0]">
            Loading SONIC trajectory…
          </div>
        )}
        <div ref={hostRef} className="h-[520px]" />
        <div className="pointer-events-none absolute left-4 top-4 rounded-lg border border-[#2a2a3d] bg-black/50 px-3 py-2 text-xs text-[#e8e8f0] backdrop-blur">
          Purple torso · green limbs · orange joints · right-hand trail
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#2a2a3d] p-4 text-xs text-[#8888a0]">
        <span>
          Frame {frameIndex + 1}/{trajectory?.frames.length ?? 0} ·{" "}
          {trajectory?.fps ?? 50} Hz
        </span>
        <span>{trajectory?.joint_order ?? "SONIC joint trajectory"}</span>
      </div>
    </div>
  );
}
