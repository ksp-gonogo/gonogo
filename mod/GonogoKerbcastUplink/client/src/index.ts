// kerbcast Uplink client for gonogo.
//
// Co-located with the GonogoKerbcastUplink C# mod (mod/GonogoKerbcastUplink):
// one directory holds the mod and the client TS it ships (Uplink architecture
// §1), the same layout every sibling Uplink client uses. It keeps the npm name
// `@ksp-gonogo/gonogo-kerbcast-uplink`: `@ksp-gonogo/kerbcast` is NOT available to
// rename onto, being the external kerbcast protocol SDK this package consumes
// from public npm (see .npmrc). So the package NAME deviates from the sibling
// convention; the layout does not.
//
// This client owns BOTH kerbcast planes, which is the one place it differs
// from a control-plane-only Uplink client:
//   - the CONTROL plane rides the Uplink's Topics (`kerbcast.cameras`,
//     `kerbcast.available`) like any other Uplink;
//   - the MEDIA plane does not ride Topics at all, video stays on kerbcast's
//     own WebRTC path, because a keyframed telemetry channel is the wrong
//     shape for encoded media (KerbcastUplink.cs's own header).
// The two meet at `cameraId` === kerbcast's `flightId`, which
// `KerbcastCameraEntryBuilder.Build` establishes mod-side.
//
// Importing this package's entry point side-effects four registrations
// into @ksp-gonogo/core's global registries:
//
//   - `KerbcastDataSource` → registerDataSource("kerbcast", ...) so the
//     sidecar connection appears in the Data Sources widget alongside the
//     other registered sources.
//   - `CameraFeed` component → registerComponent({ id: "camera-feed", ... })
//     so it's placeable from the dashboard widget picker.
//   - `DockingCameraAugment` → registerAugment({ id: "kerbcast-docking-camera",
//     ... }) filling @ksp-gonogo/components's DistanceToTarget widget's
//     `distance-to-target.camera` slot with the close-range docking-camera
//     backdrop. This REPLACED that widget's built-in `HudCamera`, which had
//     kerbcast wired directly into the core client, the thing this package's
//     move exists to end.
//   - `KerbcastAvatarAugment` → registerAugment({ id: "kerbcast-crew-avatar",
//     ... }) filling @ksp-gonogo/components's CrewStatus widget's
//     `crew-status.avatar` slot with a live per-kerbal face.
//     Correlates by kerbal NAME against kerbcast's
//     `kind: Kerbal` cameras: see CrewAvatarGate/selectKerbalCamera.ts.
//
// To wire it into the app: `import "@ksp-gonogo/gonogo-kerbcast-uplink";` during app
// bootstrap (alongside the other data-source/registration imports in
// app/src/dataSources/index.ts).

export type { CameraFeedConfig } from "./CameraFeed";
export { CameraFeed, isPartCamera } from "./CameraFeed";
export {
  useDelayedKerbcastStream,
  useDelayedPlaybackStatus,
} from "./CameraFeed/useDelayedKerbcastStream";
// The embedded-facecam kill-switch gate + kerbal-face augment, wired into
// CrewStatus's `crew-status.avatar` slot below.
export { KerbcastAvatarAugment } from "./CrewAvatarGate";
export { selectKerbalCamera } from "./CrewAvatarGate/selectKerbalCamera";
export type { LabelableCamera } from "./cameraLabels";
export { buildCameraLabeler } from "./cameraLabels";
// The generic delayed-media infrastructure (DelayedPlayoutBuffer, the
// per-frame pipeline, `isFrameDelaySupported`, the capture-clock helpers) is
// published as `@ksp-gonogo/sitrep-sdk/media`: import it from there, not from
// this kerbcast client.
export { DockingCameraAugment } from "./DockingCameraAugment";
export { selectDockingCamera } from "./DockingCameraAugment/selectDockingCamera";
export { useKerbcastCameras } from "./hooks/useKerbcastCameras";
export type {
  DelayedPlayoutResult,
  KerbcastStreamDelayOptions,
} from "./hooks/useKerbcastStream";
export {
  useDelayedPlayout,
  useKerbcastStream,
} from "./hooks/useKerbcastStream";
export type {
  CameraAddedPayload,
  CameraRemovedPayload,
  KerbcastEdgeSource,
  KerbcastEventKind,
  SignalLostPayload,
  StreamDegradedPayload,
} from "./KerbcastEventProducer";
export type { CameraLifecycle } from "./lifecycle";
export { getCameraLifecycle } from "./lifecycle";
// Non-widget infra (defineUplinkClient-equivalent registerUplinkHandle side
// effect, kerbcastSource, KERBCAST_EVENTS_TOPIC, useKerbcastMainConnect)
// lives in `./runtime`, split out specifically so MainScreen can depend on
// it WITHOUT also evaluating `./CameraFeed` above (see `./runtime`'s own doc
// comment for why that matters to the Uplink loader). Re-exported here too
// so the package root keeps its full existing surface for every other
// consumer.
export * from "./runtime";

// Side-effect registrations happen at the module-load points below.
// The imports stay un-aliased so the package's `dist/index.js` keeps
// them as bare imports tsc / bundlers won't tree-shake away.
import "./CameraFeed";
import "./CrewAvatarGate"; // registerAugment("kerbcast-crew-avatar" -> crew-status.avatar)
import "./DockingCameraAugment";
import "./settings/registerKerbcastSettings"; // registerSetting × 2 (declarative "Kerbcast" category)
