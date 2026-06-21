"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import URDFLoader from "urdf-loader";
import { G1_MUJOCO_JOINT_NAMES } from "@/lib/g1Motion";
import { applyCameraFrame } from "@/lib/cameraFrame";
import { useCameraDebug } from "@/lib/useCameraDebug";
import { CameraDebugPanel } from "@/components/CameraDebugPanel";

type Trajectory = {
  fps: number;
  playback_fps?: number;
  duration_sec?: number;
  frames: number[][];
  joint_order: string;
};

type URDFRobotLike = THREE.Object3D & {
  setJointValue?: (jointName: string, value: number) => void;
};

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const millis = Math.floor((safeSeconds % 1) * 1000);
  return `${minutes}:${String(wholeSeconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
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
    },
  );
}

function applyFrameToUrdf(robot: THREE.Group, frame: number[]) {
  const urdf = robot.userData.urdf as URDFRobotLike | undefined;
  const setJointValue = urdf?.setJointValue;
  if (!setJointValue) return;

  G1_MUJOCO_JOINT_NAMES.forEach((jointName, index) => {
    const value = frame[index];
    if (Number.isFinite(value)) setJointValue.call(urdf, jointName, value);
  });
}

export function RobotReplay3D({ moveId }: { moveId: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef(0);
  const playingRef = useRef(true);
  const [trajectory, setTrajectory] = useState<Trajectory | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [error, setError] = useState("");
  const [isPlaying, setIsPlaying] = useState(true);
  const { frame: cameraFrame, defaultFrame: cameraDefault, syncFromScene, resetToDefault } =
    useCameraDebug("replay");

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

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(host.clientWidth, 520);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    applyCameraFrame(camera, controls, cameraDefault);
    controls.enableDamping = true;
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
    robot.rotation.y = (3 * Math.PI) / 2;
    scene.add(robot);
    addG1UrdfSkin(robot);

    const clock = new THREE.Clock();
    let raf = 0;
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

      applyFrameToUrdf(robot, activeTrajectory.frames[frameRef.current]);
      controls.update();
      syncFromScene(camera, controls);
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
  }, [cameraDefault, syncFromScene, trajectory]);

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
        <CameraDebugPanel
          label="Replay camera"
          frame={cameraFrame}
          defaultFrame={cameraDefault}
          onReset={resetToDefault}
          defaultOpen={false}
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/70 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-black/80 to-transparent" />

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
