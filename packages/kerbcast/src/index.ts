// kerbcast consumer for gonogo.
//
// Importing this package's entry point side-effects two registrations
// into @ksp-gonogo/core's global registries:
//
//   - `KerbcastDataSource` → registerDataSource("kerbcast", ...) so the
//     sidecar connection appears in the Data Sources widget alongside
//     Telemachus / kOS / etc.
//   - `CameraFeed` component → registerComponent({ id:
//     "camera-feed", ... }) so it's placeable from the dashboard
//     widget picker.
//
// To wire it into the app: `import "@ksp-gonogo/kerbcast";` somewhere
// during app bootstrap (alongside the existing telemachus / kos
// data-source imports in app/src/dataSources/index.ts).

export type { CameraFeedConfig } from "./CameraFeed";
export { CameraFeed } from "./CameraFeed";
export { useDelayedKerbcastStream } from "./CameraFeed/useDelayedKerbcastStream";
export type { LabelableCamera } from "./cameraLabels";
export { buildCameraLabeler } from "./cameraLabels";
export type {
  DelayClockLike,
  DelayedPlayoutBufferOptions,
  StampedFrame,
} from "./DelayedPlayoutBuffer";
export { DelayedPlayoutBuffer } from "./DelayedPlayoutBuffer";
export { useKerbcastCameras } from "./hooks/useKerbcastCameras";
export type { KerbcastStreamDelayOptions } from "./hooks/useKerbcastStream";
export {
  useDelayedPlayout,
  useKerbcastStream,
} from "./hooks/useKerbcastStream";
export * from "./KerbcastDataSource";
export type { CameraLifecycle } from "./lifecycle";
export { getCameraLifecycle } from "./lifecycle";
export { KerbcastSettings } from "./settings/KerbcastSettings";

// Side-effect registrations happen at the module-load points below.
// The imports stay un-aliased so the package's `dist/index.js` keeps
// them as bare imports tsc / bundlers won't tree-shake away.
import "./KerbcastDataSource";
import "./CameraFeed";
