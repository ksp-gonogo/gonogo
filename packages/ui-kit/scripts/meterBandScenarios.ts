/**
 * The meters the band sheets are drawn from, as DATA.
 *
 * Separate from the entry that renders them so the before/after pair differs
 * only in what is handed to `<Meter>`: the sheets, their order, their captions
 * and their sizes are the same file on both sides, which is what makes the two
 * PNGs comparable at all.
 */
export type Tone = "neutral" | "go" | "warn" | "nogo" | "info";

/** One bar on a sheet: the figure, and the interval a model would defend. */
export interface MeterCase {
  label: string;
  /** 0..1, the fill. */
  fraction: number;
  /**
   * The band's ends as fractions of the same track, absent where none.
   *
   * `at` is the model's own point estimate, for the cases where it has moved
   * away from the observation. It defaults to {@link MeterCase.fraction}, and
   * it has to sit between the two ends: a band whose value is outside its own
   * interval is ill-formed and the meter refuses it, which is how the stale
   * case on the last sheet first came out with no marks at all.
   */
  band?: { lo: number; hi: number; kind: "bound" | "sigma1"; at?: number };
  tone?: Tone;
  fillColor?: string;
  /** A tank, where this bar is drawn from an amount over a capacity. */
  tank?: { amount: number; capacity: number; unit: "units" };
  /** Not a reading of now: how the sheet asks for the stale treatment. */
  stale?: boolean;
  /** What the case is here to show, printed under the bar. */
  note?: string;
}

export interface MeterSheet {
  id: string;
  title: string;
  blurb: string;
  size: "sm" | "md";
  width: number;
  cases: MeterCase[];
}

export const SHEETS: MeterSheet[] = [
  {
    id: "crew-survival",
    title: "Crew survival, one row per kerbal",
    blurb:
      "Jebediah's dose and stress accumulators are carried forward by a model " +
      "that will bound them; his pressure rule is not. Bill's whole row is a " +
      "plain observation. The treatment is absent where there is nothing to say.",
    size: "sm",
    width: 360,
    cases: [
      {
        label: "Jeb · Radiation dose",
        fraction: 0.39,
        band: { lo: 0.379, hi: 0.401, kind: "sigma1" },
        tone: "warn",
        note: "one sigma of a fitted rate",
      },
      {
        label: "Jeb · Stress",
        fraction: 0.72,
        band: { lo: 0.66, hi: 0.78, kind: "sigma1" },
        tone: "nogo",
        note: "a wider sigma: fewer samples behind it",
      },
      {
        label: "Jeb · Pressure",
        fraction: 0.12,
        tone: "go",
        note: "no model offers a band here",
      },
      {
        label: "Bill · Radiation dose",
        fraction: 0.21,
        tone: "go",
        note: "observation only, no reckoning",
      },
      { label: "Bill · Stress", fraction: 0.34, tone: "neutral" },
    ],
  },
  {
    id: "band-widths",
    title: "How the marks read as the interval widens",
    blurb:
      "The same figure at 62%, under models of increasing doubt, then two that " +
      "run off the end of the track. Subtle enough to ignore, readable when " +
      "looked for.",
    size: "md",
    width: 360,
    cases: [
      {
        label: "Quantised",
        fraction: 0.62,
        band: { lo: 0.615, hi: 0.625, kind: "bound" },
        note: "a hard bound half a percent wide",
      },
      {
        label: "Tight",
        fraction: 0.62,
        band: { lo: 0.6, hi: 0.64, kind: "bound" },
      },
      {
        label: "Loose",
        fraction: 0.62,
        band: { lo: 0.53, hi: 0.71, kind: "sigma1" },
      },
      {
        label: "Barely knows",
        fraction: 0.62,
        band: { lo: 0.34, hi: 0.9, kind: "sigma1" },
      },
      {
        label: "Asymmetric",
        fraction: 0.62,
        band: { lo: 0.58, hi: 0.82, kind: "sigma1" },
        note: "the real error is rarely even",
      },
      {
        label: "Against the ceiling",
        fraction: 0.95,
        band: { lo: 0.9, hi: 1.08, kind: "sigma1" },
        tone: "warn",
        note: "the high end is past full, and pins at the end",
      },
      {
        label: "Against the floor",
        fraction: 0.04,
        band: { lo: -0.05, hi: 0.1, kind: "sigma1" },
        tone: "info",
        note: "the low end is past empty",
      },
      { label: "No band", fraction: 0.62, note: "for comparison" },
    ],
  },
  {
    id: "resource-tank",
    title: "The tank form, over an identity fill",
    blurb:
      "Amount over capacity, where the fill carries a resource's own colour " +
      "rather than a status. The marks have to stay legible on both halves of " +
      "the track.",
    size: "md",
    width: 360,
    cases: [
      {
        label: "LiquidFuel",
        fraction: 0.58,
        tank: { amount: 232, capacity: 400, unit: "units" },
        band: { lo: 0.545, hi: 0.615, kind: "sigma1" },
        fillColor: "hsl(40deg 65% 55%)",
        note: "a burn-rate model, one sigma",
      },
      {
        label: "Oxidizer",
        fraction: 0.55,
        tank: { amount: 269, capacity: 489, unit: "units" },
        band: { lo: 0.44, hi: 0.66, kind: "sigma1" },
        fillColor: "hsl(200deg 60% 55%)",
      },
      {
        label: "MonoPropellant",
        fraction: 0.81,
        tank: { amount: 32.4, capacity: 40, unit: "units" },
        fillColor: "hsl(120deg 35% 55%)",
        note: "no model, so no marks",
      },
    ],
  },
  {
    id: "currency",
    title: "A band on a reading that is no longer current",
    blurb:
      "A stale bar is the last real observation and is marked as one. The marks " +
      "are the model's interval for NOW, so the gap between the bar's end and " +
      "the pair is how far the model has carried the number since.",
    size: "md",
    width: 360,
    cases: [
      {
        label: "Current, banded",
        fraction: 0.47,
        band: { lo: 0.45, hi: 0.49, kind: "sigma1" },
        tone: "info",
        note: "observed now; the interval straddles the bar",
      },
      {
        label: "Stale, banded",
        fraction: 0.47,
        band: { lo: 0.33, hi: 0.39, kind: "sigma1", at: 0.36 },
        tone: "info",
        stale: true,
        note: "last seen at 47%; the model says 36% by now",
      },
      {
        label: "Stale, no model",
        fraction: 0.47,
        tone: "info",
        stale: true,
        note: "nothing carries it forward",
      },
    ],
  },
  {
    id: "ends-small",
    title: "An end mark on the SMALL track",
    blurb:
      "The question a taller mark had to answer: one pinned at 0% or 100% must " +
      "stay on the bar rather than beside it. The small size is the one every " +
      "WidgetMeters stack draws, and the one the marks were shortest on.",
    size: "sm",
    width: 360,
    cases: [
      {
        label: "Against the ceiling",
        fraction: 0.95,
        band: { lo: 0.9, hi: 1.08, kind: "sigma1" },
        tone: "warn",
        note: "the high end is past full, so its mark pins at 100%",
      },
      {
        label: "Against the floor",
        fraction: 0.04,
        band: { lo: -0.05, hi: 0.1, kind: "sigma1" },
        tone: "info",
        note: "the low end is past empty, so its mark pins at 0%",
      },
      {
        label: "Mid-track",
        fraction: 0.5,
        band: { lo: 0.42, hi: 0.58, kind: "sigma1" },
        note: "for comparison: neither mark is against an end",
      },
    ],
  },
];
