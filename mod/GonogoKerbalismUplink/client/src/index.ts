// @ksp-gonogo/gonogo-kerbalism-uplink: the KerbalismUplink client package entry.
//
// Registers the Kerbalism Domain's bare-primitive presence Topic. Bare
// side-effect import so bundlers never tree-shake the registration call.
//
// NOTE: the SpaceWeather + LifeSupportSystems widgets currently live in
// @ksp-gonogo/components (they read the canonical kerbalism.* Topics via
// useTelemetry). Physically relocating them into this package is a follow-up,
// the visual/snapshot probe harness that renders them lives in components, so
// the move is a mechanical file relocation with no data-path change.
import "./topics";
