// Typed Topic registry — Uplink architecture spec §3.1.
//
// Exports a `TopicId` string-literal union of every Topic the mod declares, plus a
// `TopicPayload<T extends TopicId>` mapped type resolving each Topic to its wire
// payload interface (e.g. `TopicPayload<'vessel.orbit'>` = `VesselOrbit`). Every place
// that names a Topic — widget `channels`/`optionalChannels` declarations and the
// `useTelemetry` read hook — is constrained to this union and shares the same token,
// so there are no open string keys and no drift.
//
// ── Single source of truth ────────────────────────────────────────────────────────
// The Topic *strings* are authored C#-side in each Uplink/provider's
// `ChannelDeclaration.Topic` (see `mod/Sitrep.Host/*ViewProvider.cs`,
// `mod/Gonogo.KSP`, `mod/Gonogo.Kos`, `mod/GonogoScansatUplink`,
// `mod/GonogoRealAntennasUplink`). This registry is DERIVED from those declarations
// and `topics.test.ts` reads the C# sources and asserts `TOPIC_IDS` stays in exact
// sync — so a Topic added or removed in C# fails the SDK build until this file is
// updated.
//
// FOLLOW-UP (T0.1 → full codegen): the payload *types* are only centralised in
// `Sitrep.Contract` for the vessel.*, comms.*, time.warp and kOS-processor Topics —
// those resolve to a precise generated interface below. The career.*, parts.*,
// system.*, science.* and scansat.* payloads are not yet in the contract, so they
// resolve to `unknown` here (honest: the SDK does not yet know their shape). The
// clean end-state is to move those payload records into `Sitrep.Contract`, tag each
// payload type with its Topic (e.g. a `[SitrepTopic("vessel.orbit")]` attribute), and
// have `codegen.sh`/`RtConfig` emit BOTH the payload interfaces and this
// `TopicId`/`TopicPayloadMap` pair — replacing the hand-authored map while keeping the
// exact same exported surface. Tracked separately; not in scope for T0.1.

import type {
  CommsConnectivity,
  CommsControlState,
  CommsDataRate,
  CommsDelay,
  CommsLinkMargin,
  CommsLinkQuality,
  CommsNetwork,
  CommsPath,
  CommsSignalStrength,
  DockAlignment,
  KosProcessorInfo,
  VesselAttitude,
  VesselComms,
  VesselControl,
  VesselCrew,
  VesselFlight,
  VesselIdentity,
  VesselManeuver,
  VesselOrbit,
  VesselOrbitTruth,
  VesselPropulsion,
  VesselResources,
  VesselStructure,
  VesselSurface,
  VesselTarget,
  VesselThermal,
  WarpState,
} from "./__generated__/contract";

/**
 * The Topic → payload-type map. Keys are the wire Topic strings; values are the
 * payload interface a `stream-data` message on that Topic carries. `TopicId` and
 * `TopicPayload` are both derived from this one declaration.
 *
 * Entries typed `unknown` are Topics whose payload record is not yet in
 * `Sitrep.Contract` (see the FOLLOW-UP note at the top of this file).
 */
export interface TopicPayloadMap {
  // ── vessel.* (Sitrep.Host/VesselViewProvider.cs) ──
  "vessel.attitude": VesselAttitude;
  "vessel.comms": VesselComms;
  "vessel.control": VesselControl;
  "vessel.crew": VesselCrew;
  "vessel.dock": DockAlignment;
  "vessel.flight": VesselFlight;
  "vessel.identity": VesselIdentity;
  "vessel.maneuver": VesselManeuver;
  "vessel.orbit": VesselOrbit;
  "vessel.orbit.truth": VesselOrbitTruth;
  "vessel.propulsion": VesselPropulsion;
  "vessel.resources": VesselResources;
  "vessel.structure": VesselStructure;
  "vessel.surface": VesselSurface;
  "vessel.target": VesselTarget;
  "vessel.thermal": VesselThermal;

  // ── time.* (Sitrep.Host/VesselViewProvider.cs) ──
  "time.warp": WarpState;

  // ── comms.* (Gonogo.KSP/CommsCoreUplink.cs + GonogoRealAntennasUplink) ──
  "comms.connectivity": CommsConnectivity;
  "comms.signalStrength": CommsSignalStrength;
  "comms.controlState": CommsControlState;
  "comms.path": CommsPath;
  "comms.network": CommsNetwork;
  "comms.delay": CommsDelay;
  "comms.linkQuality": CommsLinkQuality;
  "comms.dataRate": CommsDataRate;
  "comms.linkMargin": CommsLinkMargin;

