// kerbcam consumer for gonogo.
//
// Importing this package's entry point side-effects two registrations
// into @gonogo/core's global registries:
//
//   - `KerbcamDataSource` → registerDataSource("kerbcam", ...) so the
//     sidecar connection appears in the Data Sources widget alongside
//     Telemachus / kOS / etc.
//   - `ExpCameraFeed` component → registerComponent({ id:
//     "exp-camera-feed", ... }) so it's placeable from the dashboard
//     widget picker.
//
// To wire it into the app: `import "@gonogo/kerbcam";` somewhere
// during app bootstrap (alongside the existing telemachus / kos
// data-source imports in app/src/dataSources/index.ts).

export type { ExpCameraFeedConfig } from "./ExpCameraFeed";
export { ExpCameraFeed } from "./ExpCameraFeed";
export { useKerbcamCameras } from "./hooks/useKerbcamCameras";
export { useKerbcamStream } from "./hooks/useKerbcamStream";
export * from "./KerbcamDataSource";

// Side-effect registrations happen at the module-load points below.
// The imports stay un-aliased so the package's `dist/index.js` keeps
// them as bare imports tsc / bundlers won't tree-shake away.
import "./KerbcamDataSource";
import "./ExpCameraFeed";
