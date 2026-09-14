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
  Panel,
  ReadoutCaption,
  Section,
  SelectableRow,
  Text,
  ToggleButton,
  Unit,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import { BREAKING_GROUND } from "../uplink";
import { numOrNull } from "../wire";

/**
 * Robotics Console (Breaking Ground). Lists the active vessel's robotic
 * hinges, rotation servos and pistons with current-vs-target position, an
 * at-target indicator, and motor / lock controls. The selected joint (first by
 * default) gets a target stepper and is the target of the serial actions.
 * Rotors live in the separate Rotor Tachometer widget.
 *
 * Reads `robotics.servos` (the positioned-servo identity list, filtered by
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
  rotationServo: 5,
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
 * is in METRES, so one shared 0.5 reports "AT TARGET" for a piston sitting half
 * a metre away. That stays invisible for as long as extension is mislabelled as
 * a percentage, since 0.5% is a fine tolerance.
 *
 * 1cm for the piston is a judgement call rather than a measured figure: KSP's
 * piston traverse velocities run 0.05 to 5 m/s, so a centimetre is roughly a
 * fifth of a second of travel at the slowest setting.
 */
const AT_TARGET_EPSILON: Record<ServoType, number> = {
  hinge: 0.5,
  rotationServo: 0.5,
  piston: 0.01,
};

/**
 * The angle-driven kinds share a step and a tolerance because they share a
 * unit: a rotation servo is a hinge as far as this widget is concerned, and
 * they are separate names only because they are separate parts and the
 * operator picking one has to know which they picked.
 */
export type ServoType = "hinge" | "rotationServo" | "piston";

/**
 * One positioned joint as this console drives it.
 *
 * Position, target and torque are `number | null`, and `atTarget` is
 * `boolean | null` BECAUSE they are: it is derived from the two of them, so with
 * either one withheld there is nothing to derive it from, and
 * `abs(0 - 0) < 0.5` is how a joint nobody read acquires an AT TARGET badge.
 * `BreakingGroundViewProvider` withholds each of these through
 * `SnapshotDict.GetDouble` (absent, non-numeric and non-finite alike), and
 * `ServoCapture` nulls the fields that do not apply to a joint of this kind, so
 * a hinge carries no extension and a piston no angle. The target stepper steps
 * FROM `target`, so a substituted zero there does not stay on screen: one press
 * commands a 60° hinge to 5°.
 */
