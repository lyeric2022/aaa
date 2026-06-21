import type * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type Vec3 = { x: number; y: number; z: number };

export type CameraFrame = {
  position: Vec3;
  target: Vec3;
};

/** Temporary defaults — replace once you pick the hero frame in the UI. */
export const CAMERA_DEFAULTS = {
  arena: {
    position: { x: -3.286, y: 1.839, z: 0.935 },
    target: { x: 0, y: 1.05, z: 0 },
  },
  replay: {
    position: { x: 1.15, y: 1.25, z: 5.6 },
    target: { x: 0, y: 0.95, z: 0 },
  },
} as const satisfies Record<string, CameraFrame>;

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

export function readCameraFrame(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
): CameraFrame {
  return {
    position: {
      x: round3(camera.position.x),
      y: round3(camera.position.y),
      z: round3(camera.position.z),
    },
    target: {
      x: round3(controls.target.x),
      y: round3(controls.target.y),
      z: round3(controls.target.z),
    },
  };
}

export function applyCameraFrame(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  frame: CameraFrame,
) {
  camera.position.set(frame.position.x, frame.position.y, frame.position.z);
  controls.target.set(frame.target.x, frame.target.y, frame.target.z);
  controls.update();
}

export function formatCameraFrame(frame: CameraFrame) {
  return JSON.stringify(frame, null, 2);
}
