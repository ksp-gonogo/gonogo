/*
 * A burn has three instants (ignition, the impulsive-equivalent reference and
 * cutoff) and they never merge into one countdown. Under an impulsive plan the
 * outer two are absent, and an absent one says why rather than dropping out:
 * three rows read as the complete set.
 */

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

/** The words around one instant, caller-supplied because most of them describe this app's burn source rather than burns in general. */
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
 * The stock-shaped framing, and the default. It assumes a reference instant
 * exists, which is a patched-conic assumption: an integrating planner may have
 * none. Ignition and cutoff are real events whose label and question are
 * shared vocabulary; the reference is a model artefact whose label and question
 * travel with its provenance, as `basis`, `absent` and `absentDetail` do
 * throughout.
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
    /*
     * The half-delta-v point, not the time midpoint: mass falls as the burn
     * proceeds, so the second half takes longer, and ignition sits a lead ahead
     * of this instant.
     */
    label: "Half-Δv",
    question: "when has half the delta-v been delivered",
    basis: "planned",
    // The reference is the one instant every plan has, so it is never absent for a burn that exists at all.
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
  const [first, second, third] = rows;
  return [first, second, third];
}

/** Burn duration in seconds, or null when the plan models none; derived, since the wire ships only the two instants. */
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
  /** The view clock on the same scale; outside [0, 1] before or after the burn, where a renderer omits the marker rather than clamping it. */
  nowFraction: number;
  marks: readonly BurnAxisMark[];
}

/** The instants on one shared scale; null when fewer than two have a UT (the impulsive case), since one mark shows no ordering. */
export function burnAxis(
  rows: readonly BurnInstantRow[],
  nowUt: number,
): BurnAxis | null {
  const dated = rows.filter(
    (r): r is BurnInstantRow & { atUt: number } => r.atUt != null,
  );
  if (dated.length < 2) return null;

  const uts = dated.map((r) => r.atUt);
  // The span is the burn, not now-to-cutoff: the instants' spacing relative to each other is the whole content.
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
