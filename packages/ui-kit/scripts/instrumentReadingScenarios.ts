/**
 * The instruments the reckoning sheets are drawn from, as DATA.
 *
 * Separate from the entry that renders them so the before/after pair differs
 * only in what is handed to the primitive: the sheets, their order and their
 * captions are the same file on both sides, which is what makes the two PNGs
 * comparable at all.
 *
 * The BEFORE side hands each case its bare quantity, which is all the
 * instruments could take. So the first sheet is the control: every case on it
 * is a plain observation, and the two sides of it must be identical.
 */
export type Instrument = "gauge" | "tape" | "dial" | "diverging";

/** One instrument on a sheet: the figure, and the statements about it. */
export interface InstrumentCase {
  label: string;
  instrument: Instrument;
  /** The figure, in the case's own unit. */
  at: number;
  unit: string;
  min: number;
  max: number;
  /** The interval a model would defend, absent where it offers none. */
  band?: { lo: number; hi: number; kind: "bound" | "sigma1" };
  /** Not a reading of now: how the sheet asks for the held treatment. */
  stale?: boolean;
  /** A reading that carries no figure at all. */
  empty?: boolean;
  /** What the case is here to show, printed under the instrument. */
  note?: string;
}

export interface InstrumentSheet {
  id: string;
  title: string;
  blurb: string;
  width: number;
  cases: InstrumentCase[];
}

const TWR = { instrument: "gauge", unit: "1", min: 0, max: 3 } as const;
const AGL = { instrument: "tape", unit: "m", min: 0, max: 1000 } as const;
const HDG = { instrument: "dial", unit: "deg", min: 0, max: 360 } as const;
const RATE = {
  instrument: "diverging",
  unit: "units/s",
  min: -10,
  max: 10,
} as const;

export const SHEETS: InstrumentSheet[] = [
  {
    id: "control-observed",
    title: "Control: every figure is a reading of now",
    blurb:
      "Nothing on this sheet has anything to say about its own currency, so " +
      "nothing is drawn. It is the before/after control: an instrument handed " +
      "a plain observation must draw what it drew when it could only take one.",
    width: 460,
    cases: [
      { ...TWR, label: "TWR", at: 1.84, note: "observed, no model" },
      { ...AGL, label: "Altitude above terrain", at: 420, note: "observed" },
      { ...HDG, label: "Heading", at: 118, note: "observed" },
      { ...RATE, label: "Water", at: 4.2, note: "observed" },
    ],
  },
  {
    id: "held",
    title: "Held: the figure stands, and says it is no longer current",
    blurb:
      "The last real reading is still drawn, because it is still the best " +
      "knowledge available. What changes is that each instrument says so: the " +
      "mark on the readout, and the grade in the accessible name.",
    width: 460,
    cases: [
      {
        ...TWR,
        label: "TWR",
        at: 1.84,
        stale: true,
        note: "the needle holds, the readout is marked",
      },
      {
        ...AGL,
        label: "Altitude above terrain",
        at: 420,
        stale: true,
        note: "the pointer flag carries the mark",
      },
      {
        ...HDG,
        label: "Heading",
        at: 118,
        stale: true,
        note: "the centre readout carries the mark",
      },
      {
        ...RATE,
        label: "Water",
        at: 4.2,
        stale: true,
        note: "fades; the number beside it says the rest",
      },
    ],
  },
  {
    id: "banded",
    title: "Reckoned: one mark per bound, never a shaded span",
    blurb:
      "A model that will defend an interval puts its two ends on the track " +
      "the figure is drawn against. Two marks and never a shaded region: a " +
      "shaded span reads as somewhere the value IS, and a band is a claim " +
      "about how well one number is known.",
    width: 460,
    cases: [
      {
        ...TWR,
        label: "TWR",
        at: 1.5,
        band: { lo: 1.2, hi: 1.8, kind: "sigma1" },
        note: "one sigma of a fitted rate",
      },
      {
        ...AGL,
        label: "Altitude above terrain",
        at: 430,
        band: { lo: 340, hi: 520, kind: "sigma1" },
        note: "the two ends, at their own heights",
      },
      {
        ...HDG,
        label: "Heading",
        at: 118,
        band: { lo: 96, hi: 140, kind: "bound" },
        note: "a hard bound, not a sigma",
      },
      {
        ...RATE,
        label: "Water",
        at: 4.2,
        band: { lo: 3.0, hi: 5.4, kind: "sigma1" },
        note: "no bounds: four pixels and aria-hidden",
      },
    ],
  },
  {
    id: "held-and-reckoned",
    title: "Held AND reckoned, and a reading carrying no figure at all",
    blurb:
      "The two axes are independent: a held reading may still carry a model, " +
      "and both treatments are drawn. The last case on each row is a reading " +
      "with no number, where the instrument shows no pointer rather than " +
      "parking one at the foot of its scale, which would be a reading of zero.",
    width: 460,
    cases: [
      {
        ...TWR,
        label: "TWR",
        at: 1.5,
        band: { lo: 1.2, hi: 1.8, kind: "sigma1" },
        stale: true,
        note: "marked, and still bounded",
      },
      { ...TWR, label: "TWR, nothing reported", at: 0, empty: true, note: "" },
      {
        ...AGL,
        label: "Altitude, nothing reported",
        at: 0,
        empty: true,
        note: "no pointer on the rail",
      },
      {
        ...HDG,
        label: "Heading, nothing reported",
        at: 0,
        empty: true,
        note: "no needle on the face",
      },
    ],
  },
];
