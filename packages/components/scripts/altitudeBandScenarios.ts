/**
 * The scenes `render-altitude-band.ts` draws, and the arithmetic behind each.
 *
 * Every row is the SAME descent sampled at the same four uneven instants; what
 * differs is how far past the anchor the frame is drawn and, for the last two
 * rows, which samples the window is allowed to see. So the pictures can be read
 * against each other rather than each on its own terms.
 *
 * ## Why the scatter is chosen rather than sprinkled
 *
 * The residuals `[5, -10, 5, 0]` are orthogonal to both a constant and to
 * `t - tBar`, so the least-squares slope is still exactly the acceleration the
 * altitudes were integrated from. The carried number is therefore identical to
 * the clean run's, and the marks beside it are the only difference between the
 * two rows. With `tBar = 5.5` the residual sum of squares is 150 over `n - 2`
 * degrees of freedom and the time spread is 29, so the fitted acceleration's
 * standard error is `sqrt(75 / 29)`, about 1.61 m/s².
 *
 * ## Two sheets because the band's size is a fact about the scene
 *
 * The interval is `0.5 x sigma_a x dt²`, tens of metres at six seconds. On the
 * last kilometre of a landing that is several percent of the track and a reader
 * can see it. On a track drawn to the 70 km interface the SAME interval is four
 * ten-thousandths of the width and lands inside one pixel. The second sheet
 * exists to show that rather than to let the first imply otherwise.
 */

/** One `vessel.flight` sample: the two fields the descent fit reads. */
export interface Sample {
  at: number;
  altitudeAsl: number;
  verticalSpeed: number;
}

export interface Row {
  label: string;
  note: string;
  samples: readonly Sample[];
  /** The instant the frame is drawn for, past the newest sample's own. */
  viewUt: number;
  /** What the track is a fraction of, in metres. */
  capacityM: number;
}

export interface Sheet {
  id: string;
  title: string;
  blurb: string;
  rows: readonly Row[];
}

/**
 * A gentle powered descent: `h(t) = 600 - 10t - t²`, so the vertical speed is
 * `-10 - 2t` and the acceleration a constant -2 m/s².
 *
 * Chosen so that six seconds of carry still lands the craft above the ground:
 * a free-fall fixture carried that far reckons its way underground, and a
 * meter drawn from a negative altitude is a picture of the fixture rather than
 * of the band.
 */
const CLEAN_APPROACH: readonly Sample[] = [
  { at: 3, altitudeAsl: 561, verticalSpeed: -16 },
  { at: 4, altitudeAsl: 544, verticalSpeed: -18 },
  { at: 5, altitudeAsl: 525, verticalSpeed: -20 },
  { at: 10, altitudeAsl: 400, verticalSpeed: -30 },
];

/** The same instants with the residuals put back in. */
const SCATTERED_APPROACH: readonly Sample[] = CLEAN_APPROACH.map((s, i) => ({
  ...s,
  verticalSpeed: s.verticalSpeed + [5, -10, 5, 0][i],
}));

/**
 * The reentry fixture from `atmospheric-reckoning.test.ts`, whose residuals are
 * a fifth the size and whose altitude is a hundred times higher.
 */
const REENTRY: readonly Sample[] = [
  { at: 3, altitudeAsl: 59_227.5, verticalSpeed: -214 },
  { at: 4, altitudeAsl: 59_010, verticalSpeed: -222 },
  { at: 5, altitudeAsl: 58_787.5, verticalSpeed: -224 },
  { at: 10, altitudeAsl: 57_600, verticalSpeed: -250 },
];

const APPROACH_CAPACITY = 600;

export const SHEETS: readonly Sheet[] = [
  {
    id: "landing-approach",
    title: "Altitude carried under delay, last 600 m",
    blurb:
      "One descent, four readings. The bar is the last observed altitude; the marks are where the fitted acceleration says the craft is now, and how well it knows that. The track is altitude against the 600 m the run began at.",
    rows: [
      {
        label: "Carried 3 s",
        note: "Four scattered samples, frame drawn 3 s past the anchor",
        samples: SCATTERED_APPROACH,
        viewUt: 13,
        capacityM: APPROACH_CAPACITY,
      },
      {
        label: "Carried 6 s",
        note: "The same fit, twice as far out: the interval quadruples",
        samples: SCATTERED_APPROACH,
        viewUt: 16,
        capacityM: APPROACH_CAPACITY,
      },
      {
        label: "Carried 6 s, two samples",
        note: "Two points determine a line, so there is no residual to measure",
        samples: SCATTERED_APPROACH.slice(2),
        viewUt: 16,
        capacityM: APPROACH_CAPACITY,
      },
      {
        label: "Carried 6 s, no scatter",
        note: "Four samples exactly on one line: a degenerate estimate, not an exact one",
        samples: CLEAN_APPROACH,
        viewUt: 16,
        capacityM: APPROACH_CAPACITY,
      },
    ],
  },
  {
    id: "reentry-scale",
    title: "The same band, drawn to the 70 km interface",
    blurb:
      "A reentry at 57 km on a track whose full width is the atmosphere. The model offers the interval it always does and the marks land inside a pixel of the bar's end. Nothing is wrong with the band; it is the scale that cannot show it.",
    rows: [
      {
        label: "Carried 6 s at 57 km",
        note: "Interval as a share of the track: about four ten-thousandths",
        samples: REENTRY,
        viewUt: 16,
        capacityM: 70_000,
      },
    ],
  },
];
