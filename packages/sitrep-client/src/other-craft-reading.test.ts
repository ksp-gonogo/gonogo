import { describe, expect, it } from "vitest";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

function point<T>(validAt: number, payload: T): TimelinePoint<T> {
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

const delayFor = (craft: string) => ({
  oneWaySeconds: 0,
  meta: { source: `vessel:${craft}` },
});

describe("a reading about another craft", () => {
  it("reads as pending once comms.delay names a different active craft", () => {
    const s = store();
    s.ingest("comms.delay", point(10, delayFor("old")));
    s.ingest(
      "vessel.control",
      point(10, { sas: true, meta: { source: "vessel:old" } }),
    );
    s.beginFrame();
    expect(s.sampleReading("vessel.control").state).toBe("observed");

    s.ingest("comms.delay", point(11, delayFor("new")));
    s.beginFrame();
    expect(s.sampleReading("vessel.control").state).toBe("pending");
  });

  it("reads as observed again when the active craft's own reading lands", () => {
    const s = store();
    s.ingest("comms.delay", point(10, delayFor("old")));
    s.ingest(
      "vessel.control",
      point(10, { sas: true, meta: { source: "vessel:old" } }),
    );
    s.ingest("comms.delay", point(11, delayFor("new")));
    s.ingest(
      "vessel.control",
      point(12, { sas: false, meta: { source: "vessel:new" } }),
    );
    s.beginFrame();
    expect(s.sampleReading("vessel.control").state).toBe("observed");
  });

  it("leaves a reading that names no craft alone", () => {
    const s = store();
    s.ingest("comms.delay", point(10, delayFor("new")));
    s.ingest(
      "career.status",
      point(10, { funds: 1, meta: { source: "game" } }),
    );
    s.ingest("vessel.target", point(10, { name: "x" }));
    s.beginFrame();
    expect(s.sampleReading("career.status").state).toBe("observed");
    expect(s.sampleReading("vessel.target").state).toBe("observed");
  });

  it("judges nothing before the active craft is known", () => {
    const s = store();
    s.ingest(
      "vessel.control",
      point(10, { sas: true, meta: { source: "vessel:old" } }),
    );
    s.beginFrame();
    expect(s.sampleReading("vessel.control").state).toBe("observed");
  });
});
