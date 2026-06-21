"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import URDFLoader from "urdf-loader";
import type { MoveRecord } from "@/lib/types";
import { announcer, battleCall, koCall, resetCall } from "@/lib/announcer";
import { applyCameraFrame } from "@/lib/cameraFrame";
import { useCameraDebug } from "@/lib/useCameraDebug";
import { CameraDebugPanel } from "@/components/CameraDebugPanel";

type PlayerSide = "left" | "right";

type FighterState = {
  name: string;
  hp: number;
  balance: number;
  x: number;
  attacking: boolean;
  attackSide: PlayerSide | null;
  attackStart: number;
  hitFlash: number;
};

type ArenaMove = {
  id: string;
  name: string;
  speed: number;
  power: number;
  balanceRisk: number;
  recovery: number;
};

function clamp(value: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, value));
}

function prettifyName(raw: string): string {
  const cleaned = raw
    .replace(/[_-]+/g, " ")
    .replace(/\bsonic\b/gi, "")
    .replace(/\buntitled project\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const base = cleaned || "Ghost Move";
  return base.replace(/\b\w/g, (c) => c.toUpperCase());
}

function toArenaMove(record: MoveRecord): ArenaMove {
  return {
    id: record.move_card.id,
    name: prettifyName(record.move_card.name || record.move_card.id),
    speed: record.move_card.stats.speed,
    power: record.move_card.stats.power,
    balanceRisk: record.move_card.stats.balance_risk,
    recovery: record.move_card.stats.recovery,
  };
}

function createMaterial(color: string, emissive = "#000000") {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    metalness: 0.35,
    roughness: 0.38,
  });
}

function capsule(radius: number, length: number, material: THREE.Material) {
  return new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 8, 18), material);
}

type URDFRobotLike = THREE.Object3D & {
  setJointValue?: (jointName: string, value: number) => void;
};

function setPlaceholderVisible(robot: THREE.Group, visible: boolean) {
  for (const child of robot.children) {
    if (child.userData.placeholder) child.visible = visible;
  }
}

function tintRobot(robot: THREE.Object3D, accent: string) {
  robot.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as THREE.MeshStandardMaterial | THREE.MeshPhongMaterial;
    if (material && "color" in material) {
      material.color.lerp(new THREE.Color(accent), 0.08);
      material.needsUpdate = true;
    }
  });
}

function addG1UrdfSkin(robot: THREE.Group, accent: string) {
  const loader = new URDFLoader();
  loader.load(
    "/models/g1_description/g1_29dof_mode_15.urdf",
    (urdf: URDFRobotLike) => {
      urdf.name = "g1_urdf_skin";
      // URDFLoader preserves ROS coordinates (Z-up). The arena is Three.js
      // Y-up, so rotate the whole robot into the arena and lift its feet.
      urdf.rotation.x = -Math.PI / 2;
      urdf.position.y = 0.82;
      urdf.scale.setScalar(1.08);
      urdf.traverse((obj) => {
        obj.castShadow = true;
        obj.receiveShadow = true;
      });
      tintRobot(urdf, accent);
      robot.userData.urdf = urdf;
      setPlaceholderVisible(robot, false);
      robot.add(urdf);
    },
    undefined,
    (err) => {
      console.error("Failed to load G1 URDF", err);
      setPlaceholderVisible(robot, true);
    },
  );
}

