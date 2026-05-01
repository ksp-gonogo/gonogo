import type {
  ActionDefinition,
  ComponentProps,
  ConfigComponentProps,
} from "@gonogo/core";
import {
  registerComponent,
  useActionInput,
  useDataValue,
  useExecuteAction,
} from "@gonogo/core";
import {
  Button,
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Panel,
  PanelTitle,
  PrimaryButton,
  Select,
  Switch,
} from "@gonogo/ui";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { AttitudeIndicator } from "./AttitudeIndicator";

const SAS_MODES = [
  "StabilityAssist",
  "Prograde",
  "Retrograde",
  "Normal",
  "Antinormal",
  "RadialIn",
  "RadialOut",
  "Target",
  "AntiTarget",
  "Maneuver",
] as const;
type SasMode = (typeof SAS_MODES)[number];

interface NavballConfig {
  /** When true, use n.heading2/pitch2/roll2 (CoM frame). Default false (root part). */
  useCoMFrame?: boolean;
  /** When true, render the control surface; otherwise show display-only. */
  controlMode?: boolean;
}

// Action surface — kept verbose so each axis / mode is independently
// mappable to a hardware input. The order matches the visible button rows
// for cognitive consistency.
const navballActions = [
  // Mode + arm
  { id: "take-control", label: "Toggle control mode", accepts: ["button"] },
  { id: "arm-fbw", label: "Arm FBW", accepts: ["button"] },
  { id: "disarm-fbw", label: "Disarm FBW", accepts: ["button"] },
  // SAS
  { id: "toggle-sas", label: "Toggle SAS", accepts: ["button"] },
  { id: "toggle-rcs", label: "Toggle RCS", accepts: ["button"] },
  { id: "toggle-precision", label: "Toggle precision", accepts: ["button"] },
  { id: "kill-rotation", label: "Kill rotation (SAS)", accepts: ["button"] },
  { id: "sas-stability", label: "SAS — Stability", accepts: ["button"] },
  { id: "sas-prograde", label: "SAS — Prograde", accepts: ["button"] },
  { id: "sas-retrograde", label: "SAS — Retrograde", accepts: ["button"] },
  { id: "sas-normal", label: "SAS — Normal", accepts: ["button"] },
  { id: "sas-antinormal", label: "SAS — Anti-normal", accepts: ["button"] },
  { id: "sas-radial-in", label: "SAS — Radial in", accepts: ["button"] },
  { id: "sas-radial-out", label: "SAS — Radial out", accepts: ["button"] },
  { id: "sas-target", label: "SAS — Target", accepts: ["button"] },
  { id: "sas-anti-target", label: "SAS — Anti-target", accepts: ["button"] },
  { id: "sas-maneuver", label: "SAS — Maneuver", accepts: ["button"] },
  // Throttle
  { id: "set-throttle", label: "Set throttle", accepts: ["analog"] },
  { id: "throttle-up", label: "Throttle up 10%", accepts: ["button"] },
  { id: "throttle-down", label: "Throttle down 10%", accepts: ["button"] },
  { id: "throttle-zero", label: "Throttle zero", accepts: ["button"] },
  { id: "throttle-full", label: "Throttle full", accepts: ["button"] },
  // FBW axes
  { id: "set-pitch", label: "Pitch axis", accepts: ["analog"] },
  { id: "set-yaw", label: "Yaw axis", accepts: ["analog"] },
  { id: "set-roll", label: "Roll axis", accepts: ["analog"] },
  { id: "translate-x", label: "RCS X", accepts: ["analog"] },
  { id: "translate-y", label: "RCS Y", accepts: ["analog"] },
  { id: "translate-z", label: "RCS Z", accepts: ["analog"] },
  // Trim
  { id: "set-pitch-trim", label: "Pitch trim", accepts: ["analog"] },
  { id: "set-yaw-trim", label: "Yaw trim", accepts: ["analog"] },
  { id: "set-roll-trim", label: "Roll trim", accepts: ["analog"] },
] as const satisfies readonly ActionDefinition[];

type NavballActions = typeof navballActions;

