import { getComponents } from "@ksp-gonogo/core";
import { beforeAll, describe, expect, it } from "vitest";
import {
  availableAtSeat,
  declaredDomains,
  groundDomainsOf,
} from "./seatAvailability";

// Registers the real catalogue, rather than a fixture that could drift from it.
import "../index";

describe("declaredDomains", () => {
  it("reads both declaration forms, because a widget may use either", () => {
    expect(
      [
        ...declaredDomains({
          channels: ["vessel.orbit"],
          optionalChannels: ["comms.delay"],
          dataRequirements: ["career.status.economy.funds"],
        }),
      ].sort(),
    ).toEqual(["career", "comms", "vessel"]);
  });

  it("treats a bare key with no dot as its own domain", () => {
    expect([...declaredDomains({ channels: ["kos" as never] })]).toEqual([
      "kos",
    ]);
  });
});

describe("availableAtSeat", () => {
  const ground = { channels: ["career.status" as never] };
  const aboard = { channels: ["vessel.orbit" as never] };

  it("lets everything through at mission control", () => {
    expect(availableAtSeat(ground, "mission-control")).toBe(true);
    expect(availableAtSeat(aboard, "mission-control")).toBe(true);
  });

  it("keeps a ground instrument off the pilot's screen", () => {
    expect(availableAtSeat(ground, "pilot")).toBe(false);
  });

  it("fails OPEN for a domain it has never heard of", () => {
    expect(
      availableAtSeat({ channels: ["someUplink.thing" as never] }, "pilot"),
    ).toBe(true);
  });

  it("counts an OPTIONAL ground channel, unlike the health gate", () => {
    expect(
      availableAtSeat(
        { optionalChannels: ["spaceCenter.scene" as never] },
        "pilot",
      ),
    ).toBe(false);
  });

  it("lets an explicit declaration overrule the derivation in both directions", () => {
    expect(availableAtSeat({ ...ground, seats: ["pilot"] }, "pilot")).toBe(
      true,
    );
    expect(
      availableAtSeat({ ...aboard, seats: ["mission-control"] }, "pilot"),
    ).toBe(false);
  });

  it("lets the command-centre roster and separation aboard", () => {
    expect(
      availableAtSeat(
        {
          channels: ["commandCentre.roster", "commandCentre.separation"],
        },
        "pilot",
      ),
    ).toBe(true);
  });

  it("still counts the rest of the command-centre domain as ground", () => {
    expect(
      availableAtSeat(
        {
          channels: [
            "commandCentre.roster",
            "commandCentre.activeVesselDelay" as never,
          ],
        },
        "pilot",
      ),
    ).toBe(false);
  });

  it("lets a widget that declares no topic at all aboard", () => {
    expect(availableAtSeat({}, "pilot")).toBe(true);
  });
});

describe("the built-in catalogue, derived", () => {
  let excluded: Array<{
    id: string;
    domains: readonly string[];
    declared?: readonly string[];
  }>;

  beforeAll(() => {
    excluded = getComponents()
      .filter((def) => !availableAtSeat(def, "pilot"))
      .map((def) => ({
        id: def.id,
        domains: groundDomainsOf(def),
        ...(def.seats ? { declared: def.seats } : {}),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  });

  it("excludes exactly the widgets a ground domain excludes, and no others", () => {
    // The list and its reasons, so a widget joining or leaving the pilot's screen shows as a diff.
    expect(excluded).toMatchInlineSnapshot(`
      [
        {
          "domains": [
            "career",
            "spaceCenter",
          ],
          "id": "astronaut-complex",
        },
        {
          "domains": [
            "career",
          ],
          "id": "career-economy",
        },
        {
          "domains": [
            "career",
          ],
          "id": "contract-manager",
        },
        {
          "declared": [
            "mission-control",
          ],
          "domains": [],
          "id": "fleet-roster",
        },
        {
          "domains": [
            "career",
            "spaceCenter",
          ],
          "id": "launch-director",
        },
        {
          "domains": [
            "career",
          ],
          "id": "objectives",
        },
        {
          "domains": [
            "career",
          ],
          "id": "science-data",
        },
        {
          "domains": [
            "career",
            "spaceCenter",
          ],
          "id": "space-center-status",
        },
        {
          "domains": [
            "career",
          ],
          "id": "strategies",
        },
        {
          "domains": [
            "career",
            "spaceCenter",
          ],
          "id": "tech-tree",
        },
      ]
    `);
  });

  it("names a reason for every exclusion", () => {
    for (const e of excluded) {
      expect(e.domains.length + (e.declared?.length ?? 0)).toBeGreaterThan(0);
    }
  });

  it("leaves the craft-side instruments alone", () => {
    const ids = new Set(excluded.map((e) => e.id));
    for (const id of ["navball", "current-orbit", "map-view", "comm-signal"]) {
      expect(ids.has(id)).toBe(false);
    }
  });
});
