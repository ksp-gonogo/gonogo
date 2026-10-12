import { isValue } from "../unit-system/value";
import type { Value } from "../value";
import type { DerivedChannelDefinition, DerivedGet } from "./timeline-store";

/**
 * One resource's current/max amounts on the `dv.stages` wire array (mirrors
 * `Sitrep.Contract.ResourceAmount`'s shape). Both amounts are `Value<"units">`
 * on the wire: KSP's resource unit, not kilograms.
 */
interface StageResourceWireEntry {
  current?: Value<"units"> | null;
  max?: Value<"units"> | null;
}

/** The subset of a `dv.stages` wire entry (`Sitrep.Contract.StageDeltaVEntry`) this derivation reads. */
interface StageDeltaVWireEntry {
  stage?: number | null;
  resources?: Record<string, StageResourceWireEntry | null | undefined> | null;
}

/** The `vessel.structure` channel payload subset this derivation reads. */
interface VesselStructureWirePayload {
  currentStage?: number | null;
}

/**
 * The amount of each resource in the active stage, keyed by resource name, as
 * either the current or the maximum amount. Useful for showing the operator how
 * much of each resource the stage holds. Returned by
 * `deriveCurrentStageResourceCurrent` and `deriveCurrentStageResourceMax`, and
 * read by the fuel status widget.
 */
export type ResourceAmountMap = Record<string, Value<"units">>;

/**
 * Shared lookup behind both `dv.currentStageResource`/`dv.currentStageResourceMax`:
 * finds the `dv.stages` entry whose `stage` field equals
 * `vessel.structure.currentStage` and returns its raw `resources` map (or `{}`
 * when no stage matches, or the matching stage carries none). `dv.stages`
 * already carries a per-STAGE resource breakdown
 * (`Gonogo.KSP.KspHost.BuildStageResources`); this derivation exists purely to
 * pick out the one entry the legacy `r.resourceCurrent[X]`/
 * `r.resourceCurrentMax[X]` pair meant ("the currently active stage"), since a
 * raw-field-subtopic string can't express a dynamic array lookup keyed by
 * another topic's live value: the lookup has to happen here, in a real
 * `derive()` function, not as a static field path in `map-topic.ts`.
 *
 * `undefined` while `dv.stages` or `vessel.structure` hasn't arrived
 * (propagated from whichever input isn't whole yet); `null` when either is a
 * confirmed tombstone. Never throws.
 */
function currentStageResources(
  get: DerivedGet,
):
  | Record<string, StageResourceWireEntry | null | undefined>
  | null
  | undefined {
  const stagesPoint = get<StageDeltaVWireEntry[]>("dv.stages");
  if (!stagesPoint) return undefined;
  if (stagesPoint.payload === null) return null;

  const structurePoint = get<VesselStructureWirePayload>("vessel.structure");
  if (!structurePoint) return undefined;
  if (structurePoint.payload === null) return null;

  const currentStage = structurePoint.payload.currentStage;
  if (typeof currentStage !== "number") return {};

  const stages = Array.isArray(stagesPoint.payload) ? stagesPoint.payload : [];
  const match = stages.find(
    (s) => s && typeof s === "object" && s.stage === currentStage,
  );

  return match?.resources && typeof match.resources === "object"
    ? match.resources
    : {};
}

/**
 * The current amount of each resource in the active stage, keyed by resource
 * name, derived for the `dv.currentStageResource` channel. Useful for showing
 * the operator what the stage has left to burn. Used by
 * `dvCurrentStageResourceChannel`.
 *
 * An entry whose `current` is not a finite number is left out, never replaced
 * by a `0`.
 */
export function deriveCurrentStageResourceCurrent(
  get: DerivedGet,
): ResourceAmountMap | null | undefined {
  const resources = currentStageResources(get);
  if (resources === undefined || resources === null) return resources;

  const out: ResourceAmountMap = {};
  for (const [name, amount] of Object.entries(resources)) {
    if (amount && isValue(amount.current)) {
      out[name] = amount.current;
    }
  }
  return out;
}

/**
 * The maximum amount of each resource in the active stage, keyed by resource
 * name, derived for the `dv.currentStageResourceMax` channel. Useful for showing
 * the operator how full the stage's tanks were. Used by
 * `dvCurrentStageResourceChannel`.
 *
 * An entry whose `max` is not a finite number is left out, as in
 * {@link deriveCurrentStageResourceCurrent}.
 */
export function deriveCurrentStageResourceMax(
  get: DerivedGet,
): ResourceAmountMap | null | undefined {
  const resources = currentStageResources(get);
  if (resources === undefined || resources === null) return resources;

  const out: ResourceAmountMap = {};
  for (const [name, amount] of Object.entries(resources)) {
    if (amount && isValue(amount.max)) {
      out[name] = amount.max;
    }
  }
  return out;
}

/**
 * The derived channel for `dv.currentStageResource`, ready to register with
 * `store.registerDerivedChannel`. Useful for showing the operator the resources
 * of the active stage. Registered on the default store of `TelemetryProvider`
 * through `PRODUCTION_DERIVED_CHANNELS`.
 *
 * Its `fields: true` exposes `dv.currentStageResource.<name>` for each
 * resource. The channel's status is the worst across `dv.stages` and
 * `vessel.structure`, both of which are read on every call.
 */
export const dvCurrentStageResourceChannel: DerivedChannelDefinition<ResourceAmountMap> =
  {
    topic: "dv.currentStageResource",
    inputs: ["dv.stages", "vessel.structure"],
    derive: deriveCurrentStageResourceCurrent,
    fields: true,
  };

export const dvCurrentStageResourceMaxChannel: DerivedChannelDefinition<ResourceAmountMap> =
  {
    topic: "dv.currentStageResourceMax",
    inputs: ["dv.stages", "vessel.structure"],
    derive: deriveCurrentStageResourceMax,
    fields: true,
  };