function makeRobot(accent: string) {
  const robot = new THREE.Group();
  const dark = createMaterial("#d7d9df");
  const black = createMaterial("#11131a");
  const glow = createMaterial(accent, accent);

  const pelvis = capsule(0.18, 0.18, black);
  pelvis.name = "pelvis";
  pelvis.userData.placeholder = true;
  pelvis.position.y = 0.95;
  pelvis.rotation.z = Math.PI / 2;
  robot.add(pelvis);

  const torso = capsule(0.23, 0.48, dark);
  torso.name = "torso";
  torso.userData.placeholder = true;
  torso.position.y = 1.35;
  robot.add(torso);

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.24, 0.22), black);
  chest.name = "chest";
  chest.userData.placeholder = true;
  chest.position.y = 1.62;
  robot.add(chest);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.22), dark);
  head.name = "head";
  head.userData.placeholder = true;
  head.position.y = 1.88;
  robot.add(head);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.235), glow);
  visor.userData.placeholder = true;
  visor.position.set(0, 1.9, 0.115);
  robot.add(visor);

  const makeLimb = (name: string, x: number, y: number, upper = true) => {
    const limb = capsule(upper ? 0.055 : 0.05, upper ? 0.34 : 0.32, dark);
    limb.name = name;
    limb.userData.placeholder = true;
    limb.position.set(x, y, 0);
    robot.add(limb);
    return limb;
  };

  makeLimb("leftUpperArm", -0.36, 1.48);
  makeLimb("leftForearm", -0.47, 1.2, false);
  makeLimb("rightUpperArm", 0.36, 1.48);
  makeLimb("rightForearm", 0.47, 1.2, false);
  makeLimb("leftThigh", -0.14, 0.68);
  makeLimb("leftShin", -0.14, 0.31, false);
  makeLimb("rightThigh", 0.14, 0.68);
  makeLimb("rightShin", 0.14, 0.31, false);

  for (const [x, y] of [
    [-0.36, 1.67],
    [0.36, 1.67],
    [-0.14, 0.86],
    [0.14, 0.86],
  ]) {
    const joint = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 16), glow);
    joint.userData.placeholder = true;
    joint.position.set(x, y, 0);
    robot.add(joint);
  }

  addG1UrdfSkin(robot, accent);
  return robot;
}

function setRobotPose(
  robot: THREE.Group,
  side: PlayerSide,
  attackProgress: number,
  hitFlash: number,
) {
  const direction = side === "left" ? 1 : -1;
  robot.rotation.y = side === "left" ? 0 : Math.PI;
  robot.position.y = hitFlash > 0 ? Math.sin(hitFlash * Math.PI * 6) * 0.015 : 0;

  const rightUpper = robot.getObjectByName("rightUpperArm");
  const rightFore = robot.getObjectByName("rightForearm");
  const leftUpper = robot.getObjectByName("leftUpperArm");
  const leftFore = robot.getObjectByName("leftForearm");
  const torso = robot.getObjectByName("torso");

  const punch = Math.sin(Math.min(1, attackProgress) * Math.PI);
  robot.scale.setScalar(1 + punch * 0.04);
  const urdf = robot.userData.urdf as URDFRobotLike | undefined;
  if (urdf?.setJointValue) {
    const reach = punch * (side === "left" ? -1 : 1);
    urdf.setJointValue("right_shoulder_pitch_joint", -0.45 - punch * 1.15);
    urdf.setJointValue("right_shoulder_roll_joint", reach * 0.35);
    urdf.setJointValue("right_elbow_joint", 0.35 + punch * 1.2);
    urdf.setJointValue("left_shoulder_pitch_joint", -0.2 + punch * 0.35);
    urdf.setJointValue("left_elbow_joint", 0.7 - punch * 0.25);
    urdf.setJointValue("waist_yaw_joint", reach * 0.22);
  }
  if (rightUpper) {
    rightUpper.position.z = punch * 0.52 * direction;
    rightUpper.position.x = 0.36 + punch * 0.16;
    rightUpper.rotation.x = punch * 1.7;
  }
  if (rightFore) {
    rightFore.position.z = punch * 0.95 * direction;
    rightFore.position.x = 0.47 + punch * 0.28;
    rightFore.rotation.x = punch * 2.1;
  }
  if (leftUpper) leftUpper.rotation.x = -0.35 - punch * 0.4;
  if (leftFore) leftFore.rotation.x = -0.45 - punch * 0.3;
  if (torso) torso.rotation.z = -punch * 0.12 * direction;
}

