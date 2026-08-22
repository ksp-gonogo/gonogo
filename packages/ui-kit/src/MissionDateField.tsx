import { useId, useState } from "react";
import { ActionButton } from "./ActionButton";
import { Cluster } from "./Cluster";
import { FieldLabel, Input } from "./Form";
import { formatDuration } from "./formatDuration";
import { kspCalendar } from "./kspTime";
import { Stack } from "./Stack";
import { Text } from "./Text";

/**
 * A universal time ENTERED as a calendar instant: year, day, hour, minute,
 * second, each its own field, plus coarse steps.
 *
 * ## Why five fields and not one
 *
 * An instant a mission runs on is a date, and the operator holding it in their
 * head holds it as "day 214, about ten past four", not as 4,633,000 seconds.
 * One seconds field makes every edit an arithmetic problem: to move an ignition
 * six hours later you have to know how long a day is on the calendar the game
 * is running, which is exactly the knowledge this component exists to carry.
 *
 * ## Both halves are needed, and they do different jobs
 *
 * The fields are for an instant you already know. The coarse steps are for the
 * one you are looking for: nudging a burn a day earlier and watching what
 * happens is the tuning loop, and it is a different gesture from typing a
 * number. Offering only the fields turns every nudge into a re-type; offering
 * only the steps makes a known instant unreachable.
 *
 * ## The calendar is whichever one the game is running
 *
 * Six-hour days and 426-day years on stock Kerbin time, 24 and 365 under a
 * planet pack. The lengths are read per render from `kspCalendar()`, so an
 * entry typed as day 300 means the same instant the game's own clock would call
 * day 300. Compiling the stock numbers in would make this component wrong for
 * an RSS player in a way that still looks like a date, which is the whole reason
 * the calendar is a runtime fact rather than a constant.
 *
 * ## Rounding, and why it is to the second
 *
 * The fields cannot express a fraction of a second, so a UT with one loses it
 * on the first edit. That is deliberate: a plan whose ignition is specified to
 * the microsecond is not a plan an operator typed, and preserving the remainder
 * would make the field show one instant and hold another.
 */
export interface MissionDateFieldProps {
  /** The instant being edited, in seconds since the game's epoch. */
  value: number;

  onChange: (ut: number) => void;

  /** Names the whole group for a screen reader: "Ignition", "Plan end". */
  label: string;

  disabled?: boolean;

  /**
   * The coarse steps offered, in seconds, smallest first. Rendered as a minus
   * button and a plus button per entry. Defaults to a minute, ten minutes, an
   * hour and a day of the LIVE calendar.
   */
  steps?: number[];
}

