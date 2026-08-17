import { describe, expect, it } from "vitest";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

function point(validAt: number, payload: number | null): TimelinePoint<number> {
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

describe("TimelineStore.sampleReading", () => {
  it("returns the SAME object for repeat reads within one frame", () => {
    // `useSyncExternalStore` compares snapshots by reference, so a reading
    // rebuilt on every getSnapshot call is an infinite render loop, not merely
    // a wasted allocation. This is the property that makes the union usable
    // from a hook at all.
    const s = store();
    s.ingest("vessel.target", point(10, 5));
    s.beginFrame();

    const first = s.sampleReading("vessel.target");
    const second = s.sampleReading("vessel.target");
    expect(second).toBe(first);
  });

  it("builds a fresh reading once the frame advances", () => {
    const s = store();
    s.ingest("vessel.target", point(10, 5));
    s.beginFrame();
    const first = s.sampleReading("vessel.target");

    s.ingest("vessel.target", point(11, 6));
    s.beginFrame();
    const second = s.sampleReading("vessel.target");

    expect(second).not.toBe(first);
    expect(second).toEqual({ state: "observed", value: 6, atUt: 11 });
  });

  it("agrees with the value and status reads for the same frame", () => {
    const s = store();
    s.ingest("vessel.target", point(10, 5));
    s.beginFrame();

    const frame = s.currentFrame();
    expect(s.sampleReading("vessel.target", frame)).toEqual({
      state: "observed",
      value: s.sample<number>("vessel.target", frame)?.payload,
      atUt: 10,
    });
    expect(s.sampleStatus("vessel.target", frame)).toBe("live");
  });

  it("is pending for a topic that has never produced a point", () => {
    const s = store();
    s.beginFrame();
    expect(s.sampleReading("vessel.target")).toEqual({ state: "pending" });
  });

  it("reports the link going down as stale, keeping the last value", () => {
    const s = store();
    s.ingest("vessel.target", point(10, 5));
    s.beginFrame();
    expect(s.sampleReading("vessel.target")).toEqual({
      state: "observed",
      value: 5,
      atUt: 10,
    });

    s.setTransportConnected(false);
    s.beginFrame();
    expect(s.sampleReading("vessel.target")).toEqual({
      state: "stale",
      grade: "disconnected",
      value: 5,
      asOfUt: 10,
    });
  });

  it("reports a tombstone as a confirmed absence, with its own age", () => {
    const s = store();
    s.ingest("vessel.target", point(10, null));
    s.beginFrame();
    expect(s.sampleReading("vessel.target")).toEqual({
      state: "absent",
      atUt: 10,
    });
  });
});
