"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import URDFLoader from "urdf-loader";
import type { MoveCard, MoveRecord } from "@/lib/types";
import { getPersona, listPersonas, makePersonaController } from "@/lib/enemy/personas";
import { makeRng } from "@/lib/enemy/rng";
import type { FighterController } from "@/lib/enemy/types";
import { announcer, battleCall, koCall, resetCall } from "@/lib/announcer";
import { applyCameraFrame } from "@/lib/cameraFrame";
import { useCameraDebug } from "@/lib/useCameraDebug";
import { CameraDebugPanel } from "@/components/CameraDebugPanel";
import {
  addArenaBackground,
  applyRopeContacts,
  RING_HALF_X,
  RING_HALF_Z,
} from "@/lib/arenaEnvironment";

type PlayerSide = "left" | "right";

// Each move animates a distinct body action so the fight reads as a varied
// kit instead of one repeated punch. The archetype is what drives the skeleton.
type MoveAnim = "jab" | "cross" | "hook" | "sweep" | "guard" | "uppercut";

type FighterState = {
  name: string;
  hp: number;
  balance: number;
  /** 0-100; spent to attack, regenerates while idle. */
  stamina: number;
  /** Floor position on the mat (x = left/right, z = depth toward/away camera). */
  x: number;
  z: number;
  /** Yaw in radians; the fighter turns to face its opponent. */
  facing: number;
  /** 1 while actively walking this tick, 0 otherwise (drives the walk cycle). */
  walk: number;
  attacking: boolean;
  attackSide: PlayerSide | null;
  attackStart: number;
  /** Which animation archetype the current attack is playing. */
  attackAnim: MoveAnim | null;
  hitFlash: number;
  /** Date.now() ms until which this fighter is recovering and cannot act. */
  recoverUntil: number;
  stance: "stable" | "recovering" | "knockdown";
};

