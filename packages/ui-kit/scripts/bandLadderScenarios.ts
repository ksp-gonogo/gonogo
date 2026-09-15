/**
 * The scenes `render-band-ladder.ts` draws: what `<Band>` prints when its two
 * ends are progressively harder to tell apart.
 *
 * One sheet, because the whole point is the three cases SIDE BY SIDE. Read
 * separately each looks defensible; read together, the defect is that the two
 * indistinguishable inputs render differently and the wordier one reads as the
 * more precise.
 */

/** The next representable double above `v`: one ULP, never a chosen epsilon. */
export function nextAfter(v: number): number {
  const buf = new Float64Array([v]);
  new BigUint64Array(buf.buffer)[0] += 1n;
  return buf[0];
}

/** One row: a band's two ends in metres, and what the row is showing. */
export interface BandLadderRow {
  label: string;
  note: string;
  lowM: number;
  highM: number;
}

/**
 * 65 286.8 m is the altitude the defect was first seen at, in
 * `renders/landing-carried-altitude/after-caa30c386-04-just-inside-68km.png`.
 * Kept so the sheet is the same figure that produced the report.
 */
const SEEN_AT = 65_286.8;

export const ROWS: readonly BandLadderRow[] = [
  {
    label: "Ends one ULP apart",
    note: "7.3e-12 m: two distinct doubles, closer than any decimal count can show",
    lowM: SEEN_AT,
    highM: nextAfter(SEEN_AT),
  },
  {
    label: "Ends exactly equal",
    note: "Nothing to separate, and the primitive has always said so plainly",
    lowM: SEEN_AT,
    highM: SEEN_AT,
  },
  {
    label: "Ends 0.3 m apart",
    note: "Genuinely separable: the ladder must still earn the digits that show it",
    lowM: SEEN_AT,
    highM: SEEN_AT + 0.3,
  },
  {
    label: "Ends 10 km apart",
    note: "The ladder's original job: two ends the default would collapse to one figure",
    lowM: 6_700_000,
    highM: 6_710_000,
  },
];

export interface Sheet {
  id: string;
  title: string;
  blurb: string;
  rows: readonly BandLadderRow[];
}

export const SHEETS: readonly Sheet[] = [
  {
    id: "ladder-floor",
    title: "What <Band> prints as its ends converge",
    blurb:
      "Four bands, same component, same unit. The first two are indistinguishable to a reader and must render alike; the last two must keep every digit they earn.",
    rows: ROWS,
  },
];
