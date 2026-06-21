import * as THREE from "three";

function material(
  color: string,
  emissive = "#000000",
  emissiveIntensity = 0,
  metalness = 0.35,
  roughness = 0.58,
) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity,
    metalness,
    roughness,
  });
}

function makeCanvasTexture(lines: string[], accent: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  gradient.addColorStop(0, "#07080d");
  gradient.addColorStop(0.5, "#171225");
  gradient.addColorStop(1, "#071018");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 8;
  ctx.strokeRect(24, 24, canvas.width - 48, canvas.height - 48);

  ctx.globalAlpha = 1;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#eef2ff";
  ctx.font = "700 84px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(lines[0] ?? "GHOST FIGHTER", canvas.width / 2, 108);

  ctx.fillStyle = accent;
  ctx.font = "600 34px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(lines[1] ?? "ROBOT SPORTS ARENA", canvas.width / 2, 178);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addScreen(
  scene: THREE.Scene,
  position: THREE.Vector3Tuple,
  rotationY: number,
  lines: string[],
  accent: string,
) {
  const texture = makeCanvasTexture(lines, accent);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(4.5, 1.15),
    new THREE.MeshBasicMaterial({
      color: "#ffffff",
      map: texture ?? undefined,
      transparent: true,
    }),
  );
  screen.position.set(...position);
  screen.rotation.y = rotationY;
  scene.add(screen);

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(4.8, 1.38, 0.08),
    material("#10131f", accent, 0.25, 0.55, 0.35),
  );
  frame.position.set(position[0], position[1], position[2] - 0.04);
  frame.rotation.y = rotationY;
  scene.add(frame);

  screen.renderOrder = 2;
}

function addLightBar(
  scene: THREE.Scene,
  x: number,
  z: number,
  color: string,
  rotationY = 0,
) {
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, 2.6, 0.09),
    material("#11141f", color, 0.8, 0.5, 0.35),
  );
  bar.position.set(x, 1.45, z);
  bar.rotation.y = rotationY;
  scene.add(bar);

  const glow = new THREE.PointLight(color, 1.8, 7.5, 2);
  glow.position.set(x, 2.8, z + 0.25);
  scene.add(glow);
}

/** The squared ring the ropes enclose (half-extents on x / z). Fighters stay
 * inside this so they can lean on the ropes but never pass through them. */
export const RING_HALF_X = 2.35;
export const RING_HALF_Z = 1.75;

/** A single rope segment whose geometry we bow inward/outward on contact. */
export interface RopeHandle {
  mesh: THREE.Mesh;
  /** Pristine vertex positions, restored when no fighter is touching. */
  rest: Float32Array;
  /** World axis the rope runs along. */
  runAxis: "x" | "z";
  /** Maps a vertex's local Y to its world run coordinate (worldRun = sign*localY). */
  runSign: number;
  /** World axis the rope bows along (away from the ring centre). */
  outwardAxis: "x" | "z";
  outwardSign: number;
  /** |fixed coordinate| of the rope line on its outward axis. */
  fixedAbs: number;
  /** Local geometry axis (x or z) that corresponds to the outward direction. */
  localBulgeAxis: "x" | "z";
  dirty: boolean;
}

// How the ropes give when a fighter presses into them.
const ROPE_CONTACT_REACH = 0.85; // how far in from the rope contact begins (m)
const ROPE_MAX_BULGE = 0.14; // peak outward displacement (m)
const ROPE_SIGMA = 0.6; // width of the bow along the rope (m)