function NavballComponent({
  config,
  onConfigChange,
}: Readonly<ComponentProps<NavballConfig>>) {
  const useCoM = config?.useCoMFrame === true;
  const controlMode = config?.controlMode === true;

  const heading = numericOrNull(
    useDataValue("data", useCoM ? "n.heading2" : "n.heading"),
  );
  const pitch = numericOrNull(
    useDataValue("data", useCoM ? "n.pitch2" : "n.pitch"),
  );
  const roll = numericOrNull(
    useDataValue("data", useCoM ? "n.roll2" : "n.roll"),
  );

  const sasMode = useDataValue("data", "f.sasMode") as string | undefined;
  const sasOn = useDataValue("data", "f.sasEnabled") === true;
  const rcsOn = useDataValue("data", "v.rcsValue") === true;
  const precisionOn = useDataValue("data", "f.precisionControl") === true;
  const throttleRaw = useDataValue("data", "f.throttle");
  const throttle =
    typeof throttleRaw === "number" && Number.isFinite(throttleRaw)
      ? throttleRaw
      : 0;
  const isControllable = useDataValue("data", "v.isControllable") !== false;

  const execute = useExecuteAction("data");

  // FBW arm/disarm with auto-disarm on unmount. State mirrors the latest
  // arm command rather than a Telemachus key — no readback for FBW.
  const [fbwArmed, setFbwArmed] = useState(false);
  const fbwArmedRef = useRef(false);
  useEffect(() => {
    fbwArmedRef.current = fbwArmed;
  }, [fbwArmed]);
  useEffect(() => {
    return () => {
      // Component unmounting — release control regardless of state. Don't
      // wait for the render-cycle setFbwArmed(false), the effect cleanup
      // is the last reliable place to fire.
      if (fbwArmedRef.current) void execute("v.setFbW[0]");
    };
  }, [execute]);

  const armFbw = () => {
    void execute("v.setFbW[1]");
    setFbwArmed(true);
  };
  const disarmFbw = () => {
    void execute("v.setFbW[0]");
    setFbwArmed(false);
  };

  // Action wiring — every action surface has a mapping into a Telemachus
  // execute call, with analog values clamped to [-1, 1] and throttle to
  // [0, 1]. Button payloads only fire on the press edge (value=true) so
  // a hardware press+release doesn't trigger twice.
  useActionInput<NavballActions>({
    "take-control": (payload) => {
      if (!isButtonPress(payload)) return;
      onConfigChange?.({ ...(config ?? {}), controlMode: !controlMode });
    },
    "arm-fbw": (payload) => {
      if (!isButtonPress(payload)) return;
      armFbw();
    },
    "disarm-fbw": (payload) => {
      if (!isButtonPress(payload)) return;
      disarmFbw();
    },
    "toggle-sas": (payload) => {
      if (!isButtonPress(payload)) return;
      void execute("f.sas");
    },
    "toggle-rcs": (payload) => {
      if (!isButtonPress(payload)) return;
      void execute("f.rcs");
    },
    "toggle-precision": (payload) => {
      if (!isButtonPress(payload)) return;
      // No dedicated key in Telemachus — toggling FBW pitch trim doesn't
      // help. v.precisionControlValue is a read; setting precision happens
      // via the SAS path. For now treat as a no-op with a console hint.
      // (Surfaced as an action so a future Telemachus version can wire it.)
    },
    "kill-rotation": (payload) => {
      if (!isButtonPress(payload)) return;
      void execute("f.setSASMode[StabilityAssist]");
    },
    "sas-stability": (p) =>
      isButtonPress(p) && void execute("f.setSASMode[StabilityAssist]"),
    "sas-prograde": (p) =>
      isButtonPress(p) && void execute("f.setSASMode[Prograde]"),
    "sas-retrograde": (p) =>
      isButtonPress(p) && void execute("f.setSASMode[Retrograde]"),
    "sas-normal": (p) =>
      isButtonPress(p) && void execute("f.setSASMode[Normal]"),
    "sas-antinormal": (p) =>
      isButtonPress(p) && void execute("f.setSASMode[Antinormal]"),
    "sas-radial-in": (p) =>
      isButtonPress(p) && void execute("f.setSASMode[RadialIn]"),
    "sas-radial-out": (p) =>
      isButtonPress(p) && void execute("f.setSASMode[RadialOut]"),
    "sas-target": (p) =>
      isButtonPress(p) && void execute("f.setSASMode[Target]"),
    "sas-anti-target": (p) =>
      isButtonPress(p) && void execute("f.setSASMode[AntiTarget]"),
    "sas-maneuver": (p) =>
      isButtonPress(p) && void execute("f.setSASMode[Maneuver]"),
    "set-throttle": (p) => {
      if (p.kind !== "analog") return;
      const v = clamp(p.value as number, 0, 1);
      void execute(`f.setThrottle[${v.toFixed(3)}]`);
    },
    "throttle-up": (p) => isButtonPress(p) && void execute("f.throttleUp"),
    "throttle-down": (p) => isButtonPress(p) && void execute("f.throttleDown"),
    "throttle-zero": (p) => isButtonPress(p) && void execute("f.throttleZero"),
    "throttle-full": (p) => isButtonPress(p) && void execute("f.throttleFull"),
    "set-pitch": (p) => {
      if (p.kind !== "analog") return;
      void execute(`v.setPitch[${clamp(p.value as number, -1, 1).toFixed(3)}]`);
    },
    "set-yaw": (p) => {
      if (p.kind !== "analog") return;
      void execute(`v.setYaw[${clamp(p.value as number, -1, 1).toFixed(3)}]`);
    },
    "set-roll": (p) => {
      if (p.kind !== "analog") return;
      void execute(`v.setRoll[${clamp(p.value as number, -1, 1).toFixed(3)}]`);
    },
    "translate-x": (p) => {
      if (p.kind !== "analog") return;
      // Telemachus exposes v.setTranslation[x,y,z] only — synthesize the
      // missing axes from zero so per-axis bindings can each fire alone.
      const v = clamp(p.value as number, -1, 1);
      void execute(`v.setTranslation[${v.toFixed(3)},0,0]`);
    },
    "translate-y": (p) => {
      if (p.kind !== "analog") return;
      const v = clamp(p.value as number, -1, 1);
      void execute(`v.setTranslation[0,${v.toFixed(3)},0]`);
    },
    "translate-z": (p) => {
      if (p.kind !== "analog") return;
      const v = clamp(p.value as number, -1, 1);
      void execute(`v.setTranslation[0,0,${v.toFixed(3)}]`);
    },
    "set-pitch-trim": (p) => {
      if (p.kind !== "analog") return;
      void execute(
        `f.setPitchTrim[${clamp(p.value as number, -1, 1).toFixed(3)}]`,
      );
    },
    "set-yaw-trim": (p) => {
      if (p.kind !== "analog") return;
      void execute(
        `f.setYawTrim[${clamp(p.value as number, -1, 1).toFixed(3)}]`,
      );
    },
    "set-roll-trim": (p) => {
      if (p.kind !== "analog") return;
      void execute(
        `f.setRollTrim[${clamp(p.value as number, -1, 1).toFixed(3)}]`,
      );
    },
  });

  const [dialSize, setDialSize] = useState(180);
  const dialRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = dialRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        if (e.contentRect.width > 0 && e.contentRect.height > 0) {
          // Use width as the primary; the indicator picks the smaller
          // dimension internally if it ever doesn't fit.
          setDialSize(Math.min(220, Math.floor(e.contentRect.width) - 10));
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <Panel>
      <Header>
        <PanelTitle>{controlMode ? "GNC CONTROL" : "ATTITUDE"}</PanelTitle>
        <ModeBadgeRow>
          <ModeBadge $on={sasOn}>SAS{sasMode ? `: ${sasMode}` : ""}</ModeBadge>
          <ModeBadge $on={rcsOn}>RCS</ModeBadge>
          {precisionOn && <ModeBadge $on>PRECISION</ModeBadge>}
        </ModeBadgeRow>
      </Header>

      <Body>
        <DialWrap ref={dialRef}>
          <AttitudeIndicator
            heading={heading}
            pitch={pitch}
            roll={roll}
            size={dialSize}
          />
          <ThrottleColumn>
            <ThrottleLabel>THR</ThrottleLabel>
            <ThrottleBar>
              <ThrottleFill style={{ height: `${throttle * 100}%` }} />
            </ThrottleBar>
            <ThrottleVal>{Math.round(throttle * 100)}%</ThrottleVal>
          </ThrottleColumn>
        </DialWrap>

        {controlMode && (
          <ControlSurface
            disabled={!isControllable}
            sasMode={sasMode ?? null}
            sasOn={sasOn}
            rcsOn={rcsOn}
            precisionOn={precisionOn}
            throttle={throttle}
            fbwArmed={fbwArmed}
            onArmFbw={armFbw}
            onDisarmFbw={disarmFbw}
            execute={execute}
          />
        )}
      </Body>
    </Panel>
  );
}