type ArenaMove = {
  id: string;
  name: string;
  speed: number;
  power: number;
  balanceRisk: number;
  recovery: number;
  anim: MoveAnim;
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

// Pick a distinct animation archetype from a scored move's profile so two
// different cards rarely look the same: fast+light reads as a jab, heavy as a
// cross, high-risk low moves as a sweep, and so on.
function animForStats(speed: number, power: number, balanceRisk: number): MoveAnim {
  if (balanceRisk >= 60 && power >= 18) return "sweep";
  if (power >= 24) return "guard";
  if (power >= 18 && balanceRisk >= 40) return "uppercut";
  if (power >= 14) return "cross";
  if (speed >= 60) return "jab";
  return "hook";
}

function toArenaMove(record: MoveRecord): ArenaMove {
  const { speed, power, balance_risk: balanceRisk, recovery } = record.move_card.stats;
  return {
    id: record.move_card.id,
    name: prettifyName(record.move_card.name || record.move_card.id),
    speed,
    power,
    balanceRisk,
    recovery,
    anim: animForStats(speed, power, balanceRisk),
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

// Joints the pose system writes. Every frame resets these to a neutral guard
// first, so switching between archetypes never leaves a limb stuck mid-swing.
const POSE_JOINTS = [
  "left_shoulder_pitch_joint",
  "left_shoulder_roll_joint",
  "left_shoulder_yaw_joint",
  "left_elbow_joint",
  "right_shoulder_pitch_joint",
  "right_shoulder_roll_joint",
  "right_shoulder_yaw_joint",
  "right_elbow_joint",
  "waist_yaw_joint",
  "waist_pitch_joint",
  "waist_roll_joint",
  "left_hip_pitch_joint",
  "left_hip_roll_joint",
  "left_knee_joint",
  "right_hip_pitch_joint",
  "right_hip_roll_joint",
  "right_knee_joint",
] as const;

type JointMap = Partial<Record<(typeof POSE_JOINTS)[number], number>>;

// A relaxed fighting guard: hands up, slight knee bend. Idle robots and the
// start/end of every attack settle here.
const NEUTRAL_GUARD: JointMap = {
  left_shoulder_pitch_joint: -0.22,
  left_shoulder_roll_joint: 0.18,
  left_elbow_joint: 1.05,
  right_shoulder_pitch_joint: -0.22,
  right_shoulder_roll_joint: -0.18,
  right_elbow_joint: 1.05,
  waist_pitch_joint: 0.06,
  left_knee_joint: 0.08,
  right_knee_joint: 0.08,
};

// Per-archetype joint targets at the peak of the swing (envelope = 1). Each
// touches a different mix of joints so the moves read as visually distinct.
// `dir` is +1 for the left-side fighter and -1 for the right so rotations
// mirror correctly.
function poseTargets(anim: MoveAnim, dir: number): JointMap {
  switch (anim) {
    // Snappy lead-hand straight: left arm fires forward, body stays square.
    case "jab":
      return {
        left_shoulder_pitch_joint: -1.55,
        left_shoulder_roll_joint: 0.05,
        left_elbow_joint: 0.12,
        right_shoulder_pitch_joint: -0.25,
        right_elbow_joint: 1.2,
        waist_yaw_joint: 0.14 * dir,
      };
    // Heavy rear-hand cross: huge torso rotation drives the right arm through.
    case "cross":
      return {
        right_shoulder_pitch_joint: -1.5,
        right_shoulder_roll_joint: -0.3 * dir,
        right_elbow_joint: 0.15,
        left_shoulder_pitch_joint: 0.15,
        left_elbow_joint: 1.3,
        waist_yaw_joint: 0.55 * dir,
        waist_pitch_joint: 0.18,
      };
    // Wide horizontal hook: arm swings across with a roll-out and waist turn.
    case "hook":
      return {
        right_shoulder_pitch_joint: -0.9,
        right_shoulder_roll_joint: -1.15 * dir,
        right_shoulder_yaw_joint: 0.6 * dir,
        right_elbow_joint: 1.45,
        left_shoulder_pitch_joint: -0.1,
        left_elbow_joint: 1.1,
        waist_yaw_joint: 0.42 * dir,
        waist_roll_joint: 0.12 * dir,
      };
    // Rising uppercut: dip then drive up from the legs, right fist comes up.
    case "uppercut":
      return {
        right_shoulder_pitch_joint: 0.55,
        right_shoulder_roll_joint: -0.15 * dir,
        right_elbow_joint: 1.95,
        left_shoulder_pitch_joint: -0.3,
        left_elbow_joint: 1.2,
        waist_yaw_joint: 0.3 * dir,
        waist_pitch_joint: -0.28,
        left_knee_joint: 0.55,
        right_knee_joint: 0.55,
      };
    // Low spinning sweep: deep crouch, lead leg sweeps out, arms counterbalance.
    case "sweep":
      return {
        waist_pitch_joint: 0.5,
        waist_yaw_joint: 0.45 * dir,
        left_hip_pitch_joint: -0.2,
        left_knee_joint: 1.35,
        right_hip_pitch_joint: -0.5,
        right_hip_roll_joint: -0.7 * dir,
        right_knee_joint: 0.25,
        left_shoulder_pitch_joint: -0.6,
        left_shoulder_roll_joint: 0.9,
        right_shoulder_pitch_joint: -0.6,
        right_shoulder_roll_joint: -0.9,
      };
    // Two-handed overhead guard break: both arms rise high then smash down.
    case "guard":
      return {
        left_shoulder_pitch_joint: -2.6,
        left_shoulder_roll_joint: 0.25,
        left_elbow_joint: 0.45,
        right_shoulder_pitch_joint: -2.6,
        right_shoulder_roll_joint: -0.25,
        right_elbow_joint: 0.45,
        waist_pitch_joint: 0.22,
        left_knee_joint: 0.4,
        right_knee_joint: 0.4,
      };
  }
}

// Vertical crouch offset (metres) applied to the whole robot at peak swing, so
// low moves visibly drop the body rather than only bending joints.
function crouchDepth(anim: MoveAnim): number {
  if (anim === "sweep") return 0.32;
  if (anim === "uppercut") return 0.14;
  if (anim === "guard") return 0.1;
  return 0;
}

// Additive walk-cycle joint offsets at a given phase: hips and the opposite
// arms swing out of phase, knees bend on the trailing leg — enough to read as a
// natural stride. Scaled by intensity at the call site.
function strideOffsets(phase: number): JointMap {
  const s = Math.sin(phase);
  return {
    left_hip_pitch_joint: 0.55 * s,
    right_hip_pitch_joint: -0.55 * s,
    left_knee_joint: 0.4 * Math.max(0, -s),
    right_knee_joint: 0.4 * Math.max(0, s),
    left_shoulder_pitch_joint: -0.4 * s,
    right_shoulder_pitch_joint: 0.4 * s,
    waist_roll_joint: 0.05 * s,
  };
}

function setRobotPose(
  robot: THREE.Group,
  attackProgress: number,
  hitFlash: number,
  anim: MoveAnim | null,
  walkPhase: number,
  walkIntensity: number,
) {
  const punch = anim ? Math.sin(Math.min(1, attackProgress) * Math.PI) : 0;
  // Walking is suppressed while a strike is at full extension so the swing
  // reads cleanly, then blends back in as the fighter returns to neutral.
  const stride = walkIntensity * (1 - punch);

  const flashBob = hitFlash > 0 ? Math.sin(hitFlash * Math.PI * 6) * 0.015 : 0;
  const crouch = anim ? crouchDepth(anim) * punch : 0;
  const bob = stride > 0.001 ? Math.abs(Math.sin(walkPhase)) * 0.03 * stride : 0;
  robot.position.y = flashBob - crouch + bob;
  robot.scale.setScalar(1 + punch * 0.04);

  const urdf = robot.userData.urdf as URDFRobotLike | undefined;
  if (urdf?.setJointValue) {
    // Both fighters now rotate to face their opponent, so the pose is authored
    // once in the local frame (forward = local +x) with no left/right mirror.
    const targets = anim ? poseTargets(anim, 1) : null;
    const walk = stride > 0.001 ? strideOffsets(walkPhase) : null;
    // Blend neutral guard -> archetype peak by the swing envelope, then add the
    // scaled walk stride on top. Joints not named by an archetype fall back to
    // neutral, keeping the rest of the body stable instead of snapping to zero.
    for (const joint of POSE_JOINTS) {
      const base = NEUTRAL_GUARD[joint] ?? 0;
      const peak = targets?.[joint] ?? base;
      const walkAdd = walk ? (walk[joint] ?? 0) * stride : 0;
      urdf.setJointValue(joint, base + (peak - base) * punch + walkAdd);
    }
  }

  // Placeholder primitive limbs (only visible if the URDF fails to load) keep a
  // generic punch so the fallback robot still reacts.
  const rightUpper = robot.getObjectByName("rightUpperArm");
  const rightFore = robot.getObjectByName("rightForearm");
  const leftUpper = robot.getObjectByName("leftUpperArm");
  const leftFore = robot.getObjectByName("leftForearm");
  const torso = robot.getObjectByName("torso");
  if (rightUpper) {
    rightUpper.position.z = punch * 0.52;
    rightUpper.position.x = 0.36 + punch * 0.16;
    rightUpper.rotation.x = punch * 1.7;
  }
  if (rightFore) {
    rightFore.position.z = punch * 0.95;
    rightFore.position.x = 0.47 + punch * 0.28;
    rightFore.rotation.x = punch * 2.1;
  }
  if (leftUpper) leftUpper.rotation.x = -0.35 - punch * 0.4;
  if (leftFore) leftFore.rotation.x = -0.45 - punch * 0.3;
  if (torso) torso.rotation.z = -punch * 0.12;
}

// Damage scales hard with power, so a heavy move is a real payoff — picking the
// right moment to land one matters more than throwing the cheapest thing.
function damageFor(move: ArenaMove) {
  return Math.round(3 + move.power * 0.5 + move.speed * 0.05);
}

// Heavy/high-risk moves break balance much more — they're how you set up a
// stagger and open a punish, the reward that justifies their cost.
function balanceDamageFor(move: ArenaMove) {
  return Math.round(5 + move.balanceRisk * 0.25 + move.power * 0.12);
}

// Stamina is a tight budget: ~3 moves empties the bar and forces a rest. Power
// costs the most, so you can't lean on your big move — spend it deliberately.
function staminaCostFor(move: ArenaMove) {
  return Math.round(18 + move.power * 0.5 + move.speed * 0.1);
}

// How long the attacker is locked in recovery (ms) — the window an opponent
// punishes into. Heavy, low-recovery moves leave you exposed much longer, so
// whiffing one at the wrong time loses the exchange.
function recoveryMsFor(move: ArenaMove) {
  return Math.round(320 + (100 - move.recovery) * 4.5 + move.power * 3);
}

// Below this you're too winded to act and must rest (visible breather windows).
const MIN_STAMINA_TO_ACT = 30;

// Footwork tuning. Movement is now full 2D on the mat: circle in to land, drift
// out (or to the flank) to make the opponent whiff. Units are arena metres.
const MOVE_SPEED = 2.3; // walking speed in metres/sec
// Fighters are penned inside the rope ring (a small inset keeps their centre in
// so the body can lean on the ropes but never slip through them).
const BOUND_X = RING_HALF_X - 0.18;
const BOUND_Z = RING_HALF_Z - 0.18;
const MIN_GAP = 0.9; // closest the two bodies can get (no overlap)
// A committed strike lunges forward, so its effective reach is a bit longer
// than the standing pose. This keeps the pocket generous enough to fight in.
const LUNGE_REACH = 0.5;
// How fast a fighter can rotate to face the opponent (fraction/40ms tick). A
// finite turn rate is what lets circling/flanking pull you out of their cone.
const TURN_RATE = 0.22;
// A strike only connects inside this frontal cone, so which way you are facing
// when you commit decides whether the swing lands. cos(~55°).
const HIT_CONE_COS = 0.57;
// Walk-cycle stride frequency (radians/sec at full speed).
const STRIDE_FREQ = 9;

// How far a move can connect, mirroring the enemy brain's movePhysics().range
// so the AI and the player share one notion of "in range".
function reachFor(move: ArenaMove) {
  return 0.6 + move.speed * 0.012 + move.power * 0.004 + LUNGE_REACH;
}

// Keep a position inside the rectangular rope ring.
function clampToBox(x: number, z: number, hx: number, hz: number): [number, number] {
  return [Math.max(-hx, Math.min(hx, x)), Math.max(-hz, Math.min(hz, z))];
}

// Shortest-path interpolation between two angles (radians).
function angleLerp(from: number, to: number, t: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * t;
}

// Yaw (Three.js Y-rotation) that points a fighter at (dx, dz). Forward at yaw 0
// is +x, matching the original left-fighter orientation.
function faceYaw(dx: number, dz: number): number {
  return Math.atan2(-dz, dx);
}

export function Arena3D() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const leftRobot = useRef<THREE.Group | null>(null);
  const rightRobot = useRef<THREE.Group | null>(null);
  const leftImpactRef = useRef<THREE.Mesh | null>(null);
  const rightImpactRef = useRef<THREE.Mesh | null>(null);
  const leftStateRef = useRef<FighterState | null>(null);
  const rightStateRef = useRef<FighterState | null>(null);
  const deckCardsRef = useRef<MoveCard[]>([]);
  const playMoveRef = useRef<((side: PlayerSide, move: ArenaMove) => void) | null>(null);
  // Currently-held movement keys (lowercased). Read by the movement tick.
  const keysRef = useRef<Set<string>>(new Set());
  // The AI's current walk intent for Player 2: 1 = advance toward the player,
  // 0 = hold position. The movement tick turns "advance" into a 2D step.
  const aiIntentRef = useRef<number>(0);
  const [moves, setMoves] = useState<ArenaMove[]>([]);
  const [deckCards, setDeckCards] = useState<MoveCard[]>([]);
  const [personaId, setPersonaId] = useState<string>("");
  const [left, setLeft] = useState<FighterState>({
    name: "Player 1",
    hp: 100,
    balance: 100,
    stamina: 100,
    x: -1.15,
    z: 0,
    facing: 0,
    walk: 0,
    attacking: false,
    attackSide: null,
    attackStart: 0,
    attackAnim: null,
    hitFlash: 0,
    recoverUntil: 0,
    stance: "stable",
  });
  const [right, setRight] = useState<FighterState>({
    name: "Player 2",
    hp: 100,
    balance: 100,
    stamina: 100,
    x: 1.15,
    z: 0,
    facing: Math.PI,
    walk: 0,
    attacking: false,
    attackSide: null,
    attackStart: 0,
    attackAnim: null,
    hitFlash: 0,
    recoverUntil: 0,
    stance: "stable",
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

  // Footwork input: WASD walks Player 1, the arrow keys walk Player 2, both
  // across the full mat. We only track which keys are held here; the movement
  // tick turns that into motion.
  useEffect(() => {
    const tracked = new Set([
      "w",
      "a",
      "s",
      "d",
      "arrowup",
      "arrowdown",
      "arrowleft",
      "arrowright",
    ]);
    const onDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (!tracked.has(key)) return;
      // Stop the arrow keys from scrolling the page while fighting.
      if (key.startsWith("arrow")) e.preventDefault();
      keysRef.current.add(key);
    };
    const onUp = (e: KeyboardEvent) => keysRef.current.delete(e.key.toLowerCase());
    const clear = () => keysRef.current.clear();
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", clear);
    };
  }, []);

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
        const usable = records.filter((r) => r.move_card.verdict !== "pending");
        setMoves(usable.map(toArenaMove));
        setDeckCards(usable.map((r) => r.move_card));
      });
  }, []);

  const arenaBasics = useMemo<ArenaMove[]>(
    () => [
      { id: "basic_jab", name: "Quick Jab", speed: 72, power: 11, balanceRisk: 28, recovery: 64, anim: "jab" },
      { id: "basic_cross", name: "Counter Cross", speed: 54, power: 22, balanceRisk: 48, recovery: 50, anim: "cross" },
      { id: "basic_sweep", name: "Low Sweep", speed: 46, power: 17, balanceRisk: 62, recovery: 44, anim: "sweep" },
      { id: "basic_guard", name: "Guard Break", speed: 38, power: 26, balanceRisk: 70, recovery: 36, anim: "guard" },
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

  // Full MoveCards for the enemy brain, aligned to the displayed roster (it
  // reads the SAME scored stats the scorer computes). Real scored cards are
  // reused; arena-basic fillers are synthesized from their ArenaMove.
  const usableDeck = useMemo<MoveCard[]>(() => {
    const byId = new Map(deckCards.map((c) => [c.id, c]));
    return usableMoves.map(
      (m): MoveCard =>
        byId.get(m.id) ?? {
          id: m.id,
          name: m.name,
          source: "sonic_zip",
          attack_type: "strike_combo",
          studio_sonic_validated: false,
          stats: {
            speed: m.speed,
            power: m.power,
            smoothness: 80,
            balance_risk: m.balanceRisk,
            recovery: m.recovery,
            deployability: 60,
          },
          verdict: "needs_edits",
          coach_feedback: "",
          created_at: "1970-01-01T00:00:00.000Z",
          pipeline: { data: "fallback", eval: "fallback", deploy: "fallback" },
        },
    );
  }, [deckCards, usableMoves]);

  useEffect(() => {
    deckCardsRef.current = usableDeck;
  }, [usableDeck]);

  // AI opponent: when a persona is selected it drives Player 2 through the same
  // controller contract as the headless arena. The per-frame decide() runs on
  // the existing decay-tick cadence; NO LLM in this loop.
  useEffect(() => {
    if (!personaId) return;
    const persona = getPersona(personaId);
    if (!persona) return;
    setRight((p) => ({ ...p, name: persona.name }));
    const controller: FighterController = makePersonaController(persona);
    const rng = makeRng(0xa1 + personaId.length);
    let tick = 0;
    const timer = setInterval(() => {
      const now = Date.now();
      const ls = leftStateRef.current;
      const rs = rightStateRef.current;
      const deck = deckCardsRef.current;
      if (!ls || !rs || !deck.length) return;
      if (ls.hp <= 0 || rs.hp <= 0) return; // match decided
      // Locked in recovery — can neither strike nor reposition. (Footwork is
      // free of stamina, so being winded no longer blocks walking into range.)
      if (now < rs.recoverUntil) {
        aiIntentRef.current = 0;
        return;
      }
      tick += 1;
      // The opponent's stance/cooldown is real now, so the tactician sees a live
      // world: it whiff-punishes when the player is recovering and backs off when
      // its own balance/stamina is low — different decisions on different beats.
      const action = controller.decide(
        {
          tick,
          // The UI throttles decide() to off-cooldown beats, so each call is one
          // executor frame — 15 Hz makes the tactician re-score every beat.
          rateHz: 15,
          self: {
            hp: rs.hp,
            x: rs.x,
            balance: rs.balance,
            stamina: rs.stamina,
            cooldown: now < rs.recoverUntil ? 1 : 0,
            stance: rs.stance,
          },
          opponent: {
            hp: ls.hp,
            x: ls.x,
            balance: ls.balance,
            stamina: ls.stamina,
            cooldown: now < ls.recoverUntil ? 1 : 0,
            stance: ls.attacking ? "extended" : ls.stance,
          },
          deck,
          // Real spacing now: the 2D gap between the fighters drives the brain,
          // so the executor walks the enemy into reach ("advance") and only
          // throws ("move") once a strike can actually land.
          range: Math.hypot(ls.x - rs.x, ls.z - rs.z),
        },
        rng,
      );
      if (action.kind === "move") {
        const am = usableMoves.find((m) => m.id === action.moveId) ?? usableMoves[0];
        // In range: stop walking and commit, if it can afford the move; else
        // rest this beat to regenerate (the breather is part of the rhythm).
        aiIntentRef.current = 0;
        if (am && rs.stamina >= staminaCostFor(am)) playMoveRef.current?.("right", am);
      } else if (action.kind === "advance") {
        // Out of range: close in on the player until a strike can connect (the
        // movement tick steps straight toward them across the mat).
        aiIntentRef.current = 1;
      } else {
        aiIntentRef.current = 0; // wait / space
      }
    }, 260);
    return () => {
      clearInterval(timer);
      aiIntentRef.current = 0;
    };
  }, [personaId, usableMoves]);

  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;
    const scene = new THREE.Scene();
    const env = addArenaBackground(scene);

    const camera = new THREE.PerspectiveCamera(45, host.clientWidth / 560, 0.1, 100);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, 560);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    scene.add(key);
    const magenta = new THREE.DirectionalLight("#7c5cff", 2);
    magenta.position.set(-3, 2, 1);
    scene.add(magenta);
    const green = new THREE.DirectionalLight("#3dd68c", 1.8);
    green.position.set(3, 2, 1);
    scene.add(green);

    const leftBot = makeRobot("#3dd68c");
    const rightBot = makeRobot("#ff5c5c");
    leftBot.position.set(left.x, 0, left.z);
    leftBot.rotation.y = left.facing;
    rightBot.position.set(right.x, 0, right.z);
    rightBot.rotation.y = right.facing;
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
    let lastT = 0;
    const clock = new THREE.Clock();

    // Drives one fighter's transform + pose each frame, returning its attack
    // progress and forward vector so the caller can place the impact spark.
    const driveBot = (
      bot: THREE.Group,
      state: FighterState,
      attackMatches: boolean,
      dt: number,
    ) => {
      const progress = attackMatches
        ? Math.min(1, (Date.now() - state.attackStart) / 520)
        : 0;

      // Turn smoothly toward the authoritative facing (locked mid-swing).
      bot.rotation.y = angleLerp(bot.rotation.y, state.facing, 0.35);
      const fwdX = Math.cos(bot.rotation.y);
      const fwdZ = -Math.sin(bot.rotation.y);

      // Lunge forward along the current facing during a strike.
      const lunge = progress * (1 - progress) * 1.5;
      const targetX = state.x + fwdX * lunge;
      const targetZ = state.z + fwdZ * lunge;
      bot.position.x = THREE.MathUtils.lerp(bot.position.x, targetX, 0.3);
      bot.position.z = THREE.MathUtils.lerp(bot.position.z, targetZ, 0.3);

      // Walk cycle: advance phase only while actually moving so strides flow
      // with held keys. Intensity eases in/out for a smooth start and stop.
      const ud = bot.userData;
      const walkInt = THREE.MathUtils.lerp((ud.walkInt as number) ?? 0, state.walk, 0.18);
      ud.walkInt = walkInt;
      const phase = ((ud.walkPhase as number) ?? 0) + dt * STRIDE_FREQ * walkInt;
      ud.walkPhase = phase;

      setRobotPose(bot, progress, state.hitFlash, state.attackAnim, phase, walkInt);
      return { progress, fwdX, fwdZ };
    };

    const placeImpact = (
      impact: THREE.Mesh | null,
      bot: THREE.Group,
      fwdX: number,
      fwdZ: number,
      progress: number,
    ) => {
      if (!impact) return;
      impact.visible = progress > 0.2 && progress < 0.82;
      impact.position.set(bot.position.x + fwdX * 0.78, 1.35, bot.position.z + fwdZ * 0.78);
      impact.scale.setScalar(0.6 + progress * 2.2);
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = clock.getElapsedTime();
      const dt = Math.min(0.05, t - lastT);
      lastT = t;
      const leftState = leftStateRef.current ?? left;
      const rightState = rightStateRef.current ?? right;

      const l = driveBot(leftBot, leftState, leftState.attackSide === "left", dt);
      const r = driveBot(rightBot, rightState, rightState.attackSide === "right", dt);
      placeImpact(leftImpact, leftBot, l.fwdX, l.fwdZ, l.progress);
      placeImpact(rightImpact, rightBot, r.fwdX, r.fwdZ, r.progress);

      // Bow the ropes wherever a fighter is leaning on the ring.
      applyRopeContacts(env.ropes, [leftBot.position, rightBot.position]);

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
    const decay = (p: FighterState): FighterState => {
      const now = Date.now();
      const recovering = now < p.recoverUntil;
      return {
        ...p,
        hitFlash: Math.max(0, p.hitFlash - 0.08),
        attacking: p.attacking && now - p.attackStart < 520,
        attackSide: now - p.attackStart < 520 ? p.attackSide : null,
        attackAnim: now - p.attackStart < 520 ? p.attackAnim : null,
        // Slow stamina regen so the ~3-move budget actually bites and forces
        // rest windows; balance returns faster once out of stagger.
        stamina: clamp(p.stamina + (recovering ? 0.4 : 1.0)),
        balance: clamp(p.balance + (recovering ? 0.4 : 1.1)),
        stance: recovering ? p.stance : "stable",
      };
    };
    const timer = setInterval(() => {
      const now = Date.now();
      const ls = leftStateRef.current;
      const rs = rightStateRef.current;
      if (!ls || !rs) {
        setLeft(decay);
        setRight(decay);
        return;
      }

      const step = MOVE_SPEED * 0.04; // metres per 40ms tick
      const keys = keysRef.current;
      const live = ls.hp > 0 && rs.hp > 0;

      // Fighters turn to face each other; facing is locked mid-swing so the
      // direction you committed to is the direction the strike actually goes.
      const leftFacing = ls.attacking
        ? ls.facing
        : angleLerp(ls.facing, faceYaw(rs.x - ls.x, rs.z - ls.z), TURN_RATE);
      const rightFacing = rs.attacking
        ? rs.facing
        : angleLerp(rs.facing, faceYaw(ls.x - rs.x, ls.z - rs.z), TURN_RATE);

      // Movement is relative to each fighter's orientation: forward/back run
      // along facing (toward/away from the opponent) and strafe circles around
      // them. Footwork is only allowed in neutral (alive, not recovering). We
      // normalize so diagonals aren't faster.
      const walkVector = (
        facing: number,
        fwd: number,
        strafe: number,
      ): [number, number] => {
        const fx = Math.cos(facing);
        const fz = -Math.sin(facing);
        // Right-hand vector (perpendicular to forward in the XZ plane).
        const rx = -fz;
        const rz = fx;
        const vx = fwd * fx + strafe * rx;
        const vz = fwd * fz + strafe * rz;
        const m = Math.hypot(vx, vz);
        return m > 0 ? [vx / m, vz / m] : [0, 0];
      };

      const leftFree = live && now >= ls.recoverUntil;
      let lFwd = 0;
      let lStr = 0;
      if (leftFree) {
        if (keys.has("w")) lFwd += 1;
        if (keys.has("s")) lFwd -= 1;
        if (keys.has("d")) lStr += 1;
        if (keys.has("a")) lStr -= 1;
      }
      const [lvx, lvz] = walkVector(leftFacing, lFwd, lStr);

      const rightFree = live && now >= rs.recoverUntil;
      let rFwd = 0;
      let rStr = 0;
      if (rightFree) {
        if (personaId) {
          // The AI faces the player, so "advance" is simply walking forward.
          if (aiIntentRef.current === 1) rFwd += 1;
        } else {
          if (keys.has("arrowup")) rFwd += 1;
          if (keys.has("arrowdown")) rFwd -= 1;
          if (keys.has("arrowright")) rStr += 1;
          if (keys.has("arrowleft")) rStr -= 1;
        }
      }
      const [rvx, rvz] = walkVector(rightFacing, rFwd, rStr);

      // Apply movement as a delta onto each fighter's authoritative state so we
      // never clobber knockback the strike resolver just wrote. We then clamp to
      // the mat disk and push out of the opponent (read live from its ref) so the
      // two bodies never overlap.
      const resolve = (
        p: FighterState,
        vx: number,
        vz: number,
        facing: number,
        other: FighterState | null,
        fallback: FighterState,
      ): FighterState => {
        let [nx, nz] = clampToBox(p.x + vx * step, p.z + vz * step, BOUND_X, BOUND_Z);
        const ox = other?.x ?? fallback.x;
        const oz = other?.z ?? fallback.z;
        let dx = nx - ox;
        let dz = nz - oz;
        let d = Math.hypot(dx, dz);
        if (d < MIN_GAP) {
          if (d < 1e-4) {
            // Exactly overlapping (shouldn't normally happen): nudge sideways.
            dx = nx >= ox ? 1 : -1;
            dz = 0;
            d = 1;
          }
          nx = ox + (dx / d) * MIN_GAP;
          nz = oz + (dz / d) * MIN_GAP;
          [nx, nz] = clampToBox(nx, nz, BOUND_X, BOUND_Z);
        }
        return { ...decay(p), x: nx, z: nz, facing, walk: vx || vz ? 1 : 0 };
      };

      setLeft((p) => resolve(p, lvx, lvz, leftFacing, rightStateRef.current, rs));
      setRight((p) => resolve(p, rvx, rvz, rightFacing, leftStateRef.current, ls));
    }, 40);
    return () => clearInterval(timer);
  }, [personaId]);

  function playMove(side: PlayerSide, move: ArenaMove) {
    const now = Date.now();
    const ls = leftStateRef.current ?? left;
    const rs = rightStateRef.current ?? right;
    if (ls.hp <= 0 || rs.hp <= 0) return;

    const attacker = side === "left" ? ls : rs;
    const defenderState = side === "left" ? rs : ls;
    const cost = staminaCostFor(move);
    // Can't act while recovering or too winded — this is what stops the spam.
    if (now < attacker.recoverUntil || attacker.stamina < cost) return;

    const recoverMs = recoveryMsFor(move);
    const attackerName = side === "left" ? left.name : right.name;
    const defenderName = side === "left" ? right.name : left.name;

    const applyAttacker = (p: FighterState): FighterState => ({
      ...p,
      attacking: true,
      attackSide: side,
      attackStart: now,
      attackAnim: move.anim,
      stamina: clamp(p.stamina - cost),
      recoverUntil: now + recoverMs,
      stance: "recovering",
    });

    // Spacing + aim check on the 2D mat. The strike lands only if the opponent
    // is within reach AND inside the attacker's frontal cone — so both distance
    // and which way you are facing (the swing direction) decide the hit. A miss
    // still commits the attacker (stamina + recovery lockout): the price of
    // throwing into open air, and the window the opponent punishes.
    const dx = defenderState.x - attacker.x;
    const dz = defenderState.z - attacker.z;
    const gap = Math.hypot(dx, dz) || 1e-4;
    const fwdX = Math.cos(attacker.facing);
    const fwdZ = -Math.sin(attacker.facing);
    const aimDot = (fwdX * dx + fwdZ * dz) / gap; // cos(angle facing→opponent)
    const inReach = gap <= reachFor(move);
    const inFront = aimDot >= HIT_CONE_COS;
    if (!inReach || !inFront) {
      if (side === "left") setLeft(applyAttacker);
      else setRight(applyAttacker);
      const why = !inReach
        ? `${defenderName} is out of range`
        : `${defenderName} slipped to the flank`;
      const whiff = `${attackerName}'s ${move.name} whiffs — ${why}!`;
      setLog((prev) => [whiff, ...prev.slice(0, 4)]);
      return;
    }

    // Counter hit: striking an opponent who is mid-move or recovering lands
    // harder. This is what makes timing (and the enemy's whiff-punish) matter.
    const defenderBusy = now < defenderState.recoverUntil || defenderState.attacking;
    const dmg = Math.round(damageFor(move) * (defenderBusy ? 1.6 : 1));
    const bal = Math.round(balanceDamageFor(move) * (defenderBusy ? 1.35 : 1));
    const knock = 0.18 + move.speed / 500;
    // Knockback pushes the defender directly away from the attacker.
    const knockX = (dx / gap) * knock;
    const knockZ = (dz / gap) * knock;

    const applyDefender = (p: FighterState): FighterState => {
      const newBalance = clamp(p.balance - bal);
      const hardStagger = newBalance < 12;
      const staggered = newBalance < 35;
      // Getting hit interrupts you: a stagger locks recovery (and breaks any
      // attack you were winding up), so trades have real consequences.
      const stunMs = hardStagger ? 950 : staggered ? 620 : 150;
      const [kx, kz] = clampToBox(p.x + knockX, p.z + knockZ, BOUND_X, BOUND_Z);
      return {
        ...p,
        hp: clamp(p.hp - dmg),
        balance: newBalance,
        x: kx,
        z: kz,
        hitFlash: 1,
        recoverUntil: Math.max(p.recoverUntil, now + stunMs),
        stance: staggered ? "knockdown" : "recovering",
      };
    };

    if (side === "left") {
      setLeft(applyAttacker);
      setRight(applyDefender);
    } else {
      setRight(applyAttacker);
      setLeft(applyDefender);
    }

    const counterTag = defenderBusy ? " (counter!)" : "";
    const line = battleCall(attackerName, defenderName, move, dmg) + counterTag;
    setLog((prev) => [line, ...prev.slice(0, 4)]);
    void announcer.speak(battleCall(attackerName, defenderName, move, dmg));
  }
  playMoveRef.current = playMove;

  function reset() {
    koSpokenRef.current = false;
    aiIntentRef.current = 0;
    setLeft((p) => ({
      ...p,
      hp: 100,
      balance: 100,
      stamina: 100,
      x: -1.15,
      z: 0,
      facing: 0,
      walk: 0,
      hitFlash: 0,
      recoverUntil: 0,
      stance: "stable",
    }));
    setRight((p) => ({
      ...p,
      hp: 100,
      balance: 100,
      stamina: 100,
      x: 1.15,
      z: 0,
      facing: Math.PI,
      walk: 0,
      hitFlash: 0,
      recoverUntil: 0,
      stance: "stable",
    }));
    const line = resetCall();
    setLog([line]);
    void announcer.speak(line);
  }

  const winner = left.hp <= 0 ? right.name : right.hp <= 0 ? left.name : null;
  // Re-evaluated every render (the 40ms decay tick re-renders), so buttons grey
  // out while a fighter is staggered/recovering or too winded to act.
  const renderNow = Date.now();
  const leftBusy = renderNow < left.recoverUntil || left.stamina < MIN_STAMINA_TO_ACT;
  const rightBusy = renderNow < right.recoverUntil || right.stamina < MIN_STAMINA_TO_ACT;
  // Player 2 is auto-piloted while a persona is selected.
  const rightIsAI = personaId !== "";

  useEffect(() => {
    if (!winner || koSpokenRef.current) return;
    koSpokenRef.current = true;
    const loser = winner === left.name ? right.name : left.name;
    const line = koCall(winner, loser);
    setLog((prev) => [line, ...prev.slice(0, 4)]);
    void announcer.speak(line);

    // Log the bout into the Redis historical-performance layer. Player 2's id is
    // the persona when an AI is piloting, otherwise a generic manual id. Fire and
    // forget: a missing Redis just means no history is recorded.
    const rightId = personaId || "player_2";
    void fetch("/api/arena/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participants: [
          { id: "player_1", name: left.name },
          { id: rightId, name: right.name },
        ],
        winner_id: winner === left.name ? "player_1" : rightId,
        final_hp: { a: Math.round(left.hp), b: Math.round(right.hp) },
        source: "live_arena",
      }),
    }).catch(() => {});
  }, [winner, left.name, right.name, left.hp, right.hp, personaId]);

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
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex flex-col gap-1 text-xs text-[#8888a0]">
              <span className="uppercase tracking-[0.18em]">Player 2 AI</span>
              <select
                value={personaId}
                onChange={(e) => setPersonaId(e.target.value)}
                className="rounded-lg border border-[#2a2a3d] bg-[#14141f] px-3 py-2 text-sm text-[#e8e8f0] outline-none focus:border-[#7c5cff]"
              >
                <option value="">Manual (human)</option>
                {listPersonas().map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => setAnnouncerOn((on) => !on)}
              className={`self-end rounded-lg border px-4 py-2 text-sm transition ${
                announcerOn
                  ? "border-[#3dd68c]/50 bg-[#3dd68c]/10 text-[#3dd68c]"
                  : "border-[#2a2a3d] text-[#8888a0] hover:border-[#7c5cff]"
              }`}
            >
              {announcerOn ? "🔊 Announcer on" : "🔇 Announcer off"}
            </button>
            <button
              onClick={reset}
              className="self-end rounded-lg border border-[#2a2a3d] px-4 py-2 text-sm hover:border-[#7c5cff]"
            >
              Reset round
            </button>
          </div>
        </div>

        <div className="grid gap-3 p-4 md:grid-cols-[1fr_240px_1fr]">
          <HealthPanel
            name={left.name}
            hp={left.hp}
            balance={left.balance}
            stamina={left.stamina}
            stance={left.stance}
            accent="#3dd68c"
          />
          <div className="grid place-items-center text-center">
            <div className="rounded-full border border-[#2a2a3d] bg-black/30 px-5 py-2 text-sm font-bold">
              {winner ? `${winner} WINS` : "VS"}
            </div>
          </div>
          <HealthPanel
            name={right.name}
            hp={right.hp}
            balance={right.balance}
            stamina={right.stamina}
            stance={right.stance}
            accent="#ff5c5c"
          />
        </div>

        <div className="relative">
          <div ref={hostRef} className="h-[560px]" />
          <CameraDebugPanel
            label="Arena camera"
            frame={cameraFrame}
            defaultFrame={cameraDefault}
            onReset={resetToDefault}
          />
          <div className="absolute left-4 top-4 space-y-1 rounded-lg border border-[#2a2a3d] bg-black/60 px-3 py-2 text-xs text-[#e8e8f0] backdrop-blur">
            <div>Drag to rotate · scroll/pinch to zoom · right-drag to pan</div>
            <div className="text-[#8888a0]">
              Move: <span className="text-[#3dd68c]">P1 WASD</span>
              {rightIsAI ? (
                <> · <span className="text-[#ff5c5c]">P2 auto</span></>
              ) : (
                <> · <span className="text-[#ff5c5c]">P2 arrows</span></>
              )}{" "}
              · circle in to land, flank to dodge
            </div>
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
          disabled={!!winner || leftBusy}
        />
        <MoveControls
          title={rightIsAI ? `Player 2 moves (${right.name} AI)` : "Player 2 moves"}
          side="right"
          moves={usableMoves}
          onPlay={playMove}
          disabled={!!winner || rightBusy}
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
  stamina,
  stance,
  accent,
}: {
  name: string;
  hp: number;
  balance: number;
  stamina: number;
  stance: FighterState["stance"];
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
        {stance === "knockdown" ? (
          <span className="font-semibold text-[#ff5c5c]">STAGGERED</span>
        ) : (
          <span>{Math.round(balance)}</span>
        )}
      </div>
      <Bar value={balance} color="#f5a623" small />
      <div className="mt-2 flex items-center justify-between text-xs text-[#8888a0]">
        <span>Stamina</span>
        <span>{Math.round(stamina)}</span>
      </div>
      <Bar value={stamina} color="#5cc8ff" small />
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
