import { type ValueCommand, value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  Panel,
  ReadoutCaption,
  type ReckoningMarking,
  Section,
  SelectableRow,
  Stepper,
  Text,
  ToggleButton,
  Unit,
  type UnitValue,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { lockStateText, motorStateText } from "../unreadLabels";
import {
  positionDecimals,
  type ServoInfo,
  TARGET_STEP,
  unitFor,
} from "./servos";

type PositionReading = UnitValue<"°" | "m">;

export interface PositionReadings {
  current: PositionReading;
  target: PositionReading;
}

export interface RoboticsConsoleViewProps {
  servos: ServoInfo[];
  selected: ServoInfo;
  /** The selected joint's target as commanded, expected at the craft now, and last seen while the readings are held. */
  targetCommand: {
    commanded: number | null;
    expected: number | null;
    lastSeen: number | null;
    lastSeenCaption?: string;
  };
  /** The field readings a servo's drawn positions come from. */
  positionReadings: (s: ServoInfo) => PositionReadings;
  /** The held marking of the servo list while it has stopped arriving; the flags are the toggles' words, so the toggles carry it. */
  flagsMarked: ReckoningMarking | null;
  /** Grid rows; below six only the readout and target stepper fit. */
  rows: number;
  onSelect: (partId: string) => void;
  /** The command the stepper sends, given the position stepped to. */
  stepCommand: ValueCommand<number, unknown, unknown>;
  /** The command the motor control sends, given true to engage the motor. */
  motorCommand: ValueCommand<boolean, unknown, unknown>;
  /** The command the lock control sends, given true to lock the joint. */
  lockCommand: ValueCommand<boolean, unknown, unknown>;
}

/** One of a joint's positions for the list; a withheld figure is "unknown" rather than a drawn zero. */
function ServoPosition({
  servo,
  of,
  readings,
}: {
  servo: ServoInfo;
  of: "current" | "target";
  readings: PositionReadings;
}) {
  if (servo[of] === null) return "unknown";
  return <Unit value={readings[of]} decimals={positionDecimals(servo.type)} />;
}

function ListSuffix({ servo }: { servo: ServoInfo }) {
  if (servo.locked === true) return " · locked";
  if (servo.atTarget === true) {
    return (
      <>
        {" · "}
        <span role="img" aria-label="at target">
          ✓
        </span>
      </>
    );
  }
  return null;
}

export function RoboticsConsoleView({
  servos,
  selected,
  positionReadings,
  flagsMarked,
  targetCommand,
  rows,
  onSelect,
  stepCommand,
  motorCommand,
  lockCommand,
}: RoboticsConsoleViewProps) {
  const decimals = positionDecimals(selected.type);
  const readings = positionReadings(selected);
  const showToggles = rows >= 6;
  const showServoList = servos.length > 1 && rows >= 6;

  return (
    <Panel
      panelTitle="ROBOTICS"
      sections={[
        <Section key="readout" full>
          <Cluster justify="start" align="baseline" wrap>
            {selected.current === null ? (
              <Text size="lg" weight="semibold" level="muted" role="status">
                Position unknown
              </Text>
            ) : (
              <Text size="lg" weight="semibold">
                <Unit value={readings.current} decimals={decimals} />
              </Text>
            )}
            <Text level="muted" aria-hidden="true">
              →
            </Text>
            {selected.target === null ? (
              <Text level="muted" size="lg" role="status">
                Target unknown
              </Text>
            ) : (
              <Text level="muted" size="lg">
                <Unit value={readings.target} decimals={decimals} />
              </Text>
            )}
            {showToggles && selected.atTarget !== null && (
              <Badge tone={selected.atTarget ? "go" : undefined} role="status">
                {selected.atTarget ? "AT TARGET" : "MOVING"}
              </Badge>
            )}
          </Cluster>
        </Section>,
        <Section key="target" gap="related-dense">
          {/* Relative to the target, so an unread target disables it. */}
          <Cluster justify="start" wrap>
            <ReadoutCaption>Target</ReadoutCaption>
            <Cluster justify="start">
              <Stepper
                label="target"
                unknown="unknown"
                value={targetCommand.commanded}
                expected={targetCommand.expected}
                lastSeen={targetCommand.lastSeen}
                lastSeenCaption={targetCommand.lastSeenCaption}
                step={TARGET_STEP[selected.type]}
                format={(v) =>
                  writeQuantity(value(unitFor(selected.type), v), { decimals })
                }
                command={stepCommand}
                unavailable={
                  targetCommand.commanded === null
                    ? "The target is not reported"
                    : null
                }
              />
            </Cluster>
          </Cluster>

          {/* An unread flag gets a third, disabled state rather than defaulting to off or unlocked. */}
          {showToggles && (
            <Cluster justify="start" wrap>
              <ToggleButton
                size="sm"
                tone="go"
                command={motorCommand}
                state={selected.motorEngaged}
                name="Motor"
                unavailable={
                  selected.motorEngaged === null
                    ? "The motor state is not reported"
                    : selected.motorized === false
                      ? "This part has no motor"
                      : null
                }
                marking={flagsMarked}
              >
                {(shown) =>
                  `Motor ${motorStateText(typeof shown === "boolean" ? shown : null)}`
                }
              </ToggleButton>
              <ToggleButton
                size="sm"
                tone="warn"
                command={lockCommand}
                state={selected.locked}
                name="Lock"
                unavailable={
                  selected.locked === null
                    ? "The lock state is not reported"
                    : null
                }
                marking={flagsMarked}
              >
                {(shown) =>
                  lockStateText(typeof shown === "boolean" ? shown : null)
                }
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
                onClick={() => onSelect(s.partId)}
              >
                <span>{s.name}</span>
                <span>
                  {s.type} ·{" "}
                  <ServoPosition
                    servo={s}
                    of="current"
                    readings={positionReadings(s)}
                  />
                  /
                  <ServoPosition
                    servo={s}
                    of="target"
                    readings={positionReadings(s)}
                  />
                  <ListSuffix servo={s} />
                </span>
              </SelectableRow>
            ))}
          </Section>
        ),
      ]}
    />
  );
}
