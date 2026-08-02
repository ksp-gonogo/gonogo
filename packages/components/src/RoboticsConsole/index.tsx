import type { ActionDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  registerComponent,
  useActionInput,
  useExecuteAction,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  Cluster,
  EmptyState,
  Panel,
  ToggleButton,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import styled from "styled-components";

/**
 * Robotics Console (Breaking Ground). Lists the active vessel's robotic
 * hinges and pistons with current-vs-target position, an at-target
 * indicator, and motor / lock controls. The selected joint (first by
 * default) gets a target stepper and is the target of the serial actions.
 * Rotors live in the separate Rotor Tachometer widget.
 *
 * Reads `parts.robotics` (the hinge/piston identity list, filtered by
 * `type`) + `robotics.available`; degrades to a muted empty state without
 * Breaking Ground or when no servo is present.
 */

type RoboticsConsoleConfig = Record<string, never>;

/**
 * Target nudge per button press, PER TYPE, for the same reason the tolerance
 * below is per type: 5 is five degrees on a hinge and five METRES on a piston,
 * which is further than most pistons travel in total. 5cm gives a piston a
 * comparable number of presses across its range.
 */
const TARGET_STEP: Record<ServoType, number> = {
  hinge: 5,
  piston: 0.05,
};

/**
 * Position formatting, per type. A hinge reads in whole degrees; a piston
 * reads in metres and needs decimals, because Math.round on a 0.6m extension
 * prints "1m" and on a 0.4m one prints "0m".
 */
const formatPos = (type: ServoType, v: number): string =>
  type === "piston" ? v.toFixed(2) : String(Math.round(v));

/**
 * At-target tolerance, PER SERVO TYPE, because the two types are measured in
 * different units and one shared number cannot be right for both.
 *
 * A hinge is in degrees, where half a degree is a sensible dead band. A piston
 * is in METRES, and the shared 0.5 that used to cover both meant a piston
 * sitting half a metre from its target reported "AT TARGET". That was invisible
 * while the widget mislabelled extension as a percentage, since 0.5% is a fine
 * tolerance; correcting the unit is what exposed it.
 *
 * 1cm for the piston is a judgement call rather than a measured figure: KSP's
 * piston traverse velocities run 0.05 to 5 m/s, so a centimetre is roughly a
 * fifth of a second of travel at the slowest setting.
 */
const AT_TARGET_EPSILON: Record<ServoType, number> = {
  hinge: 0.5,
  piston: 0.01,
};

export type ServoType = "hinge" | "piston";

export interface ServoInfo {
  partId: string;
  name: string;
  type: ServoType;
  current: number;
  target: number;
  atTarget: boolean;
  motorEngaged: boolean;
  locked: boolean;
  torqueLimit: number;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

// A piston's extension is a LENGTH, not a percentage. The contract declares
// ServoEntry.CurrentExtension/TargetExtension as metres, and a decompile of
// ModuleRoboticServoPiston confirms it: the value is a Vector3.Dot of two
// world positions along the servo's main axis. This label said "%" and was
// wrong on screen at every piston readout in the widget.
const unitFor = (type: ServoType) => (type === "piston" ? "m" : "°");

/**
 * Parses the `parts.robotics` bare array (`mod/Sitrep.Host/PartsViewProvider.cs`)
 * down to the hinge/piston entries this widget drives (`type ∈ {"hinge",
 * "piston"}`; rotors are Rotor Tachometer's domain). `partId` is
 * `Part.flightID` stringified: stable per-part for the life of the flight
 * and, unlike `partName`, unique even among symmetric same-named parts (e.g.
 * a multirotor's N identical arms). Entries with no string `partId` are
 * dropped: they can't be selected or targeted safely. A hinge's position
 * comes off `currentAngle`/`targetAngle`; a piston's off `currentExtension`/
 * `targetExtension`. `atTarget` is derived (no such field on the wire):
 * current and target within the type's tolerance, which differs because the two
 * types are measured in different units. See AT_TARGET_EPSILON.
 */
export function parseServos(raw: unknown): ServoInfo[] {
  if (!Array.isArray(raw)) return [];
  const out: ServoInfo[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (e.type !== "hinge" && e.type !== "piston") continue;
    if (typeof e.partId !== "string") continue;
    const type: ServoType = e.type;
    const current = num(
      type === "piston" ? e.currentExtension : e.currentAngle,
    );
    const target = num(type === "piston" ? e.targetExtension : e.targetAngle);
    out.push({
      partId: e.partId,
      name: typeof e.partName === "string" ? e.partName : `Servo ${e.partId}`,
      type,
      current,
      target,
      atTarget: Math.abs(current - target) < AT_TARGET_EPSILON[type],
      motorEngaged: e.servoMotorIsEngaged === true,
      locked: e.servoIsLocked === true,
      torqueLimit: num(e.servoMotorLimit),
    });
  }
  return out;
}

const roboticsActions = [
  {
    id: "targetUp",
    label: "Target +",
    accepts: ["button"],
    description: "Increase the selected joint's target.",
  },
  {
    id: "targetDown",
    label: "Target −",
    accepts: ["button"],
    description: "Decrease the selected joint's target.",
  },
  {
    id: "toggleMotor",
    label: "Toggle motor",
    accepts: ["button"],
    description: "Engage / disengage the selected joint's motor.",
  },
  {
    id: "toggleLock",
    label: "Toggle lock",
    accepts: ["button"],
    description: "Lock / unlock the selected joint.",
  },
] as const satisfies readonly ActionDefinition[];

export type RoboticsConsoleActions = typeof roboticsActions;

function RoboticsConsoleComponent({
  h,
}: Readonly<ComponentProps<RoboticsConsoleConfig>>) {
  const roboticsRaw = useTelemetry("parts.robotics");
  const available = useTelemetry("robotics.available")?.available;
  const execute = useExecuteAction("data");

  const servos = parseServos(roboticsRaw);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    servos.find((s) => s.partId === selectedId) ?? servos[0] ?? null;

  // The dispatched value is type-formatted too: sending Math.round of a
  // metre extension would command the piston to a whole metre.
  const setTarget = (id: string, type: ServoType, value: number) =>
    void execute(`robotics.servo.setTarget[${id},${formatPos(type, value)}]`);
  const setMotor = (id: string, engaged: boolean) =>
    void execute(`robotics.servo.setMotor[${id},${engaged}]`);
  const setLock = (id: string, locked: boolean) =>
    void execute(`robotics.servo.setLock[${id},${locked}]`);

  useActionInput<RoboticsConsoleActions>({
    targetUp: (p) => {
      if (p.kind === "button" && p.value !== true) return undefined;
      if (!selected) return undefined;
      const next = selected.target + TARGET_STEP[selected.type];
      setTarget(selected.partId, selected.type, next);
      return { Target: next };
    },
    targetDown: (p) => {
      if (p.kind === "button" && p.value !== true) return undefined;
      if (!selected) return undefined;
      const next = selected.target - TARGET_STEP[selected.type];
      setTarget(selected.partId, selected.type, next);
      return { Target: next };
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
  });

  if (servos.length === 0 || !selected) {
    return (
      <Panel panelTitle="ROBOTICS">
        <EmptyState role="status">
          {available === false
            ? "Breaking Ground not installed"
            : "No robotic parts on this vessel"}
        </EmptyState>
      </Panel>
    );
  }

  const unit = unitFor(selected.type);
  // At the registered minSize (h=4) even the readout + Target stepper alone
  // are within a few px of the panel's full height; adding the motor/lock
  // toggles and the joint list on top of them clipped the Target stepper row
  // mid-glyph (overflow:auto has no visible scroll affordance in this static
  // Body). The readout + Target stepper are the essential "controls" the
  // widget's render-harness mode comment means by minSize's "readout +
  // controls"; the toggles and the joint list are both secondary and drop
  // out below h=6 rather than fighting the stepper for space. Mirrors
  // CommSignal/TargetPicker's rows-based section gating.
  const rows = h ?? 8;
  const showToggles = rows >= 6;
  const showServoList = servos.length > 1 && rows >= 6;

  return (
    <Panel panelTitle="ROBOTICS">
      <Body>
        <Cluster justify="start" align="baseline" wrap>
          <Current>
            {formatPos(selected.type, selected.current)}
            <Unit>{unit}</Unit>
          </Current>
          <Arrow aria-hidden="true">→</Arrow>
          <Target>
            {formatPos(selected.type, selected.target)}
            <Unit>{unit}</Unit>
          </Target>
          {showToggles && (
            <StatePill $atTarget={selected.atTarget} role="status">
              {selected.atTarget ? "AT TARGET" : "MOVING"}
            </StatePill>
          )}
        </Cluster>

        <Controls>
          <ControlRow>
            <ControlLabel>Target</ControlLabel>
            <Stepper>
              <StepBtn
                type="button"
                aria-label="Decrease target"
                onClick={() =>
                  setTarget(
                    selected.partId,
                    selected.type,
                    selected.target - TARGET_STEP[selected.type],
                  )
                }
              >
                −
              </StepBtn>
              <StepValue>
                {formatPos(selected.type, selected.target)}
                {unit}
              </StepValue>
              <StepBtn
                type="button"
                aria-label="Increase target"
                onClick={() =>
                  setTarget(
                    selected.partId,
                    selected.type,
                    selected.target + TARGET_STEP[selected.type],
                  )
                }
              >
                +
              </StepBtn>
            </Stepper>
          </ControlRow>

          {showToggles && (
            <ToggleRow>
              <ToggleButton
                size="sm"
                active={selected.motorEngaged}
                tone="go"
                onClick={() =>
                  setMotor(selected.partId, !selected.motorEngaged)
                }
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
            </ToggleRow>
          )}
        </Controls>

        {showServoList && (
          <ServoList aria-label="Robotic joints">
            {servos.map((s) => (
              <ServoRow
                key={s.partId}
                type="button"
                $selected={s.partId === selected.partId}
                aria-pressed={s.partId === selected.partId}
                onClick={() => setSelectedId(s.partId)}
              >
                <ServoName>{s.name}</ServoName>
                <ServoMeta>
                  {s.type} · {formatPos(s.type, s.current)}
                  {unitFor(s.type)}/{formatPos(s.type, s.target)}
                  {unitFor(s.type)}
                  {s.locked ? " · locked" : s.atTarget ? " · ✓" : ""}
                </ServoMeta>
              </ServoRow>
            ))}
          </ServoList>
        )}
      </Body>
    </Panel>
  );
}

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding: var(--space-4) var(--space-8) var(--space-8);
  overflow: auto;
`;

const Current = styled.span`
  /* Off the type scale: the scale stops at --font-size-lg (16px) and this
     is a display-tier readout. */
  font-size: 22px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
`;

const Arrow = styled.span`
  color: var(--color-text-muted);
`;

const Target = styled.span`
  font-size: var(--font-size-lg);
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
`;

const StatePill = styled.span<{ $atTarget: boolean }>`
  margin-left: auto;
  align-self: center;
  font-size: var(--font-size-2xs);
  letter-spacing: 0.06em;
  padding: var(--space-hair) var(--space-6);
  border-radius: var(--radius-xs);
  background: ${(p) =>
    p.$atTarget ? "var(--color-status-go-bg)" : "var(--color-surface-raised)"};
  color: ${(p) =>
    p.$atTarget ? "var(--color-status-go-fg)" : "var(--color-text-muted)"};
`;

const Controls = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
`;

const ControlRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4) var(--space-8);
  flex-wrap: wrap;
`;

const ControlLabel = styled.span`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
`;

const Stepper = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-6);
`;

const StepBtn = styled.button`
  min-width: 26px;
  padding: var(--space-2) var(--space-6);
  background: var(--color-surface-panel);
  color: var(--color-text-primary);
  border: 1px solid var(--color-surface-raised);
  border-radius: var(--radius-xs);
  cursor: pointer;
  font-family: inherit;
  font-size: var(--font-size-base);
  line-height: var(--line-height-flush);
`;

const StepValue = styled.span`
  min-width: 52px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-size: var(--font-size-sm);
`;

const ToggleRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
`;

const ServoList = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`;

const ServoRow = styled.button<{ $selected: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-hair);
  padding: var(--space-4) var(--space-8);
  background: ${(p) =>
    p.$selected ? "var(--color-status-go-bg)" : "var(--color-surface-panel)"};
  color: ${(p) =>
    p.$selected ? "var(--color-status-go-fg)" : "var(--color-text-primary)"};
  border: 1px solid
    ${(p) => (p.$selected ? "transparent" : "var(--color-surface-raised)")};
  border-radius: var(--radius-xs);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
`;

const ServoName = styled.span`
  font-size: var(--font-size-xs);
  font-weight: 600;
`;

const ServoMeta = styled.span`
  font-size: var(--font-size-2xs);
  opacity: 0.7;
  letter-spacing: 0.03em;
  font-variant-numeric: tabular-nums;
`;

registerComponent<RoboticsConsoleConfig>({
  id: "robotics-console",
  name: "Robotics Console",
  description:
    "Current-vs-target position, at-target state and motor/lock controls for Breaking Ground robotic hinges, rotation servos and pistons. Select a joint to drive it from the stepper or a mapped input.",
  tags: ["telemetry", "robotics"],
  defaultSize: { w: 5, h: 8 },
  minSize: { w: 4, h: 4 },
  component: RoboticsConsoleComponent,
  dataRequirements: ["parts.robotics", "robotics.available"],
  defaultConfig: {},
  actions: roboticsActions,
  pushable: true,
  requires: ["flight"],
});

export { RoboticsConsoleComponent };
