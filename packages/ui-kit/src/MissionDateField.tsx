import { value } from "@ksp-gonogo/sitrep-sdk";
import { useId, useState } from "react";
import { Button } from "./Button";
import { Cluster } from "./Cluster";
import { FieldLabel, Input } from "./Form";
import { kspCalendar } from "./kspTime";
import { NULL_DISPLAY } from "./NullValue";
import { Stack } from "./Stack";
import { Text } from "./Text";
import { writeQuantity } from "./units";

/**
 * Props for {@link MissionDateField}.
 *
 * @category Form
 */
export interface MissionDateFieldProps {
  /**
   * The instant being edited, in seconds since the game's epoch, or `null` when
   * there is none: a reading that did not arrive, a field the producer withheld.
   *
   * A non-finite number is read as `null` too, rather than clamped to the epoch.
   */
  value: number | null;

  /** Called with the new instant, in whole seconds since the game's epoch. */
  onChange: (ut: number) => void;

  /** Names the whole group for a screen reader: "Ignition", "Plan end". */
  label: string;

  disabled?: boolean;

  /**
   * The coarse steps offered, in seconds, smallest first. Rendered as a minus
   * button and a plus button per entry. Defaults to a minute, ten minutes, an
   * hour and a day of the LIVE calendar.
   *
   * An empty list removes the row entirely, for a caller with another nudge
   * control beside this one.
   */
  steps?: number[];
}

/**
 * The five components of an instant on the game's own calendar.
 *
 * @category Form
 */
export interface MissionDateParts {
  year: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * Splits a UT (seconds since the game's epoch) into calendar components, with years and days ONE-BASED to match
 * every other date this kit renders: UT zero is Year 1 Day 1, not Year 0 Day 0.
 *
 * A non-finite or negative UT lands on the epoch, as a floor under arithmetic;
 * it is never a way to render an absent instant, which never reaches here.
 *
 * @category Form
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

/** What an instant typed into an empty field is built on top of. */
const EPOCH_PARTS: MissionDateParts = {
  year: 1,
  day: 1,
  hour: 0,
  minute: 0,
  second: 0,
};

/**
 * Recombines calendar components into a UT.
 *
 * Does not clamp an out-of-range component: an hour of 30 rolls into the next
 * day, so the operator never does the carry.
 *
 * @category Form
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
 * A coarse step's label, written by the kit's duration formatter on the live
 * calendar's tiers, so a day's worth of seconds reads as a day.
 */
function stepLabel(seconds: number): string {
  return writeQuantity(value("s", seconds));
}

/**
 * A universal time ENTERED as a calendar instant: year, day, hour, minute,
 * second, each its own field, plus coarse steps. The fields are for an instant
 * you know; the steps are the tuning loop for one you are looking for.
 *
 * Calendar lengths come from the running game's calendar, so day 300 means
 * what the game's own clock calls day 300. Edits round to the second, so the
 * field never shows one instant and holds another.
 *
 * An instant nobody stated is not the epoch: `null` comes up empty with the
 * absent token, and nothing is committed until a component is typed.
 *
 * {@link UnitInput} with a `ut` unit renders this for you and emits a `Value`;
 * use this directly when you hold the instant as a bare number of seconds.
 *
 * @category Form
 */
export function MissionDateField({
  value,
  onChange,
  label,
  disabled,
  steps,
}: MissionDateFieldProps) {
  const groupId = useId();
  const absentId = `${groupId}-absent`;
  // A non-finite number is the same absence as a null, reached by a different route.
  const instant = value !== null && Number.isFinite(value) ? value : null;
  const parts = instant === null ? null : partsOfUt(instant);
  const calendar = kspCalendar();
  const coarse = steps ?? [
    calendar.minute,
    10 * calendar.minute,
    calendar.hour,
    calendar.day,
  ];

  /*
   * An in-progress edit is held as text for the one field being typed in, so a
   * cleared field stays empty instead of snapping back. Dropped on blur, so the
   * field never disagrees with the instant.
   */
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
    <Stack gap="caption" key={key}>
      <FieldLabel htmlFor={`${groupId}-${key}`}>{text}</FieldLabel>
      <Input
        id={`${groupId}-${key}`}
        type="number"
        inputMode="numeric"
        // Named for the group as well as the column, so two of these on one panel are distinguishable.
        aria-label={`${label} ${text}`}
        // On every field, so the absence is spoken on focus.
        aria-describedby={parts === null ? absentId : undefined}
        min={min}
        step={1}
        style={{ width }}
        disabled={disabled}
        placeholder={parts === null ? NULL_DISPLAY : undefined}
        value={
          draft?.key === key
            ? draft.text
            : parts === null
              ? ""
              : String(parts[key])
        }
        onBlur={() => setDraft(null)}
        onChange={(event) => {
          const typed = event.target.value;
          setDraft({ key, text: typed });
          if (typed.trim() === "") return;
          const next = Number(typed);
          if (!Number.isFinite(next)) return;
          // The epoch is the base only once the operator has typed something.
          onChange(utOfParts({ ...(parts ?? EPOCH_PARTS), [key]: next }));
        }}
      />
    </Stack>
  );

  return (
    <Stack gap="related-dense" role="group" aria-label={label}>
      <Cluster gap="related-dense" wrap justify="start">
        {field("year", "YEAR", 1, "5rem")}
        {field("day", "DAY", 1, "5rem")}
        {field("hour", "HR", 0, "4rem")}
        {field("minute", "MIN", 0, "4rem")}
        {field("second", "SEC", 0, "4rem")}
      </Cluster>
      {/* Words as well as the token, since the dash carries the absence only to an eye. */}
      {parts === null && (
        <Text id={absentId} level="muted" size="sm">
          {`${NULL_DISPLAY} no ${label.toLowerCase()} to show. Type one to state it.`}
        </Text>
      )}
      {coarse.length === 0 ? null : (
        <Cluster gap="related-packed" wrap justify="start">
          <Text level="faint" size="sm">
            NUDGE
          </Text>
          {/* Disabled over an absent instant: a step is relative, and there is nothing to step from. */}
          {coarse.map((step) => (
            <Button
              variant="ghost"
              size="sm"
              key={`minus-${step}`}
              disabled={disabled || instant === null}
              aria-label={`${label} earlier by ${stepLabel(step)}`}
              onClick={() => instant !== null && onChange(instant - step)}
            >
              {`-${stepLabel(step)}`}
            </Button>
          ))}
          {coarse.map((step) => (
            <Button
              variant="ghost"
              size="sm"
              key={`plus-${step}`}
              disabled={disabled || instant === null}
              aria-label={`${label} later by ${stepLabel(step)}`}
              onClick={() => instant !== null && onChange(instant + step)}
            >
              {`+${stepLabel(step)}`}
            </Button>
          ))}
        </Cluster>
      )}
    </Stack>
  );
}
