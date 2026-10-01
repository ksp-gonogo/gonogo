import { type Value, value } from "@ksp-gonogo/sitrep-sdk";
import {
  NULL_DISPLAY,
  Stack,
  ToggleButton,
  Unit,
  UnitInput,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { PresetPicker } from "./PresetPicker";
import { computeRelInc } from "./planning";
import { PRESETS } from "./presets";
import type { PlannerInputsApi } from "./usePlannerInputs";

interface PresetInputProps {
  api: PlannerInputsApi;
  /** Live values for the target-matching presets' description rows, passed in so this stays presentational. */
  telemetry: {
    currentUT: Value<"ut"> | undefined;
    inclination: number | undefined;
    lan: number | undefined;
    targetName: string | undefined;
    targetInclinationLive: number | undefined;
    targetLanLive: number | undefined;
    targetPeA: number | undefined;
  };
}

export function PresetInput({ api, telemetry }: PresetInputProps) {
  const { inputs, setPreset } = api;
  const selectedPreset = PRESETS.find((p) => p.id === inputs.preset);
  return (
    <>
      <PresetPicker value={inputs.preset} onChange={setPreset} />
      {selectedPreset?.description && (
        <div style={PRESET_DESC_STYLE}>{selectedPreset.description}</div>
      )}
      <PresetCustomInputs api={api} telemetry={telemetry} />
      <PresetTargetDescription api={api} telemetry={telemetry} />
    </>
  );
}

function PresetCustomInputs({ api, telemetry }: PresetInputProps) {
  const {
    inputs,
    setPrograde,
    setNormal,
    setRadial,
    setTargetInclination,
    setTargetAltitudeKm,
    setStandoffMeters,
  } = api;
  const selectedPreset = PRESETS.find((p) => p.id === inputs.preset);
  if (!selectedPreset?.needsCustomInput) return null;
  if (inputs.preset === "match-inclination") {
    return (
      <Stack style={CUSTOM_INPUTS_STYLE}>
        <UnitInput
          label="Target inc"
          unit="°"
          value={value("°", inputs.targetInclination)}
          onChange={(next) => setTargetInclination(next.magnitude)}
        />
      </Stack>
    );
  }
  if (inputs.preset === "hohmann-to-altitude") {
    return (
      <Stack style={CUSTOM_INPUTS_STYLE}>
        <UnitInput
          label="Target alt"
          unit="km"
          value={value("km", inputs.targetAltitudeKm)}
          onChange={(next) => setTargetAltitudeKm(next.magnitude)}
        />
      </Stack>
    );
  }
  if (inputs.preset === "hohmann-rendezvous-target") {
    return (
      <Stack style={CUSTOM_INPUTS_STYLE}>
        <UnitInput
          label="Standoff"
          unit="m"
          value={value("m", inputs.standoffMeters)}
          onChange={(next) => setStandoffMeters(next.magnitude)}
        />
      </Stack>
    );
  }
  return (
    <Stack style={CUSTOM_INPUTS_STYLE}>
      {inputs.preset === "custom-ut" && (
        <UtModeInputs api={api} currentUT={telemetry.currentUT} />
      )}
      <UnitInput
        label="Prograde"
        unit="m/s"
        value={value("m/s", inputs.prograde)}
        onChange={(next) => setPrograde(next.magnitude)}
      />
      <UnitInput
        label="Normal"
        unit="m/s"
        value={value("m/s", inputs.normal)}
        onChange={(next) => setNormal(next.magnitude)}
      />
      <UnitInput
        label="Radial"
        unit="m/s"
        value={value("m/s", inputs.radial)}
        onChange={(next) => setRadial(next.magnitude)}
      />
    </Stack>
  );
}

interface UtModeInputsProps {
  api: PlannerInputsApi;
  currentUT: Value<"ut"> | undefined;
}

function UtModeInputs({ api, currentUT }: UtModeInputsProps) {
  const { inputs, setUtMode, setBurnAtUT, setBurnInSeconds } = api;
  // The form holds the instant as plain seconds, so it can be frozen into a trigger and sent to another screen.
  const enterBurnAt = (instant: Value<"ut">) => setBurnAtUT(instant.magnitude);
  return (
    <>
      <div style={UT_MODE_ROW_STYLE}>
        <ToggleButton
          size="md"
          active={inputs.utMode === "relative"}
          type="button"
          onClick={() => setUtMode("relative")}
        >
          burn in
        </ToggleButton>
        <ToggleButton
          size="md"
          active={inputs.utMode === "absolute"}
          type="button"
          onClick={() => {
            // Seed the absolute field with "now + 60s" the first time the user flips modes, so they don't see a 0.
            if (inputs.burnAtUT === 0 && currentUT !== undefined) {
              enterBurnAt(currentUT.plus(value("s", 60)));
            }
            setUtMode("absolute");
          }}
        >
          at UT
        </ToggleButton>
      </div>
      {inputs.utMode === "relative" ? (
        <UnitInput
          label="Burn in"
          unit="s"
          value={value("s", inputs.burnInSeconds)}
          onChange={(next) => setBurnInSeconds(next.magnitude)}
        />
      ) : (
        <UnitInput
          label="At UT"
          unit="ut"
          value={value("ut", inputs.burnAtUT)}
          onChange={enterBurnAt}
        />
      )}
    </>
  );
}

function PresetTargetDescription({ api, telemetry }: PresetInputProps) {
  const { inputs } = api;
  const {
    inclination,
    lan,
    targetName,
    targetInclinationLive,
    targetLanLive,
    targetPeA,
  } = telemetry;
  if (inputs.preset === "match-target-inclination") {
    return (
      <div style={PRESET_DESC_STYLE}>
        {targetName
          ? `Target: ${targetName} (${writeQuantity(value("°", targetInclinationLive ?? 0), { decimals: 1 })})`
          : "No target selected in-game."}
      </div>
    );
  }
  if (inputs.preset === "match-target-plane") {
    return (
      <div style={PRESET_DESC_STYLE}>
        {targetName && targetLanLive !== undefined
          ? `Target: ${targetName}, i=${writeQuantity(value("°", targetInclinationLive ?? 0), { decimals: 1 })} Ω=${writeQuantity(value("°", targetLanLive), { decimals: 1 })}`
          : "No target selected in-game (or target LAN unavailable)."}
      </div>
    );
  }
  if (inputs.preset === "hohmann-rendezvous-target") {
    if (!targetName) {
      return <div style={PRESET_DESC_STYLE}>No target selected in-game.</div>;
    }
    const planeMismatch = computeRelInc(
      inclination,
      lan,
      targetInclinationLive,
      targetLanLive,
    );
    return (
      <div style={PRESET_DESC_STYLE}>
        Target: {targetName}, PeA{" "}
        {targetPeA === undefined
          ? NULL_DISPLAY
          : writeQuantity(value("m", targetPeA), { decimals: 1 })}
        , i=
        <Unit value={value("°", targetInclinationLive ?? 0)} decimals={1} />,
        Δplane=
        {planeMismatch === null ? (
          NULL_DISPLAY
        ) : (
          <Unit value={value("°", planeMismatch)} decimals={1} />
        )}
        {planeMismatch !== null && planeMismatch > 0.5
          ? " (plane match prepended)"
          : ""}
      </div>
    );
  }
  return null;
}

const PRESET_DESC_STYLE = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-dim)",
  paddingTop: "var(--gap-caption)",
} as const;

/** The gap is named, not sized, so the surrounding surface can retune it. */
const CUSTOM_INPUTS_STYLE = {
  gap: "var(--gap-related)",
  paddingTop: "var(--gap-planner-section)",
} as const;

const UT_MODE_ROW_STYLE = {
  display: "flex",
  gap: "var(--gap-related)",
} as const;
