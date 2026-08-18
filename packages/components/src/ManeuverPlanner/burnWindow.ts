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

const FRAMING: Record<
  BurnInstantKind,
  {
    label: string;
    question: string;
    basis: string;
    absent: string;
    absentDetail: string;
  }
> = {
  ignition: {
    label: "Ignition",
    question: "when do the engines light",
    basis: "rocket equation",
    absent: "no burn-time model",
    absentDetail:
      "Nothing supplies a burn duration for this craft, so there is no ignition time. Stock computes one only for a loaded vessel.",
  },
  reference: {
    label: "Node",
    question: "when does the impulsive equivalent fall",
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
): readonly [BurnInstantRow, BurnInstantRow, BurnInstantRow] {
  const at: Record<BurnInstantKind, number | null> = {
    ignition: burn.ignitionUt ?? null,
    reference: burn.ut,
    cutoff: burn.cutoffUt ?? null,
  };
  const rows = ORDER.map((kind) => {
    const framing = FRAMING[kind];
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
