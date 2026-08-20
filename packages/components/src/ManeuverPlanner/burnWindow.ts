// ---------------------------------------------------------------------------
// A burn has three instants and they must never merge into one countdown.
//
// "Burn in 4h" is true of whichever of them it came from and wrong about the
// other two, which is the same failure the vessel-tracker deadline rows exist
// to prevent. Ignition is when to light the engines, the reference is the
// impulsive-equivalent instant every countdown in the app has always shown, and
// cutoff is when to stop. Under an impulsive plan the outer two are absent, and
// an absent one says WHY rather than dropping out, because three rows read as
// the complete set and two read as a shorter answer to a different question.
// ---------------------------------------------------------------------------

/** Fixed order: the order they occur, which is also the order they are flown. */
export type BurnInstantKind = "ignition" | "reference" | "cutoff";

export interface BurnInstantRow {
  kind: BurnInstantKind;
  /** What happens at it. */
  label: string;
  /** The question this row answers, so the three never read as restatements. */
  question: string;
  /** UT it falls at, or null when nothing supplies one. Never a substituted reference. */
  atUt: number | null;
  /** How it was arrived at, or why there isn't one. Short: it is the first thing to truncate. */
  basis: string;
  /** The long form of {@link basis}, for a tooltip. */
  detail?: string;
}

const ORDER: readonly BurnInstantKind[] = ["ignition", "reference", "cutoff"];

/**
 * The words wrapped around one instant. Supplied by the caller because four of
 * these five fields describe where THIS app gets a burn from rather than
 * anything true of burns: `basis` says "rocket equation" because
 * `BurnTiming` computed it, `absent`/`absentDetail` name stock's own solver
 * outright, and the reference row's `question` asserts a delta-v profile to be
 * half-way through.
 *
 * The row MODEL around it is general: the fixed ignition/reference/cutoff
 * order, the rule that an absent instant says WHY rather than dropping out, and
 * the axis are true of any burn from any planner.
 */
export interface BurnInstantFraming {
  /** What happens at it. */
  label: string;
  /** The question this row answers, so the three never read as restatements. */
  question: string;
  /** How it was arrived at. */
  basis: string;
  /** Shown in place of `basis` when nothing supplies the instant. */
  absent: string;
  /** The long form of `absent`, for a tooltip. */
  absentDetail: string;
}

/**
 * The stock-shaped framing, and the default.
 *
 * **It assumes the reference instant exists**, which is a stock-patched-conic
 * assumption and not a fact about burns. A planner that INTEGRATES has a real
 * ignition and a real cutoff and may have no impulsive equivalent at all, in
 * which case the honest render is two rows rather than three reworded, and no
 * table of words fixes that. Whether it is two or three-reworded is the first
 * thing a second caller settles; it is deliberately not designed for here.
 *
 * Recorded rather than merely known, because a default that cannot say what it
 * assumes is a default that gets adopted as a truth.
 *
 * ## Which of these a second provider may change
 *
 * Nothing enforces this and nothing should until a second provider exists, but
 * the division is NOT the per-field one it looks like, and that is worth having
 * in writing because the per-field split is what someone would reach for.
 *
 * The line falls between the KINDS. `ignition` and `cutoff` are REAL EVENTS,
 * true of any burn from any planner: engines light, engines stop. Their `label`
 * and `question` are shared vocabulary and a second provider should supply the
 * same words, differing only in provenance. `reference` is a MODEL ARTEFACT,
 * and renaming it from "Impulse" to "Half-Δv" did not change that: the new
 * label presumes a burn with a measurable delta-v profile to be half-way
 * through, just as the old one presumed an impulsive equivalent to exist. Both
 * are claims about a burn model, so its label and question travel WITH the
 * provenance rather than with the vocabulary.
 *
 * Freezing `label` and `question` across all three, which is the tidier-looking
 * split, would force a future provider to display a word that is wrong for its
 * model, and for an integrating planner a word for an instant it does not have.
 * A consistency rule that produces a false label is doing the opposite of its
 * job. `basis`, `absent` and `absentDetail` are provenance throughout.
 */
