import { getContributionsForSlot } from "@ksp-gonogo/core";
import {
  Situation,
  type SystemBodies,
  VesselType,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import "../CommSignal/badge";
import "../CrewStatus/badge";
import "../FleetComms/badge";
import "../SystemView/vesselOrbitsContribution";

/**
 * The built-in contributions against held readings: each one draws a held
 * value as held, through the entry's own `held` field or the slot's own
 * marking, and never as current.
 */

function observed(payload: unknown) {
  return {
    state: "observed",
    value: payload,
    atUt: value("ut", 100),
    reckoning: { status: "none" },
  } as const;
}

function held(payload: unknown) {
  return {
    state: "held",
    value: payload,
    asOfUt: value("ut", 100),
    grade: "disconnected",
    reckoning: { status: "none" },
  } as const;
}

const PENDING = { state: "pending", reckoning: { status: "none" } } as const;

function compute(slot: string, id: string, topics: Record<string, unknown>) {
  const contribution = getContributionsForSlot(slot).find((c) => c.id === id);
  if (!contribution) throw new Error(`the ${id} contribution is missing`);
  return contribution.compute(topics) as Record<string, unknown>[] | null;
}

const CREW = {
  count: value("count", 3),
  capacity: value("count", 4),
  crew: [],
};

describe("the built-in contributions draw a held value as held", () => {
  it("the crew headcount badge carries the crew reading, so a held count shows the held word", () => {
    const [current] =
      compute("crew-status.badges", "core:crew-status-aboard-badge", {
        "vessel.crew": observed(CREW),
      }) ?? [];
    const [stale] =
      compute("crew-status.badges", "core:crew-status-aboard-badge", {
        "vessel.crew": held(CREW),
      }) ?? [];
    expect(current).toMatchObject({ label: "3/4 aboard" });
    expect(stale).toMatchObject({
      label: "3/4 aboard",
      held: { state: "held", grade: "disconnected" },
    });
  });

  it("the comms link badge keeps the link's last word while held and marks it held", () => {
    const [badge] =
      compute("system-view.badges", "core:fleet-comms-badge", {
        "comms.link": held({ connected: true }),
      }) ?? [];
    expect(badge).toMatchObject({
      label: "COMMS LINKED",
      held: { state: "held" },
    });
  });

  it("the comms link badge waits for a link not yet heard from", () => {
    const [badge] =
      compute("system-view.badges", "core:fleet-comms-badge", {
        "comms.link": PENDING,
      }) ?? [];
    expect(badge).toMatchObject({ label: "COMMS AWAITING" });
  });

  it("CommNet Signal says no signal from the readings' own currency", () => {
    const badges = (link: unknown) =>
      compute("comm-signal.badges", "core:comm-signal-no-signal-badge", {
        "comms.link": link,
        "vessel.comms": observed({}),
      });
    expect(badges(observed({ connected: true }))).toEqual([]);
    expect(badges(held({ connected: true }))).toMatchObject([
      { label: "No signal" },
    ]);
  });

  it("the fleet's orbits are drawn held while the roster they came from is held", () => {
    const bodies: SystemBodies = {
      bodies: [{ index: 1, name: "Kerbin" } as SystemBodies["bodies"][number]],
    };
    const roster = {
      vessels: [
        {
          vesselId: "v-1",
          name: "Relay",
          vesselType: VesselType.Relay,
          situation: Situation.Orbiting,
          bodyIndex: 1,
        },
      ],
    };
    const entities = (vessels: unknown) =>
      compute("system-view.entities", "core:system-view-vessel-orbits", {
        "system.vessels": vessels,
        "system.bodies": observed(bodies),
        "comms.network": PENDING,
      }) ?? [];
    expect(entities(observed(roster))[0]?.currency).toBeUndefined();
    expect(entities(held(roster))[0]?.currency).toBe("held");
  });
});
