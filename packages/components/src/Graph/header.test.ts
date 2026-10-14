import type { DataKeyMeta } from "@ksp-gonogo/data";
import { describe, expect, it } from "vitest";
import { computeFullTitle } from "./header";
import type { GraphSeries } from "./types";

const altitude = {
  source: { topic: "vessel.flight", field: "altitude" },
} as GraphSeries;
const speed = {
  source: { topic: "vessel.flight", field: "speed" },
} as GraphSeries;

describe("computeFullTitle", () => {
  it("names a series by its catalog label", () => {
    const meta = new Map([
      ["vessel.flight.altitude", { label: "Altitude" } as DataKeyMeta],
    ]);
    expect(computeFullTitle([altitude], meta)).toBe("Altitude");
  });

  it("leaves a series with no label out, rather than naming it by its raw key", () => {
    const meta = new Map([
      ["vessel.flight.altitude", { label: "Altitude" } as DataKeyMeta],
    ]);
    expect(computeFullTitle([altitude, speed], meta)).toBe("Altitude");
  });

  it("has no title while no series is labelled", () => {
    expect(computeFullTitle([altitude], new Map())).toBeUndefined();
  });
});
