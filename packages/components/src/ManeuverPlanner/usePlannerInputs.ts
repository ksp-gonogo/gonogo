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
  /** Altitude of the circular orbit a capture aims for; null follows the approach periapsis. */
  captureAltitudeKm: number | null;
  /** Whether a capture circularises at that altitude with a second burn. */
  captureCircularise: boolean;
  /** The body a transfer is planned to, by name; empty until one is picked. */
  transferBody: string;
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
  setCaptureAltitudeKm: (n: number | null) => void;
  setCaptureCircularise: (on: boolean) => void;
  setTransferBody: (name: string) => void;
}

/** The per-preset form state; `setPreset` zeroes the Δv inputs when switching to a preset that takes none. */
export function usePlannerInputs(
  config: ManeuverPlannerConfig | undefined,
): PlannerInputsApi {
  const [preset, setPresetState] = useState<PresetId>(
    config?.defaultPreset ?? "circularize-apo",
  );
  const [prograde, setPrograde] = useState(0);
  const [normal, setNormal] = useState(0);
  const [radial, setRadial] = useState(0);
  // Defaults to 60s so the custom-ut preset always has a future UT.
  const [burnInSeconds, setBurnInSeconds] = useState(60);
  // "relative" → burnInSeconds from now; "absolute" → burnAtUT as entered.
  const [utMode, setUtMode] = useState<"relative" | "absolute">("relative");
  const [burnAtUT, setBurnAtUT] = useState(0);
  const [targetInclination, setTargetInclination] = useState(0);
  const [targetAltitudeKm, setTargetAltitudeKm] = useState(100);
  const [standoffMeters, setStandoffMeters] = useState(
    config?.defaultStandoffMeters ?? 500,
  );

  const [captureAltitudeKm, setCaptureAltitudeKm] = useState<number | null>(
    null,
  );
  const [captureCircularise, setCaptureCircularise] = useState(true);

  const [transferBody, setTransferBody] = useState(
    config?.defaultTransferBody ?? "",
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
      captureAltitudeKm,
      captureCircularise,
      transferBody,
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
    setCaptureAltitudeKm,
    setCaptureCircularise,
    setTransferBody,
  };
}