interface ControlSurfaceProps {
  disabled: boolean;
  sasMode: string | null;
  sasOn: boolean;
  rcsOn: boolean;
  precisionOn: boolean;
  throttle: number;
  fbwArmed: boolean;
  onArmFbw: () => void;
  onDisarmFbw: () => void;
  execute: (action: string) => Promise<void>;
}

function ControlSurface({
  disabled,
  sasMode,
  sasOn,
  rcsOn,
  precisionOn,
  throttle,
  fbwArmed,
  onArmFbw,
  onDisarmFbw,
  execute,
}: ControlSurfaceProps) {
  return (
    <ControlWrap>
      {disabled && (
        <Banner role="status" aria-live="polite">
          Vessel not controllable — buttons disabled.
        </Banner>
      )}
      <Group>
        <GroupLabel>SAS</GroupLabel>
        <ButtonGrid>
          <ToggleButton
            type="button"
            $active={sasOn}
            onClick={() => void execute("f.sas")}
            disabled={disabled}
          >
            {sasOn ? "SAS ON" : "SAS OFF"}
          </ToggleButton>
          <ToggleButton
            type="button"
            $active={rcsOn}
            onClick={() => void execute("f.rcs")}
            disabled={disabled}
          >
            {rcsOn ? "RCS ON" : "RCS OFF"}
          </ToggleButton>
          <ToggleButton type="button" $active={precisionOn} disabled>
            PRECISION
          </ToggleButton>
        </ButtonGrid>
      </Group>

      <Group>
        <GroupLabel>SAS Mode</GroupLabel>
        <ButtonGrid>
          {SAS_MODES.map((mode) => (
            <ToggleButton
              key={mode}
              type="button"
              $active={sasMode === mode}
              onClick={() => void execute(`f.setSASMode[${mode}]`)}
              disabled={disabled}
            >
              {modeShort(mode)}
            </ToggleButton>
          ))}
        </ButtonGrid>
      </Group>

      <Group>
        <GroupLabel>Throttle</GroupLabel>
        <SliderRow>
          <Slider
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={throttle}
            onChange={(e) =>
              void execute(
                `f.setThrottle[${Number(e.target.value).toFixed(3)}]`,
              )
            }
            disabled={disabled}
            aria-label="Throttle"
          />
          <SliderVal>{Math.round(throttle * 100)}%</SliderVal>
        </SliderRow>
        <ButtonGrid>
          <Button
            type="button"
            onClick={() => void execute("f.throttleZero")}
            disabled={disabled}
          >
            ZERO
          </Button>
          <Button
            type="button"
            onClick={() => void execute("f.throttleDown")}
            disabled={disabled}
          >
            −10%
          </Button>
          <Button
            type="button"
            onClick={() => void execute("f.throttleUp")}
            disabled={disabled}
          >
            +10%
          </Button>
          <Button
            type="button"
            onClick={() => void execute("f.throttleFull")}
            disabled={disabled}
          >
            FULL
          </Button>
        </ButtonGrid>
      </Group>

      <Group>
        <GroupLabel>Fly-by-wire</GroupLabel>
        <FbwRow>
          <ToggleButton
            type="button"
            $active={fbwArmed}
            onClick={fbwArmed ? onDisarmFbw : onArmFbw}
            disabled={disabled}
          >
            {fbwArmed ? "FBW ARMED" : "Arm FBW"}
          </ToggleButton>
          <FbwHint>
            {fbwArmed
              ? "Mapped pitch/yaw/roll/translate inputs are live."
              : "Bind axes via the Inputs tab, then arm to take stick control."}
          </FbwHint>
        </FbwRow>
      </Group>
    </ControlWrap>
  );
}

