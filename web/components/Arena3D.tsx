"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import URDFLoader from "urdf-loader";
import type { MoveCard, MoveRecord } from "@/lib/types";
import { getPersona, listPersonas, makePersonaController } from "@/lib/enemy/personas";
import { makeRng } from "@/lib/enemy/rng";
import type { FighterController } from "@/lib/enemy/types";
import { announcer, koCall, resetCall } from "@/lib/announcer";
import {
  ARENA_BASICS,
  advanceFooting,
  angleLerp,
  applyMove,
  attackAnimMs,
  BOUND_X,
  BOUND_Z,
  clampToBox,
  createFighter,
  decayFighter,
  MIN_STAMINA_TO_ACT,
  MOVE_SPEED,
  staminaCostFor,
  animForStats,
  type ArenaMove,
  type FighterState,
  type FootInput,
  type MoveAnim,
  type PlayerSide,
} from "@/lib/arenaCombat";
import { applyG1JointFrame } from "@/lib/g1Motion";
import { applyCameraFrame, CAMERA_DEFAULTS } from "@/lib/cameraFrame";
import { buildArenaShareUrl, useArenaMultiplayer } from "@/lib/useArenaMultiplayer";
import { addArenaBackground, applyRopeContacts } from "@/lib/arenaEnvironment";

const ARENA_CAMERA_DEFAULT = CAMERA_DEFAULTS.arena;

function clamp(value: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, value));
}

