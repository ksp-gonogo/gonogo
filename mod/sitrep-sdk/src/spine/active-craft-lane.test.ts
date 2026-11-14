import { describe, expect, it } from "vitest";
import { type Meta, Quality, Staleness } from "../__generated__/contract";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

function meta(validAt: number, deliveredAt: number): Meta {
  return {
    source: "system",
    validAt,
    seq: 0,
    deliveredAt,
    vantage: "ground:ksc",
    quality: Quality.OnRails,
    active: true,
    staleness: Staleness.Fresh,
    timelineEpoch: 0,
  };
}

function setup() {
  let wall = 0;
  const clock = new ViewClock({
    nowWall: () => wall,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  const flight = (craft: string, validAt: number, deliveredAt: number) => {
    wall = deliveredAt * 1000;
    store.ingest("vessel.flight", {
      validAt,
      payload: {
        altitudeAsl: validAt,
        meta: { source: `vessel:${craft}` },
      },
      meta: meta(validAt, deliveredAt),
      epoch: 0,
    });
  };
  const switchTo = (craft: string, at: number) => {
    wall = at * 1000;
    store.ingest("comms.delay", {
      validAt: at,
      payload: { oneWaySeconds: 1, meta: { source: `vessel:${craft}` } },
      meta: meta(at, at),
      epoch: 0,
    });
  };
  const altitude = () =>
    (
      store.sample<{ altitudeAsl: number }>("vessel.flight", store.beginFrame())
        ?.payload as { altitudeAsl: number } | undefined
    )?.altitudeAsl;
  return { store, flight, switchTo, altitude };
}

/**
 * After a switch the active-vessel topics carry readings of two craft, each
 * reaching the screen after its own craft's delay. The screen shows the
 * active craft's own newest reading, whichever craft's readings lie past it.
 */
describe("an active-vessel topic after a switch", () => {
  it("shows the new craft's reading when the craft left behind has newer ones", () => {
    const { flight, switchTo, altitude } = setup();
    switchTo("near", 0);
    for (let ut = 0; ut <= 100; ut++) flight("near", ut, ut + 1);

    switchTo("far", 101);
    // The far craft's newest reading to have arrived is older than the near craft's last.
    flight("far", 70, 101);

    expect(altitude()).toBe(70);
  });

  it("shows nothing when the craft switched to has no reading on the screen yet", () => {
    const { flight, switchTo, altitude } = setup();
    switchTo("near", 0);
    for (let ut = 0; ut <= 10; ut++) flight("near", ut, ut + 1);

    switchTo("unheard", 11);

    expect(altitude()).toBeUndefined();
  });

  it("shows the craft switched back to its own reading again", () => {
    const { flight, switchTo, altitude } = setup();
    switchTo("a", 0);
    for (let ut = 0; ut <= 10; ut++) flight("a", ut, ut + 1);
    switchTo("b", 11);
    flight("b", 11, 12);
    switchTo("a", 12);

    expect(altitude()).toBe(10);
  });

  it("leaves a topic about some other craft alone", () => {
    const { store, switchTo } = setup();
    switchTo("a", 0);
    store.ingest("trackingStation.vessel.b.link", {
      validAt: 1,
      payload: { connected: true, meta: { source: "vessel:b" } },
      meta: meta(1, 1),
      epoch: 0,
    });

    expect(
      store.sample("trackingStation.vessel.b.link", store.beginFrame()),
    ).toBeDefined();
  });

  it("applies to an Uplink's Topic the mod lists as following the active craft", () => {
    const { store, switchTo } = setup();
    store.ingest("system.uplinks", {
      validAt: 0,
      payload: {
        delayRoles: {
          trueNow: [],
          heldAtHome: [],
          trueNowPrefixes: [],
          followsActiveCraft: ["life-support.supplies"],
        },
      },
      meta: meta(0, 0),
      epoch: 0,
    });
    const supplies = (craft: string, validAt: number, deliveredAt: number) =>
      store.ingest("life-support.supplies", {
        validAt,
        payload: { food: validAt, meta: { source: `vessel:${craft}` } },
        meta: meta(validAt, deliveredAt),
        epoch: 0,
      });
    switchTo("near", 0);
    for (let ut = 0; ut <= 100; ut++) supplies("near", ut, ut + 1);
    switchTo("far", 101);
    supplies("far", 70, 101);

    const shown = store.sample<{ food: number }>(
      "life-support.supplies",
      store.beginFrame(),
    )?.payload as { food: number } | undefined;
    expect(shown?.food).toBe(70);
  });

  it("tells an Uplink's readings apart by the craft whose node delivered them when the payload names none", () => {
    const { store, switchTo } = setup();
    store.ingest("system.uplinks", {
      validAt: 0,
      payload: {
        delayRoles: {
          trueNow: [],
          heldAtHome: [],
          trueNowPrefixes: [],
          followsActiveCraft: ["life-support.crew"],
        },
      },
      meta: meta(0, 0),
      epoch: 0,
    });
    const crew = (craft: string, validAt: number, deliveredAt: number) =>
      store.ingest("life-support.crew", {
        validAt,
        payload: { asOf: validAt },
        meta: { ...meta(validAt, deliveredAt), source: `fleet.${craft}` },
        epoch: 0,
      });
    switchTo("near", 0);
    for (let ut = 0; ut <= 100; ut++) crew("near", ut, ut + 1);
    switchTo("far", 101);
    crew("far", 70, 101);

    const shown = store.sample<{ asOf: number }>(
      "life-support.crew",
      store.beginFrame(),
    )?.payload as { asOf: number } | undefined;
    expect(shown?.asOf).toBe(70);
  });
});

/**
 * A station's store fetches history from the main screen and trims what it keeps
 * to a window behind each topic's newest reading. After a switch to a craft out
 * of contact, that craft's only reading is from before its blackout, older than
 * the craft left behind's last. The trim keeps it, as the main screen does.
 */
describe("a station's store after a switch to a craft out of contact", () => {
  it("keeps the new craft's only reading though the craft left behind has a much newer one", () => {
    const { store, flight, switchTo, altitude } = setup();
    store.setHistorySource({ request: async () => [] });
    switchTo("near", 0);
    for (let ut = 600; ut <= 669; ut++) flight("near", ut, ut);

    switchTo("dark", 670);
    flight("dark", 560, 670);
    // A reading of the craft left behind still lands after the switch.
    flight("near", 670, 670);

    expect(altitude()).toBe(560);
  });
});

/**
 * The first link frame of a craft out of contact after a switch, as recorded on
 * the Deck. A screen reads a held link as awaiting its first signal, so the mod
 * serves this catch-up as fresh: it is the craft's link report, the answer
 * itself.
 */
describe("the link frame a switch to a craft out of contact delivers", () => {
  const probe = "6667a929-ca1a-7df0-b765-cdab33ebf5bf";
  const linkFrame = (staleness: Staleness) => ({
    validAt: 591.3599999997522,
    payload: { connected: false, meta: { source: `vessel:${probe}` } },
    meta: {
      ...meta(591.3599999997522, 669.619999999681),
      source: `fleet.${probe}`,
      staleness,
    },
    epoch: 0,
  });

  it("reads as the craft's link, lost, as the mod now serves it", () => {
    const { store, switchTo } = setup();
    switchTo(probe, 669.6);
    store.ingest("comms.link", linkFrame(Staleness.Fresh));

    const reading = store.sampleReading<{ connected: boolean }>(
      "comms.link",
      store.beginFrame(),
    );
    expect(reading.state).toBe("observed");
    expect(reading.state === "observed" && reading.value.connected).toBe(false);
  });

  it("read as held, and so as awaiting a first signal, as it was served before", () => {
    const { store, switchTo } = setup();
    switchTo(probe, 669.6);
    store.ingest("comms.link", linkFrame(Staleness.Held));

    const reading = store.sampleReading("comms.link", store.beginFrame());
    expect(reading.state).toBe("held");
    expect(reading.state === "held" && reading.grade).toBe("held");
  });
});

/**
 * The command centre's route to the active craft names no craft, so after a
 * switch the store cannot tell the craft left behind's route by its source. It
 * goes by when the route was recorded: one recorded before the new craft became
 * active is the craft left behind's, and the screen waits for the new craft's.
 */
describe("a route that names no craft, after a switch", () => {
  const stateActive = (store: TimelineStore, craft: string, at: number) =>
    store.ingest("ksp.activeVessel", {
      validAt: at,
      payload: { vesselId: craft },
      meta: meta(at, at),
      epoch: 0,
    });
  const route = (store: TimelineStore, metres: number, at: number) =>
    store.ingest("comms.path", {
      validAt: at,
      payload: { hops: [{ distanceMetres: metres }] },
      meta: meta(at, at),
      epoch: 0,
    });

  it("waits for the new craft's route instead of showing the old craft's", () => {
    const { store } = setup();
    stateActive(store, "home", 0);
    route(store, 447.4, 50);

    stateActive(store, "probe", 100);
    // The route the planner sent on the switch's own tick was measured for the craft left behind.
    route(store, 447.4, 100);
    expect(store.sampleReading("comms.path", store.beginFrame()).state).toBe(
      "pending",
    );

    route(store, 1_200_000, 101);
    const reading = store.sampleReading<{ hops: { distanceMetres: number }[] }>(
      "comms.path",
      store.beginFrame(),
    );
    expect(reading.state).toBe("observed");
    expect(
      reading.state === "observed" && reading.value.hops[0].distanceMetres,
    ).toBe(1_200_000);
  });

  it("shows the route as it is when the game names the same craft again", () => {
    const { store } = setup();
    stateActive(store, "home", 0);
    route(store, 447.4, 50);
    stateActive(store, "home", 100);

    expect(store.sampleReading("comms.path", store.beginFrame()).state).toBe(
      "observed",
    );
  });
});

/**
 * The order a station receives a switch in, as recorded on the Deck: the screen
 * last drew before the switch, the game's statement of the new craft arrives,
 * then the new craft's only reading, then a late reading of the craft left
 * behind. The trim keeps the new craft's reading from the moment it arrives.
 */
describe("a station's store when the switch arrives between two frames", () => {
  it("keeps the new craft's only reading through the craft left behind's late one", () => {
    const { store, flight } = setup();
    store.setHistorySource({ request: async () => [] });
    const stateActive = (craft: string, at: number) =>
      store.ingest("ksp.activeVessel", {
        validAt: at,
        payload: { vesselId: craft },
        meta: meta(at, at),
        epoch: 0,
      });
    stateActive("near", 600);
    for (let ut = 600; ut <= 669; ut++) flight("near", ut, ut);
    store.beginFrame();

    stateActive("dark", 670);
    flight("dark", 560, 670);
    flight("near", 670, 670);

    const shown = store.sample<{ altitudeAsl: number }>(
      "vessel.flight",
      store.beginFrame(),
    )?.payload;
    expect(shown?.altitudeAsl).toBe(560);
  });
});
