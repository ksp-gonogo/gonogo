import { CameraKind, type CameraState, Layer } from "@ksp-gonogo/kerbcast";

/**
 * Build a fully-populated `CameraState` for a unit test, with sensible
 * defaults for every field `selectKerbalCamera` doesn't care about. Kept
 * local to this augment's tests (not the SDK's own `MockCameraInit`, which
 * builds cameras through a live `MockSidecar` registry) because these tests
 * exercise the pure selection function directly, with no client/transport
 * involved.
 */
export function makeCameraState(
  overrides: Partial<CameraState> & { flightId: number },
): CameraState {
  return {
    kind: CameraKind.Part,
    partName: "part",
    partTitle: "Part",
    cameraName: "Camera",
    vesselName: "Vessel",
    layers: [Layer.Near],
    operatorLayers: [Layer.Near],
    renderWidth: 64,
    renderHeight: 64,
    operatorWidth: 64,
    operatorHeight: 64,
    supportsZoom: false,
    fov: 60,
    fovMin: 60,
    fovMax: 60,
    supportsPan: false,
    panYaw: 0,
    panPitch: 0,
    panYawMin: 0,
    panYawMax: 0,
    panPitchMin: 0,
    panPitchMax: 0,
    encoderBitrateBps: 0,
    targetBitrateBps: 0,
    degradeLevel: 0,
    ...overrides,
  };
}
