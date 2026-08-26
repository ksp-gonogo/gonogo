import type { DerivedChannelDefinition, DerivedGet } from "./timeline-store";

/** The subset of a `dv.stages` wire entry (`Sitrep.Contract.StageDeltaVEntry`) this derivation reads. */
interface StageDeltaVWireEntry {
  stage?: number | null;
  dvActual?: number | null;
  deltaVActual?: number | null;
  dryMass?: number | null;
  fuelMass?: number | null;
}

/** The `vessel.structure` channel payload subset this derivation reads. */
interface VesselStructureWirePayload {
  currentStage?: number | null;
}

/**
 * The four vessel-wide / current-stage ΔV and mass scalars the generic Graph
 * widget's key picker offers as `dv.total` / `dv.current` /
 * `dv.currentFuelMass` / `dv.totalMass`. This channel is their stream home,
 * computed off the same two already-carried raw topics rather than projected
 * out of `dv.stages` by a client-side derived-key registration.
 */
export interface DvLegacyScalars {
  /** Sum of every stage's `deltaVActual`: vessel-total ΔV at the current situation (m/s). */
  total: number;
  /** The active stage's own `deltaVActual` (m/s), or `null` when no stage matches `vessel.structure.currentStage`. */
  current: number | null;
  /** The active stage's own `fuelMass`, or `null` when no stage matches. */
  currentFuelMass: number | null;
  /**
   * Sum of every stage's `dryMass + fuelMass`. `StageDeltaVEntry` carries no
   * `stageMass` field at all (`useVesselDeltaV.ts`'s own doc comment), so the
   * per-stage total is reconstructed from the two fields the wire does carry.
   */
  totalMass: number;
}

function numField(
  entry: Record<string, unknown>,
  ...keys: string[]
): number | null {
  for (const k of keys) {
    const v = entry[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function asStageArray(value: unknown): StageDeltaVWireEntry[] {
  return Array.isArray(value) ? (value as StageDeltaVWireEntry[]) : [];
}

/**
 * `dv.legacyScalars` derivation: see {@link DvLegacyScalars} for what each
 * field means. `undefined` while either input hasn't arrived yet; `null` on
 * a confirmed tombstone of either: same two-input join shape as
 * `dv-stage-resources.ts`'s `currentStageResources`.
 */
export function deriveDvLegacyScalars(
  get: DerivedGet,
): DvLegacyScalars | null | undefined {
  const stagesPoint = get<unknown>("dv.stages");
  if (!stagesPoint) return undefined;
  if (stagesPoint.payload === null) return null;

  const structurePoint = get<VesselStructureWirePayload>("vessel.structure");
  if (!structurePoint) return undefined;
  if (structurePoint.payload === null) return null;

  const stages = asStageArray(stagesPoint.payload);
  const currentStage = structurePoint.payload.currentStage;
  const match =
    typeof currentStage === "number"
      ? stages.find(
          (s) => s && typeof s === "object" && s.stage === currentStage,
        )
      : undefined;

  let total = 0;
  let totalMass = 0;
  for (const stage of stages) {
    if (!stage || typeof stage !== "object") continue;
    const entry = stage as Record<string, unknown>;
    total += numField(entry, "deltaVActual", "dvActual") ?? 0;
    const dry = numField(entry, "dryMass") ?? 0;
    const fuel = numField(entry, "fuelMass") ?? 0;
    totalMass += dry + fuel;
  }

  return {
    total,
    current: match
      ? numField(match as Record<string, unknown>, "deltaVActual", "dvActual")
      : null,
    currentFuelMass: match
      ? numField(match as Record<string, unknown>, "fuelMass")
      : null,
    totalMass,
  };
}

/**
 * Ready-to-register definition: `store.registerDerivedChannel(dvLegacyScalarsChannel)`.
 * `fields: true` exposes `dv.legacyScalars.total` / `.current` /
 * `.currentFuelMass` / `.totalMass`: the targets `map-topic.ts`'s
 * `LEGACY_KEY_HOMES` entries for `dv.total`/`dv.current`/
 * `dv.currentFuelMass`/`dv.totalMass` point at. `deriveStatus` omitted: the
 * default (worst status across `dv.stages` + `vessel.structure`, both
 * genuinely consulted every call) is exactly right, same as
 * `dv-stage-resources.ts`'s channels.
 */
export const dvLegacyScalarsChannel: DerivedChannelDefinition<DvLegacyScalars> =
  {
    topic: "dv.legacyScalars",
    inputs: ["dv.stages", "vessel.structure"],
    derive: deriveDvLegacyScalars,
    fields: true,
  };
