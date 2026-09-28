import {
  Badge,
  Button,
  Cluster,
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
import {
  flagLabel,
  lockStateText,
  motorStateText,
  stepperLabel,
} from "../unreadLabels";
import {
  formatPos,
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
  /** The field readings a servo's drawn positions come from. */
  positionReadings: (s: ServoInfo) => PositionReadings;
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

function listSuffix(s: ServoInfo): string {
  if (s.locked === true) return " · locked";
  if (s.atTarget === true) return " · ✓";
  return "";
}

export function RoboticsConsoleView({
  servos,
  selected,
  positionReadings,
  rows,
  onSelect,
  setTarget,
  setMotor,
  setLock,
}: RoboticsConsoleViewProps) {
  const unit = unitFor(selected.type);
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
          <Cluster justify="between" wrap>
            <ReadoutCaption>Target</ReadoutCaption>
            <Inline>
              <Button
                variant="ghost"
                size="sm"
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
              </Button>
              <Text size="sm">
                {selected.target === null ? (
                  "unknown"
                ) : (
                  <>
                    {formatPos(selected.type, selected.target)}
                    {unit}
                  </>
                )}
              </Text>
              <Button
                variant="ghost"
                size="sm"
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
              </Button>
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
                Motor {motorStateText(selected.motorEngaged)}
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
                  {listSuffix(s)}
                </span>
              </SelectableRow>
            ))}
          </Section>
        ),
      ]}
    />
  );
}
