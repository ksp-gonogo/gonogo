import { describe, expect, it } from "vitest";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

function point(validAt: number, payload: unknown): TimelinePoint<unknown> {
  return {
    validAt,
    payload,
    meta: makeMeta({ validAt, deliveredAt: validAt }),
    epoch: 0,
  };
}

function store(): TimelineStore {
  return new TimelineStore(
    new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
  );
}

const CREW = { count: 2, capacity: 6, crew: [{ name: "Bob Kerman" }] };
const LOST = { connected: false, controlSource: 0, hasLocalControl: false };
const LINKED = { connected: true, controlSource: 2, hasLocalControl: true };

/**
 * A pod undocks and the craft left with no antenna reads connected false, after which
 * the mod sends it nothing: the last crew and parts frames, at 36909.1, are all the
 * ground has, and the loss itself arrives at 36910.1.
 */
describe("readings of a craft whose link home is lost", () => {
  it("are held from their last value before the blackout", () => {
    const s = store();
    s.ingest("vessel.crew", point(36909.1, CREW));
    s.ingest("vessel.parts", point(36909.1, { parts: [] }));
    s.ingest("comms.connectivity", point(36910.1, LOST));
    s.beginFrame();

    const crew = s.sampleReading("vessel.crew");
    expect(crew.state).toBe("held");
    expect(crew.state === "held" && crew.grade).toBe("last-before-blackout");
    const parts = s.sampleReading("vessel.parts");
    expect(parts.state === "held" && parts.grade).toBe("last-before-blackout");
  });

  it("are current when frames taken after the loss still arrive", () => {
    const s = store();
    s.ingest("comms.connectivity", point(36910.1, LOST));
    s.ingest("vessel.crew", point(36911.2, CREW));
    s.beginFrame();

    expect(s.sampleReading("vessel.crew").state).toBe("observed");
  });

  it("are current while the link stands", () => {
    const s = store();
    s.ingest("vessel.crew", point(36909.1, CREW));
    s.ingest("comms.connectivity", point(36910.1, LINKED));
    s.beginFrame();

    expect(s.sampleReading("vessel.crew").state).toBe("observed");
  });

  it("do not hold what the ground knows without the craft", () => {
    const s = store();
    s.ingest("trackingStation.bodies", point(36909.1, { bodies: [] }));
    s.ingest("comms.connectivity", point(36910.1, LOST));
    s.beginFrame();

    expect(s.sampleReading("trackingStation.bodies").state).toBe("observed");
    expect(s.sampleReading("comms.connectivity").state).toBe("observed");
  });
});
