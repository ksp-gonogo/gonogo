import type { StageInfo } from "@ksp-gonogo/core";
import { registerDerivedKey } from "@ksp-gonogo/sitrep-sdk";

/** A sample's value when it is a real number, and `undefined` when the stream
 *  carried anything else, so a derived key yields nothing rather than NaN. */
function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

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
    fn: ([missionTime]) => {
      const seconds = asNumber(missionTime.v);
      return seconds === undefined ? undefined : seconds / 3600;
    },
  });

  registerDerivedKey({
    id: "v.altitudeRate",
    inputs: ["v.altitude"],
    meta: { label: "Altitude rate", unit: "m/s", group: "Velocity" },
    fn: ([altitude], previous) => {
      if (previous === null) return undefined;
      const dt = (altitude.t - previous[0].t) / 1000;
      if (dt <= 0) return undefined;
      const now = asNumber(altitude.v);
      const before = asNumber(previous[0].v);
      if (now === undefined || before === undefined) return undefined;
      return (now - before) / dt;
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
      const vo = asNumber(orbital.v);
      const vv = asNumber(vertical.v);
      if (vo === undefined || vv === undefined) return undefined;
      if (!Number.isFinite(vo) || !Number.isFinite(vv)) return undefined;
      const sq = vo * vo - vv * vv;
      // Floating-point noise can push this just below zero on a perfectly
      // vertical climb. Clamp rather than producing NaN.
      return Math.sqrt(Math.max(sq, 0));
    },
  });

  // `dv.stages` is a StageInfo[], great for the FuelStatus widget but unusable
  // as a Graph series, so the active stage's TWR is projected out of it here.
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
}
