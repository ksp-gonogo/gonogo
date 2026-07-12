import type { StageInfo } from "@ksp-gonogo/core";
import { registerDerivedKey } from "../derive";

function asStageArray(value: unknown): StageInfo[] | null {
  return Array.isArray(value) ? (value as StageInfo[]) : null;
}

function pickCurrentStage(
  stages: StageInfo[],
  currentStage: unknown,
): StageInfo | null {
  if (typeof currentStage !== "number") return null;
  return stages.find((s) => s.stage === currentStage) ?? null;
}

/**
 * Register the built-in derived keys shipped with @ksp-gonogo/data.
 *
 * Called once from app setup (e.g. packages/app/src/dataSources/buffered.ts).
 * Tests that do not want derived-key side-effects should NOT call this.
 */
export function registerBuiltinDerivedKeys(): void {
  registerDerivedKey({
    id: "v.missionTimeHours",
    inputs: ["v.missionTime"],
    meta: { label: "Mission time (hours)", unit: "hr", group: "State" },
    fn: ([missionTime]) => (missionTime.v as number) / 3600,
  });

  registerDerivedKey({
    id: "v.altitudeRate",
    inputs: ["v.altitude"],
    meta: { label: "Altitude rate", unit: "m/s", group: "Velocity" },
    fn: ([altitude], previous) => {
      if (previous === null) return undefined;
      const dt = (altitude.t - previous[0].t) / 1000;
      if (dt <= 0) return undefined;
      return ((altitude.v as number) - (previous[0].v as number)) / dt;
    },
  });

  // Horizontal velocity in the inertial frame, derived from the orbital
  // speed magnitude and the radial (vertical) component:
  //   v_horizontal = sqrt(v_orbital² - v_vertical²)
  // The OrbitalAscent widget uses this against altitude to plot how far the
  // vessel is from circular-orbit speed at its current radius.
  registerDerivedKey({
    id: "v.horizontalVelocity",
    inputs: ["v.orbitalVelocity", "v.verticalSpeed"],
    meta: { label: "Horizontal velocity", unit: "m/s", group: "Velocity" },
    fn: ([orbital, vertical]) => {
      const vo = orbital.v as number;
      const vv = vertical.v as number;
      if (!Number.isFinite(vo) || !Number.isFinite(vv)) return undefined;
      const sq = vo * vo - vv * vv;
      // Floating-point noise can push this just below zero on a perfectly
      // vertical climb. Clamp rather than producing NaN.
      return Math.sqrt(Math.max(sq, 0));
    },
  });

  // ── Delta-V & mass, projected out of the complex dv.stages array ──────
  // `dv.stages` is a StageInfo[] — great for the FuelStatus widget but
  // unusable as a Graph series. These derived keys expose the scalar
  // rollups most often wanted for plotting: vessel-total ΔV, active-stage
  // ΔV / fuel mass / TWR, and current total vessel mass.

  registerDerivedKey({
    id: "dv.total",
    inputs: ["dv.stages"],
    meta: { label: "Total delta-V", unit: "m/s", group: "Stages" },
    fn: ([stages]) => {
      const arr = asStageArray(stages.v);
      if (!arr) return undefined;
      return arr.reduce((sum, s) => sum + (s.deltaVActual ?? 0), 0);
    },
  });

  registerDerivedKey({
    id: "dv.current",
    inputs: ["dv.stages", "v.currentStage"],
    meta: { label: "Current stage delta-V", unit: "m/s", group: "Stages" },
    fn: ([stages, current]) => {
      const arr = asStageArray(stages.v);
      if (!arr) return undefined;
      return pickCurrentStage(arr, current.v)?.deltaVActual;
    },
  });

  registerDerivedKey({
    id: "dv.currentTWR",
    inputs: ["dv.stages", "v.currentStage"],
    // TWR is dimensionless. Labelling "g" puts it on its own axis group
    // in the graph's auto-axis heuristic, and the legend makes the
    // quantity unambiguous.
    meta: { label: "Current stage TWR", unit: "g", group: "Stages" },
    fn: ([stages, current]) => {
      const arr = asStageArray(stages.v);
      if (!arr) return undefined;
      return pickCurrentStage(arr, current.v)?.TWRActual;
    },
  });

  registerDerivedKey({
    id: "dv.currentFuelMass",
    inputs: ["dv.stages", "v.currentStage"],
    meta: { label: "Current stage fuel mass", unit: "kg", group: "Stages" },
    fn: ([stages, current]) => {
      const arr = asStageArray(stages.v);
      if (!arr) return undefined;
      return pickCurrentStage(arr, current.v)?.fuelMass;
    },
  });

  registerDerivedKey({
    id: "dv.totalMass",
    inputs: ["dv.stages"],
    meta: { label: "Total vessel mass", unit: "kg", group: "Stages" },
    fn: ([stages]) => {
      const arr = asStageArray(stages.v);
      if (!arr) return undefined;
      return arr.reduce((sum, s) => sum + (s.stageMass ?? 0), 0);
    },
  });
}