function smooth01(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

function addRingRopes(scene: THREE.Scene): RopeHandle[] {
  const postMaterial = material("#181d2a", "#222943", 0.35, 0.55, 0.32);
  const ropeMaterials = [
    material("#2b2448", "#7c5cff", 0.65, 0.25, 0.28),
    material("#19362c", "#3dd68c", 0.6, 0.25, 0.28),
  ];

  const corners: THREE.Vector3Tuple[] = [
    [-RING_HALF_X, 0, -RING_HALF_Z],
    [RING_HALF_X, 0, -RING_HALF_Z],
    [RING_HALF_X, 0, RING_HALF_Z],
    [-RING_HALF_X, 0, RING_HALF_Z],
  ];

  for (const [x, , z] of corners) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.35, 16), postMaterial);
    post.position.set(x, 0.62, z);
    post.castShadow = true;
    scene.add(post);
  }

  const ropeSegments: [THREE.Vector3Tuple, THREE.Vector3Tuple][] = [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
  ];

  const handles: RopeHandle[] = [];
  for (const y of [0.58, 0.84, 1.1]) {
    ropeSegments.forEach(([a, b], i) => {
      const start = new THREE.Vector3(a[0], y, a[2]);
      const end = new THREE.Vector3(b[0], y, b[2]);
      const mid = start.clone().lerp(end, 0.5);
      const length = start.distanceTo(end);
      const horizontal = Math.abs(a[0] - b[0]) > Math.abs(a[2] - b[2]);
      // Extra length segments give the rope enough vertices to bow smoothly.
      const geometry = new THREE.CylinderGeometry(0.018, 0.018, length, 8, 28);
      const rope = new THREE.Mesh(geometry, ropeMaterials[i % ropeMaterials.length]);
      rope.position.copy(mid);
      rope.rotation.z = horizontal ? Math.PI / 2 : 0;
      rope.rotation.x = horizontal ? 0 : Math.PI / 2;
      scene.add(rope);

      const rest = (geometry.attributes.position.array as Float32Array).slice();
      handles.push(
        horizontal
          ? {
              mesh: rope,
              rest,
              runAxis: "x",
              runSign: -1, // rotation.z = +90° sends local +Y to world -X
              outwardAxis: "z",
              outwardSign: Math.sign(mid.z) || 1,
              fixedAbs: Math.abs(mid.z),
              localBulgeAxis: "z",
              dirty: false,
            }
          : {
              mesh: rope,
              rest,
              runAxis: "z",
              runSign: 1, // rotation.x = +90° sends local +Y to world +Z
              outwardAxis: "x",
              outwardSign: Math.sign(mid.x) || 1,
              fixedAbs: Math.abs(mid.x),
              localBulgeAxis: "x",
              dirty: false,
            },
      );
    });
  }
  return handles;
}

/**
 * Bow each rope outward where a fighter leans into it. Recomputed from the rest
 * pose every frame so the deformation tracks the fighter and relaxes when they
 * step away. `fighters` are the live mat positions (x, z).
 */
export function applyRopeContacts(
  ropes: RopeHandle[],
  fighters: { x: number; z: number }[],
) {
  for (const rope of ropes) {
    const contacts: { run: number; press: number }[] = [];
    for (const f of fighters) {
      const out = (rope.outwardAxis === "x" ? f.x : f.z) * rope.outwardSign;
      const press = smooth01((out - (rope.fixedAbs - ROPE_CONTACT_REACH)) / ROPE_CONTACT_REACH);
      if (press > 0.001) {
        contacts.push({ run: rope.runAxis === "x" ? f.x : f.z, press });
      }
    }

    const attr = rope.mesh.geometry.attributes.position;
    const arr = attr.array as Float32Array;
    if (contacts.length === 0) {
      if (rope.dirty) {
        arr.set(rope.rest);
        attr.needsUpdate = true;
        rope.dirty = false;
      }
      continue;
    }

    const bulgeIdx = rope.localBulgeAxis === "x" ? 0 : 2;
    for (let i = 0; i < arr.length; i += 3) {
      const worldRun = rope.runSign * rope.rest[i + 1];
      let weight = 0;
      for (const c of contacts) {
        const d = worldRun - c.run;
        const g = Math.exp(-(d * d) / (2 * ROPE_SIGMA * ROPE_SIGMA)) * c.press;
        if (g > weight) weight = g;
      }
      arr[i + bulgeIdx] = rope.rest[i + bulgeIdx] + rope.outwardSign * ROPE_MAX_BULGE * weight;
    }
    attr.needsUpdate = true;
    rope.dirty = true;
  }
}

function addAudienceLights(scene: THREE.Scene) {
  const colors = ["#7c5cff", "#3dd68c", "#ff5c5c", "#f5a623"];
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i < 20; i++) {
      const x = -5.4 + i * 0.56;
      const y = 1.4 + row * 0.34;
      const z = -4.7 - row * 0.3;
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.025 + row * 0.004, 8, 8),
        material("#0b0d12", colors[(i + row) % colors.length], 0.95, 0.1, 0.35),
      );
      dot.position.set(x, y, z);
      scene.add(dot);
    }
  }
}

function addAtmosphere(scene: THREE.Scene) {
  const count = 140;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 8;
    positions[i * 3 + 1] = 0.6 + Math.random() * 3.8;
    positions[i * 3 + 2] = -5 + Math.random() * 7;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: "#8ca3ff",
      size: 0.018,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    }),
  );
  scene.add(points);
}

