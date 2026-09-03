import {
  clearRegistry,
  getComponents,
  registerComponent,
} from "@ksp-gonogo/core";
import { beforeAll, describe, expect, it } from "vitest";
import {
  availableAtSeat,
  declaredDomains,
  groundDomainsOf,
} from "./seatAvailability";

/*
 * Importing the package for its side effect: every widget file calls
 * `registerComponent` on import, so this is how the derivation gets a real
 * catalogue to run over rather than a fixture that could drift from it.
 */
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
    /*
     * The direction is the whole point: a third-party widget reading an Uplink
     * domain works aboard with no annotation from an author who never heard of
     * the pilot seat.
     */
    expect(
      availableAtSeat({ channels: ["someUplink.thing" as never] }, "pilot"),
    ).toBe(true);
  });

  it("counts an OPTIONAL ground channel, unlike the health gate", () => {
    /*
     * A widget renders through an optional channel it cannot read, but one
     * that would draw the VAB's contents when they arrive is still a ground
     * instrument.
     */
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

  it("lets a widget that declares no topic at all aboard", () => {
    // Notes, Perf Budgets, the serial controls: chrome with no telemetry of
    // its own has no domain to judge and no reason to be refused.
    expect(availableAtSeat({}, "pilot")).toBe(true);
  });
});

describe("the built-in catalogue, derived", () => {
  let excluded: Array<{ id: string; domains: readonly string[] }>;

  beforeAll(() => {
    excluded = getComponents()
      .filter((def) => !availableAtSeat(def, "pilot"))
      .map((def) => ({ id: def.id, domains: groundDomainsOf(def) }))
      .sort((a, b) => a.id.localeCompare(b.id));
  });

  it("excludes exactly the widgets a ground domain excludes, and no others", () => {
    /*
     * The LIST and its REASONS, so a new ground domain or a new widget reading
     * one shows up as a failing diff rather than as a widget silently
     * appearing on, or vanishing from, a pilot's screen. Update it
     * deliberately.
     *
     * Eight of these are unambiguous ground instruments. THREE are mixed and
     * are the honest cost of deriving rather than declaring, each excluded by
     * a single ground channel among craft-side ones:
     *
     * - `mission-event-log`, on `career.status` and `recovery.lastSummary`
     * beside seven craft channels. A crew watching their own launch, crash
     * and docking events is exactly who wants this, and the spec's own
     * predicted table missed it
     * - `science-data`, on `career`, though a crew running an experiment
     * aboard is the one taking the reading
     * - `contract-manager`, on `career`, though the crew is who fulfils it
     *
     * Each is one `seats: ["mission-control", "pilot"]` away from being forced
     * aboard. That is a call about what belongs on a pilot's screen rather than
     * about the rule, so the derivation is left honest and the three are named
     * here instead of quietly overridden.
     */
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
          "domains": [
            "commandCentre",
          ],
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
            "recovery",
          ],
          "id": "mission-event-log",
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
      expect(e.domains.length).toBeGreaterThan(0);
    }
  });

  it("leaves the craft-side instruments alone", () => {
    const ids = new Set(excluded.map((e) => e.id));
    for (const id of ["navball", "current-orbit", "map-view", "comm-signal"]) {
      expect(ids.has(id)).toBe(false);
    }
  });
});
