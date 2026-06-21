import * as THREE from "three";

function panelMaterial(color: string, emissive: string, emissiveIntensity = 0.35) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity,
    metalness: 0.45,
    roughness: 0.55,
  });
}

/** Procedural robot-sports arena: ring, backdrop, corner lights, fog. */
export function addArenaBackground(scene: THREE.Scene) {
  scene.background = new THREE.Color("#07070d");
  scene.fog = new THREE.Fog("#07070d", 6, 22);

  const deck = new THREE.Mesh(
    new THREE.CylinderGeometry(3.6, 3.8, 0.05, 72),
    new THREE.MeshStandardMaterial({
      color: "#0d0f18",
      metalness: 0.25,
      roughness: 0.82,
    }),
  );
  deck.position.y = -0.08;
  deck.receiveShadow = true;
  scene.add(deck);

  const mat = new THREE.Mesh(
    new THREE.CylinderGeometry(2.35, 2.35, 0.1, 72),
    new THREE.MeshStandardMaterial({
      color: "#141722",
      metalness: 0.35,
      roughness: 0.45,
    }),
  );
  mat.position.y = -0.03;
  mat.receiveShadow = true;
  scene.add(mat);

  const innerRing = new THREE.Mesh(
    new THREE.TorusGeometry(2.15, 0.035, 12, 96),
    panelMaterial("#2a2340", "#7c5cff", 0.9),
  );
  innerRing.rotation.x = Math.PI / 2;
  innerRing.position.y = 0.03;
  scene.add(innerRing);

  const outerRing = new THREE.Mesh(
    new THREE.TorusGeometry(2.65, 0.025, 12, 96),
    panelMaterial("#1a2030", "#3dd68c", 0.55),
  );
  outerRing.rotation.x = Math.PI / 2;
  outerRing.position.y = 0.025;
  scene.add(outerRing);

  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 9),
    panelMaterial("#090a10", "#2b1f55", 0.2),
  );
  backdrop.position.set(0, 3.8, -5.8);
  scene.add(backdrop);

  const sideBackdrop = (x: number, rotY: number) => {
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 7),
      panelMaterial("#090a10", "#14263a", 0.18),
    );
    wall.position.set(x, 3.2, -2.2);
    wall.rotation.y = rotY;
    scene.add(wall);
  };
  sideBackdrop(-6.2, Math.PI / 5);
  sideBackdrop(6.2, -Math.PI / 5);

  const bannerTextColors = ["#7c5cff", "#3dd68c", "#7c5cff"] as const;
  [-4.8, 0, 4.8].forEach((x, i) => {
    const banner = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 0.55, 0.08),
      panelMaterial("#10121a", bannerTextColors[i], 0.75),
    );
    banner.position.set(x, 5.2, -5.4);
    scene.add(banner);
  });

  const addCornerTower = (x: number, accent: string) => {
    const tower = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 3.6, 0.18),
      panelMaterial("#181b26", accent, 0.85),
    );
    tower.position.set(x, 1.8, -3.1);
    scene.add(tower);

    const lamp = new THREE.PointLight(accent, 1.4, 8, 2);
    lamp.position.set(x, 3.4, -2.8);
    scene.add(lamp);
  };
  addCornerTower(-3.4, "#3dd68c");
  addCornerTower(3.4, "#ff5c5c");

  const crowdDeck = new THREE.Mesh(
    new THREE.TorusGeometry(4.2, 0.35, 8, 64),
    new THREE.MeshStandardMaterial({
      color: "#0a0c14",
      emissive: "#111827",
      emissiveIntensity: 0.25,
      metalness: 0.2,
      roughness: 0.9,
    }),
  );
  crowdDeck.rotation.x = Math.PI / 2;
  crowdDeck.position.y = 0.55;
  scene.add(crowdDeck);

  const grid = new THREE.GridHelper(12, 24, "#343055", "#171729");
  grid.position.y = -0.06;
  scene.add(grid);

  return {
    dispose: () => {
      scene.fog = null;
    },
  };
}
