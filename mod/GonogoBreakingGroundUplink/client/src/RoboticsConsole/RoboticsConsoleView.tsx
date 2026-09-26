import {
  ActionButton,
  Badge,
  Cluster,
  Inline,
  Panel,
  ReadoutCaption,
  Section,
  SelectableRow,
  Text,
  ToggleButton,
  Unit,
} from "@ksp-gonogo/ui-kit";
import {
  flagLabel,
  lockStateText,
  motorStateText,
  stepperLabel,
} from "../unreadLabels";
import {
  formatPos,
  posWithUnit,
  type ServoInfo,
  TARGET_STEP,
  unitFor,
} from "./servos";

export interface RoboticsConsoleViewProps {
  servos: ServoInfo[];
  selected: ServoInfo;
  positionsNotCurrent: boolean;
  /** Grid rows; below six only the readout and target stepper fit. */
  rows: number;
  onSelect: (partId: string) => void;
  setTarget: (id: string, type: ServoInfo["type"], value: number) => void;
  setMotor: (id: string, engaged: boolean) => void;
  setLock: (id: string, locked: boolean) => void;
}

function listSuffix(s: ServoInfo): string {
  if (s.locked === true) return " · locked";
  if (s.atTarget === true) return " · ✓";
  return "";
}

export function RoboticsConsoleView({
  servos,
  selected,
  positionsNotCurrent,
  rows,
  onSelect,
  setTarget,
  setMotor,
  setLock,
}: RoboticsConsoleViewProps) {
  const unit = unitFor(selected.type);
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
                  {s.type} · {posWithUnit(s.type, s.current)}/
                  {posWithUnit(s.type, s.target)}
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
