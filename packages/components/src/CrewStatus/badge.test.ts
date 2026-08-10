import type { VesselCrew } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { crewAboardBadge } from "./badge";

function crew(overrides: Partial<VesselCrew> = {}): VesselCrew {
  return {
    count: { magnitude: 3, unit: "count" } as VesselCrew["count"],
    capacity: { magnitude: 4, unit: "count" } as VesselCrew["capacity"],
    crew: [],
    meta: {} as VesselCrew["meta"],
    ...overrides,
  };
}

describe("crewAboardBadge", () => {
  it("shows no badge when there is no crew data yet", () => {
    expect(crewAboardBadge(undefined)).toBeNull();
  });

  it("shows no badge when the headcount itself has not arrived", () => {
    expect(
      crewAboardBadge(
        crew({ count: undefined as unknown as VesselCrew["count"] }),
      ),
    ).toBeNull();
  });

  it("labels count/capacity, info tone", () => {
    expect(crewAboardBadge(crew())).toEqual([
      { id: "crew-status-aboard", label: "3/4 aboard", tone: "info" },
    ]);
  });

  it("falls back to a bare count when capacity is unknown", () => {
    expect(
      crewAboardBadge(
        crew({ capacity: undefined as unknown as VesselCrew["capacity"] }),
      ),
    ).toEqual([{ id: "crew-status-aboard", label: "3 aboard", tone: "info" }]);
  });

  it("handles an unmanned probe (zero crew)", () => {
    expect(
      crewAboardBadge(
        crew({
          count: { magnitude: 0, unit: "count" } as VesselCrew["count"],
        }),
      ),
    ).toEqual([
      { id: "crew-status-aboard", label: "0/4 aboard", tone: "info" },
    ]);
  });
});
