/** Vertical lift for G1 URDF skin so feet sit on the arena floor (Y-up, after Z→Y rotation). */
export const G1_URDF_FLOOR_Y = 0.88;

/** MuJoCo / Unitree SDK joint order for G1 29-DoF. */
export const G1_MUJOCO_JOINT_NAMES = [
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

/**
 * UFB / GR00T SONIC zip exports joint_pos in IsaacLab/internal order.
 * Map internal column i -> MuJoCo joint index.
 * Ref: Unitree RL Lab g1_29dof joint_mapping.
 */
export const ISAACLAB_TO_MUJOCO_JOINT_INDEX = [
  0, 6, 12, 1, 7, 13, 2, 8, 14, 3, 9, 15, 22, 4, 10, 16, 23, 5, 11, 17, 24,
  18, 25, 19, 26, 20, 27, 21, 28,
] as const;

export function remapIsaacLabJoints(frame: number[]): number[] {
  const out = new Array<number>(frame.length);
  for (let i = 0; i < frame.length; i++) {
    out[ISAACLAB_TO_MUJOCO_JOINT_INDEX[i]] = frame[i] ?? 0;
  }
  return out;
}

export function remapIsaacLabFrames(frames: number[][]): number[][] {
  return frames.map(remapIsaacLabJoints);
}

/** Lafan CSV rows are already MuJoCo qpos: XYZ + QX QY QZ QW + 29 joints. */
export function lafanCsvRowToMujocoQpos(row: number[]): {
  position: [number, number, number];
  jointAngles: number[];
} {
  return {
    position: [row[0] ?? 0, row[1] ?? 0, row[2] ?? 0],
    jointAngles: row.slice(7),
  };
}

export function remapLafanJointRow(row: number[]): number[] {
  // Lafan G1 CSV joint columns are already MuJoCo/SDK order.
  return row.slice(7);
}

/** Drive a G1 URDF from one remapped MuJoCo joint frame. */
export function applyG1JointFrame(
  setJointValue: (jointName: string, value: number) => void,
  frame: number[],
) {
  G1_MUJOCO_JOINT_NAMES.forEach((jointName, index) => {
    const value = frame[index];
    if (Number.isFinite(value)) setJointValue(jointName, value);
  });
}
