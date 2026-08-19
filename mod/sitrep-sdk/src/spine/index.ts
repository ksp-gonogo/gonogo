// ---------------------------------------------------------------------------
// `@ksp-gonogo/sitrep-sdk/spine`: the READ SEMANTICS of a topic.
//
// What `useTelemetry("vessel.state.altitudeAsl")` MEANS: the derived-channel
// path, the raw-field-subtopic fallback the legacy-key table rides on, epoch
// handling on a quickload rewind, and the frame-coherent memoisation that makes
// a re-read within one frame hand back the identical object. A widget depends on
// all of it while it renders.
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
// TS2305s in a downstream package. These seven modules are one unit and the
// whole of each belongs here.
// ---------------------------------------------------------------------------

export * from "./client-reading";
export * from "./client-timeline";
export * from "./heartbeat-tracker";
export * from "./reckoners";
export * from "./stream-status";
export * from "./timeline-store";
export * from "./view-clock";
