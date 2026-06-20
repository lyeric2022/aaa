"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import URDFLoader from "urdf-loader";

type Trajectory = {
  fps: number;
  playback_fps?: number;
  duration_sec?: number;
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

type URDFRobotLike = THREE.Object3D & {
  setJointValue?: (jointName: string, value: number) => void;
};

const G1_JOINT_ORDER = [
  "left_hip_pitch_joint",
  "left_hip_roll_joint",
  "left_hip_yaw_joint",
  "left_knee_joint",
  "left_ankle_pitch_joint",
  "left_ankle_roll_joint",
  "right_hip_pitch_joint",
  "right_hip_roll_joint",
  "right_hip_yaw_joint",
  "right_knee_joint",
  "right_ankle_pitch_joint",
  "right_ankle_roll_joint",
  "waist_yaw_joint",
  "waist_roll_joint",
  "waist_pitch_joint",
  "left_shoulder_pitch_joint",
  "left_shoulder_roll_joint",
  "left_shoulder_yaw_joint",
  "left_elbow_joint",
  "left_wrist_roll_joint",
  "left_wrist_pitch_joint",
  "left_wrist_yaw_joint",
  "right_shoulder_pitch_joint",
  "right_shoulder_roll_joint",
  "right_shoulder_yaw_joint",
  "right_elbow_joint",
  "right_wrist_roll_joint",
  "right_wrist_pitch_joint",
  "right_wrist_yaw_joint",
] as const;

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

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const millis = Math.floor((safeSeconds % 1) * 1000);
  return `${minutes}:${String(wholeSeconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function setPlaceholderVisible(robot: THREE.Group, visible: boolean) {
  for (const child of robot.children) {
    if (child.userData.placeholder) child.visible = visible;
  }
}

function tintRobot(robot: THREE.Object3D) {
  robot.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as THREE.MeshStandardMaterial | THREE.MeshPhongMaterial;
    if (material && "color" in material) {
      material.color.lerp(new THREE.Color("#7c5cff"), 0.06);
      material.needsUpdate = true;
    }
  });
}

function addG1UrdfSkin(robot: THREE.Group) {
  const loader = new URDFLoader();
  loader.load(
    "/models/g1_description/g1_29dof_mode_15.urdf",
    (urdf: URDFRobotLike) => {
      urdf.name = "g1_replay_skin";
      urdf.rotation.x = -Math.PI / 2;
      urdf.position.y = 0.82;
      urdf.scale.setScalar(1.08);
      urdf.traverse((obj) => {
        obj.castShadow = true;
        obj.receiveShadow = true;
      });
      tintRobot(urdf);
      robot.userData.urdf = urdf;
      robot.add(urdf);
    },
    undefined,
    (err) => {
      console.error("Failed to load replay G1 URDF", err);
      setPlaceholderVisible(robot, true);
    },
  );
}

function applyFrameToUrdf(robot: THREE.Group, frame: number[]) {
  const urdf = robot.userData.urdf as URDFRobotLike | undefined;
  const setJointValue = urdf?.setJointValue;
  if (!setJointValue) return;

  G1_JOINT_ORDER.forEach((jointName, index) => {
    const value = frame[index];
    if (Number.isFinite(value)) setJointValue.call(urdf, jointName, value);
  });
}

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
  const [isPlaying, setIsPlaying] = useState(true);

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
    scene.background = new THREE.Color("#060707");
    scene.fog = new THREE.Fog("#060707", 4.2, 12);

    const camera = new THREE.PerspectiveCamera(
      42,
      host.clientWidth / 520,
      0.1,
      100,
    );
    camera.position.set(1.15, 1.25, 5.6);
    camera.lookAt(0, 0.95, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(host.clientWidth, 520);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0.95, 0);
    controls.minDistance = 2.4;
    controls.maxDistance = 8;

    scene.add(new THREE.AmbientLight("#b9c3d6", 0.65));
    const key = new THREE.DirectionalLight("#e7eefc", 2.5);
    key.position.set(-2.5, 4.8, 3.2);
    key.castShadow = true;
    scene.add(key);
    const fill = new THREE.DirectionalLight("#2f6dff", 0.7);
    fill.position.set(4, 1.8, -3);
    scene.add(fill);

    const grid = new THREE.GridHelper(16, 32, "#1f2630", "#10151d");
    grid.position.y = -0.01;
    scene.add(grid);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 16),
      new THREE.MeshStandardMaterial({
        color: "#090b0f",
        emissive: "#030405",
        metalness: 0.05,
        roughness: 0.8,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

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
      transparent: true,
      opacity: 0.38,
    });
    const green = new THREE.MeshStandardMaterial({
      color: "#3dd68c",
      emissive: "#0d3b27",
      metalness: 0.15,
      roughness: 0.3,
      transparent: true,
      opacity: 0.42,
    });
    const orange = new THREE.MeshStandardMaterial({
      color: "#f5a623",
      emissive: "#4a2b05",
      metalness: 0.1,
      roughness: 0.4,
      transparent: true,
      opacity: 0.68,
    });

    const bones = SEGMENTS.map((_, i) => {
      const mesh = new THREE.Mesh(boneGeo, i < 4 ? purple : green);
      mesh.userData.placeholder = true;
      robot.add(mesh);
      return mesh;
    });
    const joints = Object.keys(pointsFromFrame(activeTrajectory.frames[0], 0)).map(() => {
      const mesh = new THREE.Mesh(jointGeo, orange);
      mesh.userData.placeholder = true;
      robot.add(mesh);
      return mesh;
    });
    const torso = new THREE.Mesh(torsoGeo, purple);
    torso.userData.placeholder = true;
    robot.add(torso);
    const head = new THREE.Mesh(headGeo, orange);
    head.userData.placeholder = true;
    robot.add(head);

    const trail = Array.from({ length: 18 }, () => {
      const mesh = new THREE.Mesh(trailGeo, green);
      mesh.material = green.clone();
      mesh.userData.placeholder = true;
      robot.add(mesh);
      return mesh;
    });

    addG1UrdfSkin(robot);

    const clock = new THREE.Clock();
    let raf = 0;
    const matrixUp = new THREE.Vector3(0, 1, 0);
    const playbackFps =
      activeTrajectory.playback_fps ??
      activeTrajectory.frames.length /
        Math.max(
          activeTrajectory.duration_sec ??
            activeTrajectory.frames.length / Math.max(activeTrajectory.fps, 1),
          0.001,
        );

    function renderLoop() {
      raf = requestAnimationFrame(renderLoop);
      const elapsed = clock.getElapsedTime();
      if (playingRef.current) {
        frameRef.current =
          Math.floor(elapsed * playbackFps) % activeTrajectory.frames.length;
      }

      const frame = activeTrajectory.frames[frameRef.current];
      const pts = pointsFromFrame(frame, frameRef.current);
      const values = Object.values(pts);
      applyFrameToUrdf(robot, frame);

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

      robot.rotation.y = 0;
      controls.update();
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
      controls.dispose();
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
    <div className="overflow-hidden rounded-2xl border border-[#171a22] bg-[#050607] shadow-2xl shadow-black/50">
      <div className="relative">
        {!trajectory && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-[#05050a] text-sm text-[#8888a0]">
            Loading SONIC trajectory…
          </div>
        )}
        <div ref={hostRef} className="h-[520px]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/70 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-black/80 to-transparent" />

        <div className="absolute left-3 top-3 flex gap-2">
          <button className="rounded border border-white/10 bg-black/40 px-3 py-1.5 text-[11px] text-white/50 backdrop-blur">
            ↩ Undo
          </button>
          <button className="rounded border border-white/10 bg-black/40 px-3 py-1.5 text-[11px] text-white/50 backdrop-blur">
            ↪ Redo
          </button>
        </div>

        <div className="pointer-events-none absolute bottom-12 left-3 rounded-sm px-1 text-[9px] uppercase tracking-[0.14em] text-white/45">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[#6aa3ff]" />
            Reference motion
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[#dce6f3]" />
            GEAR-SONIC simulation
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 border-t border-white/10 bg-black/35 px-4 py-2 backdrop-blur-sm">
          <div className="flex items-center justify-center gap-3 text-[11px] text-white/55">
            <button
              onClick={() => {
                frameRef.current = 0;
                setFrameIndex(0);
              }}
              className="rounded border border-white/10 bg-[#0c1118] px-2.5 py-1 text-white/60"
              title="Go to start"
              aria-label="Go to start"
            >
              ⏮
            </button>
            <button
              onClick={() => {
                const next = !playingRef.current;
                playingRef.current = next;
                setIsPlaying(next);
              }}
              className="rounded border border-[#a6ff3d]/40 bg-[#a6ff3d]/10 px-3 py-1 font-semibold text-[#a6ff3d]"
              title="Play / Pause"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? "Ⅱ" : "▶"}
            </button>
            <span>
              {trajectory
                ? formatTime(
                    (frameIndex / Math.max(trajectory.frames.length - 1, 1)) *
                      (trajectory.duration_sec ??
                        trajectory.frames.length / Math.max(trajectory.fps, 1)),
                  )
                : "0:00.000"}{" "}
              /{" "}
              {trajectory
                ? formatTime(
                    trajectory.duration_sec ??
                      trajectory.frames.length / Math.max(trajectory.fps, 1),
                  )
                : "0:00.000"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
