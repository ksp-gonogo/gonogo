import { useCallback, useState } from "react";
import { type ManeuverPlannerConfig, PRESETS, type PresetId } from "./presets";

/** Mutable inputs that drive the preset math + the per-preset UI. */
export interface PlannerInputs {
  preset: PresetId;
  prograde: number;
  normal: number;
  radial: number;
  burnInSeconds: number;
  utMode: "relative" | "absolute";
  burnAtUT: number;
  targetInclination: number;
  targetAltitudeKm: number;
  standoffMeters: number;
}

export interface PlannerInputsApi {
  inputs: PlannerInputs;
  setPreset: (next: PresetId) => void;
  setPrograde: (n: number) => void;
  setNormal: (n: number) => void;
  setRadial: (n: number) => void;
  setBurnInSeconds: (n: number) => void;
  setUtMode: (m: "relative" | "absolute") => void;
  setBurnAtUT: (n: number) => void;
  setTargetInclination: (n: number) => void;
  setTargetAltitudeKm: (n: number) => void;
  setStandoffMeters: (n: number) => void;
}

/**
 * Consolidates the 10 setter pairs that drive the per-preset form. The
 * `setPreset` returned here also resets prograde/normal/radial to 0 when
 * switching to a preset that doesn't take custom Δv inputs — preserves the
 * pre-extraction behaviour from `renderNewManeuverSection`.
 */
export function usePlannerInputs(
  config: ManeuverPlannerConfig | undefined,
): PlannerInputsApi {
  const [preset, setPresetState] = useState<PresetId>(
    config?.defaultPreset ?? "circularize-apo",
  );
  const [prograde, setPrograde] = useState(0);
  const [normal, setNormal] = useState(0);
  const [radial, setRadial] = useState(0);
  // "Burn in N seconds" input for the custom-ut preset. Default 60s so the
  // UI always has a sensible future UT even before the user touches it.
  const [burnInSeconds, setBurnInSeconds] = useState(60);
  // "relative" → burnInSeconds from now; "absolute" → burnAtUT as entered.
  const [utMode, setUtMode] = useState<"relative" | "absolute">("relative");
  const [burnAtUT, setBurnAtUT] = useState(0);
  const [targetInclination, setTargetInclination] = useState(0);
  const [targetAltitudeKm, setTargetAltitudeKm] = useState(100);
  const [standoffMeters, setStandoffMeters] = useState(
    config?.defaultStandoffMeters ?? 500,
  );

  const setPreset = useCallback((next: PresetId) => {
    setPresetState(next);
    if (!PRESETS.find((p) => p.id === next)?.needsCustomInput) {
      setPrograde(0);
      setNormal(0);
      setRadial(0);
    }
  }, []);

  return {
    inputs: {
      preset,
      prograde,
      normal,
      radial,
      burnInSeconds,
      utMode,
      burnAtUT,
      targetInclination,
      targetAltitudeKm,
      standoffMeters,
    },
    setPreset,
    setPrograde,
    setNormal,
    setRadial,
    setBurnInSeconds,
    setUtMode,
    setBurnAtUT,
    setTargetInclination,
    setTargetAltitudeKm,
    setStandoffMeters,
  };
}