function parsePlayerSide(raw: string | null): PlayerSide {
  return raw === "2" || raw === "right" ? "right" : "left";
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

function attackProgressFor(state: FighterState): number {
  if (!state.attackSide) return 0;
  const duration = attackAnimMs(state.attackMoveId);
  return Math.min(1, (Date.now() - state.attackStart) / duration);
}

function setRobotPose(
  robot: THREE.Group,
  attackProgress: number,
  hitFlash: number,
  anim: MoveAnim | null,
  walkPhase: number,
  walkIntensity: number,
  attackMoveId: string | null,
  blockFrames: number[][] | null,
) {
  const urdf = robot.userData.urdf as URDFRobotLike | undefined;
  if (attackMoveId === "block" && blockFrames?.length && urdf?.setJointValue) {
    const frameIdx = Math.min(
      blockFrames.length - 1,
      Math.floor(attackProgress * blockFrames.length),
    );
    applyG1JointFrame(urdf.setJointValue.bind(urdf), blockFrames[frameIdx]!);
    robot.position.y = hitFlash > 0 ? Math.sin(hitFlash * Math.PI * 6) * 0.015 : 0;
    robot.scale.setScalar(1);
    setPlaceholderVisible(robot, false);
    return;
  }

  const punch = anim ? Math.sin(Math.min(1, attackProgress) * Math.PI) : 0;
  // Walking is suppressed while a strike is at full extension so the swing
  // reads cleanly, then blends back in as the fighter returns to neutral.
  const stride = walkIntensity * (1 - punch);

  const flashBob = hitFlash > 0 ? Math.sin(hitFlash * Math.PI * 6) * 0.015 : 0;
  const crouch = anim ? crouchDepth(anim) * punch : 0;
  const bob = stride > 0.001 ? Math.abs(Math.sin(walkPhase)) * 0.03 * stride : 0;
  robot.position.y = flashBob - crouch + bob;
  robot.scale.setScalar(1 + punch * 0.04);

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

// Walk-cycle stride frequency (radians/sec at full speed). Footwork tuning and
// the 2D movement math now live in arenaCombat so the local tick and the
// authoritative server room loop stay in lockstep.
const STRIDE_FREQ = 9;

export function Arena3D() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roomId = searchParams.get("room");
  const playerSide = parsePlayerSide(searchParams.get("player"));
  const playerNumber = playerSide === "left" ? 1 : 2;
  const [personaId, setPersonaId] = useState<string>("");
  // Online 1v1 is opt-in: pick "online" from the dropdown, or arrive on a shared
  // room link. Everything else (default + AI personas) is local play with live
  // keyboard footwork, so WASD/arrow movement keeps working.
  const onlineMode = personaId === "online" || !!roomId;
  // A real AI persona is selected (not local human, not online).
  const aiPersonaId = onlineMode ? "" : personaId;
  const multiplayer = useArenaMultiplayer({ enabled: onlineMode, roomId, playerSide });

  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const resizeSceneRef = useRef<(() => void) | null>(null);
  const leftRobot = useRef<THREE.Group | null>(null);
  const rightRobot = useRef<THREE.Group | null>(null);
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
  const [left, setLeft] = useState<FighterState>(() => createFighter("Player 1", -1.15, 0));
  const [right, setRight] = useState<FighterState>(() => createFighter("Player 2", 1.15, Math.PI));
  const [log, setLog] = useState<string[]>([
    "Choose a move. Each robot can play robot-skill cards like Street Fighter specials.",
  ]);
  const [announcerOn, setAnnouncerOn] = useState(true);
  const [announcerReady, setAnnouncerReady] = useState<boolean | null>(null);
  const koSpokenRef = useRef(false);
  const blockTrajectoryRef = useRef<number[][] | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === viewportRef.current);
      resizeSceneRef.current?.();
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  function toggleFullscreen() {
    if (!viewportRef.current) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void viewportRef.current.requestFullscreen();
  }

  useEffect(() => {
    resizeSceneRef.current?.();
  }, [isFullscreen]);

  useEffect(() => {
    fetch("/api/moves/block/trajectory")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { frames?: number[][] } | null) => {
        if (data?.frames?.length) blockTrajectoryRef.current = data.frames;
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    leftStateRef.current = left;
    rightStateRef.current = right;
  }, [left, right]);

  useEffect(() => {
    announcer.setEnabled(announcerOn);
  }, [announcerOn]);

  // Redirect to include room code in URL once the multiplayer hook creates it.
  useEffect(() => {
    if (!multiplayer.roomCode || multiplayer.roomCode === roomId) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("room", multiplayer.roomCode);
    router.replace(`/arena?${params.toString()}`);
  }, [multiplayer.roomCode, roomId, router, searchParams]);

  // Sync fighter state from multiplayer room snapshots.
  useEffect(() => {
    if (!multiplayer.snapshot) return;
    setLeft(multiplayer.snapshot.left);
    setRight(multiplayer.snapshot.right);
    setLog(multiplayer.snapshot.log);
  }, [multiplayer.snapshot]);

  useEffect(() => {
    multiplayer.setOnLogLine((line) => void announcer.speak(line));
    return () => multiplayer.setOnLogLine(null);
  }, [multiplayer]);

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
      // Don't hijack keys while an input/select/textarea/contenteditable is
      // focused (e.g. changing the Player 2 AI dropdown with arrow keys).
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (
        tag === "INPUT" ||
        tag === "SELECT" ||
        tag === "TEXTAREA" ||
        el?.isContentEditable
      ) {
        return;
      }
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

  // Real scored moves only — no synthetic filler once motions are loaded.
  const usableMoves = useMemo<ArenaMove[]>(() => {
    if (moves.length > 0) return moves.slice(0, 4);
    return ARENA_BASICS.slice(0, 4);
  }, [moves]);

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
    if (!aiPersonaId) return;
    const persona = getPersona(aiPersonaId);
    if (!persona) return;
    setRight((p) => ({ ...p, name: persona.name }));
    const controller: FighterController = makePersonaController(persona);
    const rng = makeRng(0xa1 + aiPersonaId.length);
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
  }, [aiPersonaId, usableMoves]);

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
    applyCameraFrame(camera, controls, ARENA_CAMERA_DEFAULT);
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

    let raf = 0;
    let lastT = 0;
    const clock = new THREE.Clock();
    const blockFramesRef = blockTrajectoryRef;

    const driveBot = (
      bot: THREE.Group,
      state: FighterState,
      attackMatches: boolean,
      dt: number,
    ) => {
      const progress = attackMatches ? attackProgressFor(state) : 0;

      bot.rotation.y = angleLerp(bot.rotation.y, state.facing, 0.35);
      const fwdX = Math.cos(bot.rotation.y);
      const fwdZ = -Math.sin(bot.rotation.y);

      const lunge =
        state.attackMoveId === "block" ? 0 : progress * (1 - progress) * 1.5;
      const [targetX, targetZ] = clampToBox(
        state.x + fwdX * lunge,
        state.z + fwdZ * lunge,
        BOUND_X,
        BOUND_Z,
      );
      bot.position.x = THREE.MathUtils.lerp(bot.position.x, targetX, 0.3);
      bot.position.z = THREE.MathUtils.lerp(bot.position.z, targetZ, 0.3);

      const ud = bot.userData;
      const walkInt = THREE.MathUtils.lerp((ud.walkInt as number) ?? 0, state.walk, 0.18);
      ud.walkInt = walkInt;
      const phase = ((ud.walkPhase as number) ?? 0) + dt * STRIDE_FREQ * walkInt;
      ud.walkPhase = phase;

      setRobotPose(
        bot,
        progress,
        state.hitFlash,
        state.attackAnim,
        phase,
        walkInt,
        state.attackMoveId,
        blockFramesRef.current,
      );
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = clock.getElapsedTime();
      const dt = Math.min(0.05, t - lastT);
      lastT = t;
      const leftState = leftStateRef.current ?? left;
      const rightState = rightStateRef.current ?? right;

      driveBot(leftBot, leftState, leftState.attackSide === "left", dt);
      driveBot(rightBot, rightState, rightState.attackSide === "right", dt);

      applyRopeContacts(env.ropes, [leftBot.position, rightBot.position]);

      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    const resize = () => {
      if (!hostRef.current) return;
      const width = hostRef.current.clientWidth;
      const height = hostRef.current.clientHeight || 560;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    resizeSceneRef.current = resize;
    resize();
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      resizeSceneRef.current = null;
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
    // The scene is recreated only once; state updates are pushed through refs/React values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (multiplayer.isMultiplayer) return; // server simulates footwork in multiplayer
    const timer = setInterval(() => {
      const now = Date.now();
      const ls = leftStateRef.current;
      const rs = rightStateRef.current;
      if (!ls || !rs) {
        setLeft((p) => decayFighter(p, now));
        setRight((p) => decayFighter(p, now));
        return;
      }

      // P1 always walks with WASD. P2 is either the AI (advance = walk forward)
      // or the local arrow keys. advanceFooting gates these to neutral and
      // applies the facing/collision/decay shared with the server.
      const keys = keysRef.current;
      const leftInput: FootInput = { fwd: 0, strafe: 0 };
      if (keys.has("w")) leftInput.fwd += 1;
      if (keys.has("s")) leftInput.fwd -= 1;
      if (keys.has("d")) leftInput.strafe += 1;
      if (keys.has("a")) leftInput.strafe -= 1;

      const rightInput: FootInput = { fwd: 0, strafe: 0 };
      if (aiPersonaId) {
        if (aiIntentRef.current === 1) rightInput.fwd += 1;
      } else {
        if (keys.has("arrowup")) rightInput.fwd += 1;
        if (keys.has("arrowdown")) rightInput.fwd -= 1;
        if (keys.has("arrowright")) rightInput.strafe += 1;
        if (keys.has("arrowleft")) rightInput.strafe -= 1;
      }

      const next = advanceFooting(ls, rs, leftInput, rightInput, now, MOVE_SPEED * 0.04);
      setLeft(next.left);
      setRight(next.right);
    }, 40);
    return () => clearInterval(timer);
  }, [aiPersonaId, multiplayer.isMultiplayer]);

  // In online play, stream this client's footwork intent to the server (which
  // simulates it authoritatively). We read both WASD and arrows so each player
  // drives their own fighter however they like; the hook dedupes by direction.
  useEffect(() => {
    if (!multiplayer.isMultiplayer) return;
    const timer = setInterval(() => {
      const keys = keysRef.current;
      const input: FootInput = { fwd: 0, strafe: 0 };
      if (keys.has("w") || keys.has("arrowup")) input.fwd += 1;
      if (keys.has("s") || keys.has("arrowdown")) input.fwd -= 1;
      if (keys.has("d") || keys.has("arrowright")) input.strafe += 1;
      if (keys.has("a") || keys.has("arrowleft")) input.strafe -= 1;
      multiplayer.sendInput(input);
    }, 60);
    return () => clearInterval(timer);
    // sendInput is a stable useCallback; depending on the whole multiplayer
    // object would recreate this interval on every snapshot (~25Hz).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiplayer.isMultiplayer, multiplayer.sendInput]);

  function playMove(side: PlayerSide, move: ArenaMove) {
    if (multiplayer.isMultiplayer) {
      if (side !== playerSide) return;
      void multiplayer.playRemoteMove(move);
      return;
    }
    const now = Date.now();
    const ls = leftStateRef.current ?? left;
    const rs = rightStateRef.current ?? right;
    const result = applyMove(ls, rs, side, move, now);
    if (!result) return;
    setLeft(result.left);
    setRight(result.right);
    setLog((prev) => [result.logLine, ...prev.slice(0, 4)]);
    void announcer.speak(result.logLine.replace(/ \(counter!\)$/, ""));
  }
  playMoveRef.current = playMove;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }

      const slot = Number(e.key);
      if (!Number.isInteger(slot) || slot < 1 || slot > 4) return;

      const move = usableMoves[slot - 1];
      if (!move) return;

      const ls = leftStateRef.current;
      const rs = rightStateRef.current;
      if (!ls || !rs || ls.hp <= 0 || rs.hp <= 0) return;

      const now = Date.now();
      const self = playerSide === "left" ? ls : rs;
      if (now < self.recoverUntil || self.stamina < MIN_STAMINA_TO_ACT) return;

      e.preventDefault();
      playMoveRef.current?.(playerSide, move);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [usableMoves, playerSide]);

  function reset() {
    if (multiplayer.isMultiplayer) {
      if (playerSide !== "left") return;
      koSpokenRef.current = false;
      void multiplayer.resetRemote();
      return;
    }
    koSpokenRef.current = false;
    aiIntentRef.current = 0;
    setLeft(createFighter(left.name, -1.15, 0));
    setRight(createFighter(right.name, 1.15, Math.PI));
    const line = resetCall();
    setLog([line]);
    void announcer.speak(line);
  }

  const winner =
    multiplayer.snapshot?.winner ??
    (left.hp <= 0 ? right.name : right.hp <= 0 ? left.name : null);
  // Re-evaluated every render (the 40ms decay tick re-renders), so buttons grey
  // out while a fighter is staggered/recovering or too winded to act.
  const renderNow = Date.now();
  const leftBusy = renderNow < left.recoverUntil || left.stamina < MIN_STAMINA_TO_ACT;
  const rightBusy = renderNow < right.recoverUntil || right.stamina < MIN_STAMINA_TO_ACT;
  // Player 2 is auto-piloted while a real AI persona is selected.
  const rightIsAI = aiPersonaId !== "";
  const shareUrl =
    multiplayer.roomCode && typeof window !== "undefined"
      ? buildArenaShareUrl(multiplayer.roomCode)
      : null;

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
              Two G1-inspired fighters face off using scored robot move cards. You are Player{" "}
              {playerNumber}.
              {onlineMode && (
                <span className="mt-1 block">
                  {multiplayer.status === "connecting" && "Connecting to arena room…"}
                  {multiplayer.status === "waiting" && multiplayer.roomCode &&
                    "Waiting for Player 2 — share the link below."}
                  {multiplayer.status === "live" && "Live 1v1 — moves sync in real time."}
                  {multiplayer.status === "error" && (
                    <span className="text-[#ff5c5c]">{multiplayer.error}</span>
                  )}
                </span>
              )}
              {playerSide === "left" && onlineMode && shareUrl && (
                <span className="mt-1 block">
                  Player 2 link:{" "}
                  <code className="break-all rounded bg-black/30 px-1.5 py-0.5 text-[#3dd68c]">
                    {shareUrl}
                  </code>
                </span>
              )}
              {announcerReady === false && (
                <span className="mt-1 block text-[#f5a623]">
                  Deepgram voice off — add DEEPGRAM_API_KEY to web/.env.local
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {playerSide === "left" && (
              <label className="flex flex-col gap-1 text-xs text-[#8888a0]">
                <span className="uppercase tracking-[0.18em]">Player 2 AI</span>
                <select
                  value={personaId}
                  onChange={(e) => setPersonaId(e.target.value)}
                  disabled={multiplayer.status === "live"}
                  className="rounded-lg border border-[#2a2a3d] bg-[#14141f] px-3 py-2 text-sm text-[#e8e8f0] outline-none focus:border-[#7c5cff] disabled:opacity-50"
                >
                  <option value="">Local 2-player (P1 WASD / P2 arrows)</option>
                  <option value="online">Human opponent (online)</option>
                  {listPersonas().map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
            {(playerSide === "left" || !multiplayer.isMultiplayer) && (
              <button
                onClick={reset}
                className="self-end rounded-lg border border-[#2a2a3d] px-4 py-2 text-sm hover:border-[#7c5cff]"
              >
                Reset round
              </button>
            )}
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

        <div
          ref={viewportRef}
          className="relative bg-[#060707] [&:fullscreen]:h-full [&:fullscreen]:w-full"
        >
          <div ref={hostRef} className="h-[560px] [&:fullscreen]:h-full" />
          <button
            type="button"
            onClick={toggleFullscreen}
            className="absolute right-4 top-4 z-10 rounded-lg border border-[#2a2a3d] bg-black/60 px-3 py-1.5 text-xs text-[#e8e8f0] backdrop-blur transition hover:border-[#7c5cff]"
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          </button>
          <div className="absolute left-4 top-4 space-y-1 rounded-lg border border-[#2a2a3d] bg-black/60 px-3 py-2 text-xs text-[#e8e8f0] backdrop-blur">
            <div>Drag to rotate · scroll/pinch to zoom · right-drag to pan</div>
            <div className="text-[#8888a0]">
              Move: <span className="text-[#3dd68c]">P1 WASD</span>
              {rightIsAI ? (
                <> · <span className="text-[#ff5c5c]">P2 auto</span></>
              ) : (
                <> · <span className="text-[#ff5c5c]">P2 arrows</span></>
              )}{" "}
              · strikes <span className="text-[#a78bfa]">1–{Math.min(usableMoves.length, 4)}</span>
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

      <MoveControls
        title={
          playerSide === "right" && rightIsAI
            ? `Player ${playerNumber} moves (${right.name} AI)`
            : `Player ${playerNumber} moves`
        }
        side={playerSide}
        moves={usableMoves}
        onPlay={playMove}
        disabled={!!winner || (playerSide === "left" ? leftBusy : rightBusy)}
      />
      {!multiplayer.isMultiplayer && (
        <MoveControls
          title={rightIsAI ? `Player 2 moves (${right.name} AI)` : "Player 2 moves"}
          side={playerSide === "left" ? "right" : "left"}
          moves={usableMoves}
          onPlay={playMove}
          disabled={!!winner || (playerSide === "left" ? rightBusy : leftBusy)}
        />
      )}

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
      <p className="mb-3 text-sm font-semibold">
        {title}
        <span className="ml-2 font-normal text-[#8888a0]">· keys 1–{Math.min(moves.length, 4)}</span>
      </p>
      <div className="grid gap-2">
        {moves.slice(0, 4).map((move, index) => (
          <button
            key={`${side}-${move.id}`}
            onClick={() => onPlay(side, move)}
            disabled={disabled}
            className="flex items-start gap-3 rounded-xl border border-[#2a2a3d] bg-black/25 p-3 text-left transition hover:border-[#7c5cff] hover:bg-[#7c5cff]/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[#2a2a3d] disabled:hover:bg-black/25"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#7c5cff]/40 bg-[#7c5cff]/10 font-mono text-sm font-bold text-[#a78bfa]">
              {index + 1}
            </span>
            <span className="min-w-0">
              <div className="font-medium">{move.name}</div>
              <div className="mt-1 text-xs text-[#8888a0]">
                speed {Math.round(move.speed)} · power {Math.round(move.power)} · risk{" "}
                {Math.round(move.balanceRisk)}
              </div>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
