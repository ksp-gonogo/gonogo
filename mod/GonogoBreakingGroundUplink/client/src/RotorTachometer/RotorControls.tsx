import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import {
  ActionButton,
  Cluster,
  Inline,
  ReadoutCaption,
  Section,
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
import { type RotorInfo, RPM_STEP, TORQUE_STEP } from "./rotors";

/** A brake toggle's state word; an unread brake is "unknown", never off. */
function brakeStateText(brakePercentage: number | null): string {
  if (brakePercentage === null) return "unknown";
  return brakePercentage > 0 ? "on" : "off";
}

/** The reverse button's text: the heading it spins, or the bare verb when the heading is unread. */
function directionText(counterClockwise: boolean | null): string {
  if (counterClockwise === null) return "Reverse";
  return counterClockwise ? "↺ CCW" : "↻ CW";
}

export interface RotorControlsProps {
  selected: RotorInfo;
  torqueReading: Reading<Value<"%">>;
  setRpmLimit: (id: string, rpm: number) => void;
  setTorqueLimit: (id: string, pct: number) => void;
  setBrake: (id: string, pct: number) => void;
  setMotor: (id: string, engaged: boolean) => void;
  setLock: (id: string, locked: boolean) => void;
  reverse: (id: string) => void;
}

/** The selected rotor's steppers and toggles; each is relative to or inverted from a figure read back, so an unread one disables it. */
export function RotorControls({
  selected,
  torqueReading,
  setRpmLimit,
  setTorqueLimit,
  setBrake,
  setMotor,
  setLock,
  reverse,
}: RotorControlsProps) {
  return (
    <Section gap="related-dense">
      {/* Relative to the value beside them, so an unread figure disables them. */}
      <Cluster justify="between" wrap>
        <ReadoutCaption>RPM cap</ReadoutCaption>
        <Inline>
          <ActionButton
            tone="ghost"
            type="button"
            aria-label={stepperLabel("Lower RPM cap", selected.rpmLimit)}
            disabled={selected.rpmLimit === null}
            onClick={() =>
              selected.rpmLimit !== null &&
              setRpmLimit(selected.partId, selected.rpmLimit - RPM_STEP)
            }
          >
            −
          </ActionButton>
          <Text size="sm" tone="default">
            {selected.rpmLimit === null
              ? "RPM cap unknown"
              : Math.round(selected.rpmLimit)}
          </Text>
          <ActionButton
            tone="ghost"
            type="button"
            aria-label={stepperLabel("Raise RPM cap", selected.rpmLimit)}
            disabled={selected.rpmLimit === null}
            onClick={() =>
              selected.rpmLimit !== null &&
              setRpmLimit(selected.partId, selected.rpmLimit + RPM_STEP)
            }
          >
            +
          </ActionButton>
        </Inline>
      </Cluster>

      <Cluster justify="between" wrap>
        <ReadoutCaption>Torque</ReadoutCaption>
        <Inline>
          <ActionButton
            tone="ghost"
            type="button"
            aria-label={stepperLabel(
              "Lower torque limit",
              selected.torqueLimit,
            )}
            disabled={selected.torqueLimit === null}
            onClick={() =>
              selected.torqueLimit !== null &&
              setTorqueLimit(
                selected.partId,
                selected.torqueLimit - TORQUE_STEP,
              )
            }
          >
            −
          </ActionButton>
          <Text size="sm" tone="default">
            {/* A worded absence, since a bare placeholder between two steppers reads as a render failure. */}
            {selected.torqueLimit === null ? (
              "Torque unknown"
            ) : (
              <Unit value={torqueReading} decimals={0} />
            )}
          </Text>
          <ActionButton
            tone="ghost"
            type="button"
            aria-label={stepperLabel(
              "Raise torque limit",
              selected.torqueLimit,
            )}
            disabled={selected.torqueLimit === null}
            onClick={() =>
              selected.torqueLimit !== null &&
              setTorqueLimit(
                selected.partId,
                selected.torqueLimit + TORQUE_STEP,
              )
            }
          >
            +
          </ActionButton>
        </Inline>
      </Cluster>

      <Cluster justify="start" wrap>
        {/* An unread flag gets a third, disabled state rather than defaulting to off or unlocked. */}
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
        {/* The brake sends an absolute percentage inverted from the current one, so an unread brake disables it. */}
        <ToggleButton
          size="sm"
          active={
            selected.brakePercentage !== null && selected.brakePercentage > 0
          }
          tone="warn"
          disabled={selected.brakePercentage === null}
          aria-label={
            selected.brakePercentage === null
              ? "Toggle brake (unavailable, not reported)"
              : undefined
          }
          onClick={() =>
            selected.brakePercentage !== null &&
            setBrake(selected.partId, selected.brakePercentage > 0 ? 0 : 100)
          }
        >
          Brake {brakeStateText(selected.brakePercentage)}
        </ToggleButton>
        {/* Reverse stays available on an unread heading; only the heading it prints is withheld. */}
        <ToggleButton size="sm" onClick={() => reverse(selected.partId)}>
          {directionText(selected.counterClockwise)}
        </ToggleButton>
      </Cluster>
    </Section>
  );
}
