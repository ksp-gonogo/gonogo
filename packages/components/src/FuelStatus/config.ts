export type DeltaVMode = "vac" | "actual" | "asl";

export interface FuelStatusConfig {
  /** Which ΔV / TWR column to show: "actual" (current atmosphere, the default), "vac" for reference, "asl" for ascent planning. */
  deltaVMode?: DeltaVMode;
}

export const DELTA_V_MODE_LABELS: Record<DeltaVMode, string> = {
  actual: "Current atmosphere",
  vac: "Vacuum",
  asl: "Sea level",
};

export const DELTA_V_MODE_SHORT: Record<DeltaVMode, string> = {
  actual: "ACT",
  vac: "VAC",
  asl: "ASL",
};
