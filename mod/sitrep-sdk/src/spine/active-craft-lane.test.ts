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
});
