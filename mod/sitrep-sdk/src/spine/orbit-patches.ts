/**
 * The vessel's future-orbit patch chain (`vessel.orbit.patches` / each
 * `vessel.maneuver.nodes[].patches`, `mod/Sitrep.Contract/OrbitPatch.cs`):
 * reshaped into the legacy `OrbitPatch` shape MapView/
 * `packages/core/src/calc/trajectory.ts` already consume (`o.orbitPatches`,
 * `ManeuverNode.orbitPatches`). The impact walk over the same chain is
 * `impact-point.ts`'s.
 */

/**
 * Wire shape of one `OrbitPatch` entry (mirrors `mod/Sitrep.Contract/
 * OrbitPatch.cs`). Hand-mirrored, same convention as `VesselOrbitPayload`
 * in `wire-payloads.ts`: not (yet) generated into this package.
 */
import { TransitionType } from "../__generated__/contract";
import { namesOf } from "../enum-names";
import type { Value } from "../value";

export interface OrbitPatchWirePayload {
  sma: Value<"m">;
  ecc: Value<"1">;
  inc: Value<"°">;
  lan: Value<"°">;
  argPe: Value<"°">;
  meanAnomalyAtEpoch: Value<"rad">;
  epoch: Value<"ut">;
  period: Value<"s">;
  startUt: Value<"ut">;
  endUt: Value<"ut">;
  /** Raw `Sitrep.Contract.TransitionType` ordinal: see `transitionName`. */
  patchStartTransition: number;
  patchEndTransition: number;
  peA: Value<"m">;
  apA: Value<"m">;
  semiLatusRectum: Value<"m">;
  semiMinorAxis: Value<"m">;
  referenceBody: string;
  closestEncounterBody?: string | null;
  /**
   * Parent body's GM, so a patch propagates from what it carries with no
   * `system.bodies` join. Absent only on a recording captured before the field
   * existed; see `OrbitPatch.cs`.
   */
  mu?: Value<"m³/s²"> | null;
  /** Body identity, where `referenceBody` is the display name. Absent on a pre-existing recording. */
  referenceBodyIndex?: number | null;
  /** `closestEncounterBody`'s index. Absent when there is no encounter, and on a pre-existing recording. */
  closestEncounterBodyIndex?: number | null;
}

/**
 * The legacy `o.orbitPatches`/`ManeuverNode.orbitPatches` shape
 * (`@ksp-gonogo/core`'s `OrbitPatch`, `packages/core/src/schemas/
 * orbit.ts`): re-declared HERE, structurally identical but not
 * imported, because `sitrep-client` cannot depend on `@ksp-gonogo/core`
 * (the dependency points the other way: core depends on sitrep-client; see
 * `core`'s `package.json`). TypeScript's structural typing makes the two
 * interchangeable at every call site that matters (`@ksp-gonogo/core`'s
 * `predictGroundTrack` accepts this shape with no cast needed).
 */
export interface LegacyOrbitPatch {
  startUT: number;
  endUT: number;
  patchStartTransition: TransitionName;
  patchEndTransition: TransitionName;
  PeA: number;
  ApA: number;
  inclination: number;
  eccentricity: number;
  epoch: number;
  period: number;
  argumentOfPeriapsis: number;
  sma: number;
  lan: number;
  maae: number;
  referenceBody: string;
  semiLatusRectum: number;
  semiMinorAxis: number;
  closestEncounterBody: string | null;
}

/**
 * `Sitrep.Contract.TransitionType` ordinal → the uppercase name legacy
 * the legacy formatter used (`packages/core/src/
 * schemas/orbit.ts`'s `OrbitPatch.patchStartTransition` doc comment).
 * Declaration order matches `mod/Sitrep.Contract/VesselEnums.cs`'s
 * `TransitionType` (Initial/Final/Encounter/Escape/Maneuver/Collision/
 * Unknown): same ordinal-table pattern as `contract-enum-names.ts`'s
 * `SITUATION_NAMES`/`SAS_MODE_NAMES`. KSP's OWN enum spells the impact case
 * "IMPACT"; `Gonogo.KSP.KspHost.BuildOrbitPatchChain` already translates
 * that to "COLLISION" before it reaches the wire, so this table only ever
 * needs the `TransitionType` spelling.
 */
export const TRANSITION_TYPE_NAMES: readonly string[] = namesOf(
  TransitionType,
).map((name) => name.toUpperCase());

/**
 * The closed set of names {@link TRANSITION_TYPE_NAMES} can produce, derived
 * from the generated enum rather than written out.
 *
 * Derived so that a member appended in C# widens this union on the next
 * codegen, which turns any exhaustive `switch` over a transition into a compile
 * error until somebody rules on the new member. A hand-written union would do
 * the opposite: it would stay closed around the old members and let the new one
 * fall through whichever default arm happened to be there.
 */
export type TransitionName = Uppercase<keyof typeof TransitionType>;

function transitionName(ordinal: number): TransitionName {
  return (TRANSITION_TYPE_NAMES[ordinal] ?? "UNKNOWN") as TransitionName;
}

/**
 * Reshapes one wire `OrbitPatch` into the legacy shape the ground-track
 * prediction and the map overlay already consume unchanged: a pure field
 * rename/passthrough, no lookup needed: `referenceBody`/`closestEncounterBody`
 * are already body NAME strings on the wire (see `OrbitPatch.cs`'s doc comment
 * for why), unlike most of this codebase's index-based body references.
 *
 * `mu` and the body indexes are deliberately NOT carried through. This is the
 * legacy shape and those fields never existed in it; a consumer
 * that wants them reads the wire payload, which is where they live.
 */
export function mapOrbitPatch(wire: OrbitPatchWirePayload): LegacyOrbitPatch {
  return {
    startUT: wire.startUt.magnitude,
    endUT: wire.endUt.magnitude,
    patchStartTransition: transitionName(wire.patchStartTransition),
    patchEndTransition: transitionName(wire.patchEndTransition),
    PeA: wire.peA.magnitude,
    ApA: wire.apA.magnitude,
    inclination: wire.inc.magnitude,
    eccentricity: wire.ecc.magnitude,
    epoch: wire.epoch.magnitude,
    period: wire.period.magnitude,
    argumentOfPeriapsis: wire.argPe.magnitude,
    sma: wire.sma.magnitude,
    lan: wire.lan.magnitude,
    maae: wire.meanAnomalyAtEpoch.magnitude,
    referenceBody: wire.referenceBody,
    semiLatusRectum: wire.semiLatusRectum.magnitude,
    semiMinorAxis: wire.semiMinorAxis.magnitude,
    closestEncounterBody: wire.closestEncounterBody ?? null,
  };
}
