import { magnitudeOf, type Quantityish } from "@ksp-gonogo/ui-kit";

/**
 * How far the ladder is allowed to climb when nothing has said how long it is.
 *
 * KSP's own ladder is eight rungs, and an install republishes the VALUES on
 * them rather than the count: the deck's RSS/RO table is eight entries too.
 * The bound only ever applies to the learned table, because a published one
 * says how many rungs it has.
 */
const MAX_LEARNED_INDEX = 7;

/**
 * What each warp rung actually runs at on the install the client is talking to.
 *
 * The table is CONFIG, not a constant: a planet pack is free to republish it,
 * and asking for a rung believing it to be stock's 100x on an install that runs
 * it at 10000x spends a warp window that cannot be aborted from inside. Two
 * sources, in order of authority:
 *
 * 1. `time.warp.warpRates`, the install's own table as the mod reads it off
 *    `TimeWarp.fetch.warpRates`. Complete, so the ladder needs no guessing.
 * 2. What the game has been SEEN running at, rung by rung, when the mod is too
 *    old to publish the table. Sparse by construction: it knows a rung only
 *    once the game has been at it.
 *
 * There is deliberately no third source. Falling back to stock's table is what
 * the defect was, and a stock guess is indistinguishable from knowledge at the
 * point of use.
 */
export class WarpRateTable {
  private published: readonly number[] | null = null;
  private learned = new Map<number, number>();

  /**
   * Take the install's own table off `time.warp`, or forget it again when a
   * stream stops carrying one.
   */
  setPublished(rates: readonly Quantityish[] | null | undefined): void {
    if (rates == null || rates.length === 0) {
      this.published = null;
      return;
    }
    const read: number[] = [];
    for (const rate of rates) {
      const magnitude = magnitudeOf(rate);
      /* All or nothing: a table with a hole in it would have the hole read as
         "no evidence for this rung" and probed, on an install that has already
         said what the rung is. */
      if (magnitude == null || !Number.isFinite(magnitude) || magnitude <= 0) {
        return;
      }
      read.push(magnitude);
    }
    this.published = read;
  }

  /** Record what the game was actually running at a rung it reached. */
  observe(index: number, rate: number): void {
    if (!Number.isInteger(index) || index < 0) return;
    if (!Number.isFinite(rate) || rate <= 0) return;
    this.learned.set(index, rate);
  }

  /** Whether the install's own table is in hand, as opposed to observations of it. */
  hasPublishedTable(): boolean {
    return this.published !== null;
  }

  /**
   * The rate at a rung, or `undefined` where there is no evidence for one.
   *
   * Rung 0 answers 1 without evidence: it is not a warp rate, it is the
   * absence of warp, and every source agrees on it by construction.
   */
  rateAt(index: number): number | undefined {
    if (index === 0) return this.published?.[0] ?? 1;
    if (this.published !== null) return this.published[index];
    return this.learned.get(index);
  }

  /**
   * The fastest rung this client is willing to ask for, given the fastest rate
   * that still leaves the safety margin intact.
   *
   * Walks UP from rung 0 rather than scanning down from the top, because the
   * learned table is sparse and a scan down would jump over the rungs it has
   * no evidence for. The walk stops at the first rung known to be too fast, and
   * so also steps the ladder back DOWN when a rung turns out to run faster than
   * the client believed: the previous code could only ever overshoot, never
   * notice.
   *
   * The first rung with no evidence is returned as-is. It is the smallest move
   * that can produce that evidence, the game reports what it actually gave, and
   * the next tick judges the result rather than a prediction. Without that step
   * a client talking to a mod too old to publish the table could never warp at
   * all, which is a worse answer than one careful rung.
   */
  chooseIndex(maxRate: number): number {
    const ceiling = this.ladderTopIndex();
    let chosen = 0;
    for (let i = 1; i <= ceiling; i++) {
      const rate = this.rateAt(i);
      if (rate === undefined) return i;
      if (rate > maxRate) return chosen;
      chosen = i;
    }
    return chosen;
  }

  private ladderTopIndex(): number {
    return this.published !== null
      ? this.published.length - 1
      : MAX_LEARNED_INDEX;
  }
}
