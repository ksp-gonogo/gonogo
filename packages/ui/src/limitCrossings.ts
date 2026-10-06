/** The side of a limit a figure must not be on: `above` for a ceiling, `below` for a floor. */
export type LimitSide = "above" | "below";

/** Whether a figure stands at or past a limit, on the side the limit declares bad. */
export function isPast(y: number, at: number, bad: LimitSide): boolean {
  return bad === "above" ? y >= at : y <= at;
}

/** The start of one spell a trace spent past a limit. */
export interface LimitCrossing {
  /** The first sample of the spell. */
  index: number;
  /** Where the spell starts, in pixels: on the limit's line where the trace met it, or on the trace at its first sample where it did not cross in view. */
  x: number;
  y: number;
  /** False where the trace was already past the limit at its first sample, so the crossing itself is before the window. */
  entered: boolean;
  /** How many spells this entry stands for: more than one where the trace chattered across the limit and their starts ran together. */
  spells: number;
}

interface CrossingInputs {
  /** Each sample's figure, and where it is drawn. */
  y: readonly number[];
  cx: readonly number[];
  cy: readonly number[];
  limit: number;
  /** Where the limit's line is drawn. */
  limitY: number;
  bad: LimitSide;
  /** Samples that open a hole: nothing joins one to the sample before it. */
  breaks?: readonly number[];
  /** A step trace jumps at the sample, so it meets the line there and not part-way to it. */
  step?: boolean;
  /** A spell starting closer than this to the start of the one before joins it, so a trace that chatters across the limit carries one mark and not a row of them. */
  minGapPx: number;
}

/**
 * Where a trace went past a limit: one entry per continuous spell on the bad
 * side, at the spell's start. Spells whose starts follow each other closer
 * than `minGapPx` are one entry, at the first of them, however long the run.
 *
 * A hole in the trace does not end a spell that is past the limit on both
 * sides of it, since nothing says the figure came back in between.
 */
export function limitCrossings({
  y,
  cx,
  cy,
  limit,
  limitY,
  bad,
  breaks = [],
  step = false,
  minGapPx,
}: Readonly<CrossingInputs>): LimitCrossing[] {
  /** Where the spell opening at sample `i` starts. `from` is the sample the trace is drawn from to reach it, when there is one. */
  const spellStart = (
    i: number,
    seenAny: boolean,
    from: number | null,
  ): Omit<LimitCrossing, "spells"> => {
    if (!seenAny) return { index: i, x: cx[i], y: cy[i], entered: false };
    if (from === null) return { index: i, x: cx[i], y: limitY, entered: true };
    const rise = cy[i] - cy[from];
    const along = rise === 0 ? 1 : (limitY - cy[from]) / rise;
    return {
      index: i,
      x: cx[from] + (cx[i] - cx[from]) * along,
      y: limitY,
      entered: true,
    };
  };
  const holes = new Set(breaks);
  const found: LimitCrossing[] = [];
  let previous: number | null = null;
  let seenAny = false;
  let inSpell = false;
  let lastStartX = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < y.length; i++) {
    if (!Number.isFinite(y[i])) {
      previous = null;
      continue;
    }
    const past = isPast(y[i], limit, bad);
    if (past && !inSpell) {
      const start = spellStart(
        i,
        seenAny,
        // A step jumps at the sample, and nothing joins a sample to the one before a hole.
        step || holes.has(i) ? null : previous,
      );
      const last = found[found.length - 1];
      if (last !== undefined && start.x - lastStartX < minGapPx) last.spells++;
      else found.push({ ...start, spells: 1 });
      lastStartX = start.x;
    }
    inSpell = past;
    seenAny = true;
    previous = i;
  }
  return found;
}
