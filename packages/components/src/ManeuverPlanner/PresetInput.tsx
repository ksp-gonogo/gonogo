import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  LabeledInput,
  NULL_DISPLAY,
  Stack,
  ToggleButton,
  Unit,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { PresetPicker } from "./PresetPicker";
import { computeRelInc } from "./planning";
import { PRESETS } from "./presets";
import type { PlannerInputsApi } from "./usePlannerInputs";

interface PresetInputProps {
  api: PlannerInputsApi;
  /** Live telemetry values used by `match-target-*` and `hohmann-rendezvous-target`
   *  description rows. Passed through unchanged from the orchestrator so this
   *  component stays pure-presentational (no `useDataValue` calls of its own). */
  telemetry: {
    currentUT: number | undefined;
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
        <LabeledInput
          label="Target inc"
          value={inputs.targetInclination}
          onChange={setTargetInclination}
          suffix="°"
        />
      </Stack>
    );
  }
  if (inputs.preset === "hohmann-to-altitude") {
    return (
      <Stack style={CUSTOM_INPUTS_STYLE}>
        <LabeledInput
          label="Target alt"
          value={inputs.targetAltitudeKm}
          onChange={setTargetAltitudeKm}
          suffix="km"
        />
      </Stack>
    );
  }
  if (inputs.preset === "hohmann-rendezvous-target") {
    return (
      <Stack style={CUSTOM_INPUTS_STYLE}>
        <LabeledInput
          label="Standoff"
          value={inputs.standoffMeters}
          onChange={setStandoffMeters}
          suffix="m"
        />
      </Stack>
    );
  }
  return (
    <Stack style={CUSTOM_INPUTS_STYLE}>
      {inputs.preset === "custom-ut" && (
        <UtModeInputs api={api} currentUT={telemetry.currentUT} />
      )}
      <LabeledInput
        label="Prograde"
        value={inputs.prograde}
        onChange={setPrograde}
      />
      <LabeledInput label="Normal" value={inputs.normal} onChange={setNormal} />
      <LabeledInput label="Radial" value={inputs.radial} onChange={setRadial} />
    </Stack>
  );
}

interface UtModeInputsProps {
  api: PlannerInputsApi;
  currentUT: number | undefined;
}

function UtModeInputs({ api, currentUT }: UtModeInputsProps) {
  const { inputs, setUtMode, setBurnAtUT, setBurnInSeconds } = api;
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
            // Seed the absolute field with "now + 60s" the first time
            // the user flips modes, so they don't see a 0.
            if (inputs.burnAtUT === 0 && currentUT !== undefined) {
              setBurnAtUT(currentUT + 60);
            }
            setUtMode("absolute");
          }}
        >
          at UT
        </ToggleButton>
      </div>
      {inputs.utMode === "relative" ? (
        <LabeledInput
          label="Burn in"
          value={inputs.burnInSeconds}
          onChange={setBurnInSeconds}
          suffix="s"
        />
      ) : (
        <LabeledInput
          label="At UT"
          value={inputs.burnAtUT}
          onChange={setBurnAtUT}
          suffix=""
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

/** Stack carries the column; the gap is named rather than sized so the surface
 *  around these inputs can retune it, and the seam above them is set here. */
const CUSTOM_INPUTS_STYLE = {
  gap: "var(--gap-related)",
  paddingTop: "var(--gap-planner-section)",
} as const;

const UT_MODE_ROW_STYLE = {
  display: "flex",
  gap: "var(--gap-related)",
} as const;
