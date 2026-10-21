import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { parseSavedShips, type SavedShip, sortByLastLaunched } from "./ships";

function ship(name: string, launchedAt: number | null): SavedShip {
  return {
    name,
    file: name,
    partCount: 4,
    totalMass: 1,
    facility: "VAB",
    facilityOrdinal: 1,
    requiresFunds: 100,
    missingParts: [],
    lastLaunched: launchedAt === null ? null : value("ut", launchedAt),
    lastLaunchedByName: false,
  };
}

describe("sortByLastLaunched", () => {
  it("puts the most recently launched first and the never-launched after, by name", () => {
    const sorted = sortByLastLaunched([
      ship("Zeta", null),
      ship("Old", 100),
      ship("Alpha", null),
      ship("New", 900),
    ]);
    expect(sorted.map((s) => s.name)).toEqual(["New", "Old", "Alpha", "Zeta"]);
  });

  it("orders craft launched at the same time by name and leaves its input alone", () => {
    const input = [ship("B", 5), ship("A", 5)];
    expect(sortByLastLaunched(input).map((s) => s.name)).toEqual(["A", "B"]);
    expect(input.map((s) => s.name)).toEqual(["B", "A"]);
  });
});

describe("parseSavedShips last launch", () => {
  it("reads the launch time and whether it was matched by name", () => {
    const [recorded, byName, never] =
      parseSavedShips([
        { name: "A", lastLaunchedUt: 2400, lastLaunchedByName: false },
        { name: "B", lastLaunchedUt: 1900, lastLaunchedByName: true },
        { name: "C" },
      ]) ?? [];
    expect(recorded.lastLaunched?.magnitude).toBe(2400);
    expect(recorded.lastLaunchedByName).toBe(false);
    expect(byName.lastLaunched?.magnitude).toBe(1900);
    expect(byName.lastLaunchedByName).toBe(true);
    expect(never.lastLaunched).toBeNull();
    expect(never.lastLaunchedByName).toBe(false);
  });
});
