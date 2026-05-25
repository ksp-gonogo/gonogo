/**
 * Extended CameraState type that includes the `lifecycle` field sent by
 * kerbcam sidecar v0.3.2+. The published `@jonpepler/kerbcam` v0.3.1 types
 * don't include this field yet, so we extend locally and cast.
 *
 * The sidecar serialises lifecycle as `"active"` or `"destroyed"` in the
 * `camera-state-changed` / `camera-snapshot` JSON payloads. The published
 * client passes these objects through unchanged; we read the field here.
 */

import type { CameraState } from "@jonpepler/kerbcam";

/** Lifecycle state of a kerbcam camera. */
export type CameraLifecycle = "active" | "destroyed";

/**
 * `CameraState` extended with the lifecycle field present in sidecar
 * v0.3.2+. Absent on older sidecars — callers should treat `undefined`
 * as `"active"` for forward compatibility.
 */
export type CameraStateWithLifecycle = CameraState & {
  lifecycle?: CameraLifecycle;
};

/**
 * Extract the lifecycle from a raw CameraState object. Treats missing or
 * unrecognised values as `"active"` per the protocol spec ("absent or
 * unknown values treated as active for forward compatibility").
 */
export function getCameraLifecycle(cam: CameraState): CameraLifecycle {
  const raw = (cam as CameraStateWithLifecycle).lifecycle;
  return raw === "destroyed" ? "destroyed" : "active";
}