function damageFor(move: ArenaMove) {
  return Math.round(8 + move.power * 0.22 + move.speed * 0.18);
}

function balanceDamageFor(move: ArenaMove) {
  return Math.round(8 + move.balanceRisk * 0.22 + move.speed * 0.08);
}

export function Arena3D() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const leftRobot = useRef<THREE.Group | null>(null);
  const rightRobot = useRef<THREE.Group | null>(null);
  const leftImpactRef = useRef<THREE.Mesh | null>(null);
  const rightImpactRef = useRef<THREE.Mesh | null>(null);
  const leftStateRef = useRef<FighterState | null>(null);
  const rightStateRef = useRef<FighterState | null>(null);
  const [moves, setMoves] = useState<ArenaMove[]>([]);
  const [left, setLeft] = useState<FighterState>({
    name: "Player 1",
    hp: 100,
    balance: 100,
    x: -1.15,
    attacking: false,
    attackSide: null,
    attackStart: 0,
    hitFlash: 0,
  });
  const [right, setRight] = useState<FighterState>({
    name: "Player 2",
    hp: 100,
    balance: 100,
    x: 1.15,
    attacking: false,
    attackSide: null,
    attackStart: 0,
    hitFlash: 0,
  });
  const [log, setLog] = useState<string[]>([
    "Choose a move. Each robot can play robot-skill cards like Street Fighter specials.",
  ]);
  const [announcerOn, setAnnouncerOn] = useState(true);
  const [announcerReady, setAnnouncerReady] = useState<boolean | null>(null);
  const koSpokenRef = useRef(false);
  const { frame: cameraFrame, defaultFrame: cameraDefault, syncFromScene, resetToDefault } =
    useCameraDebug("arena");

  useEffect(() => {
    leftStateRef.current = left;
    rightStateRef.current = right;
  }, [left, right]);

  useEffect(() => {
    announcer.setEnabled(announcerOn);
  }, [announcerOn]);

  useEffect(() => {
    fetch("/api/tts")
      .then((res) => res.json())
      .then((data: { configured?: boolean }) => setAnnouncerReady(Boolean(data.configured)))
      .catch(() => setAnnouncerReady(false));
  }, []);

  useEffect(() => {
    fetch("/api/moves")
      .then((r) => r.json())
      .then((records: MoveRecord[]) => {
        const scored = records
          .filter((r) => r.move_card.verdict !== "pending")
          .map(toArenaMove);
        setMoves(scored.length ? scored : []);
      });
  }, []);

  const arenaBasics = useMemo<ArenaMove[]>(
    () => [
      { id: "basic_jab", name: "Quick Jab", speed: 72, power: 11, balanceRisk: 28, recovery: 64 },
      { id: "basic_cross", name: "Counter Cross", speed: 54, power: 22, balanceRisk: 48, recovery: 50 },
      { id: "basic_sweep", name: "Low Sweep", speed: 46, power: 17, balanceRisk: 62, recovery: 44 },
      { id: "basic_guard", name: "Guard Break", speed: 38, power: 26, balanceRisk: 70, recovery: 36 },
    ],
    [],
  );

  // Always give each fighter a varied kit: the player's real scored moves
  // first, then arena archetypes to fill out a 4-slot loadout.
  const usableMoves = useMemo<ArenaMove[]>(() => {
    const roster: ArenaMove[] = [];
    const seen = new Set<string>();
    for (const move of [...moves, ...arenaBasics]) {
      const key = move.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      roster.push(move);
      if (roster.length >= 4) break;
    }
    return roster;
  }, [moves, arenaBasics]);

  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#07070d");

    const camera = new THREE.PerspectiveCamera(45, host.clientWidth / 560, 0.1, 100);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, 560);
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    applyCameraFrame(camera, controls, cameraDefault);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.minDistance = 1.8;
    controls.maxDistance = 8;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.update();

    scene.add(new THREE.AmbientLight("#ffffff", 1.1));
    const key = new THREE.DirectionalLight("#ffffff", 2.4);
    key.position.set(0, 5, 4);
    scene.add(key);
    const magenta = new THREE.DirectionalLight("#7c5cff", 2);
    magenta.position.set(-3, 2, 1);
    scene.add(magenta);
    const green = new THREE.DirectionalLight("#3dd68c", 1.8);
    green.position.set(3, 2, 1);
    scene.add(green);

    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(2.4, 2.4, 0.08, 72),
      createMaterial("#12131d"),
    );
    floor.position.y = -0.04;
    scene.add(floor);
    scene.add(new THREE.GridHelper(5, 18, "#343055", "#171729"));

    const leftBot = makeRobot("#3dd68c");
    const rightBot = makeRobot("#ff5c5c");
    leftBot.position.x = left.x;
    rightBot.position.x = right.x;
    scene.add(leftBot, rightBot);
    leftRobot.current = leftBot;
    rightRobot.current = rightBot;

    const impactGeo = new THREE.SphereGeometry(0.12, 20, 20);
    const leftImpact = new THREE.Mesh(impactGeo, createMaterial("#3dd68c", "#3dd68c"));
    const rightImpact = new THREE.Mesh(impactGeo, createMaterial("#ff5c5c", "#ff5c5c"));
    leftImpact.visible = false;
    rightImpact.visible = false;
    scene.add(leftImpact, rightImpact);
    leftImpactRef.current = leftImpact;
    rightImpactRef.current = rightImpact;

    let raf = 0;
    const clock = new THREE.Clock();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = clock.getElapsedTime();
      const leftState = leftStateRef.current ?? left;
      const rightState = rightStateRef.current ?? right;
      const leftProgress =
        leftState.attackSide === "left"
          ? Math.min(1, (Date.now() - leftState.attackStart) / 520)
          : 0;
      const rightProgress =
        rightState.attackSide === "right"
          ? Math.min(1, (Date.now() - rightState.attackStart) / 520)
          : 0;

      const leftLunge = leftProgress * (1 - leftProgress) * 1.5;
      const rightLunge = rightProgress * (1 - rightProgress) * 1.5;
      leftBot.position.x = THREE.MathUtils.lerp(leftBot.position.x, leftState.x + leftLunge, 0.28);
      rightBot.position.x = THREE.MathUtils.lerp(rightBot.position.x, rightState.x - rightLunge, 0.28);
      leftBot.position.z = Math.sin(t * 2.2) * 0.015;
      rightBot.position.z = -Math.sin(t * 2.1) * 0.015;
      setRobotPose(leftBot, "left", leftProgress, leftState.hitFlash);
      setRobotPose(rightBot, "right", rightProgress, rightState.hitFlash);

      if (leftImpact) {
        leftImpact.visible = leftProgress > 0.2 && leftProgress < 0.82;
        leftImpact.position.set(leftBot.position.x + 0.78, 1.35, 0);
        leftImpact.scale.setScalar(0.6 + leftProgress * 2.2);
      }
      if (rightImpact) {
        rightImpact.visible = rightProgress > 0.2 && rightProgress < 0.82;
        rightImpact.position.set(rightBot.position.x - 0.78, 1.35, 0);
        rightImpact.scale.setScalar(0.6 + rightProgress * 2.2);
      }
      controls.update();
      syncFromScene(camera, controls);
      renderer.render(scene, camera);
    };
    loop();

    const resize = () => {
      if (!hostRef.current) return;
      camera.aspect = hostRef.current.clientWidth / 560;
      camera.updateProjectionMatrix();
      renderer.setSize(hostRef.current.clientWidth, 560);
    };
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
    // The scene is recreated only once; state updates are pushed through refs/React values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setLeft((p) => ({
        ...p,
        hitFlash: Math.max(0, p.hitFlash - 0.08),
        attacking: p.attacking && Date.now() - p.attackStart < 520,
        attackSide: Date.now() - p.attackStart < 520 ? p.attackSide : null,
      }));
      setRight((p) => ({
        ...p,
        hitFlash: Math.max(0, p.hitFlash - 0.08),
        attacking: p.attacking && Date.now() - p.attackStart < 520,
        attackSide: Date.now() - p.attackStart < 520 ? p.attackSide : null,
      }));
    }, 40);
    return () => clearInterval(timer);
  }, []);

  function playMove(side: PlayerSide, move: ArenaMove) {
    const ls = leftStateRef.current ?? left;
    const rs = rightStateRef.current ?? right;
    if (ls.hp <= 0 || rs.hp <= 0) return;

    const dmg = damageFor(move);
    const bal = balanceDamageFor(move);
    const knock = 0.18 + move.speed / 500;
    const attackerName = side === "left" ? left.name : right.name;
    const defenderName = side === "left" ? right.name : left.name;

    if (side === "left") {
      setLeft((p) => ({ ...p, attacking: true, attackSide: "left", attackStart: Date.now() }));
      setRight((p) => ({
        ...p,
        hp: clamp(p.hp - dmg),
        balance: clamp(p.balance - bal),
        x: Math.min(1.55, p.x + knock),
        hitFlash: 1,
      }));
    } else {
      setRight((p) => ({ ...p, attacking: true, attackSide: "right", attackStart: Date.now() }));
      setLeft((p) => ({
        ...p,
        hp: clamp(p.hp - dmg),
        balance: clamp(p.balance - bal),
        x: Math.max(-1.55, p.x - knock),
        hitFlash: 1,
      }));
    }

    const line = battleCall(attackerName, defenderName, move, dmg);
    setLog((prev) => [line, ...prev.slice(0, 4)]);
    void announcer.speak(line);
  }

  function reset() {
    koSpokenRef.current = false;
    setLeft((p) => ({ ...p, hp: 100, balance: 100, x: -1.15, hitFlash: 0 }));
    setRight((p) => ({ ...p, hp: 100, balance: 100, x: 1.15, hitFlash: 0 }));
    const line = resetCall();
    setLog([line]);
    void announcer.speak(line);
  }

  const winner = left.hp <= 0 ? right.name : right.hp <= 0 ? left.name : null;

  useEffect(() => {
    if (!winner || koSpokenRef.current) return;
    koSpokenRef.current = true;
    const loser = winner === left.name ? right.name : left.name;
    const line = koCall(winner, loser);
    setLog((prev) => [line, ...prev.slice(0, 4)]);
    void announcer.speak(line);
  }, [winner, left.name, right.name]);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[#2a2a3d] bg-[#101018] overflow-hidden shadow-2xl shadow-[#7c5cff]/10">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#2a2a3d] p-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[#3dd68c]">
              Ghost Fighter Arena
            </p>
            <h1 className="text-2xl font-bold">3D robot-sports duel</h1>
            <p className="text-sm text-[#8888a0]">
              Two G1-inspired fighters face off using scored robot move cards.
              {announcerReady === false && (
                <span className="mt-1 block text-[#f5a623]">
                  Deepgram voice off — add DEEPGRAM_API_KEY to web/.env.local
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setAnnouncerOn((on) => !on)}
              className={`rounded-lg border px-4 py-2 text-sm transition ${
                announcerOn
                  ? "border-[#3dd68c]/50 bg-[#3dd68c]/10 text-[#3dd68c]"
                  : "border-[#2a2a3d] text-[#8888a0] hover:border-[#7c5cff]"
              }`}
            >
              {announcerOn ? "🔊 Announcer on" : "🔇 Announcer off"}
            </button>
            <button
              onClick={reset}
              className="rounded-lg border border-[#2a2a3d] px-4 py-2 text-sm hover:border-[#7c5cff]"
            >
              Reset round
            </button>
          </div>
        </div>

        <div className="grid gap-3 p-4 md:grid-cols-[1fr_240px_1fr]">
          <HealthPanel name={left.name} hp={left.hp} balance={left.balance} accent="#3dd68c" />
          <div className="grid place-items-center text-center">
            <div className="rounded-full border border-[#2a2a3d] bg-black/30 px-5 py-2 text-sm font-bold">
              {winner ? `${winner} WINS` : "VS"}
            </div>
          </div>
          <HealthPanel name={right.name} hp={right.hp} balance={right.balance} accent="#ff5c5c" />
        </div>

        <div className="relative">
          <div ref={hostRef} className="h-[560px]" />
          <CameraDebugPanel
            label="Arena camera"
            frame={cameraFrame}
            defaultFrame={cameraDefault}
            onReset={resetToDefault}
          />
          <div className="absolute left-4 top-4 rounded-lg border border-[#2a2a3d] bg-black/60 px-3 py-2 text-xs text-[#e8e8f0] backdrop-blur">
            Drag to rotate · scroll/pinch to zoom · right-drag to pan
          </div>
          <Image
            src="/models/unitree_g1/g1.png"
            alt="Unitree G1 reference"
            width={112}
            height={112}
            className="absolute bottom-4 right-4 hidden w-28 rounded-lg border border-[#2a2a3d] bg-black/60 p-1 opacity-80 md:block"
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <MoveControls
          title="Player 1 moves"
          side="left"
          moves={usableMoves}
          onPlay={playMove}
          disabled={!!winner}
        />
        <MoveControls
          title="Player 2 moves"
          side="right"
          moves={usableMoves}
          onPlay={playMove}
          disabled={!!winner}
        />
      </div>

      <div className="rounded-2xl border border-[#2a2a3d] bg-[#14141f] p-4">
        <p className="mb-3 text-xs uppercase tracking-[0.18em] text-[#8888a0]">
          Broadcast
        </p>
        <div className="space-y-2">
          {log.map((entry, i) => (
            <div key={i} className="rounded-lg bg-black/25 px-3 py-2 text-sm">
              {entry}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HealthPanel({
  name,
  hp,
  balance,
  accent,
}: {
  name: string;
  hp: number;
  balance: number;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-[#2a2a3d] bg-black/25 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold">{name}</span>
        <span className="font-mono text-sm">{Math.round(hp)} HP</span>
      </div>
      <Bar value={hp} color={accent} />
      <div className="mt-2 flex items-center justify-between text-xs text-[#8888a0]">
        <span>Balance</span>
        <span>{Math.round(balance)}</span>
      </div>
      <Bar value={balance} color="#f5a623" small />
    </div>
  );
}

function Bar({ value, color, small }: { value: number; color: string; small?: boolean }) {
  return (
    <div className={`overflow-hidden rounded bg-[#2a2a3d] ${small ? "h-1.5" : "h-3"}`}>
      <div
        className="h-full rounded transition-all duration-300"
        style={{ width: `${clamp(value)}%`, backgroundColor: color }}
      />
    </div>
  );
}

function MoveControls({
  title,
  side,
  moves,
  onPlay,
  disabled,
}: {
  title: string;
  side: PlayerSide;
  moves: ArenaMove[];
  onPlay: (side: PlayerSide, move: ArenaMove) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[#2a2a3d] bg-[#14141f] p-4">
      <p className="mb-3 text-sm font-semibold">{title}</p>
      <div className="grid gap-2">
        {moves.slice(0, 4).map((move) => (
          <button
            key={`${side}-${move.id}`}
            onClick={() => onPlay(side, move)}
            disabled={disabled}
            className="rounded-xl border border-[#2a2a3d] bg-black/25 p-3 text-left transition hover:border-[#7c5cff] hover:bg-[#7c5cff]/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[#2a2a3d] disabled:hover:bg-black/25"
          >
            <div className="font-medium">{move.name}</div>
            <div className="mt-1 text-xs text-[#8888a0]">
              speed {Math.round(move.speed)} · power {Math.round(move.power)} · risk{" "}
              {Math.round(move.balanceRisk)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