/** Procedural robot-sports arena: stage, ropes, LED boards, crowd lights, fog. */
export function addArenaBackground(scene: THREE.Scene) {
  scene.background = new THREE.Color("#05060b");
  scene.fog = new THREE.Fog("#05060b", 5.5, 20);

  const floorBase = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 18),
    new THREE.MeshStandardMaterial({
      color: "#06070c",
      metalness: 0.18,
      roughness: 0.76,
    }),
  );
  floorBase.rotation.x = -Math.PI / 2;
  floorBase.position.y = -0.125;
  floorBase.receiveShadow = true;
  scene.add(floorBase);

  const deck = new THREE.Mesh(
    new THREE.CylinderGeometry(3.65, 3.95, 0.18, 96),
    new THREE.MeshStandardMaterial({
      color: "#10131f",
      metalness: 0.48,
      roughness: 0.38,
    }),
  );
  deck.position.y = -0.12;
  deck.receiveShadow = true;
  scene.add(deck);

  const mat = new THREE.Mesh(
    new THREE.CylinderGeometry(2.42, 2.42, 0.08, 96),
    new THREE.MeshStandardMaterial({
      color: "#171b29",
      emissive: "#0c1122",
      emissiveIntensity: 0.12,
      metalness: 0.45,
      roughness: 0.32,
    }),
  );
  mat.position.y = -0.01;
  mat.receiveShadow = true;
  scene.add(mat);

  [
    [2.02, 0.026, "#7c5cff", 1.05],
    [2.44, 0.018, "#3dd68c", 0.75],
    [2.9, 0.016, "#ff5c5c", 0.45],
  ].forEach(([radius, tube, color, glow]) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(Number(radius), Number(tube), 12, 128),
      material("#151827", String(color), Number(glow), 0.18, 0.22),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    scene.add(ring);
  });

  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(12, 5.5, 0.16),
    material("#080a12", "#141326", 0.28, 0.25, 0.7),
  );
  backWall.position.set(0, 2.65, -5.35);
  scene.add(backWall);

  const leftWall = backWall.clone();
  leftWall.position.set(-5.7, 2.4, -2.1);
  leftWall.rotation.y = Math.PI / 4.7;
  scene.add(leftWall);

  const rightWall = backWall.clone();
  rightWall.position.set(5.7, 2.4, -2.1);
  rightWall.rotation.y = -Math.PI / 4.7;
  scene.add(rightWall);

  addScreen(scene, [0, 4.35, -5.15], 0, ["GHOST FIGHTER", "G1 COMBAT LEAGUE"], "#a78bfa");
  addScreen(scene, [-5.25, 3.15, -2.55], Math.PI / 4.7, ["PLAYER 1", "READY"], "#3dd68c");
  addScreen(scene, [5.25, 3.15, -2.55], -Math.PI / 4.7, ["PLAYER 2", "LOCKED"], "#ff5c5c");

  addLightBar(scene, -3.7, -3.15, "#3dd68c", -0.15);
  addLightBar(scene, 3.7, -3.15, "#ff5c5c", 0.15);
  addLightBar(scene, -5.15, -0.65, "#7c5cff", Math.PI / 8);
  addLightBar(scene, 5.15, -0.65, "#7c5cff", -Math.PI / 8);

  const ropes = addRingRopes(scene);
  addAudienceLights(scene);
  addAtmosphere(scene);

  const overhead = new THREE.Mesh(
    new THREE.TorusGeometry(3.35, 0.045, 12, 96),
    material("#111623", "#7c5cff", 0.35, 0.42, 0.4),
  );
  overhead.position.set(0, 4.15, -0.25);
  overhead.rotation.x = Math.PI / 2;
  scene.add(overhead);

  const overheadLight = new THREE.SpotLight("#f4f7ff", 4.2, 12, Math.PI / 5.5, 0.55, 1.4);
  overheadLight.position.set(0, 4.4, 1.7);
  overheadLight.target.position.set(0, 0.4, 0);
  overheadLight.castShadow = true;
  scene.add(overheadLight);
  scene.add(overheadLight.target);

  const grid = new THREE.GridHelper(11, 22, "#32265d", "#121724");
  grid.position.y = -0.11;
  scene.add(grid);

  return {
    ropes,
    dispose: () => {
      scene.fog = null;
    },
  };
}
