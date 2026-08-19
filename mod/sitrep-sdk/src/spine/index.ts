// ---------------------------------------------------------------------------
// `@ksp-gonogo/sitrep-sdk/spine`: the REAL IMPLEMENTATIONS behind the host shims.
//
// Every name the root barrel publishes as an author-facing shim
// (`useTelemetry`, `useActionInput`, `registerSetting`, ...) resolves at runtime
// to `getHost().<member>`. This subpath is where those members are actually
// implemented, and the two are deliberately not the same module: the shim is what
// an Uplink calls, this is what the app and an Uplink's test WIRE INTO the host.
//
// The largest part of it is the read semantics of a topic. What
// `useTelemetry("vessel.state.altitudeAsl")` MEANS: the derived-channel path, the
// raw-field-subtopic fallback the legacy-key table rides on, epoch handling on a
// quickload rewind, and the frame-coherent memoisation that makes a re-read within
// one frame hand back the identical object. A widget depends on all of it while it
// renders.
//
// The rest arrived for the same reason by a different route: the dashboard-item
// and screen contexts, the action-input hook, the data-source hooks, and the
// setting and settings-tab registries were all in `@ksp-gonogo/core`, where an
// Uplink's test could not reach them to build a host. Each named only things
// already on this side of the line.
//
// It lives here rather than in `@ksp-gonogo/sitrep-client` because it never
// needed that package: the transitive import closure of these seven files was
// the sdk and itself, nothing more. Keeping them there meant an Uplink's tests
// could only reach the real read semantics through an unpublished package, and
// the alternative on the table was to reimplement the store inside the test
// harness. A test running against a reimplementation of the store is not
// evidence about the store, so the reimplementation is not on the table any
// more: this is a move, and an Uplink's tests run the code the app runs.
//
// Deliberately NOT re-exported from the root barrel. Authoring a derived channel
// needs `DerivedChannelDefinition` and `TimelinePoint`, which the root barrel
// already publishes; nothing about writing an Uplink needs `TimelineStore`
// itself. Publishing the class would freeze 1594 lines of evolving internals as
// third-party API, the same trap `TelemetryClient`-as-a-value was pulled back
// from. A test reaches it through this subpath; the app reaches it through
// `sitrep-client`'s re-export.
//
// Wildcards, not a curated name list: a curated one silently omitted six names
// `sitrep-client`'s own barrel re-exports, and the omission only surfaced as six
// TS2305s in a downstream package. The whole of each module belongs here.
// ---------------------------------------------------------------------------

export * from "./client";
export * from "./client-reading";
export * from "./client-timeline";
export * from "./clock";
export * from "./context";
export * from "./contributed-channels";
export * from "./dashboard-item";
export * from "./delay-authority";
export * from "./dv-legacy-scalars";
export * from "./dv-stage-resources";
export * from "./heartbeat-tracker";
export * from "./kepler";
export * from "./lifecycle";
export * from "./maneuver-legacy";
export * from "./map-command";
export * from "./map-topic";
export * from "./never-reckonable";
export * from "./orbit-patches";
export * from "./processorEvaluator";
export * from "./processors";
export * from "./propagation";
export * from "./reckoners";
export * from "./replay-recorder";
export * from "./replay-transport";
export * from "./screen";
export * from "./settings-registry";
export * from "./settings-tabs";
export * from "./space-center-state";
export * from "./stream-status";
export * from "./system-state";
export * from "./timeline-store";
export * from "./uplink-health";
export * from "./use-action-input";
export * from "./use-data-source-subscription";
export * from "./use-data-sources";
export * from "./use-execute-action";
export * from "./use-telemetry";
export * from "./vessel-state";
export * from "./view-clock";
