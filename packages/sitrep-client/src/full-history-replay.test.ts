import type { ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { buildFullHistoryStore, InstantClock } from "./full-history-replay";
import type { ReplayFixture } from "./replay-transport";
import { makeMeta } from "./stub-transport";

/**
 * Regression coverage for the retention finding in
 * docs/superpowers/plans/2026-07-11-flightgraph-missionstore-port.md: every
 * production `TimelineStore` caps at `DEFAULT_RETENTION_SECONDS` (300s), so a
 * naive replay into one of those stores would silently drop the tail of any
 * flight longer than 5 minutes. `buildFullHistoryStore` must return every
 * ingested point regardless of span, and must do so synchronously, no fake
 * timers, no real timers, no `await`.
 */

function frame(
  topic: string,
  payload: unknown,
  deliveredAt: number,
  timelineEpoch = 0,
): string {
  const message: ServerMessage = {
    type: "stream-data",
    topic,
    payload,
    meta: makeMeta({ validAt: deliveredAt, deliveredAt, timelineEpoch }),
  };
  return JSON.stringify(message);
}

describe("buildFullHistoryStore", () => {
  it("returns every ingested point across a span far exceeding the 300s default retention window", () => {
    const fixture: ReplayFixture = {
      subscribedTopics: ["vessel.orbit", "vessel.flight"],
      frames: [
        frame("vessel.orbit", { sma: 680_000 }, 0),
        frame("vessel.orbit", { sma: 681_000 }, 200),
        frame("vessel.orbit", { sma: 682_000 }, 500), // > 300s past the first point
        frame("vessel.orbit", { sma: 683_000 }, 900), // > 300s past the previous point too
        frame("vessel.flight", { altitudeAsl: 100 }, 0),
        frame("vessel.flight", { altitudeAsl: 5000 }, 900),
      ],
    };

    const store = buildFullHistoryStore(fixture);

    const orbitPoints = store.sampleRange<{ sma: number }>(
      "vessel.orbit",
      0,
      900,
    );
    expect(orbitPoints?.map((p) => p.payload)).toEqual([
      { sma: value("m", 680_000) },
      { sma: value("m", 681_000) },
      { sma: value("m", 682_000) },
      { sma: value("m", 683_000) },
    ]);
    expect(orbitPoints?.map((p) => p.validAt)).toEqual([0, 200, 500, 900]);

    const flightPoints = store.sampleRange<{ altitudeAsl: number }>(
      "vessel.flight",
      0,
      900,
    );
    expect(flightPoints?.map((p) => p.payload)).toEqual([
      { altitudeAsl: value("m", 100) },
      { altitudeAsl: value("m", 5000) },
    ]);
  });

  it("registers the production derived channels, so a derived read resolves off the raw topics a recording carries", () => {
    // A recording carries raw wire topics only: nothing ever publishes a
    // `vessel.state` frame. Without the registration this store resolves the
    // topic through the raw-field-subtopic fallback, finds no record, and
    // answers `undefined`: identical to "the recording holds nothing for that
    // key", which is why the gap survived. `isDerivedTopic` is the distinction
    // the answer alone cannot carry.
    //
    // Written against `vessel.maneuver.legacy` until that channel was retired.
    // The mechanism under test is the registration, not the channel, so the
    // example moved to one that is still derived rather than the test being
    // dropped with the channel.
    const fixture: ReplayFixture = {
      subscribedTopics: ["vessel.orbit"],
      frames: [
        frame("vessel.orbit", { referenceBodyIndex: 1, patches: [] }, 0),
        frame("vessel.orbit", { referenceBodyIndex: 1, patches: [] }, 400),
      ],
    };

    const store = buildFullHistoryStore(fixture);

    expect(store.isDerivedTopic("vessel.state.orbitPatches")).toBe(true);
    const points = store.sampleDerivedRange<unknown[]>(
      "vessel.state.orbitPatches",
      0,
      400,
    );
    // Both instants resolve, not just a truthy answer at one of them: an
    // unregistered channel and a channel whose `derive()` produced nothing
    // usable both yield a plausible-looking empty answer.
    expect(points?.map((p) => p.validAt)).toEqual([0, 400]);
  });

  it("runs synchronously (no pending timers left behind)", () => {
    const fixture: ReplayFixture = {
      frames: [frame("vessel.orbit", { sma: 1 }, 0)],
    };

    // If buildFullHistoryStore relied on real timers, this would need fake
    // timers + vi.runAllTimers(); it deliberately doesn't.
    const store = buildFullHistoryStore(fixture);
    expect(store.sampleRange("vessel.orbit", 0, 10)).toEqual([
      expect.objectContaining({ payload: { sma: value("m", 1) } }),
    ]);
  });

  it("preserves fixture ordering even when frames arrive out of deliveredAt order in the array", () => {
    const fixture: ReplayFixture = {
      frames: [
        frame("vessel.orbit", { sma: 3 }, 500),
        frame("vessel.orbit", { sma: 1 }, 0),
        frame("vessel.orbit", { sma: 2 }, 200),
      ],
    };

    const store = buildFullHistoryStore(fixture);
    const points = store.sampleRange<{ sma: number }>("vessel.orbit", 0, 500);
    expect(points?.map((p) => p.payload)).toEqual([
      { sma: value("m", 1) },
      { sma: value("m", 2) },
      { sma: value("m", 3) },
    ]);
  });

  it("does not drop pre-revert points when a fixture spans an epoch bump (a recorded revert/quickload)", () => {
    // Regression coverage for the finding: StreamRecorder has zero epoch
    // awareness, so a recorded mission routinely carries pre-revert (epoch
    // 0) and post-revert (epoch 1) frames for the same topic. Replaying
    // that straight through the live-view epoch machinery used to wipe the
    // pre-revert points on the epoch bump (and drop a topic sampled ONLY
    // pre-revert entirely, since sampleRange gates any topic behind the
    // current epoch to `[]`). A full-history graph wants everything ever
    // recorded, not the live view's "hide pre-revert ghosts" behavior.
    const fixture: ReplayFixture = {
      subscribedTopics: ["vessel.orbit", "vessel.flight"],
      frames: [
        // vessel.orbit: sampled both pre- and post-revert.
        frame("vessel.orbit", { sma: 680_000 }, 0, 0),
        frame("vessel.orbit", { sma: 681_000 }, 100, 0),
        frame("vessel.orbit", { sma: 100_000 }, 200, 1), // post-revert, epoch bumps
        frame("vessel.orbit", { sma: 101_000 }, 300, 1),
        // vessel.flight: sampled ONLY pre-revert, never re-sampled after
        // the revert, so it's the one that vanishes entirely under the
        // live-view epoch gate.
        frame("vessel.flight", { altitudeAsl: 100 }, 0, 0),
        frame("vessel.flight", { altitudeAsl: 5000 }, 100, 0),
      ],
    };

    const store = buildFullHistoryStore(fixture);

    const orbitPoints = store.sampleRange<{ sma: number }>(
      "vessel.orbit",
      0,
      300,
    );
    expect(orbitPoints?.map((p) => p.payload)).toEqual([
      { sma: value("m", 680_000) },
      { sma: value("m", 681_000) },
      { sma: value("m", 100_000) },
      { sma: value("m", 101_000) },
    ]);

    const flightPoints = store.sampleRange<{ altitudeAsl: number }>(
      "vessel.flight",
      0,
      100,
    );
    expect(flightPoints?.map((p) => p.payload)).toEqual([
      { altitudeAsl: value("m", 100) },
      { altitudeAsl: value("m", 5000) },
    ]);
  });
});

describe("InstantClock", () => {
  it("defers scheduled callbacks until drain(), firing them in scheduling order", () => {
    const clock = new InstantClock();
    const calls: number[] = [];
    clock.schedule(0, () => calls.push(1));
    clock.schedule(0, () => calls.push(2));
    expect(calls).toEqual([]); // nothing fires until drain()

    clock.drain();
    expect(calls).toEqual([1, 2]);
  });

  it("honors cancellation of a callback scheduled before drain()", () => {
    const clock = new InstantClock();
    const calls: number[] = [];
    const cancel = clock.schedule(0, () => calls.push(1));
    clock.schedule(0, () => calls.push(2));
    cancel();

    clock.drain();
    expect(calls).toEqual([2]);
  });

  it("now() increases monotonically", () => {
    const clock = new InstantClock();
    const a = clock.now();
    const b = clock.now();
    expect(b).toBeGreaterThan(a);
  });
});
