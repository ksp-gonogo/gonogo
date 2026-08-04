import type { Value } from "@ksp-gonogo/sitrep-sdk";
import { isValue } from "@ksp-gonogo/sitrep-sdk";
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

/** A resource-name-keyed map of a single amount (current OR max). */
export type ResourceAmountMap = Record<string, Value<"units">>;

/**
 * Shared lookup behind both `dv.currentStageResource`/`dv.currentStageResourceMax`:
 * finds the `dv.stages` entry whose `stage` field equals
 * `vessel.structure.currentStage` and returns its raw `resources` map (or `{}`
 * when no stage matches, or the matching stage carries none). `dv.stages`
 * already carries a per-STAGE resource breakdown
 * (`Gonogo.KSP.KspHost.BuildStageResources`); this derivation exists purely to
 * pick out the ONE entry the old Telemachus `r.resourceCurrent[X]`/
 * `r.resourceCurrentMax[X]` pair meant ("the currently active stage"), since a
 * raw-field-subtopic string can't express a dynamic array lookup keyed by
 * another topic's live value: the lookup has to happen here, in a real
 * `derive()` function, not as a static field path in `map-topic.ts`.
 *
 * `undefined` while `dv.stages` OR `vessel.structure` hasn't arrived
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
 * `dv.currentStageResource` derivation: the CURRENT amount per resource name
 * for the active stage, behind the old Telemachus `r.resourceCurrent[X]`.
 * Entries whose `current` isn't a finite number are omitted (same
 * "absent, not fabricated" discipline every other raw-dict reader in this
 * codebase follows), never a `0` standing in for "not reported".
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
 * `dv.currentStageResourceMax` derivation: the MAX amount per resource name
 * for the active stage, behind the old Telemachus `r.resourceCurrentMax[X]`.
 * Same omission discipline as {@link deriveCurrentStageResourceCurrent}.
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
 * Ready-to-register definitions:
 * `store.registerDerivedChannel(dvCurrentStageResourceChannel)` /
 * `...(dvCurrentStageResourceMaxChannel)`. `fields: true` on each exposes
 * `dv.currentStageResource.<name>` / `dv.currentStageResourceMax.<name>`: the
 * targets `map-topic.ts`'s `RESOURCE_STAGE_SCOPED` resolution points at.
 * `deriveStatus` omitted: the default (worst status across `dv.stages` +
 * `vessel.structure`, both genuinely consulted every call) is exactly right.
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