function modeShort(mode: SasMode): string {
  switch (mode) {
    case "StabilityAssist":
      return "SAS";
    case "Prograde":
      return "PRO";
    case "Retrograde":
      return "RET";
    case "Normal":
      return "NOR";
    case "Antinormal":
      return "ANT";
    case "RadialIn":
      return "RIN";
    case "RadialOut":
      return "ROU";
    case "Target":
      return "TGT";
    case "AntiTarget":
      return "ATG";
    case "Maneuver":
      return "MNV";
  }
}

function isButtonPress(p: { kind: string; value: unknown }): boolean {
  return p.kind === "button" && p.value === true;
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function numericOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ── Config component ──────────────────────────────────────────────────────────

function NavballConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<NavballConfig>>) {
  const [useCoMFrame, setUseCoMFrame] = useState(config?.useCoMFrame === true);
  const [controlMode, setControlMode] = useState(config?.controlMode === true);

  return (
    <ConfigForm>
      <Field>
        <FieldLabel>Display surface</FieldLabel>
        <Select
          value={controlMode ? "control" : "display"}
          onChange={(e) => setControlMode(e.target.value === "control")}
        >
          <option value="display">Display only — read attitude</option>
          <option value="control">Control mode — buttons + FBW</option>
        </Select>
        <FieldHint>
          Control mode adds SAS-mode buttons, throttle controls, and an FBW
          arm/disarm switch. The display still updates either way; the action
          surface is also available for serial mappings regardless.
        </FieldHint>
      </Field>
      <Field>
        <Switch
          checked={useCoMFrame}
          onChange={setUseCoMFrame}
          label="Read from centre-of-mass frame (n.*2)"
        />
        <FieldHint>
          Default reads from the root part. Switch on for vessels where the
          probe core / command pod isn't aligned with the ship's geometry.
        </FieldHint>
      </Field>
      <PrimaryButton onClick={() => onSave({ useCoMFrame, controlMode })}>
        Save
      </PrimaryButton>
    </ConfigForm>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const ModeBadgeRow = styled.div`
  display: flex;
  gap: 4px;
`;

const ModeBadge = styled.span<{ $on: boolean }>`
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 1px 5px;
  border-radius: 2px;
  background: ${(p) =>
    p.$on ? "var(--color-status-go-bg)" : "var(--color-surface-raised)"};
  color: ${(p) =>
    p.$on ? "var(--color-status-go-fg)" : "var(--color-text-faint)"};
`;

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
`;

const DialWrap = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: center;
`;

const ThrottleColumn = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 32px;
`;

const ThrottleLabel = styled.span`
  font-size: 9px;
  letter-spacing: 0.12em;
  color: var(--color-text-faint);
`;

const ThrottleBar = styled.div`
  width: 14px;
  height: 100px;
  border: 1px solid var(--color-surface-raised);
  background: var(--color-surface-app);
  position: relative;
  overflow: hidden;
`;

const ThrottleFill = styled.div`
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--color-accent-fg);
  transition: height 80ms linear;
`;

const ThrottleVal = styled.span`
  font-size: 11px;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
`;

const ControlWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--color-surface-raised);
`;

const Banner = styled.div`
  font-size: 11px;
  color: var(--color-status-warning-bg);
  padding: 4px 6px;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-status-warning-bg);
  border-radius: 2px;
`;

const Group = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const GroupLabel = styled.div`
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-faint);
`;

const ButtonGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(48px, 1fr));
  gap: 4px;