/** The five components of an instant on the game's own calendar. */
export interface MissionDateParts {
  year: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * Splits a UT into calendar components, with years and days ONE-BASED to match
 * every other date this kit renders: UT zero is Year 1 Day 1, not Year 0 Day 0.
 *
 * A non-finite or negative UT lands on the epoch rather than on a negative year,
 * the same way every other date readout in this kit clamps: a stray value should
 * read as the start of time, not as a nonsensical date.
 */
export function partsOfUt(ut: number): MissionDateParts {
  const { year: YEAR, day: DAY, hour: HOUR, minute: MINUTE } = kspCalendar();
  const clamped = Number.isFinite(ut) ? Math.max(0, ut) : 0;

  const year = Math.floor(clamped / YEAR) + 1;
  const inYear = clamped % YEAR;
  const day = Math.floor(inYear / DAY) + 1;
  const inDay = inYear % DAY;

  return {
    year,
    day,
    hour: Math.floor(inDay / HOUR),
    minute: Math.floor((inDay % HOUR) / MINUTE),
    second: Math.floor(inDay % MINUTE),
  };
}

/**
 * Recombines calendar components into a UT.
 *
 * Deliberately does NOT clamp an out-of-range component: an hour of 30 rolls
 * into the next day, which is what a keyboard-driven edit wants. Typing over
 * the hour field to reach tomorrow morning should work, and refusing it would
 * make the operator do the carry themselves.
 */
export function utOfParts(parts: MissionDateParts): number {
  const { year: YEAR, day: DAY, hour: HOUR, minute: MINUTE } = kspCalendar();
  return (
    (parts.year - 1) * YEAR +
    (parts.day - 1) * DAY +
    parts.hour * HOUR +
    parts.minute * MINUTE +
    parts.second
  );
}

/**
 * A coarse step's label, written by the kit's own duration formatter on the live
 * calendar's tiers: a day's worth of seconds reads as a day, not as 21,600
 * seconds.
 *
 * Not hand-assembled from a number and a letter. A step is a duration and the
 * kit already owns how a duration is written, including which tiers exist on the
 * calendar the game reported; spelling "1d" here would be a second answer to
 * that question, wrong for anyone not on stock Kerbin time.
 */
function stepLabel(seconds: number): string {
  return formatDuration(seconds);
}

export function MissionDateField({
  value,
  onChange,
  label,
  disabled,
  steps,
}: MissionDateFieldProps) {
  const groupId = useId();
  const parts = partsOfUt(value);
  const calendar = kspCalendar();
  const coarse = steps ?? [
    calendar.minute,
    10 * calendar.minute,
    calendar.hour,
    calendar.day,
  ];

  // An in-progress edit is held as TEXT for the one field being typed in.
  //
  // Without it the field is unusable: clearing it leaves an empty string, an
  // empty string is not a number, and a controlled field with no number to show
  // snaps back to whatever the instant says. The operator then types a digit
  // onto the end of a value they thought they had deleted. Holding the draft
  // means an empty field stays empty until there is something to commit, and
  // dropping it on blur means the field can never disagree with the instant it
  // is showing.
  const [draft, setDraft] = useState<{
    key: keyof MissionDateParts;
    text: string;
  } | null>(null);

  const field = (
    key: keyof MissionDateParts,
    text: string,
    min: number,
    width: string,
  ) => (
    <Stack gap="xs" key={key}>
      <FieldLabel htmlFor={`${groupId}-${key}`}>{text}</FieldLabel>
      <Input
        id={`${groupId}-${key}`}
        type="number"
        inputMode="numeric"
        min={min}
        step={1}
        style={{ width }}
        disabled={disabled}
        value={draft?.key === key ? draft.text : String(parts[key])}
        onBlur={() => setDraft(null)}
        onChange={(event) => {
          const typed = event.target.value;
          setDraft({ key, text: typed });
          if (typed.trim() === "") return;
          const next = Number(typed);
          if (!Number.isFinite(next)) return;
          onChange(utOfParts({ ...parts, [key]: next }));
        }}
      />
    </Stack>
  );

  return (
    <Stack gap="sm" role="group" aria-label={label}>
      <Cluster gap="sm" wrap justify="start">
        {field("year", "YEAR", 1, "5rem")}
        {field("day", "DAY", 1, "5rem")}
        {field("hour", "HR", 0, "4rem")}
        {field("minute", "MIN", 0, "4rem")}
        {field("second", "SEC", 0, "4rem")}
      </Cluster>
      <Cluster gap="xs" wrap justify="start">
        <Text tone="faint" size="sm">
          NUDGE
        </Text>
        {coarse.map((step) => (
          <ActionButton
            key={`minus-${step}`}
            disabled={disabled}
            aria-label={`${label} earlier by ${stepLabel(step)}`}
            onClick={() => onChange(value - step)}
          >
            {`-${stepLabel(step)}`}
          </ActionButton>
        ))}
        {coarse.map((step) => (
          <ActionButton
            key={`plus-${step}`}
            disabled={disabled}
            aria-label={`${label} later by ${stepLabel(step)}`}
            onClick={() => onChange(value + step)}
          >
            {`+${stepLabel(step)}`}
          </ActionButton>
        ))}
      </Cluster>
    </Stack>
  );
}
