import type {
  ActionDefinition,
  ComponentProps,
  TopicReading,
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
import { emptyStateText } from "../robotics";
import { BREAKING_GROUND } from "../uplink";
import { boolOrNull, numOrNull } from "../wire";

/**
 * The active vessel's robotic hinges, rotation servos and pistons, with current-vs-target position and motor and lock controls.
 * The selected joint (first by default) gets the target stepper and the serial actions; rotors belong to Rotor Tachometer.
 */

type RoboticsConsoleConfig = Record<string, never>;

/** Per type, because a hinge steps in degrees and a piston in metres. */
const TARGET_STEP: Record<ServoType, number> = {
  hinge: 5,
  rotationServo: 5,
  piston: 0.05,
};

/** A hinge reads in whole degrees; a piston in metres, which needs decimals. */
const formatPos = (type: ServoType, v: number): string =>
  type === "piston" ? v.toFixed(2) : String(Math.round(v));

/** At-target tolerance per type: half a degree for the angle kinds, a centimetre for a piston. */
const AT_TARGET_EPSILON: Record<ServoType, number> = {
  hinge: 0.5,
  rotationServo: 0.5,
  piston: 0.01,
};

/** A rotation servo behaves as a hinge here; the names differ only because the parts do. */
export type ServoType = "hinge" | "rotationServo" | "piston";

/**
 * One positioned joint as this console drives it.
 * Every figure is `null` when withheld, and `atTarget` is `null` whenever either input is, since the stepper steps from `target`.
 */
export interface ServoInfo {
  partId: string;
  name: string;
  type: ServoType;
  current: number | null;
  target: number | null;
  atTarget: boolean | null;
  /** Unknown is never false: the toggles send an absolute state computed by inverting these. */
  motorEngaged: boolean | null;
  locked: boolean | null;
  torqueLimit: number | null;
}

/** A fact's value, held through stale; `whenConfirmedNothing` is what an `absent` tombstone means, distinct from `pending`. */
function stillTrue<T, A>(
  reading: TopicReading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

// A piston's extension is a length in metres, not a percentage.
const unitFor = (type: ServoType) => (type === "piston" ? "m" : "°");

/** A position for the joint list; a withheld reading is "unknown", with no unit. */
const posWithUnit = (type: ServoType, v: number | null): string =>
  v === null ? "unknown" : `${formatPos(type, v)}${unitFor(type)}`;

/** A relative stepper's accessible name, carrying why it is disabled when the figure it steps from was never read. */
const stepperLabel = (action: string, from: number | null): string =>
  from === null ? `${action} (unavailable, not reported)` : action;

/** The same, for a toggle whose `enabled` is the inverse of an unread flag. */
const flagLabel = (action: string, from: boolean | null): string | undefined =>
  from === null ? `${action} (unavailable, not reported)` : undefined;

/**
 * Parses `robotics.servos` down to the hinges, rotation servos and pistons this widget drives.
 * `partId` is the stringified `Part.flightID`, unique even among symmetric same-named parts; an entry without one cannot be targeted and is dropped.
 */
export function parseServos(raw: unknown): ServoInfo[] {
  if (!Array.isArray(raw)) return [];
  const entries: unknown[] = raw;
  const out: ServoInfo[] = [];
  for (const entry of entries) {
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
      motorEngaged: boolOrNull(e.servoMotorIsEngaged),
      locked: boolOrNull(e.servoIsLocked),
      torqueLimit: numOrNull(e.servoMotorLimit),
    });
  }
  return out;
}

/**
 * The same joints off a list that has stopped arriving: the measured position (and the verdict derived from it) withheld.
 * `target` stays, because it is the last value commanded and does not drift while the link is down.
 */
