import type {
  ActionDefinition,
  ComponentProps,
  Reading,
} from "@ksp-gonogo/sitrep-sdk";
import {
  registerComponent,
  useActionInput,
  useCommand,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  ActionButton,
  Badge,
  Cluster,
  EmptyState,
  Inline,
  magnitudeOr,
  Panel,
  type Quantityish,
  ReadoutCaption,
  ScrollArea,
  SelectableRow,
  Stack,
  Text,
  ToggleButton,
  Unit,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import { BREAKING_GROUND } from "../uplink";

/**
 * Robotics Console (Breaking Ground). Lists the active vessel's robotic
 * hinges and pistons with current-vs-target position, an at-target
 * indicator, and motor / lock controls. The selected joint (first by
 * default) gets a target stepper and is the target of the serial actions.
 * Rotors live in the separate Rotor Tachometer widget.
 *
 * Reads `robotics.servos` (the hinge/piston identity list, filtered by
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

/**
 * A wire field as a number.
 *
 * Takes a `Value` as well as a bare number: a declared quantity arrives
 * wrapped from the decode, and a `typeof === "number"` test answers "no
 * reading" for every one of them, which is silent and total.
 */
/**
 * The value a VERDICT may be drawn from: current, or modelled forward to the frame.
 * A stale reading gives nothing, because a judgement cannot be dated: the operator
 * reads a band or a pill as the situation NOW.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

/**
 * The value of a FACT: something that stays true until an event changes it, and no
 * event can reach us down a link that is not delivering. `whenConfirmedNothing` is
 * what an `absent` tombstone means here, which is a different answer from `pending`
 * and must not collapse into it.
 */
function stillTrue<T, A>(
  reading: Reading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "reckonable") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

function num(v: unknown, fallback = 0): number {
  return magnitudeOr(v as Quantityish, fallback);
}

// A piston's extension is a LENGTH, not a percentage. The contract declares
// ServoEntry.CurrentExtension/TargetExtension as metres, and a decompile of
// ModuleRoboticServoPiston confirms it: the value is a Vector3.Dot of two
// world positions along the servo's main axis. This label said "%" and was
// wrong on screen at every piston readout in the widget.
const unitFor = (type: ServoType) => (type === "piston" ? "m" : "°");

/**
 * Parses the `robotics.servos` bare array (`mod/Sitrep.Host/PartsViewProvider.cs`)
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
  // Servo angles move continuously and this console commands against them, so a
  // held position would aim a command at a hinge that has since travelled.
  const roboticsRaw = judgeable(useTelemetry("robotics.servos"));
  const available = stillTrue(
    useTelemetry("robotics.available"),
    undefined,
  )?.available;

  // Delayed vessel commands (Breaking Ground robotics-audit-migration): the
  // servo motor/lock/target are actuated on the craft, subject to the same
  // signal delay as any other flight-control command, so this widget
  // dispatches over `useCommand` (not the legacy `useExecuteAction` string
  // path) to pick up per-command in-flight state for free, same shape as
  // MechJeb.
  const targetCmd = useCommand("robotics.servo.setTarget");
  const motorCmd = useCommand("robotics.servo.setMotor");
  const lockCmd = useCommand("robotics.servo.setLock");
  usePanelDelay(targetCmd);
  usePanelDelay(motorCmd);
  usePanelDelay(lockCmd);

  const servos = parseServos(roboticsRaw);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    servos.find((s) => s.partId === selectedId) ?? servos[0] ?? null;

  // The dispatched value is type-formatted too: sending Math.round of a
  // metre extension would command the piston to a whole metre.
  const setTarget = (id: string, type: ServoType, value: number) =>
    void targetCmd.send(
      { partId: id, value: Number(formatPos(type, value)) },
      { label: `Target ${formatPos(type, value)}${unitFor(type)}` },
    );
  const setMotor = (id: string, engaged: boolean) =>
    void motorCmd.send(
      { partId: id, enabled: engaged },
      { label: `Motor ${engaged ? "on" : "off"}` },
    );
  const setLock = (id: string, locked: boolean) =>
    void lockCmd.send(
      { partId: id, enabled: locked },
      { label: locked ? "Lock" : "Unlock" },
    );

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
      <ScrollArea>
        <Stack gap="md">
          <Cluster justify="start" align="baseline" wrap>
            <Text size="lg" weight="semibold">
              {formatPos(selected.type, selected.current)}
              <Unit>{unit}</Unit>
            </Text>
            <Text tone="muted" aria-hidden="true">
              →
            </Text>
            <Text tone="muted" size="lg">
              {formatPos(selected.type, selected.target)}
              <Unit>{unit}</Unit>
            </Text>
            {showToggles && (
              <Badge
                severity={selected.atTarget ? "nominal" : undefined}
                role="status"
              >
                {selected.atTarget ? "AT TARGET" : "MOVING"}
              </Badge>
            )}
          </Cluster>

          <Stack gap="sm">
            <Cluster justify="between" gap="md" wrap>
              <ReadoutCaption>Target</ReadoutCaption>
              <Inline gap="sm">
                <ActionButton
                  tone="ghost"
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
                </ActionButton>
                <Text size="sm" tone="default">
                  {formatPos(selected.type, selected.target)}
                  {unit}
                </Text>
                <ActionButton
                  tone="ghost"
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
                </ActionButton>
              </Inline>
            </Cluster>

            {showToggles && (
              <Cluster justify="start" gap="sm" wrap>
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
              </Cluster>
            )}
          </Stack>

          {showServoList && (
            <Stack gap="sm" aria-label="Robotic joints">
              {servos.map((s) => (
                <SelectableRow
                  key={s.partId}
                  selected={s.partId === selected.partId}
                  onClick={() => setSelectedId(s.partId)}
                >
                  <span>{s.name}</span>
                  <span>
                    {s.type} · {formatPos(s.type, s.current)}
                    {unitFor(s.type)}/{formatPos(s.type, s.target)}
                    {unitFor(s.type)}
                    {s.locked ? " · locked" : s.atTarget ? " · ✓" : ""}
                  </span>
                </SelectableRow>
              ))}
            </Stack>
          )}
        </Stack>
      </ScrollArea>
    </Panel>
  );
}

registerComponent<RoboticsConsoleConfig>({
  id: "robotics-console",
  name: "Robotics Console",
  description:
    "Current-vs-target position, at-target state and motor/lock controls for Breaking Ground robotic hinges, rotation servos and pistons. Select a joint to drive it from the stepper or a mapped input.",
  tags: ["telemetry", "robotics"],
  defaultSize: { w: 5, h: 8 },
  minSize: { w: 4, h: 4 },
  component: RoboticsConsoleComponent,
  dataRequirements: ["robotics.servos", "robotics.available.available"],
  defaultConfig: {},
  actions: roboticsActions,
  pushable: true,
  requires: ["flight"],
  owner: BREAKING_GROUND,
});

export { RoboticsConsoleComponent };
