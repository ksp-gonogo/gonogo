import { describe, expect, it } from "vitest";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * A reading's identity must track its DATA, not the frame it was read in.
 *
 * `useReading` hands the reading straight to `useSyncExternalStore`, which
 * compares snapshots with `Object.is`. A store that rebuilt the union on every
 * frame would therefore re-render every widget reading telemetry at frame
 * cadence forever, whether or not anything arrived, and put a fresh `reckon`
 * thunk identity into every consumer's dependency arrays while it was at it.
 *
 * The per-frame memo alone does NOT give this: `beginFrame()` mints a new
 * `FrameToken` on every ingest tick, so a token-keyed cache is a fresh object
 * per frame by construction. The identity has to be keyed on the inputs.
 *
 * `useStream` never had to solve this because it returns `point.payload`, whose
 * identity is the payload's own. A union is a wrapper, so it needs the check
 * written down.
 */

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

describe("reading identity is keyed on the data, not the frame", () => {
  it("survives frames in which nothing arrived", () => {
    const s = store();
    s.ingest("vessel.target", point(10, 5));
    s.beginFrame();
    const first = s.sampleReading("vessel.target");

    // Ten frames, no ingest. A widget must not re-render ten times for this.
    for (let i = 0; i < 10; i++) s.beginFrame();

    expect(s.sampleReading("vessel.target")).toBe(first);
  });

  it("survives frames in which a DIFFERENT topic changed", () => {
    const s = store();
    s.ingest("vessel.target", point(10, 5));
    s.beginFrame();
    const first = s.sampleReading("vessel.target");

    s.ingest("vessel.orbit", point(11, 99));
    s.beginFrame();

    expect(s.sampleReading("vessel.target")).toBe(first);
  });

  it("still yields a new identity when the value changes", () => {
    const s = store();
    s.ingest("vessel.target", point(10, 5));
    s.beginFrame();
    const first = s.sampleReading("vessel.target");

    s.ingest("vessel.target", point(11, 6));
    s.beginFrame();

    expect(s.sampleReading("vessel.target")).not.toBe(first);
  });

  it("still yields a new identity when only the STATUS changes", () => {
    // The value is untouched here; the link went down. A consumer that kept the
    // old identity would go on rendering the number as current.
    const s = store();
    s.ingest("vessel.target", point(10, 5));
    s.beginFrame();
    const first = s.sampleReading("vessel.target");

    s.setTransportConnected(false);
    s.beginFrame();

    const second = s.sampleReading("vessel.target");
    expect(second).not.toBe(first);
    expect(second.state).toBe("stale");
  });

  it("is pending with one identity for a topic that never reports", () => {
    const s = store();
    s.beginFrame();
    const first = s.sampleReading("vessel.target");
    for (let i = 0; i < 5; i++) s.beginFrame();
    expect(s.sampleReading("vessel.target")).toBe(first);
  });
});
