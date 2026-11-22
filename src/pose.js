import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

// WASM runtime and models are served locally from /public so this works offline.
export const POSE_CONNECTIONS = PoseLandmarker.POSE_CONNECTIONS;

// Torso joints used for a person's overall distance: shoulders + hips
export const TORSO = [11, 12, 23, 24];

let fileset = null;

export async function createPose({ model = 'full', numPoses = 4, minConf = 0.5 } = {}) {
  fileset ??= await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe-wasm`);
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}models/pose_landmarker_${model}.task`, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numPoses,
    minPoseDetectionConfidence: minConf,
    minPosePresenceConfidence: minConf,
    minTrackingConfidence: minConf,
  });
}
