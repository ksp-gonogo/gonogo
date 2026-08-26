/**
 * The calendar an RP-1 career is actually flown on, written down once.
 *
 * RP-1 requires RSS, which replaces KSP's date formatter with an Earth one, so a
 * day is 86,400 seconds and a year is 365.25 of them rather than Kerbin's 21,600
 * and 426.
 *
 * <p><b>Why the harness has to say this itself.</b> In the app the kit adopts
 * whatever the game reported on `time.calendar`, through a component that lives
 * in a package an Uplink may not import. A probe that does not set it keeps the
 * kit's stock Kerbin fallback, and every duration in a render comes out FOUR
 * TIMES too many days: measured, not assumed, on the first renders of the
 * construction section, where a ninety-day build read as 360d.</p>
 *
 * <p>One definition site rather than a number in each file. The driver's fixture
 * durations are written in the same day the probe renders them with, so a render
 * cannot disagree with itself, and the repo's Earth-day guard has one file to
 * exempt rather than two.</p>
 */
export const RSS_CALENDAR = {
  minute: 60,
  hour: 3_600,
  day: 86_400,
  year: 31_557_600,
} as const;
