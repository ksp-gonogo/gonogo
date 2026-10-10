import { describe, expect, it } from "vitest";
import { widenTrendDomain } from "./trendDomain";

describe("the descent-rate trend's scale", () => {
  it("only ever widens, so a sample sliding out of the window never rescales the line", () => {
    let domain: [number, number] | null = null;
    const seen: [number, number][] = [];
    for (const v of [-5, -40, -145, -120, -90, -30, -3, -1, 0]) {
      domain = widenTrendDomain(domain, v);
      seen.push(domain);
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i][0]).toBeLessThanOrEqual(seen[i - 1][0]);
      expect(seen[i][1]).toBeGreaterThanOrEqual(seen[i - 1][1]);
    }
    expect(seen[seen.length - 1]).toEqual([-145, 0]);
  });

  it("always holds zero, so a trend toward a soft touchdown reads against the ground", () => {
    expect(widenTrendDomain(null, -12)).toEqual([-12, 0]);
    expect(widenTrendDomain(null, 7)).toEqual([0, 7]);
  });

  it("ignores a value it cannot read", () => {
    expect(widenTrendDomain([-10, 0], Number.NaN)).toEqual([-10, 0]);
  });
});