export interface ServoInfo {
  partId: string;
  name: string;
  type: ServoType;
  current: number | null;
  target: number | null;
  atTarget: boolean | null;
  motorEngaged: boolean;
  locked: boolean;
  torqueLimit: number | null;
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
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

// A piston's extension is a LENGTH, not a percentage. The contract declares
// ServoEntry.CurrentExtension/TargetExtension as metres, and a decompile of
// ModuleRoboticServoPiston confirms it: the value is a Vector3.Dot of two
// world positions along the servo's main axis. This label said "%" and was
// wrong on screen at every piston readout in the widget.
const unitFor = (type: ServoType) => (type === "piston" ? "m" : "°");

/**
 * A position for the joint list, where the row has no room for a sentence. The
 * unit comes along so a withheld reading reads "unknown" rather than
 * "unknown°".
 */
const posWithUnit = (type: ServoType, v: number | null): string =>
  v === null ? "unknown" : `${formatPos(type, v)}${unitFor(type)}`;

/**
 * A relative stepper's accessible name, carrying WHY it is disabled when the
 * figure it steps from was never read. A `disabled` attribute on its own is
 * announced as "unavailable" with no reason, and the greying is visual only.
 */
const stepperLabel = (action: string, from: number | null): string =>
  from === null ? `${action} (unavailable, not reported)` : action;

/**
 * Parses the `robotics.servos` bare array (`mod/Sitrep.Host/PartsViewProvider.cs`)
 * down to the positioned entries this widget drives (`type ∈ {"hinge",
 * "rotationServo", "piston"}`; rotors are Rotor Tachometer's domain, and a
 * `"servo"` of a kind the mod could not name has no position to drive).
 * `partId` is
 * `Part.flightID` stringified: stable per-part for the life of the flight
 * and, unlike `partName`, unique even among symmetric same-named parts (e.g.
 * a multirotor's N identical arms). Entries with no string `partId` are
 * dropped: they can't be selected or targeted safely. A hinge's position
 * comes off `currentAngle`/`targetAngle`; a piston's off `currentExtension`/
 * `targetExtension`. `atTarget` is derived (no such field on the wire):
 * current and target within the type's tolerance, which differs because the two
 * types are measured in different units. See AT_TARGET_EPSILON. With either
 * side withheld it derives to `null` rather than to a verdict, because the
 * tolerance test on two substituted zeros passes for every joint.
 */
export function parseServos(raw: unknown): ServoInfo[] {
  if (!Array.isArray(raw)) return [];
  const out: ServoInfo[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (e.type !== "hinge" && e.type !== "rotationServo" && e.type !== "piston")
      continue;
    if (typeof e.partId !== "string") continue;
    const type: ServoType = e.type;
    const current = numOrNull(
      type === "piston" ? e.currentExtension : e.currentAngle,
    );
    const target = numOrNull(
      type === "piston" ? e.targetExtension : e.targetAngle,
    );
    out.push({
      partId: e.partId,
      name: typeof e.partName === "string" ? e.partName : `Servo ${e.partId}`,
      type,
      current,
      target,
      atTarget:
        current === null || target === null
          ? null
          : Math.abs(current - target) < AT_TARGET_EPSILON[type],
      motorEngaged: e.servoMotorIsEngaged === true,
      locked: e.servoIsLocked === true,
      torqueLimit: numOrNull(e.servoMotorLimit),
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
  // Nothing can carry one forward either: `robotics.servos` is never reckonable,
  // so a reading that is not a current observation draws no joints at all.
  const roboticsReading = useTelemetry("robotics.servos");
  const roboticsRaw =
    roboticsReading.state === "observed" ? roboticsReading.value : undefined;
  const available = stillTrue(
    useTelemetry("robotics.available"),
    undefined,
  )?.available;

  // The servo motor, lock and target are actuated on the craft and so are
  // subject to the same signal delay as any other flight-control command. Each
  // dispatches over `useCommand`, which carries per-command in-flight state,
  // the same shape MechJeb uses.
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
    // Both nudges dispatch NOTHING while the target is unread. They are
    // relative: `target + 5` off a substituted zero sends `setTarget value=5`
    // to a hinge really commanded to 60°, so one press of a mapped button
    // collapses the real target and the operator sees only their own nudge.
    targetUp: (p) => {
      if (p.kind === "button" && p.value !== true) return undefined;
      if (!selected || selected.target === null) return undefined;
      const next = selected.target + TARGET_STEP[selected.type];
      setTarget(selected.partId, selected.type, next);
      return { Target: next };
    },
    targetDown: (p) => {
      if (p.kind === "button" && p.value !== true) return undefined;
      if (!selected || selected.target === null) return undefined;
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
      <Panel
        panelTitle="ROBOTICS"
        sections={
          <Section>
            <EmptyState role="status">
              {available === false
                ? "Breaking Ground not installed"
                : "No robotic parts on this vessel"}
            </EmptyState>
          </Section>
        }
      />
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
    <Panel
      panelTitle="ROBOTICS"
      sections={[
        <Section key="readout" full>
          <Cluster justify="start" align="baseline" wrap>
            {selected.current === null ? (
              <Text size="lg" weight="semibold" tone="muted" role="status">
                Position unknown
              </Text>
            ) : (
              <Text size="lg" weight="semibold">
                {formatPos(selected.type, selected.current)}
                <Unit>{unit}</Unit>
              </Text>
            )}
            <Text tone="muted" aria-hidden="true">
              →
            </Text>
            {selected.target === null ? (
              <Text tone="muted" size="lg" role="status">
                Target unknown
              </Text>
            ) : (
              <Text tone="muted" size="lg">
                {formatPos(selected.type, selected.target)}
                <Unit>{unit}</Unit>
              </Text>
            )}
            {/* No badge with nothing to derive it from. AT TARGET off two
                substituted zeros is the same lie one layer up: it tells the
                operator the joint has arrived somewhere nobody measured. */}
            {showToggles && selected.atTarget !== null && (
              <Badge
                severity={selected.atTarget ? "nominal" : undefined}
                role="status"
              >
                {selected.atTarget ? "AT TARGET" : "MOVING"}
              </Badge>
            )}
          </Cluster>
        </Section>,
        <Section key="target" gap="sm">
          {/* The stepper is RELATIVE to the target beside it, so an unread
              target disables it rather than stepping off a substituted zero.
              The reason rides the accessible NAME rather than a visual-only
              greying, so a screen reader hears why the control will not act,
              and the readout beside it says the same thing on screen. */}
          <Cluster justify="between" gap="md" wrap>
            <ReadoutCaption>Target</ReadoutCaption>
            <Inline gap="sm">
              <ActionButton
                tone="ghost"
                type="button"
                aria-label={stepperLabel("Decrease target", selected.target)}
                disabled={selected.target === null}
                onClick={() =>
                  selected.target !== null &&
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
                {selected.target === null ? (
                  "unknown"
                ) : (
                  <>
                    {formatPos(selected.type, selected.target)}
                    {unit}
                  </>
                )}
              </Text>
              <ActionButton
                tone="ghost"
                type="button"
                aria-label={stepperLabel("Increase target", selected.target)}
                disabled={selected.target === null}
                onClick={() =>
                  selected.target !== null &&
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
        </Section>,
        showServoList && (
          <Section key="joints" gap="sm" aria-label="Robotic joints">
            {servos.map((s) => (
              <SelectableRow
                key={s.partId}
                selected={s.partId === selected.partId}
                onClick={() => setSelectedId(s.partId)}
              >
                <span>{s.name}</span>
                <span>
                  {s.type} · {posWithUnit(s.type, s.current)}/
                  {posWithUnit(s.type, s.target)}
                  {s.locked ? " · locked" : s.atTarget === true ? " · ✓" : ""}
                </span>
              </SelectableRow>
            ))}
          </Section>
        ),
      ]}
    />
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