`;

const ToggleButton = styled.button<{ $active: boolean }>`
  font-size: 11px;
  font-weight: 600;
  padding: 4px 6px;
  border-radius: 2px;
  border: 1px solid
    ${(p) => (p.$active ? "var(--color-accent-fg)" : "var(--color-surface-raised)")};
  background: ${(p) =>
    p.$active ? "var(--color-status-go-bg)" : "var(--color-surface-panel)"};
  color: ${(p) =>
    p.$active ? "var(--color-status-go-fg)" : "var(--color-text-primary)"};
  cursor: pointer;
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const SliderRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const Slider = styled.input`
  flex: 1;
`;

const SliderVal = styled.span`
  font-size: 11px;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
  min-width: 36px;
  text-align: right;
`;

const FbwRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const FbwHint = styled.span`
  font-size: 10px;
  color: var(--color-text-faint);
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<NavballConfig>({
  id: "navball",
  name: "Navball / Attitude Director",
  description:
    "Attitude indicator + control surface. Reads heading/pitch/roll from Telemachus's n.* bucket and exposes a deep action surface — every SAS mode, throttle, fly-by-wire pitch/yaw/roll, RCS translation and trim — so a hardware stick mapped via the Inputs tab can fly the vessel.",
  tags: ["telemetry", "control"],
  defaultSize: { w: 8, h: 11 },
  minSize: { w: 4, h: 6 },
  component: NavballComponent,
  configComponent: NavballConfigComponent,
  dataRequirements: [
    "n.heading",
    "n.pitch",
    "n.roll",
    "n.heading2",
    "n.pitch2",
    "n.roll2",
    "f.sasMode",
    "f.sasEnabled",
    "f.precisionControl",
    "v.rcsValue",
    "f.throttle",
    "v.isControllable",
    "v.angleToPrograde",
  ],
  defaultConfig: { useCoMFrame: false, controlMode: false },
  actions: navballActions,
  pushable: true,
});

export { NavballComponent };
