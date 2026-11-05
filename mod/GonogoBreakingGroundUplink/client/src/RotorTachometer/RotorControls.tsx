import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import {
  Button,
  Cluster,
  CommandStepper,
  Grid,
  ReadoutCaption,
  type ReckoningMarking,
  Section,
  Text,
  ToggleButton,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { lockStateText, motorStateText } from "../unreadLabels";
import { ROTOR_MAX_RPM, type RotorInfo, RPM_STEP, TORQUE_STEP } from "./rotors";

/** A brake toggle's state word; an unread brake is "unknown", never off. */
function brakeStateText(brakePercentage: number | null): string {
  if (brakePercentage === null) return "unknown";
  return brakePercentage > 0 ? "on" : "off";
}

/** The reverse button's text: the heading it spins, or the bare verb when the heading is unread. */
function directionText(counterClockwise: boolean | null): string {
  if (counterClockwise === null) return "Reverse";
  return counterClockwise ? "CCW" : "CW";
}

/** The reverse button's accessible name: the printed heading is the current one, not the one the press sets. */
function reverseLabel(counterClockwise: boolean | null): string | undefined {
  if (counterClockwise === null) return undefined;
  return `Reverse (now ${counterClockwise ? "CCW" : "CW"})`;
}

export interface RotorControlsProps {
  selected: RotorInfo;
  /** The RPM cap as commanded, expected at the craft now, and last seen while the readings are held. */
  rpmCommand: {
    commanded: number | null;
    expected: number | null;
    lastSeen: number | null;
    lastSeenCaption?: string;
  };
  /** The torque limit as commanded, expected at the craft now, and last seen while the readings are held. */
  torqueCommand: {
    commanded: number | null;
    expected: number | null;
    lastSeen: number | null;
    lastSeenCaption?: string;
  };
  setRpmLimit: (id: string, rpm: number) => void;
  setTorqueLimit: (id: string, pct: number) => void;
  setBrake: (id: string, pct: number) => void;
  setMotor: (id: string, engaged: boolean) => void;
  setLock: (id: string, locked: boolean) => void;
  reverse: (id: string) => void;
  /** The held marking of the read behind the toggles' flags and the heading, while it is held. */
  flagsMarked?: ReckoningMarking | null;
}

/** The selected rotor's steppers and toggles; each is relative to or inverted from a figure read back, so an unread one disables it. */
export function RotorControls({
  selected,
  rpmCommand,
  torqueCommand,
  setRpmLimit,
  setTorqueLimit,
  setBrake,
  setMotor,
  setLock,
  reverse,
  flagsMarked = null,
}: RotorControlsProps) {
  return (
    <Section gap="related-dense">
      {/* Relative to the value beside them, so an unread figure disables them. One grid, so both rows' steppers share their columns. */}
      <Grid cols="1fr auto auto auto">
        <ReadoutCaption>RPM cap</ReadoutCaption>
        <CommandStepper
          unknown="RPM cap unknown"
          lowerLabel="Lower RPM cap"
          raiseLabel="Raise RPM cap"
          commanded={rpmCommand.commanded}
          expected={rpmCommand.expected}
          lastSeen={rpmCommand.lastSeen}
          lastSeenCaption={rpmCommand.lastSeenCaption}
          min={0}
          max={ROTOR_MAX_RPM}
          step={RPM_STEP}
          figure={(v) => <Unit value={value("rpm", v)} decimals={0} />}
          disabledReason="The RPM cap is not reported"
          onChange={(v) => setRpmLimit(selected.partId, v)}
        />
        <ReadoutCaption>Torque</ReadoutCaption>
        <CommandStepper
          unknown="Torque unknown"
          lowerLabel="Lower torque limit"
          raiseLabel="Raise torque limit"
          commanded={torqueCommand.commanded}
          expected={torqueCommand.expected}
          lastSeen={torqueCommand.lastSeen}
          lastSeenCaption={torqueCommand.lastSeenCaption}
          min={0}
          max={100}
          step={TORQUE_STEP}
          figure={(v) => <Unit value={value("%", v)} decimals={0} />}
          disabledReason="The torque limit is not reported"
          onChange={(v) => setTorqueLimit(selected.partId, v)}
        />
      </Grid>

      <Cluster justify="start" wrap>
        {/* An unread flag gets a third, disabled state rather than defaulting to off or unlocked. */}
        <ToggleButton
          size="sm"
          pressed={selected.motorEngaged === true}
          tone="go"
          disabled={selected.motorEngaged === null}
          disabledReason="The motor state is not reported"
          marked={flagsMarked}
          onClick={() =>
            selected.motorEngaged !== null &&
            setMotor(selected.partId, !selected.motorEngaged)
          }
        >
          Motor {motorStateText(selected.motorEngaged)}
        </ToggleButton>
        <ToggleButton
          size="sm"
          pressed={selected.locked === true}
          tone="warn"
          disabled={selected.locked === null}
          disabledReason="The lock state is not reported"
          marked={flagsMarked}
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
          pressed={
            selected.brakePercentage !== null && selected.brakePercentage > 0
          }
          tone="warn"
          disabled={selected.brakePercentage === null}
          disabledReason="The brake is not reported"
          marked={flagsMarked}
          onClick={() =>
            selected.brakePercentage !== null &&
            setBrake(selected.partId, selected.brakePercentage > 0 ? 0 : 100)
          }
        >
          Brake {brakeStateText(selected.brakePercentage)}
        </ToggleButton>
        {/* Reverse stays available on an unread heading; only the heading it prints is withheld. */}
        <Button
          size="sm"
          type="button"
          aria-label={reverseLabel(selected.counterClockwise)}
          marked={flagsMarked}
          onClick={() => reverse(selected.partId)}
        >
          {directionText(selected.counterClockwise)}
        </Button>
      </Cluster>
    </Section>
  );
}
