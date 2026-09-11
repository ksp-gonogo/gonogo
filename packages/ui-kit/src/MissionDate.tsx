import type { Value } from "@ksp-gonogo/sitrep-sdk";
import styled from "styled-components";
import { formatKspDate } from "./formatKspDate";
import { VisuallyHidden } from "./VisuallyHidden";

/**
 * A universal time, rendered as a date on the calendar the game is running:
 * `Y1 D5 03:22:37` under stock, `14 Mar 1957 03:22:37` under one with a real
 * calendar.
 *
 * ## Why this is not `<Unit>`
 *
 * Both are the only way their presentation leaves this package, but they are
 * showing different things. A duration is a
 * LENGTH of time and scales: 90 seconds is a minute and a half, and `<Unit>`
 * climbs the time ladder to say so. A UT is an INSTANT, an offset from the
 * game's epoch, and 9,201,600 of them is not "106 days", it is Year 2 Day 1.
 * Handing a UT to `<Unit>` renders a true statement about the wrong quantity,
 * which is the exact failure the unit system exists to stop.
 *
 * Splitting them at the component rather than behind a prop on `<Unit>` keeps
 * `format` meaning one thing (a unit of the same kind, checked against the
 * model) instead of also meaning a notation, and it makes the call site say
 * which of the two it meant. The wire now says which it meant too: an instant
 * carries `"ut"` and a duration carries `"s"`, so `<Countdown>` can refuse one
 * outright rather than rendering it as forty-six days.
 *
 * ## The calendar is whichever one the game is running
 *
 * Six-hour days and 426-day years on stock Kerbin time, 24 and 365 under a
 * planet pack or with the stock `KERBIN_TIME` setting off. The mod reports it
 * on `time.calendar` and `setKspCalendar` adopts it; `kspTime.ts` has the
 * whole story. Compiling Kerbin's calendar in renders an RSS player's dates on
 * a calendar their game does not use. See `styleguide-earth-day.test.ts` for
 * the arithmetic form of the same mistake.
 *
 * The same channel can carry an ANCHOR, and one changes the notation rather
 * than the arithmetic: with it, a UT is a real instant and renders as one. It
 * arrives only from a game whose date formatter has a real calendar, and only
 * when the operator asked for real dates, so the offset form above stays the
 * default and stays right for a stock career.
 *
 * A missing or non-finite value renders `NULL_DISPLAY`, same as every other
 * readout: an absent clock shows as absent rather than as the epoch.
 */
/**
 * Which clock an instant is on.
 *
 * Real mission ops keeps two, and under signal delay they are different
 * numbers for the same event: SCET is when the thing happens at the craft,
 * and the received clock is when the telemetry showing it reaches a command
 * centre, one light-time later. Both are legitimate readings (SCET to BE at
 * an event, received to WITNESS it), so an instant that states neither is
 * answering a question nobody asked.
 *
 * ## Per reading, never per screen
 *
 * The qualifier belongs to the number, not to the dashboard. Two vessels have
 * two different light-times but ONE vantage and ONE received clock, so a
 * screen-level SCET/received switch has no single right answer while a
 * per-reading label does: each row states its own and the two stay comparable.
 * When the vantage IS the craft the light-time is zero, the two clocks
 * coincide, and there is nothing to qualify.
 *
 * ## The letters RT are ruled out
 *
 * Both clocks already exist in this codebase and one of them is named the
 * opposite of what an RT label would mean: `useViewUt()` is the DELAYED clock
 * that a received time belongs to, while `useUtNow()` is undelayed and its own
 * doc comment calls it "real time". Shipping RT as the label for the delayed
 * one guarantees a maintainer inverts it, and an inverted time label is worse
 * than none. Hence `SCET` and `AT <vantage>`, which name the vantage instead
 * of implying a global one.
 *
 * ## Only a Delayed value has two of these
 *
 * A `TrueNow` channel (funds, the research queue, every `rp1.*` date) is
 * command-centre bookkeeping the ground knows independently of any link, so
 * its SCET and its received time are the same instant by construction. Those
 * call sites pass no context at all. Offering the qualifier there would teach
 * an operator that the distinction is decorative.
 */
export type TimeContext =
  /** The craft's own clock: when the event happens, or happened, out there. */
  | { frame: "scet" }
  /**
   * The arrival clock at the observing vantage: when the frame showing it
   * reaches, or reached, the operator. `vantage` names that command centre,
   * from `useObservedVantage`'s roster entry. It is optional only because a
   * frame can arrive before the roster naming its centre does, and a qualifier
   * that cannot say WHOSE clock still beats an unqualified instant.
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
 * Sized and dimmed relative to the number it qualifies, for the reasons
 * `<Unit>`'s symbol is: it composes into a 32px readout and an 11px table cell
 * alike with no prop, it keeps the value's own tone rather than going grey
 * beside a red number, and the floor stops it rendering below what this UI is
 * legible at. `text-transform` is pinned for the same reason too, a parent
 * that lowercases its text must not turn SCET into prose.
 */
const MissionDate__Context = styled.span`
  font-size: max(0.72em, 10px);
  opacity: 0.72;
  white-space: nowrap;
  text-transform: none;
`;

export interface MissionDateProps {
  /**
   * Universal time. Seconds since the game's epoch, not a duration.
   *
   * A plain number is accepted alongside a `Value` because the clock this
   * usually renders is the app's own: `useViewUt` interpolates a UT every
   * frame from the last wire edge, so it is computed client-side and has no
   * declared unit to carry. There is exactly one unit a UT can be in.
   *
   * `Value<"s">` is still accepted alongside `Value<"ut">`: a mission date is
   * a rendering choice a caller is entitled to make about a number, and unlike
   * `Countdown` there is no wrong answer to guard against here. Passing a
   * duration renders a date measured from the epoch, which is what it asked
   * for.
   */
  value: Value<"ut"> | Value<"s"> | number | null | undefined;
  /**
   * Which clock the instant is on, shown after it as `SCET` or `AT KSC`.
   *
   * Pass `undefined` (the default) to show the bare time, and mean it: the
   * qualifier is for the case where the two clocks DIFFER, so a LAN session, a
   * vantage that is the craft itself, and every `TrueNow` value render without
   * one. A qualifier that is always present is a qualifier nobody reads.
   *
   * The "do they differ" decision is one question with one answer per screen,
   * so it is not asked here and not asked at the call site either:
   * `useTimeContexts()` (`@ksp-gonogo/core`) reads the one-way delay and the
   * observed vantage and hands back the qualifier or `undefined`.
   */
  context?: TimeContext;
}

export function MissionDate({ value, context }: MissionDateProps) {
  const ut = typeof value === "number" ? value : value?.magnitude;
  const qualifier = context && describeContext(context);
  return (
    <>
      {formatKspDate(ut ?? Number.NaN)}
      {qualifier && (
        <>
          {" "}
          <MissionDate__Context title={qualifier.title}>
            {/* The phrase REPLACES the token in the accessibility tree rather
                than joining it, same as `<Unit>`'s word does: left announceable
                beside its own expansion, "SCET" reads as "ess see ee tee
                spacecraft event time". */}
            <span aria-hidden="true">{qualifier.token}</span>
            <VisuallyHidden>{qualifier.spoken}</VisuallyHidden>
          </MissionDate__Context>
        </>
      )}
    </>
  );
}
