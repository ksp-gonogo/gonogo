import { describe, expect, it } from "vitest";
import { registerCoreReckoners } from "./reckoners";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * A reading's identity must track its DATA, not the frame it was read in.
 *
 * `useTelemetry` hands the reading straight to `useSyncExternalStore`, which
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

  it("survives frames for a FIELD of a record that did not change", () => {
    const s = store();
    s.ingest("test.record", {
      validAt: 10,
      payload: { a: 1, b: { c: 2 } },
      meta: makeMeta({ validAt: 10, deliveredAt: 10 }),
      epoch: 0,
    });
    s.beginFrame();
    const first = s.sampleReading("test.record.b.c");
    expect(first.state).toBe("observed");

    for (let i = 0; i < 5; i++) s.beginFrame();

    expect(s.sampleReading("test.record.b.c")).toBe(first);
  });

  /*
   * A field of a modelled record, read while view time moves every frame as
   * it does on a live screen. The model is on offer for the parent, but where
   * it has nothing to answer (no point yet, or a current observation it
   * declines to carry), a frame that only moved view time changed nothing a
   * widget could draw.
   */
  describe("a field whose record has a model, while view time moves", () => {
    const TARGET = {
      name: "Rendezvous Target",
      relativePosition: { x: 1, y: 0, z: 0 },
      relativeVelocity: { x: 1, y: 0, z: 0 },
    };

    function movingStore() {
      registerCoreReckoners();
      const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
      const s = new TimelineStore(clock);
      let viewUt = 1_000;
      clock.scrubTo(viewUt);
      const nextFrame = () => {
        viewUt += 1;
        clock.scrubTo(viewUt);
        s.beginFrame();
      };
      const ingestTarget = () =>
        s.ingest("vessel.target", {
          validAt: 1_000,
          payload: TARGET,
          meta: makeMeta({ validAt: 1_000, deliveredAt: 1_000 }),
          epoch: 0,
        });
      s.beginFrame();
      return { s, nextFrame, ingestTarget };
    }

    it("stays pending with one identity before the record reports", () => {
      const { s, nextFrame } = movingStore();
      const first = s.sampleReading("vessel.target.relativePosition");
      expect(first.state).toBe("pending");

      for (let i = 0; i < 5; i++) nextFrame();

      expect(s.sampleReading("vessel.target.relativePosition")).toBe(first);
    });

    it("keeps one identity while the model declines a live field", () => {
      const { s, nextFrame, ingestTarget } = movingStore();
      ingestTarget();
      s.beginFrame();
      const first = s.sampleReading("vessel.target.relativePosition");
      expect(first.state).toBe("observed");
      expect(first.reckoning.status).not.toBe("available");

      for (let i = 0; i < 5; i++) nextFrame();

      expect(s.sampleReading("vessel.target.relativePosition")).toBe(first);
    });

    it("still moves with view time for a field the model does move", () => {
      const { s, nextFrame, ingestTarget } = movingStore();
      ingestTarget();
      s.setTransportConnected(false);
      s.beginFrame();
      const first = s.sampleReading("vessel.target.relativePosition");
      expect(first.reckoning.status).toBe("available");

      nextFrame();

      expect(s.sampleReading("vessel.target.relativePosition")).not.toBe(first);
    });
  });
});
