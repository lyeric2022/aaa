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
  applyMove,
  attackAnimMs,
  createFighter,
  decayFighter,
  MIN_STAMINA_TO_ACT,
  staminaCostFor,
  type ArenaMove,
  type FighterState,
  type PlayerSide,
} from "@/lib/arenaCombat";
import { applyG1JointFrame } from "@/lib/g1Motion";
import { applyCameraFrame } from "@/lib/cameraFrame";
import { useCameraDebug } from "@/lib/useCameraDebug";
import { buildArenaShareUrl, useArenaMultiplayer } from "@/lib/useArenaMultiplayer";
import { CameraDebugPanel } from "@/components/CameraDebugPanel";
import { addArenaBackground } from "@/lib/arenaEnvironment";

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

function attackProgressFor(state: FighterState): number {
  if (!state.attackSide) return 0;
  const duration = attackAnimMs(state.attackMoveId);
  return Math.min(1, (Date.now() - state.attackStart) / duration);
}

function setRobotPose(
  robot: THREE.Group,
  side: PlayerSide,
  attackProgress: number,
  hitFlash: number,
  attackMoveId: string | null,
  blockFrames: number[][] | null,
) {
  const direction = side === "left" ? 1 : -1;
  robot.rotation.y = side === "left" ? 0 : Math.PI;
  robot.position.y = hitFlash > 0 ? Math.sin(hitFlash * Math.PI * 6) * 0.015 : 0;

  const urdf = robot.userData.urdf as URDFRobotLike | undefined;
  if (attackMoveId === "block" && blockFrames?.length && urdf?.setJointValue) {
    const frameIdx = Math.min(
      blockFrames.length - 1,
      Math.floor(attackProgress * blockFrames.length),
    );
    applyG1JointFrame(urdf.setJointValue.bind(urdf), blockFrames[frameIdx]!);
    robot.scale.setScalar(1);
    setPlaceholderVisible(robot, false);
    return;
  }

  const rightUpper = robot.getObjectByName("rightUpperArm");
  const rightFore = robot.getObjectByName("rightForearm");
  const leftUpper = robot.getObjectByName("leftUpperArm");
  const leftFore = robot.getObjectByName("leftForearm");
  const torso = robot.getObjectByName("torso");

  const punch = Math.sin(Math.min(1, attackProgress) * Math.PI);
  robot.scale.setScalar(1 + punch * 0.04);
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

function parsePlayerSide(raw: string | null): PlayerSide {
  return raw === "2" || raw === "right" ? "right" : "left";
}

export function Arena3D() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roomId = searchParams.get("room");
  const playerSide = parsePlayerSide(searchParams.get("player"));
  const playerNumber = playerSide === "left" ? 1 : 2;
  const [personaId, setPersonaId] = useState<string>("");
  const vsHuman = personaId === "";
  const multiplayer = useArenaMultiplayer({
    enabled: vsHuman,
    roomId,
    playerSide,
  });
  const hostRef = useRef<HTMLDivElement | null>(null);
  const leftRobot = useRef<THREE.Group | null>(null);
  const rightRobot = useRef<THREE.Group | null>(null);
  const leftStateRef = useRef<FighterState | null>(null);
  const rightStateRef = useRef<FighterState | null>(null);
  const deckCardsRef = useRef<MoveCard[]>([]);
  const playMoveRef = useRef<((side: PlayerSide, move: ArenaMove) => void) | null>(null);
  const [moves, setMoves] = useState<ArenaMove[]>([]);
  const [deckCards, setDeckCards] = useState<MoveCard[]>([]);
  const [left, setLeft] = useState<FighterState>(() => createFighter("Player 1", -1.15));
  const [right, setRight] = useState<FighterState>(() => createFighter("Player 2", 1.15));
  const [log, setLog] = useState<string[]>([
    "Choose a move. Each robot can play robot-skill cards like Street Fighter specials.",
  ]);
  const [announcerOn, setAnnouncerOn] = useState(true);
  const [announcerReady, setAnnouncerReady] = useState<boolean | null>(null);
  const koSpokenRef = useRef(false);
  const blockTrajectoryRef = useRef<number[][] | null>(null);
  const { frame: cameraFrame, defaultFrame: cameraDefault, syncFromScene, resetToDefault } =
    useCameraDebug("arena");

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

  useEffect(() => {
    if (!multiplayer.roomCode || multiplayer.roomCode === roomId) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("room", multiplayer.roomCode);
    router.replace(`/arena?${params.toString()}`);
  }, [multiplayer.roomCode, roomId, router, searchParams]);

  useEffect(() => {
    if (!multiplayer.snapshot) return;
    setLeft(multiplayer.snapshot.left);
    setRight(multiplayer.snapshot.right);
    setLog(multiplayer.snapshot.log);
  }, [multiplayer.snapshot]);

  useEffect(() => {
    multiplayer.setOnLogLine((line) => {
      void announcer.speak(line);
    });
    return () => multiplayer.setOnLogLine(null);
  }, [multiplayer]);

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
      // Recovering from its own move, or too winded — rest and regenerate. This
      // paces the AI instead of letting it spam, and lets stamina drive variety.
      if (now < rs.recoverUntil || rs.stamina < MIN_STAMINA_TO_ACT) return;
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
          // The arena UI has no footwork/spacing mechanic — move buttons always
          // connect — so the enemy fights from a fixed in-pocket range. Using the
          // raw x-gap (~2.3) would read as permanently out of reach, leaving the
          // executor stuck choosing "advance" (a no-op here) and never throwing.
          range: 0.6,
        },
        rng,
      );
      // "advance"/"wait" are footwork the UI can't express, so treat any
      // committed move as the action and let other beats pass as spacing.
      if (action.kind === "move") {
        const am = usableMoves.find((m) => m.id === action.moveId) ?? usableMoves[0];
        // Only throw if it can actually afford this move; otherwise rest this
        // beat to regenerate (the breather is part of the rhythm).
        if (am && rs.stamina >= staminaCostFor(am)) playMoveRef.current?.("right", am);
      }
    }, 260);
    return () => clearInterval(timer);
  }, [personaId, usableMoves]);

  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;
    const scene = new THREE.Scene();
    addArenaBackground(scene);

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
    leftBot.position.x = left.x;
    rightBot.position.x = right.x;
    scene.add(leftBot, rightBot);
    leftRobot.current = leftBot;
    rightRobot.current = rightBot;

    let raf = 0;
    const clock = new THREE.Clock();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = clock.getElapsedTime();
      const leftState = leftStateRef.current ?? left;
      const rightState = rightStateRef.current ?? right;
      const blockFrames = blockTrajectoryRef.current;
      const leftProgress =
        leftState.attackSide === "left" ? attackProgressFor(leftState) : 0;
      const rightProgress =
        rightState.attackSide === "right" ? attackProgressFor(rightState) : 0;

      const leftLunge =
        leftState.attackMoveId === "block"
          ? 0
          : leftProgress * (1 - leftProgress) * 1.5;
      const rightLunge =
        rightState.attackMoveId === "block"
          ? 0
          : rightProgress * (1 - rightProgress) * 1.5;
      leftBot.position.x = THREE.MathUtils.lerp(leftBot.position.x, leftState.x + leftLunge, 0.28);
      rightBot.position.x = THREE.MathUtils.lerp(rightBot.position.x, rightState.x - rightLunge, 0.28);
      leftBot.position.z = Math.sin(t * 2.2) * 0.015;
      rightBot.position.z = -Math.sin(t * 2.1) * 0.015;
      setRobotPose(
        leftBot,
        "left",
        leftProgress,
        leftState.hitFlash,
        leftState.attackMoveId,
        blockFrames,
      );
      setRobotPose(
        rightBot,
        "right",
        rightProgress,
        rightState.hitFlash,
        rightState.attackMoveId,
        blockFrames,
      );

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
    if (multiplayer.isMultiplayer) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setLeft((p) => decayFighter(p, now));
      setRight((p) => decayFighter(p, now));
    }, 40);
    return () => clearInterval(timer);
  }, [multiplayer.isMultiplayer]);

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

  function reset() {
    if (multiplayer.isMultiplayer) {
      if (playerSide !== "left") return;
      koSpokenRef.current = false;
      void multiplayer.resetRemote();
      return;
    }

    koSpokenRef.current = false;
    setLeft(createFighter(left.name, -1.15));
    setRight(createFighter(right.name, 1.15));
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
  // Player 2 is auto-piloted while a persona is selected.
  const rightIsAI = personaId !== "";
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
              {vsHuman && (
                <span className="mt-1 block">
                  {multiplayer.status === "connecting" && "Connecting to arena room…"}
                  {multiplayer.status === "waiting" &&
                    multiplayer.roomCode &&
                    "Waiting for Player 2 — share the link below."}
                  {multiplayer.status === "live" && "Live 1v1 — moves sync in real time."}
                  {multiplayer.status === "error" && (
                    <span className="text-[#ff5c5c]">{multiplayer.error}</span>
                  )}
                </span>
              )}
              {playerSide === "left" && vsHuman && shareUrl && (
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
                  <option value="">Human opponent (online)</option>
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