export const STOCK_FRAMING: Record<BurnInstantKind, BurnInstantFraming> = {
  ignition: {
    label: "Ignition",
    question: "when do the engines light",
    basis: "rocket equation",
    absent: "no burn-time model",
    absentDetail:
      "Nothing supplies a burn duration for this craft, so there is no ignition time. Stock computes one only for a loaded vessel.",
  },
  reference: {
    // "Half-Δv" states the BEHAVIOUR. Two earlier candidates were worse: "Node"
    // was stock's word for the object and said nothing about what kind of
    // instant it is, and "Impulse" named a model rather than the thing that
    // happens, which is weak once you know the game supplies only a node and a
    // duration and that both outer instants are ours.
    //
    // The half-DELTA-V point, not the time midpoint, and they are not the same
    // instant: mass falls as the burn proceeds, so the second half takes longer.
    // BurnTimingTests pins it, LeadToHalfSeconds > TotalSeconds / 2. Anything
    // reading as "the middle of the burn" is wrong for the same reason "Start"
    // was: ignition sits a lead AHEAD of this instant (see
    // Gonogo.KSP.StockManeuverPlanBackend, where IgnitionUt is node.UT minus
    // LeadToHalfSeconds), so a burn begun here is late by that lead.
    //
    // One word in both states rather than one per state. Where a burn-time model
    // is absent we cannot place a burn around this instant, but the instant is
    // still the one the plan supplies; what changes is only whether the rows
    // either side of it exist, which they say by being present or absent.
    label: "Half-Δv",
    question: "when has half the delta-v been delivered",
    basis: "planned",
    // The reference is the one instant every plan has, so it is never absent
    // for a burn that exists at all.
    absent: "no burn",
    absentDetail: "There is no burn to place.",
  },
  cutoff: {
    label: "Cutoff",
    question: "when do the engines stop",
    basis: "rocket equation",
    absent: "no burn-time model",
    absentDetail:
      "Nothing supplies a burn duration for this craft, so there is no cutoff time. Stock computes one only for a loaded vessel.",
  },
};

/** Just the fields this needs, so a caller can pass a parsed node or a wire one. */
export interface BurnInstants {
  ut: number;
  ignitionUt?: number | null;
  cutoffUt?: number | null;
}

/**
 * The three rows for one burn, always all three, always in this order. Pure:
 * no clock, so a test can assert the UTs without pinning one.
 */
export function burnInstantRows(
  burn: BurnInstants,
  framingTable: Record<BurnInstantKind, BurnInstantFraming> = STOCK_FRAMING,
): readonly [BurnInstantRow, BurnInstantRow, BurnInstantRow] {
  const at: Record<BurnInstantKind, number | null> = {
    ignition: burn.ignitionUt ?? null,
    reference: burn.ut,
    cutoff: burn.cutoffUt ?? null,
  };
  const rows = ORDER.map((kind) => {
    const framing = framingTable[kind];
    const atUt = at[kind];
    return {
      kind,
      label: framing.label,
      question: framing.question,
      atUt,
      basis: atUt == null ? framing.absent : framing.basis,
      detail: atUt == null ? framing.absentDetail : undefined,
    };
  });
  return rows as unknown as [BurnInstantRow, BurnInstantRow, BurnInstantRow];
}

/**
 * Burn duration, seconds, or null when the plan does not model one. Derived
 * rather than carried: the wire deliberately ships two instants and no
 * duration, because a third number alongside them is one that can disagree.
 */
export function burnDurationSeconds(burn: BurnInstants): number | null {
  if (burn.ignitionUt == null || burn.cutoffUt == null) return null;
  const d = burn.cutoffUt - burn.ignitionUt;
  return Number.isFinite(d) && d > 0 ? d : null;
}

export interface BurnAxisMark {
  kind: BurnInstantKind;
  atUt: number;
  /** Position along the axis, 0 at `fromUt` and 1 at `toUt`. */
  fraction: number;
}

export interface BurnAxis {
  fromUt: number;
  toUt: number;
  /**
   * Where the view clock sits on the same scale. OUTSIDE [0, 1] whenever the
   * burn has not started or is already over, and a renderer should omit the
   * marker rather than clamp it: clamping would draw the clock at ignition
   * while the burn is still minutes away, which is a lie about the one thing
   * the operator is reading the axis for.
   */
  nowFraction: number;
  marks: readonly BurnAxisMark[];
}

/**
 * The instants on ONE shared scale, which is the only way their order and
 * spacing are visible at a glance. Three marks at three positions is a picture
 * that cannot collapse to a countdown.
 *
 * Null when fewer than two have a UT: a single mark shows no ordering, so an
 * axis drawn for it would be decoration dressed as information. That is
 * exactly the impulsive case, and it SHOULD draw nothing.
 */
export function burnAxis(
  rows: readonly BurnInstantRow[],
  nowUt: number,
): BurnAxis | null {
  const dated = rows.filter(
    (r): r is BurnInstantRow & { atUt: number } => r.atUt != null,
  );
  if (dated.length < 2) return null;

  const uts = dated.map((r) => r.atUt);
  // The span is the BURN, not now-to-cutoff.
  //
  // Including `now` was the obvious choice and it is wrong here, which a render
  // showed immediately: a 45-second burn four minutes away put all three marks
  // inside the last tenth of the axis, so the picture whose entire job is to
  // show their ORDER showed them as one blob. The vessel-tracker axis this
  // borrows from could afford to include `now` because its deadlines were hours
  // apart and the clock was one of the things being compared. A burn window is
  // three instants seconds apart, and their spacing relative to each other is
  // the whole content.
  const fromUt = Math.min(...uts);
  const toUt = Math.max(...uts);
  const span = toUt - fromUt;
  const at = (ut: number) => (span === 0 ? 0 : (ut - fromUt) / span);

  return {
    fromUt,
    toUt,
    nowFraction: at(nowUt),
    marks: dated.map((r) => ({
      kind: r.kind,
      atUt: r.atUt,
      fraction: at(r.atUt),
    })),
  };
}
