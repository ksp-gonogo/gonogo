import styled from "styled-components";
import { LabeledInput } from "./LabeledInput";
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
        <PresetDesc>{selectedPreset.description}</PresetDesc>
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
      <CustomInputs>
        <LabeledInput
          label="Target inc"
          value={inputs.targetInclination}
          onChange={setTargetInclination}
          suffix="°"
        />
      </CustomInputs>
    );
  }
  if (inputs.preset === "hohmann-to-altitude") {
    return (
      <CustomInputs>
        <LabeledInput
          label="Target alt"
          value={inputs.targetAltitudeKm}
          onChange={setTargetAltitudeKm}
          suffix="km"
        />
      </CustomInputs>
    );
  }
  if (inputs.preset === "hohmann-rendezvous-target") {
    return (
      <CustomInputs>
        <LabeledInput
          label="Standoff"
          value={inputs.standoffMeters}
          onChange={setStandoffMeters}
          suffix="m"
        />
      </CustomInputs>
    );
  }
  return (
    <CustomInputs>
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
    </CustomInputs>
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
      <UTModeRow>
        <UTModeButton
          $active={inputs.utMode === "relative"}
          type="button"
          onClick={() => setUtMode("relative")}
        >
          burn in
        </UTModeButton>
        <UTModeButton
          $active={inputs.utMode === "absolute"}
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
        </UTModeButton>
      </UTModeRow>
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
      <PresetDesc>
        {targetName
          ? `Target: ${targetName} (${(targetInclinationLive ?? 0).toFixed(1)}°)`
          : "No target selected in-game."}
      </PresetDesc>
    );
  }
  if (inputs.preset === "match-target-plane") {
    return (
      <PresetDesc>
        {targetName && targetLanLive !== undefined
          ? `Target: ${targetName} — i=${(targetInclinationLive ?? 0).toFixed(1)}° Ω=${targetLanLive.toFixed(1)}°`
          : "No target selected in-game (or target LAN unavailable)."}
      </PresetDesc>
    );
  }
  if (inputs.preset === "hohmann-rendezvous-target") {
    if (!targetName) {
      return <PresetDesc>No target selected in-game.</PresetDesc>;
    }
    const planeMismatch = computeRelInc(
      inclination,
      lan,
      targetInclinationLive,
      targetLanLive,
    );
    return (
      <PresetDesc>
        Target: {targetName} — PeA{" "}
        {targetPeA === undefined ? "—" : `${(targetPeA / 1000).toFixed(1)} km`},
        i={(targetInclinationLive ?? 0).toFixed(1)}°, Δplane=
        {planeMismatch === null ? "—" : `${planeMismatch.toFixed(1)}°`}
        {planeMismatch !== null && planeMismatch > 0.5
          ? " (plane match prepended)"
          : ""}
      </PresetDesc>
    );
  }
  return null;
}

const PresetDesc = styled.div`
  font-size: 11px;
  color: var(--color-text-dim);
  padding-top: 2px;
`;

const CustomInputs = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 4px;
`;

const UTModeRow = styled.div`
  display: flex;
  gap: 4px;
`;

const UTModeButton = styled.button<{ $active: boolean }>`
  background: ${({ $active }) => ($active ? "var(--color-status-go-bg)" : "var(--color-surface-raised)")};
  border: 1px solid ${({ $active }) => ($active ? "var(--color-status-go-bg)" : "var(--color-border-subtle)")};
  color: ${({ $active }) => ($active ? "var(--color-status-go-fg)" : "var(--color-text-muted)")};
  font-size: var(--font-size-xs);
  padding: 3px 8px;
  border-radius: 2px;
  cursor: pointer;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;
