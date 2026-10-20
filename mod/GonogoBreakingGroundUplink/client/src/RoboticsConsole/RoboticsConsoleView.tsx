import {
  Badge,
  Button,
  Cluster,
  type heldGradeOf,
  Inline,
  Panel,
  ReadoutCaption,
  Section,
  SelectableRow,
  Text,
  ToggleButton,
  Unit,
  type UnitValue,
} from "@ksp-gonogo/ui-kit";
import { lockStateText, motorStateText } from "../unreadLabels";
import { positionDecimals, type ServoInfo, TARGET_STEP } from "./servos";

type PositionReading = UnitValue<"°" | "m">;

export interface PositionReadings {
  current: PositionReading;
  target: PositionReading;
}

export interface RoboticsConsoleViewProps {
  servos: ServoInfo[];
  selected: ServoInfo;
  /** The field readings a servo's drawn positions come from. */
  positionReadings: (s: ServoInfo) => PositionReadings;
  /** The grade the servo list is held at while it has stopped arriving; the flags and the list's words are text, so the panel carries the mark. */
  held: ReturnType<typeof heldGradeOf>;
  /** Grid rows; below six only the readout and target stepper fit. */
  rows: number;
  onSelect: (partId: string) => void;
  setTarget: (id: string, type: ServoInfo["type"], value: number) => void;
  setMotor: (id: string, engaged: boolean) => void;
  setLock: (id: string, locked: boolean) => void;
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
  held,
  rows,
  onSelect,
  setTarget,
  setMotor,
  setLock,
}: RoboticsConsoleViewProps) {
  const decimals = positionDecimals(selected.type);
  const readings = positionReadings(selected);
  const showToggles = rows >= 6;
  const showServoList = servos.length > 1 && rows >= 6;

  return (
    <Panel
      panelTitle="ROBOTICS"
      panelBadges={
        held === undefined
          ? undefined
          : [{ id: "read", label: "Reading", held }]
      }
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
          <Cluster justify="between" wrap>
            <ReadoutCaption>Target</ReadoutCaption>
            <Inline>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                aria-label="Decrease target"
                disabled={selected.target === null}
                disabledReason="The target is not reported"
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
              </Button>
              <Text size="sm">
                {selected.target === null ? (
                  "unknown"
                ) : (
                  <Unit value={readings.target} decimals={decimals} />
                )}
              </Text>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                aria-label="Increase target"
                disabled={selected.target === null}
                disabledReason="The target is not reported"
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
              </Button>
            </Inline>
          </Cluster>

          {/* An unread flag gets a third, disabled state rather than defaulting to off or unlocked. */}
          {showToggles && (
            <Cluster justify="start" wrap>
              <ToggleButton
                size="sm"
                pressed={selected.motorEngaged === true}
                tone="go"
                disabled={
                  selected.motorEngaged === null || selected.motorized === false
                }
                disabledReason={
                  selected.motorEngaged === null
                    ? "The motor state is not reported"
                    : "This part has no motor"
                }
                onClick={() =>
                  selected.motorEngaged !== null &&
                  setMotor(selected.partId, !selected.motorEngaged)
                }
              >
                Motor {motorStateText(selected.motorEngaged)}
              </ToggleButton>
              {selected.motorState && (
                <Text level="muted" size="sm">
                  {selected.motorState}
                </Text>
              )}
              <ToggleButton
                size="sm"
                pressed={selected.locked === true}
                tone="warn"
                disabled={selected.locked === null}
                disabledReason="The lock state is not reported"
                onClick={() =>
                  selected.locked !== null &&
                  setLock(selected.partId, !selected.locked)
                }
              >
                {lockStateText(selected.locked)}
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
