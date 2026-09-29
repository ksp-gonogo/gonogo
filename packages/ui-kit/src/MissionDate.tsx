import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import styled from "styled-components";
import { formatKspDate } from "./formatKspDate";
import { HeldFigure } from "./HeldMark";
import { resolveCurrency } from "./readingCurrency";
import { VisuallyHidden } from "./VisuallyHidden";

/**
 * Which clock an instant is on. Under signal delay they differ for the same
 * event: SCET is when it happens at the craft, and the received clock is when
 * the telemetry showing it reaches a command centre, one light-time later.
 *
 * The qualifier belongs to each reading, not to the screen, since two vessels
 * have different light-times. Labels are `SCET` and `AT <vantage>`, never "RT",
 * which reads as the opposite of the delayed clock. A space-centre channel
 * describes no craft, so it takes no context.
 */
export type TimeContext =
  /** The craft's own clock: when the event happens, or happened, out there. */
  | { frame: "scet" }
  /**
   * The arrival clock at the observing vantage: when the frame showing it
   * reaches, or reached, the operator. `vantage` names that command centre; it
   * is optional because a frame can arrive before the roster naming it does.
   */
  | { frame: "received"; vantage?: string };

/**
 * The qualifier as rendered: token for the eye, phrase for the accessibility
 * tree, and a title spelling out what the reading means.
 */
function describeContext(context: TimeContext): {
  token: string;
  spoken: string;
  title: string;
} {
  if (context.frame === "scet") {
    return {
      token: "SCET",
      spoken: "spacecraft event time",
      title: "Spacecraft event time: when this happens at the craft",
    };
  }
  const { vantage } = context;
  return vantage === undefined
    ? {
        token: "RECEIVED",
        spoken: "received",
        title: "When the telemetry showing this arrives",
      }
    : {
        token: `AT ${vantage}`,
        spoken: `received at ${vantage}`,
        title: `When the telemetry showing this arrives at ${vantage}`,
      };
}

/*
 * Sized and dimmed relative to the number it qualifies, as `<Unit>`'s symbol
 * is. `text-transform` is pinned so a lowercasing parent cannot turn SCET into prose.
 */
const MissionDate__Context = styled.span`
  font-size: max(0.72em, 10px);
  opacity: 0.72;
  white-space: nowrap;
  text-transform: none;
`;

export interface MissionDateProps {
  /**
   * Universal time: seconds since the game's epoch, not a duration. A plain
   * number is accepted for the client-interpolated view clock, and a
   * `Value<"s">` renders a date measured from the epoch.
   */
  value:
    | Value<"ut">
    | Value<"s">
    | Reading<Value<"ut">>
    | Reading<Value<"s">>
    | number
    | null
    | undefined;
  /**
   * Which clock the instant is on, shown after it as `SCET` or `AT KSC`.
   *
   * Leave it `undefined` where the two clocks do not differ (a LAN session, a
   * vantage that is the craft itself), since a qualifier that is always present
   * is one nobody reads.
   */
  context?: TimeContext;
}

/**
 * A universal time, rendered as a date on the calendar the game is running:
 * `Y1 D5 03:22:37` under stock, `14 Mar 1957 03:22:37` under a real calendar.
 *
 * Not `<Unit>`: a UT is an instant, an offset from the epoch, and 9,201,600 of
 * them is Year 2 Day 1, not "106 days". The calendar is the one the game
 * reports on `time.calendar`. A missing or non-finite value renders
 * `NULL_DISPLAY`, not the epoch.
 */
export function MissionDate({ value, context }: MissionDateProps) {
  // A stale instant stays true, so a held reading adds only the mark, its grade and its last-valid instant.
  const carried = typeof value === "number" ? undefined : value;
  const { shown, held, caption } = resolveCurrency(carried);
  const ut = typeof value === "number" ? value : shown?.magnitude;
  const qualifier = context && describeContext(context);
  const date = formatKspDate(ut ?? Number.NaN);
  return (
    <>
      {held ? (
        /* The component otherwise renders bare text, so the mark needs a box to hang off. */
        <HeldFigure data-held="" caption={caption}>
          {date}
        </HeldFigure>
      ) : (
        date
      )}
      {qualifier && (
        <>
          {" "}
          <MissionDate__Context title={qualifier.title}>
            {/* The phrase replaces the token in the accessibility tree, as `<Unit>`'s word does. */}
            <span aria-hidden="true">{qualifier.token}</span>
            <VisuallyHidden>{qualifier.spoken}</VisuallyHidden>
          </MissionDate__Context>
        </>
      )}
    </>
  );
}
