import { describe, expect, it } from "vitest";
import { type Meta, Quality, Staleness } from "../__generated__/contract";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

function meta(
  validAt: number,
  deliveredAt: number,
  staleness: Staleness,
): Meta {
  return {
    source: "vessel:probe",
    validAt,
    seq: 0,
    deliveredAt,
    vantage: "ground:ksc",
    quality: Quality.OnRails,
    active: true,
    staleness,
    timelineEpoch: 0,
  };
}

/**
 * A recorded sample describes the past, and can arrive while the craft is
 * still out of contact, so it is no evidence the link is alive. A live
 * reading whose craft has gone quiet reads as held even when recorded data
 * reaches the screen afterwards.
 */
describe("the heartbeat behind a live reading", () => {
  it("is not refreshed by a recorded sample arriving later", () => {
    let wall = 0;
    const clock = new ViewClock({
      nowWall: () => wall,
      warpRate: () => 1,
      delaySeconds: () => 0,
    });
    const store = new TimelineStore(clock);
    const topic = "vessel.flight";

    for (let ut = 0; ut <= 10; ut++) {
      wall = ut * 1000;
      store.ingest(topic, {
        validAt: ut,
        payload: { altitudeAsl: ut },
        meta: meta(ut, ut, Staleness.Fresh),
        epoch: 0,
      });
    }

    wall = 40_000;
    store.ingest(topic, {
      validAt: 4.5,
      payload: { altitudeAsl: 4.5 },
      meta: meta(4.5, 40, Staleness.Recorded),
      epoch: 0,
    });
    // The rest of the stream carries on, which is what moves the certainty horizon past the craft's own last live arrival.
    store.ingest("time.warp", {
      validAt: 40,
      payload: { rate: 1 },
      meta: meta(40, 40, Staleness.Fresh),
      epoch: 0,
    });

    const token = store.beginFrame();
    expect(store.sampleStatus(topic, token)).toBe("held");
  });
});
