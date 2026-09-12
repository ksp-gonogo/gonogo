import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { WarpRateTable } from "./WarpRateTable";

/** KSP's own ladder, and the one the client used to assume was everybody's. */
const STOCK = [1, 5, 10, 50, 100, 1000, 10000, 100000];

/**
 * The deck's RSS/RO install, measured 2026-09-12 by commanding each rung and
 * reading `time.warp.warpRate` back. Rung 4 is 10000x here and 100x on stock.
 */
const INSTALL = [1, 10, 100, 1000, 10000, 100000, 1000000, 6000000];

/** As the wire carries it: a dimensionless `Value`, not a bare number. */
function published(rates: readonly number[]) {
  return rates.map((r) => value("1", r));
}

describe("WarpRateTable, told the install's own table", () => {
  it("picks the fastest rung the install runs inside the budget", () => {
    const table = new WarpRateTable();
    table.setPublished(published(INSTALL));

    // 3500 game-seconds to run with ten real seconds of margin: 350x.
    expect(table.chooseIndex(350)).toBe(2);
    expect(table.rateAt(2)).toBe(100);
  });

  it("picks a different rung for the same budget on stock", () => {
    const table = new WarpRateTable();
    table.setPublished(published(STOCK));

    // The rung number is the whole point: 4 here, 2 above, same 350x budget.
    expect(table.chooseIndex(350)).toBe(4);
    expect(table.rateAt(4)).toBe(100);
  });

  it("never climbs past the end of a ladder shorter than stock's", () => {
    const table = new WarpRateTable();
    table.setPublished(published([1, 2, 4]));

    expect(table.chooseIndex(1e9)).toBe(2);
    expect(table.rateAt(3)).toBeUndefined();
  });

  it("keeps no table at all rather than half of one", () => {
    const table = new WarpRateTable();
    table.setPublished([1, Number.NaN, 100]);

    expect(table.hasPublishedTable()).toBe(false);
  });
});

describe("WarpRateTable, with only what it has watched the game do", () => {
  it("takes one rung at a time rather than guessing at the rest", () => {
    const table = new WarpRateTable();
    table.observe(0, 1);

    // Nothing has said what rung 1 runs at, and one rung is the smallest move
    // that can find out.
    expect(table.chooseIndex(350)).toBe(1);

    table.observe(1, INSTALL[1]);
    expect(table.chooseIndex(350)).toBe(2);

    table.observe(2, INSTALL[2]);
    expect(table.chooseIndex(350)).toBe(3);
  });

  it("steps back down off a rung that turned out to be too fast", () => {
    const table = new WarpRateTable();
    for (let i = 0; i <= 4; i++) table.observe(i, INSTALL[i]);

    // Rung 3 is 1000x on this install, over the 350x budget, so the ladder
    // settles on 2. The old scan could only ever overshoot: it read a rate off
    // a table of its own and never compared it to what the game did.
    expect(table.chooseIndex(350)).toBe(2);
  });

  it("holds at a standstill when even the first rung is too fast", () => {
    const table = new WarpRateTable();
    table.observe(0, 1);
    table.observe(1, 10);

    expect(table.chooseIndex(5)).toBe(0);
  });

  it("ignores a reading that is not a rate", () => {
    const table = new WarpRateTable();
    table.observe(2, Number.NaN);
    table.observe(3, 0);

    expect(table.rateAt(2)).toBeUndefined();
    expect(table.rateAt(3)).toBeUndefined();
  });

  it("answers for rung 0 without being told: it is the absence of warp", () => {
    expect(new WarpRateTable().rateAt(0)).toBe(1);
  });

  it("prefers the install's table the moment one arrives", () => {
    const table = new WarpRateTable();
    table.observe(4, 999);
    table.setPublished(published(INSTALL));

    expect(table.rateAt(4)).toBe(INSTALL[4]);
    expect(table.hasPublishedTable()).toBe(true);
  });
});