export function datePositions(servos: ServoInfo[]): ServoInfo[] {
  return servos.map((s) => ({ ...s, current: null, atTarget: null }));
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
  // Only the measured positions drift; the rest of each joint is a fact, so the list is held and its positions dated.
  const roboticsReading = useTelemetry("robotics.servos");
  const roboticsRaw = stillTrue(roboticsReading, undefined);
  const positionsNotCurrent = roboticsReading.state === "stale";
  // Two different facts: whether this craft carries a robotic part, and whether the install has the expansion.
  const available = stillTrue(
    useTelemetry("robotics.available"),
    undefined,
  )?.available;
  const breakingGround = stillTrue(
    useTelemetry("game.dlc"),
    undefined,
  )?.breakingGround;

  const targetCmd = useCommand("robotics.servo.setTarget");
  const motorCmd = useCommand("robotics.servo.setMotor");
  const lockCmd = useCommand("robotics.servo.setLock");
  usePanelDelay(targetCmd);
  usePanelDelay(motorCmd);
  usePanelDelay(lockCmd);

  const servos = positionsNotCurrent
    ? datePositions(parseServos(roboticsRaw))
    : parseServos(roboticsRaw);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    servos.find((s) => s.partId === selectedId) ?? servos[0] ?? null;

  // Type-formatted, so a piston is not commanded to a whole metre.
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
    // The nudges are relative, so they dispatch nothing while the target is unread.
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
    // Motor and lock send an absolute state inverted from the one read back, so an unread flag dispatches nothing.
    toggleMotor: (p) => {
      if (p.kind === "button" && p.value !== true) return undefined;
      if (!selected || selected.motorEngaged === null) return undefined;
      setMotor(selected.partId, !selected.motorEngaged);
      return { Motor: !selected.motorEngaged };
    },
    toggleLock: (p) => {
      if (p.kind === "button" && p.value !== true) return undefined;
      if (!selected || selected.locked === null) return undefined;
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
              {emptyStateText(
                breakingGround,
                available,
                roboticsReading.state === "observed" ||
                  roboticsReading.state === "stale",
                "robotic parts",
              )}
            </EmptyState>
          </Section>
        }
      />
    );
  }

  const unit = unitFor(selected.type);
  // Below six rows only the readout and target stepper fit, so the toggles and joint list drop out.
  const rows = h ?? 8;
  const showToggles = rows >= 6;
  const showServoList = servos.length > 1 && rows >= 6;

  return (
    <Panel
      panelTitle="ROBOTICS"
      sections={[
        <Section key="readout" full>
          {positionsNotCurrent && (
            /* Names which half is dated, so the held list does not read as a dead panel. */
            <Text tone="warn" size="xs" role="status" aria-live="polite">
              Measured positions no longer current: the joints, their targets,
              lock and motor state are the last reported.
            </Text>
          )}
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
        <Section key="target" gap="related-dense">
          {/* Relative to the target, so an unread target disables it. */}
          <Cluster justify="between" wrap>
            <ReadoutCaption>Target</ReadoutCaption>
            <Inline>
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

          {/* An unread flag gets a third, disabled state rather than defaulting to off or unlocked. */}
          {showToggles && (
            <Cluster justify="start" wrap>
              <ToggleButton
                size="sm"
                active={selected.motorEngaged === true}
                tone="go"
                disabled={selected.motorEngaged === null}
                aria-label={flagLabel("Toggle motor", selected.motorEngaged)}
                onClick={() =>
                  selected.motorEngaged !== null &&
                  setMotor(selected.partId, !selected.motorEngaged)
                }
              >
                Motor{" "}
                {selected.motorEngaged === null
                  ? "unknown"
                  : selected.motorEngaged
                    ? "on"
                    : "off"}
              </ToggleButton>
              <ToggleButton
                size="sm"
                active={selected.locked === true}
                tone="warn"
                disabled={selected.locked === null}
                aria-label={flagLabel("Toggle lock", selected.locked)}
                onClick={() =>
                  selected.locked !== null &&
                  setLock(selected.partId, !selected.locked)
                }
              >
                {selected.locked === null
                  ? "Lock unknown"
                  : selected.locked
                    ? "Locked"
                    : "Unlocked"}
              </ToggleButton>
            </Cluster>
          )}
        </Section>,
        showServoList && (
          <Section key="joints" gap="related-dense" aria-label="Robotic joints">
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
                  {s.locked === true
                    ? " · locked"
                    : s.atTarget === true
                      ? " · ✓"
                      : ""}
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
  dataRequirements: [
    "robotics.servos",
    "robotics.available.available",
    "game.dlc.breakingGround",
  ],
  defaultConfig: {},
  actions: roboticsActions,
  pushable: true,
  requires: ["flight"],
  owner: BREAKING_GROUND,
});

export { RoboticsConsoleComponent };
