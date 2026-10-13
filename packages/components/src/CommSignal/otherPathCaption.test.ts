import { describe, expect, it } from "vitest";
import { measuredRoute, otherPathStrength } from "./useSignalVerdict";

const path = (...names: string[]) => ({
  nodes: names.map((displayName) => ({ displayName })),
});

describe("otherPathStrength", () => {
  it("names the route the figure was measured on, from the first stop after the vessel", () => {
    expect(otherPathStrength(path("Probe", "Relay A", "KSC"))).toBe(
      "Measured via Relay A to KSC, a route this command centre does not believe in",
    );
    expect(measuredRoute(path("Probe", "Relay A", "Relay B", "KSC"))).toBe(
      "via Relay A, Relay B to KSC",
    );
    expect(measuredRoute(path("Probe", "KSC"))).toBe("direct to KSC");
  });

  it("says only that it is another path where it is not told which: a null path is not an empty one", () => {
    const unnamed =
      "Measured on another path: the craft's radio reported this on a route this command centre does not believe in";
    expect(otherPathStrength()).toBe(unnamed);
    expect(otherPathStrength(null)).toBe(unnamed);
    // A path that names no stop beyond the vessel gives nothing to say either, and no route is invented.
    expect(otherPathStrength(path("Probe"))).toBe(unnamed);
    expect(otherPathStrength(path("Probe", " "))).toBe(unnamed);
  });
});
