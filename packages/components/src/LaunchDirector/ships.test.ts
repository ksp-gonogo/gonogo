import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  parseSavedShips,
  type SavedShip,
  shipBlockedReason,
  sortByLastLaunched,
} from "./ships";

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
    crewSeats: null,
    canFlyUnmanned: null,
    minimumCrew: null,
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

describe("parseSavedShips control facts", () => {
  it("reads the seats, the unmanned flag and the minimum crew", () => {
    const [probe, cockpit, unread] =
      parseSavedShips([
        { name: "P", crewSeats: 0, canFlyUnmanned: true, minimumCrew: 0 },
        { name: "C", crewSeats: 2, canFlyUnmanned: false, minimumCrew: 1 },
        { name: "U" },
      ]) ?? [];
    expect(probe).toMatchObject({
      crewSeats: 0,
      canFlyUnmanned: true,
      minimumCrew: 0,
    });
    expect(cockpit).toMatchObject({
      crewSeats: 2,
      canFlyUnmanned: false,
      minimumCrew: 1,
    });
    expect(unread).toMatchObject({
      crewSeats: null,
      canFlyUnmanned: null,
      minimumCrew: null,
    });
  });
});

describe("parseSavedShips control facts as the wire carries them", () => {
  it("reads the seats and minimum crew from count values", () => {
    const [cockpit] =
      parseSavedShips([
        {
          name: "C",
          crewSeats: value("count", 2),
          canFlyUnmanned: false,
          minimumCrew: value("count", 1),
        },
      ]) ?? [];
    expect(cockpit).toMatchObject({ crewSeats: 2, minimumCrew: 1 });
  });
});

describe("shipBlockedReason crew", () => {
  const cockpit = {
    ...ship("Plane", null),
    crewSeats: 2,
    canFlyUnmanned: false,
    minimumCrew: 1,
  };

  it("blocks a craft that needs crew when none is free, and says so", () => {
    expect(shipBlockedReason(cockpit, 1000, 0)).toBe(
      "Needs crew, and no kerbal is free",
    );
  });

  it("says how many it needs when fewer are free than the craft needs", () => {
    expect(shipBlockedReason({ ...cockpit, minimumCrew: 3 }, 1000, 2)).toBe(
      "Needs 3 crew, 2 free",
    );
  });

  it("leaves a craft that crew can fly ready while one kerbal is free", () => {
    expect(shipBlockedReason(cockpit, 1000, 1)).toBeNull();
  });

  it("leaves a probe craft ready with nobody free", () => {
    expect(
      shipBlockedReason(
        { ...cockpit, canFlyUnmanned: true, minimumCrew: 0 },
        1000,
        0,
      ),
    ).toBeNull();
  });

  it("blocks a craft with no command module whatever the roster", () => {
    expect(shipBlockedReason({ ...cockpit, minimumCrew: null }, 1000, 5)).toBe(
      "No command module",
    );
  });

  it("does not block on a roster or a craft it has not read", () => {
    expect(shipBlockedReason(cockpit, 1000, null)).toBeNull();
    expect(shipBlockedReason(ship("Unread", null), 1000, 0)).toBeNull();
  });

  it("lists the crew cause beside a funds cause", () => {
    expect(shipBlockedReason(cockpit, 10, 0)).toBe(
      "Insufficient funds\nNeeds crew, and no kerbal is free",
    );
  });
});
