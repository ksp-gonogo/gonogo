import type { ActionDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  registerComponent,
  useActionInput,
  useDataStreamStatus,
  useDataValue,
  useExecuteAction,
} from "@ksp-gonogo/core";
import {
  EmptyState,
  Gauge,
  Panel,
  PanelTitle,
  StreamStatusBadge,
  ToggleButton,
  useElementSize,
} from "@ksp-gonogo/ui";
import { useState } from "react";
import styled from "styled-components";

/**
 * Rotor Tachometer (Breaking Ground). Lists the active vessel's robotic
 * rotors and shows live RPM against the commanded cap, with motor / lock /
 * brake / direction controls. The selected rotor (first by default) gets a
 * tachometer dial and is the target of the serial-mappable actions.
 *
 * Reads `parts.robotics` (the rotor identity list, filtered by `type ===
 * "rotor"`) + `robotics.available`; degrades to a muted empty state without
 * Breaking Ground or when no rotor is present.
 */

type RotorTachometerConfig = Record<string, never>;

const ROTOR_MAX_RPM = 460; // ModuleRoboticServoRotor.rpmLimit range ceiling.
const RPM_STEP = 10;
const TORQUE_STEP = 10;

export interface RotorInfo {
  partId: string;
  name: string;
  rpm: number;
  rpmLimit: number;
  torqueLimit: number;
  maxTorque: number;
  brakePercentage: number;
  motorEngaged: boolean;
  locked: boolean;
  counterClockwise: boolean;
  output: number;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Parses the `parts.robotics` bare array (`mod/Sitrep.Host/PartsViewProvider.cs`)
 * down to `type === "rotor"` entries (hinges/pistons are Robotics Console's
 * domain). `partId` is `Part.flightID` stringified — stable per-part for the
 * life of the flight and, unlike `partName`, unique even among symmetric
 * same-named parts (multirotors, coaxial helis). Entries with no string
 * `partId` are dropped — they can't be selected or targeted safely.
 */
export function parseRotors(raw: unknown): RotorInfo[] {
  if (!Array.isArray(raw)) return [];
  const out: RotorInfo[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (e.type !== "rotor") continue;
    if (typeof e.partId !== "string") continue;
    out.push({
      partId: e.partId,
      name: typeof e.partName === "string" ? e.partName : `Rotor ${e.partId}`,
      rpm: num(e.currentRPM),
      rpmLimit: num(e.rpmLimit),
      torqueLimit: num(e.servoMotorLimit),
      maxTorque: num(e.maxTorque),
      brakePercentage: num(e.brakePercentage),
      motorEngaged: e.servoMotorIsEngaged === true,
      locked: e.servoIsLocked === true,
      counterClockwise: e.counterClockwise === true,
      output: num(e.normalizedOutput),
    });
  }
  return out;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

const rotorActions = [
  {
    id: "rpmUp",
    label: "RPM up",
    accepts: ["button"],
    description: "Raise the selected rotor's RPM cap.",
  },
  {
    id: "rpmDown",
    label: "RPM down",
    accepts: ["button"],
    description: "Lower the selected rotor's RPM cap.",
  },
  {
    id: "toggleMotor",
    label: "Toggle motor",
    accepts: ["button"],
    description: "Engage / disengage the selected rotor's motor.",
  },
  {
    id: "toggleLock",
    label: "Toggle lock",
    accepts: ["button"],
    description: "Lock / unlock the selected rotor.",
  },
  {
    id: "reverse",
    label: "Reverse",
    accepts: ["button"],
    description: "Flip the selected rotor's spin direction.",
  },
] as const satisfies readonly ActionDefinition[];

export type RotorTachometerActions = typeof rotorActions;

function RotorTachometerComponent({
  h,
}: Readonly<ComponentProps<RotorTachometerConfig>>) {
  const roboticsRaw = useDataValue("data", "parts.robotics");
  const available = useDataValue<boolean>("data", "robotics.available");
  const execute = useExecuteAction("data");
  const streamStatus = useDataStreamStatus("data", "parts.robotics");

  // Measure the gauge slot so the dial follows the column width instead of a
  // fixed 180px that clips in a narrow slot.
  const { ref: gaugeRef, size: gaugeSize } = useElementSize({ w: 180, h: 104 });

  const rotors = parseRotors(roboticsRaw);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    rotors.find((r) => r.partId === selectedId) ?? rotors[0] ?? null;

  const setRpmLimit = (id: string, rpm: number) =>
    void execute(
      `robotics.rotor.setRpmLimit[${id},${Math.round(clamp(rpm, 0, ROTOR_MAX_RPM))}]`,
    );
  const setTorqueLimit = (id: string, pct: number) =>
    void execute(
      `robotics.rotor.setTorqueLimit[${id},${Math.round(clamp(pct, 0, 100))}]`,
    );
  const setBrake = (id: string, pct: number) =>
    void execute(
      `robotics.rotor.setBrake[${id},${Math.round(clamp(pct, 0, 200))}]`,
    );
  const setMotor = (id: string, engaged: boolean) =>
    void execute(`robotics.rotor.setMotor[${id},${engaged}]`);
  const setLock = (id: string, locked: boolean) =>
    void execute(`robotics.rotor.setLock[${id},${locked}]`);
  const reverse = (id: string) => void execute(`robotics.rotor.reverse[${id}]`);

  useActionInput<RotorTachometerActions>({
    rpmUp: (p) => {
      if (p.kind === "button" && p.value !== true) return undefined;
      if (!selected) return undefined;
      const next = clamp(selected.rpmLimit + RPM_STEP, 0, ROTOR_MAX_RPM);
      setRpmLimit(selected.partId, next);
      return { RPM: next };
    },
    rpmDown: (p) => {
      if (p.kind === "button" && p.value !== true) return undefined;
      if (!selected) return undefined;
      const next = clamp(selected.rpmLimit - RPM_STEP, 0, ROTOR_MAX_RPM);
      setRpmLimit(selected.partId, next);
      return { RPM: next };
    },
    toggleMotor: (p) => {
      if (p.kind === "button" && p.value !== true) return undefined;
      if (!selected) return undefined;
      setMotor(selected.partId, !selected.motorEngaged);
      return { Motor: !selected.motorEngaged };
    },
    toggleLock: (p) => {
      if (p.kind === "button" && p.value !== true) return undefined;
      if (!selected) return undefined;
      setLock(selected.partId, !selected.locked);
      return { Locked: !selected.locked };
    },
    reverse: (p) => {
      if (p.kind === "button" && p.value !== true) return undefined;
      if (!selected) return undefined;
      reverse(selected.partId);
      return { Direction: selected.counterClockwise ? "CW" : "CCW" };
    },
  });

  if (rotors.length === 0 || !selected) {
    return (
      <Panel>
        <TitleRow>
          <PanelTitle>ROTORS</PanelTitle>
          <StreamStatusBadge status={streamStatus} />
        </TitleRow>
        <EmptyState role="status">
          {available === false
            ? "Breaking Ground not installed"
            : "No rotors on this vessel"}
        </EmptyState>
      </Panel>
    );
  }

  const showGauge = (h ?? 8) >= 6;
  const cap = Math.max(selected.rpmLimit, 1);
  // Size the dial to the column width, but also cap it by a slice of the
  // widget's height so the controls (steppers + the full toggle row) stay
  // visible without scrolling; the rotor list below may scroll. Kept modest
  // so a short/wide slot doesn't let the gauge crowd the toggles off-bottom.
  const gaugeMaxH = Math.max(64, (h ?? 9) * 25 * 0.32);
  const gaugeW = Math.min(
    gaugeSize.w || 180,
    240,
    Math.round(gaugeMaxH / 0.58),
  );
  const gaugeH = Math.round(gaugeW * 0.58);

  return (
    <Panel>
      <TitleRow>
        <PanelTitle>ROTORS</PanelTitle>
        <StreamStatusBadge status={streamStatus} />
      </TitleRow>
      <Body>
        {showGauge && (
          <GaugeWrap ref={gaugeRef}>
            <Gauge
              value={clamp(selected.rpm, 0, ROTOR_MAX_RPM)}
              min={0}
              max={ROTOR_MAX_RPM}
              width={gaugeW}
              height={gaugeH}
              valueLabel={`${Math.round(selected.rpm)}`}
              unitLabel="RPM"
              zones={[
                { from: 0, to: cap, color: "var(--color-status-go-bg)" },
                {
                  from: cap,
                  to: ROTOR_MAX_RPM,
                  color: "var(--color-surface-raised)",
                },
              ]}
              ariaLabel={`${selected.name}: ${Math.round(selected.rpm)} RPM, cap ${Math.round(selected.rpmLimit)}`}
            />
          </GaugeWrap>
        )}

        <Controls>
          <ControlRow>
            <ControlLabel>RPM cap</ControlLabel>
            <Stepper>
              <StepBtn
                type="button"
                aria-label="Lower RPM cap"
                onClick={() =>
                  setRpmLimit(selected.partId, selected.rpmLimit - RPM_STEP)
                }
              >
                −
              </StepBtn>
              <StepValue>{Math.round(selected.rpmLimit)}</StepValue>
              <StepBtn
                type="button"
                aria-label="Raise RPM cap"
                onClick={() =>
                  setRpmLimit(selected.partId, selected.rpmLimit + RPM_STEP)
                }
              >
                +
              </StepBtn>
            </Stepper>
          </ControlRow>

          <ControlRow>
            <ControlLabel>Torque</ControlLabel>
            <Stepper>
              <StepBtn
                type="button"
                aria-label="Lower torque limit"
                onClick={() =>
                  setTorqueLimit(
                    selected.partId,
                    selected.torqueLimit - TORQUE_STEP,
                  )
                }
              >
                −
              </StepBtn>
              <StepValue>{Math.round(selected.torqueLimit)}%</StepValue>
              <StepBtn
                type="button"
                aria-label="Raise torque limit"
                onClick={() =>
                  setTorqueLimit(
                    selected.partId,
                    selected.torqueLimit + TORQUE_STEP,
                  )
                }
              >
                +
              </StepBtn>
            </Stepper>
          </ControlRow>

          <ToggleRow>
            <ToggleButton
              size="sm"
              active={selected.motorEngaged}
              tone="go"
              onClick={() => setMotor(selected.partId, !selected.motorEngaged)}
            >
              Motor {selected.motorEngaged ? "on" : "off"}
            </ToggleButton>
            <ToggleButton
              size="sm"
              active={selected.locked}
              tone="warn"
              onClick={() => setLock(selected.partId, !selected.locked)}
            >
              {selected.locked ? "Locked" : "Unlocked"}
            </ToggleButton>
            <ToggleButton
              size="sm"
              active={selected.brakePercentage > 0}
              tone="warn"
              onClick={() =>
                setBrake(
                  selected.partId,
                  selected.brakePercentage > 0 ? 0 : 100,
                )
              }
            >
              Brake {selected.brakePercentage > 0 ? "on" : "off"}
            </ToggleButton>
            <ToggleButton size="sm" onClick={() => reverse(selected.partId)}>
              {selected.counterClockwise ? "↺ CCW" : "↻ CW"}
            </ToggleButton>
          </ToggleRow>
        </Controls>

        {rotors.length > 1 && (
          <RotorList aria-label="Rotors">
            {rotors.map((r) => (
              <RotorRow
                key={r.partId}
                type="button"
                $selected={r.partId === selected.partId}
                aria-pressed={r.partId === selected.partId}
                onClick={() => setSelectedId(r.partId)}
              >
                <RotorName>{r.name}</RotorName>
                <RotorMeta>
                  {Math.round(r.rpm)}/{Math.round(r.rpmLimit)} RPM
                  {r.motorEngaged ? "" : " · off"}
                  {r.locked ? " · locked" : ""}
                </RotorMeta>
              </RotorRow>
            ))}
          </RotorList>
        )}
      </Body>
    </Panel>
  );
}

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
`;

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 8px 8px;
  overflow: auto;
`;

const GaugeWrap = styled.div`
  display: flex;
  justify-content: center;
  width: 100%;
  min-width: 0;
`;

const Controls = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const ControlRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px 8px;
  /* Drop the stepper below the label when there isn't room side-by-side
     (narrow widths) rather than clipping the +/value off the edge. */
  flex-wrap: wrap;
`;

const Stepper = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const ControlLabel = styled.span`
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
`;

const StepBtn = styled.button`
  min-width: 26px;
  padding: 2px 6px;
  background: var(--color-surface-panel);
  color: var(--color-text-primary);
  border: 1px solid var(--color-surface-raised);
  border-radius: 2px;
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
  line-height: 1;
`;

const StepValue = styled.span`
  min-width: 48px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
`;

const ToggleRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`;

const RotorList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const RotorRow = styled.button<{ $selected: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 4px 8px;
  background: ${(p) =>
    p.$selected ? "var(--color-status-go-bg)" : "var(--color-surface-panel)"};
  color: ${(p) =>
    p.$selected ? "var(--color-status-go-fg)" : "var(--color-text-primary)"};
  border: 1px solid
    ${(p) => (p.$selected ? "transparent" : "var(--color-surface-raised)")};
  border-radius: 2px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
`;

const RotorName = styled.span`
  font-size: 11px;
  font-weight: 600;
`;

const RotorMeta = styled.span`
  font-size: 9px;
  opacity: 0.7;
  letter-spacing: 0.03em;
  font-variant-numeric: tabular-nums;
`;

registerComponent<RotorTachometerConfig>({
  id: "rotor-tachometer",
  name: "Rotor Tachometer",
  description:
    "Live RPM vs commanded cap for Breaking Ground robotic rotors, with motor, lock, brake and direction controls. Select a rotor to drive it from the dial or a mapped input.",
  tags: ["telemetry", "robotics"],
  defaultSize: { w: 6, h: 10 },
  minSize: { w: 4, h: 4 },
  component: RotorTachometerComponent,
  dataRequirements: ["parts.robotics", "robotics.available"],
  defaultConfig: {},
  actions: rotorActions,
  pushable: true,
  requires: ["flight"],
});

export { RotorTachometerComponent };
