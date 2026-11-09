import {
  type AnyBoundCommand,
  type ValueCommand,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Button,
  Cluster,
  ReadoutCaption,
  type ReckoningMarking,
  Section,
  Stepper,
  ToggleButton,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { lockStateText, motorStateText } from "../unreadLabels";
import { ROTOR_MAX_RPM, type RotorInfo, RPM_STEP, TORQUE_STEP } from "./rotors";

/*
 * Each caption sits beside its stepper, and the two pairs share a row, only
 * where they fit: a pair that does not fit wraps under the one before it, and a
 * stepper that does not fit beside its caption wraps under it. The captions
 * share a width so the steppers of stacked pairs line up.
 */
const STEPPER_PAIRS: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  columnGap: "var(--gap-related)",
  rowGap: "var(--gap-related-dense)",
};

const STEPPER_PAIR: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "var(--gap-related-dense)",
};

const CAPTION_WIDTH: CSSProperties = { minWidth: "9ch" };

/** A stepper row's caption, held to a width the other caption shares. */
function CaptionCell({ children }: { children: string }) {
  return (
    <span style={CAPTION_WIDTH}>
      <ReadoutCaption>{children}</ReadoutCaption>
    </span>
  );
}

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
  /** The command the RPM cap stepper sends, given the cap stepped to. */
  rpmStepCommand: ValueCommand<number, unknown, unknown>;
  /** The command the torque stepper sends, given the limit stepped to. */
  torqueStepCommand: ValueCommand<number, unknown, unknown>;
  /** The command the brake control sends, given true to apply the brake. */
  brakeCommand: ValueCommand<boolean, unknown, unknown>;
  /** The command the motor control sends, given true to engage the motor. */
  motorCommand: ValueCommand<boolean, unknown, unknown>;
  /** The command the lock control sends, given true to lock the rotor. */
  lockCommand: ValueCommand<boolean, unknown, unknown>;
  /** The command the reverse button sends. */
  reverseCommand: AnyBoundCommand;
  /** The held marking of the read behind the toggles' flags and the heading, while it is held. */
  flagsMarked?: ReckoningMarking | null;
}

/** The selected rotor's steppers and toggles; each is relative to or inverted from a figure read back, so an unread one disables it. */
export function RotorControls({
  selected,
  rpmCommand,
  torqueCommand,
  rpmStepCommand,
  torqueStepCommand,
  brakeCommand,
  motorCommand,
  lockCommand,
  reverseCommand,
  flagsMarked = null,
}: RotorControlsProps) {
  return (
    <Section gap="related-dense">
      {/* Relative to the value beside them, so an unread figure disables them. One grid, so both rows' steppers share their columns. */}
      <div style={STEPPER_PAIRS}>
        <div style={STEPPER_PAIR}>
          <CaptionCell>RPM cap</CaptionCell>
          <Stepper
            label="RPM cap"
            unknown="RPM cap unknown"
            value={rpmCommand.commanded}
            expected={rpmCommand.expected}
            lastSeen={rpmCommand.lastSeen}
            lastSeenCaption={rpmCommand.lastSeenCaption}
            min={0}
            max={ROTOR_MAX_RPM}
            step={RPM_STEP}
            format={(v) => writeQuantity(value("rpm", v), { decimals: 0 })}
            command={rpmStepCommand}
            unavailable={
              rpmCommand.commanded === null
                ? "The RPM cap is not reported"
                : null
            }
          />
        </div>
        <div style={STEPPER_PAIR}>
          <CaptionCell>Torque</CaptionCell>
          <Stepper
            label="Torque limit"
            unknown="Torque unknown"
            value={torqueCommand.commanded}
            expected={torqueCommand.expected}
            lastSeen={torqueCommand.lastSeen}
            lastSeenCaption={torqueCommand.lastSeenCaption}
            min={0}
            max={100}
            step={TORQUE_STEP}
            format={(v) => writeQuantity(value("%", v), { decimals: 0 })}
            command={torqueStepCommand}
            unavailable={
              torqueCommand.commanded === null
                ? "The torque limit is not reported"
                : null
            }
          />
        </div>
      </div>

      <Cluster justify="start" wrap>
        {/* An unread flag gets a third, disabled state rather than defaulting to off or unlocked. */}
        <ToggleButton
          size="sm"
          tone="go"
          command={motorCommand}
          state={selected.motorEngaged}
          name="Motor"
          unavailable={
            selected.motorEngaged === null
              ? "The motor state is not reported"
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
            selected.locked === null ? "The lock state is not reported" : null
          }
          marking={flagsMarked}
        >
          {(shown) => lockStateText(typeof shown === "boolean" ? shown : null)}
        </ToggleButton>
        {/* The brake sends an absolute percentage inverted from the current one, so an unread brake disables it. */}
        <ToggleButton
          size="sm"
          tone="warn"
          command={brakeCommand}
          state={
            selected.brakePercentage === null
              ? null
              : selected.brakePercentage > 0
          }
          name="Brake"
          unavailable={
            selected.brakePercentage === null
              ? "The brake is not reported"
              : null
          }
          marking={flagsMarked}
        >
          {(shown) =>
            `Brake ${brakeStateText(typeof shown === "boolean" ? (shown ? 100 : 0) : null)}`
          }
        </ToggleButton>
        {/* Reverse stays available on an unread heading; only the heading it prints is withheld. */}
        <Button
          size="sm"
          aria-label={reverseLabel(selected.counterClockwise)}
          command={reverseCommand}
        >
          {directionText(selected.counterClockwise)}
        </Button>
      </Cluster>
    </Section>
  );
}