  // ── kos.* (Gonogo.Kos/KosChannels.cs) ──
  "kos.processors": KosProcessorInfo[];

  // ── payloads NOT YET in Sitrep.Contract → `unknown` (see FOLLOW-UP) ──
  "career.status": unknown; // Sitrep.Host/CareerViewProvider.cs
  "parts.power": unknown; // Sitrep.Host/PartsViewProvider.cs
  "parts.robotics": unknown; // Sitrep.Host/PartsViewProvider.cs
  "system.bodies": unknown; // Sitrep.Host/SystemViewProvider.cs
  "system.vessels": unknown; // Sitrep.Host/SystemViewProvider.cs
  "science.experiments": unknown; // Sitrep.Host/ScienceViewProvider.cs
  "science.lab": unknown; // Sitrep.Host/ScienceViewProvider.cs
  "science.deployed": unknown; // Sitrep.Host/ScienceViewProvider.cs
  "scansat.available": unknown; // GonogoScansatUplink/ScansatUplink.cs
  "scansat.scanningVessels": unknown; // GonogoScansatUplink/ScansatUplink.cs
}

/** Every Topic the mod declares, as a string-literal union. */
export type TopicId = keyof TopicPayloadMap;

/** The payload interface carried by `stream-data` messages on Topic `T`. */
export type TopicPayload<T extends TopicId> = TopicPayloadMap[T];

/**
 * Runtime list of every `TopicId`. Kept in lock-step with `TopicPayloadMap` by the
 * compile-time assertions below, and with the C# declarations by `topics.test.ts`.
 * Dynamic namespaces (e.g. the per-CPU `kos.compute.*` prefix) are intentionally NOT
 * enumerated here — a runtime-computed sub-topic has no fixed member in the union.
 */
export const TOPIC_IDS = [
  "vessel.attitude",
  "vessel.comms",
  "vessel.control",
  "vessel.crew",
  "vessel.dock",
  "vessel.flight",
  "vessel.identity",
  "vessel.maneuver",
  "vessel.orbit",
  "vessel.orbit.truth",
  "vessel.propulsion",
  "vessel.resources",
  "vessel.structure",
  "vessel.surface",
  "vessel.target",
  "vessel.thermal",
  "time.warp",
  "comms.connectivity",
  "comms.signalStrength",
  "comms.controlState",
  "comms.path",
  "comms.network",
  "comms.delay",
  "comms.linkQuality",
  "comms.dataRate",
  "comms.linkMargin",
  "kos.processors",
  "career.status",
  "parts.power",
  "parts.robotics",
  "system.bodies",
  "system.vessels",
  "science.experiments",
  "science.lab",
  "science.deployed",
  "scansat.available",
  "scansat.scanningVessels",
] as const satisfies readonly TopicId[];

const TOPIC_ID_SET: ReadonlySet<string> = new Set(TOPIC_IDS);

/** Runtime narrowing guard: is `value` a declared `TopicId`? */
export function isTopicId(value: string): value is TopicId {
  return TOPIC_ID_SET.has(value);
}

// ── Compile-time invariants (checked by `pnpm typecheck`) ───────────────────────────
// These bind the runtime `TOPIC_IDS` array to the `TopicPayloadMap` type in both
// directions, and prove payload resolution — so a drift between the array and the map,
// or a regression in `TopicPayload`, is a build error, not a silent runtime bug.

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type AssertTrue<T extends true> = T;
type AssertNever<T extends never> = T;

// `TOPIC_IDS` must list exactly the keys of `TopicPayloadMap` (no missing, no extra).
type _MissingFromRuntime = Exclude<TopicId, (typeof TOPIC_IDS)[number]>;
type _ExtraInRuntime = Exclude<(typeof TOPIC_IDS)[number], TopicId>;
export type _AssertNoMissingTopics = AssertNever<_MissingFromRuntime>;
export type _AssertNoExtraTopics = AssertNever<_ExtraInRuntime>;

// A known Topic resolves its precise contract payload.
export type _AssertOrbitResolves = AssertTrue<
  Equal<TopicPayload<"vessel.orbit">, VesselOrbit>
>;
export type _AssertKosProcessorsResolves = AssertTrue<
  Equal<TopicPayload<"kos.processors">, KosProcessorInfo[]>
>;
