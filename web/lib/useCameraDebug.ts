"use client";

import { useCallback, useRef, useState } from "react";
import type * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  applyCameraFrame,
  CAMERA_DEFAULTS,
  readCameraFrame,
  type CameraFrame,
} from "./cameraFrame";

type SceneHandles = {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
};

export function useCameraDebug(preset: keyof typeof CAMERA_DEFAULTS) {
  const defaultFrame = CAMERA_DEFAULTS[preset];
  const [frame, setFrame] = useState<CameraFrame>(defaultFrame);
  const handlesRef = useRef<SceneHandles | null>(null);
  const lastSyncRef = useRef(0);

  const syncFromScene = useCallback(
    (camera: THREE.PerspectiveCamera, controls: OrbitControls) => {
      handlesRef.current = { camera, controls };
      const now = performance.now();
      if (now - lastSyncRef.current < 200) return;
      lastSyncRef.current = now;
      setFrame(readCameraFrame(camera, controls));
    },
    [],
  );

  const resetToDefault = useCallback(() => {
    const handles = handlesRef.current;
    if (!handles) return;
    applyCameraFrame(handles.camera, handles.controls, defaultFrame);
    setFrame(defaultFrame);
  }, [defaultFrame]);

  return { frame, defaultFrame, syncFromScene, resetToDefault };
}
