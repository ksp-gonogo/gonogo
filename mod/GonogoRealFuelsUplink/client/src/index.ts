// GonogoRealFuelsUplink client for gonogo.
//
// Co-located with the GonogoRealFuelsUplink C# mod
// (mod/GonogoRealFuelsUplink): one directory holds the mod and the client TS it
// ships. Importing this package's entry point side-effects its registrations:
//
//   - `EngineRealismSection` → registerAugment({ id:
//     "realfuels-fuel-status-section", augments: "fuel-status.sections" }), so
//     the ignition budget and ullage state appear inside the base Fuel & ΔV
//     widget rather than in a widget of their own.
//
// `./uplink` declares the client identity that augment stamps as `owner`, so the
// picker's mod search tags derive "realfuels" from the registration.
//
// `./topics` declares the three Topics this Uplink publishes, including the bare
// `realfuels.available` presence primitive, and feeds their generated unit and
// shape maps into the SDK's runtime hydration registry.
import "./uplink";
import "./topics";
import "./EngineRealism";

export { EngineRealismSection } from "./EngineRealism";
