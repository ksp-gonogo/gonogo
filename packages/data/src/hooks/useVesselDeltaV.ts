import type { StageInfo } from "@ksp-gonogo/core";
import { useDataValue } from "@ksp-gonogo/core";
import { useMemo } from "react";

export interface VesselDeltaV {
  /** Total ΔV across all stages in vacuum (m/s). */
  totalVac: number;
  /** Total ΔV across all stages at sea level (m/s). */
  totalASL: number;
  /** Per-stage breakdown, in KSP's stage-number order (current stage last). */
  stages: readonly StageInfo[];
}

const EMPTY: VesselDeltaV = {
  totalVac: 0,
  totalASL: 0,
  stages: [],
};

function numField(entry: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = entry[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return 0;
}

/**
 * `dv.stages` is UN-GAPPED (P4a shared-map batch, map-topic.ts's
 * `TELEMACHUS_CLEAN_HOMES` whole-topic identity read) but the two
 * transports don't agree on field names: the legacy Telemachus
 * `DataSource` still ships the historical `StageInfo` camelCase names
 * (`deltaVVac`/`deltaVASL`), while the new mod streams a
 * `StageDeltaVEntry` (mod/sitrep-sdk contract.ts:491) through the
 * identical `dv.stages` topic key using `dvVac`/`dvAsl` instead — and
 * never carries `stageMass`/`isp*`/`TWR*`/`thrust*` at all, none of which
 * this hook's totals need. Normalize each entry so summing works
 * regardless of which wire produced the row. Mirrors FuelStatus's
 * `parseStages` shape-reconciliation (same underlying topic, same
 * rename), duplicated rather than imported because it's the one
 * cross-widget dependency `useVesselDeltaV` would otherwise need.
 */
function normalizeStage(raw: unknown): StageInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  return {
    stage: numField(e, "stage"),
    stageMass: numField(e, "stageMass"),
    dryMass: numField(e, "dryMass"),
    fuelMass: numField(e, "fuelMass"),
    startMass: numField(e, "startMass"),
    endMass: numField(e, "endMass"),
    burnTime: numField(e, "burnTime"),
    deltaVVac: numField(e, "deltaVVac", "dvVac"),
    deltaVASL: numField(e, "deltaVASL", "dvAsl"),
    deltaVActual: numField(e, "deltaVActual", "dvActual"),
    TWRVac: numField(e, "TWRVac", "twrVac"),
    TWRASL: numField(e, "TWRASL", "twrAsl"),
    TWRActual: numField(e, "TWRActual", "twrActual"),
    ispVac: numField(e, "ispVac"),
    ispASL: numField(e, "ispASL"),
    ispActual: numField(e, "ispActual"),
    thrustVac: numField(e, "thrustVac"),
    thrustASL: numField(e, "thrustASL", "thrustAsl"),
    thrustActual: numField(e, "thrustActual"),
  };
}

/**
 * Whole-vessel ΔV summary derived from the `dv.stages` complex object.
 * One subscription, one re-render per broadcast — no per-stage fan-out.
 *
 * Consumers wanting "ΔV available from stage N onwards" can slice the
 * `stages` array themselves; we only expose totals because those are
 * what the maneuver planner's feasibility check needs out of the box.
 */
export function useVesselDeltaV(): VesselDeltaV {
  const raw = useDataValue("data", "dv.stages");
  return useMemo(() => {
    if (!Array.isArray(raw) || raw.length === 0) return EMPTY;
    const stages = raw
      .map(normalizeStage)
      .filter((s): s is StageInfo => s !== null);
    let totalVac = 0;
    let totalASL = 0;
    for (const s of stages) {
      totalVac += s.deltaVVac;
      totalASL += s.deltaVASL;
    }
    return { totalVac, totalASL, stages };
  }, [raw]);
}
