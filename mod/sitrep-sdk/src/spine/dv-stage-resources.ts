import { isValue } from "../unit-system/value";
import type { Value } from "../value";
import { CORE_UPLINK_CLIENT } from "./uplink-clients";

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
 * `vessel.structure.currentStage` and returns its raw `resources` map. With no
 * such entry the nearest lower stage's map stands in; `{}` when there is none,
 * or the chosen stage carries none. `dv.stages`
 * already carries a per-STAGE resource breakdown
 * (`Gonogo.KSP.KspHost.BuildStageResources`); this derivation exists purely to
 * pick out the one entry the old `r.resourceCurrent[X]`/
 * `r.resourceCurrentMax[X]` pair meant ("the currently active stage"), since a
 * raw-field-subtopic string can't express a dynamic array lookup keyed by
 * another topic's live value: the lookup has to happen here, in a real
 * processor, not as a static field path in `map-topic.ts`.
 *
 * `undefined` while `dv.stages` or `vessel.structure` hasn't arrived
 * (propagated from whichever input isn't whole yet); `null` when either is a
 * confirmed tombstone. Never throws.
 */
function currentStageResources(
  stagesPayload: readonly StageDeltaVWireEntry[] | null | undefined,
  structure: VesselStructureWirePayload | null | undefined,
):
  | Record<string, StageResourceWireEntry | null | undefined>
  | null
  | undefined {
  if (stagesPayload === undefined) return undefined;
  if (stagesPayload === null) return null;

  if (structure === undefined) return undefined;
  if (structure === null) return null;

  const currentStage = structure.currentStage;
  if (typeof currentStage !== "number") return {};

  const stages = Array.isArray(stagesPayload) ? stagesPayload : [];
  const entries = stages.filter(
    (s): s is StageDeltaVWireEntry & { stage: number } =>
      !!s && typeof s === "object" && typeof s.stage === "number",
  );
  /*
   * A current stage with no delta-v entry (a vessel not yet staged past its
   * last stage) holds the resources of the nearest stage below it.
   */
  const match =
    entries.find((s) => s.stage === currentStage) ??
    entries
      .filter((s) => s.stage < currentStage)
      .sort((a, b) => b.stage - a.stage)[0];

  return match?.resources && typeof match.resources === "object"
    ? match.resources
    : {};
}

/**
 * The current amount of each resource in the active stage, keyed by resource
 * name, worked out for the `dv.currentStageResource` Topic. Useful for showing
 * the operator what the stage has left to burn. Used by
 * {@link DV_CURRENT_STAGE_RESOURCE}.
 *
 * An entry whose `current` is not a finite number is left out, never replaced
 * by a `0`.
 */
export function deriveCurrentStageResourceCurrent(
  stages: readonly StageDeltaVWireEntry[] | null | undefined,
  structure: VesselStructureWirePayload | null | undefined,
): ResourceAmountMap | null | undefined {
  const resources = currentStageResources(stages, structure);
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
 * name, worked out for the `dv.currentStageResourceMax` Topic. Useful for showing
 * the operator how full the stage's tanks were. Used by
 * {@link DV_CURRENT_STAGE_RESOURCE_MAX}.
 *
 * An entry whose `max` is not a finite number is left out, as in
 * {@link deriveCurrentStageResourceCurrent}.
 */
export function deriveCurrentStageResourceMax(
  stages: readonly StageDeltaVWireEntry[] | null | undefined,
  structure: VesselStructureWirePayload | null | undefined,
): ResourceAmountMap | null | undefined {
  const resources = currentStageResources(stages, structure);
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
 * The processor published as `dv.currentStageResource`. Useful for showing the
 * operator the resources of the active stage. `fields` exposes
 * `dv.currentStageResource.<name>` for each resource. Its status is the worst
 * across `dv.stages` and `vessel.structure`.
 */
export const DV_CURRENT_STAGE_RESOURCE = CORE_UPLINK_CLIENT.registerProcessor({
  id: "dv-current-stage-resource",
  topic: "dv.currentStageResource",
  fields: true,
  deps: ["dv.stages", "vessel.structure"],
  compute: ([stages, structure]) =>
    deriveCurrentStageResourceCurrent(stages, structure),
});

/** The processor published as `dv.currentStageResourceMax`, the maximum amounts beside {@link DV_CURRENT_STAGE_RESOURCE}. */
export const DV_CURRENT_STAGE_RESOURCE_MAX =
  CORE_UPLINK_CLIENT.registerProcessor({
    id: "dv-current-stage-resource-max",
    topic: "dv.currentStageResourceMax",
    fields: true,
    deps: ["dv.stages", "vessel.structure"],
    compute: ([stages, structure]) =>
      deriveCurrentStageResourceMax(stages, structure),
  });
