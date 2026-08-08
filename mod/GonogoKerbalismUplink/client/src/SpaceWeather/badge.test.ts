import { describe, expect, it } from "vitest";
import { spaceWeatherBadges } from "./badge";

describe("spaceWeatherBadges", () => {
  it("flags a storm in progress as Take cover (nogo)", () => {
    expect(spaceWeatherBadges({ stormInProgress: true })).toEqual([
      { id: "space-weather-status", label: "Take cover", tone: "nogo" },
    ]);
  });

  it("flags an incoming storm or a radiation belt as Exposed (warn)", () => {
    expect(spaceWeatherBadges({ stormIncoming: true })?.[0]?.label).toBe(
      "Exposed",
    );
    expect(spaceWeatherBadges({ innerBelt: true })?.[0]?.tone).toBe("warn");
    expect(spaceWeatherBadges({ outerBelt: true })?.[0]?.label).toBe("Exposed");
  });

  it("prioritises an in-progress storm over a belt", () => {
    expect(
      spaceWeatherBadges({ stormInProgress: true, innerBelt: true })?.[0]
        ?.label,
    ).toBe("Take cover");
  });

  it("shows no badge when sheltered or when there is no data", () => {
    expect(spaceWeatherBadges({ magnetosphere: true })).toBeNull();
    expect(spaceWeatherBadges(undefined)).toBeNull();
  });
});
