import { Quality, Staleness } from "@gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import type { VesselOrbitPayload } from "./vessel-state";
import { vesselStateChannel } from "./vessel-state";
import { ViewClock } from "./view-clock";

/** A wall clock a test can advance explicitly, instead of racing real time. */
function fakeWall(start = 0) {
  let now = start;
  return {
    now: () => now,
    advanceBy: (seconds: number) => {
      now += seconds;
    },
  };
}

function point(
  validAt: number,
  payload: number | null,
  overrides: {
    epoch?: number;
    deliveredAt?: number;
    staleness?: Staleness;
  } = {},
): TimelinePoint<number | null> {
  return {
    validAt,
    payload,
    meta: makeMeta({
      validAt,
      deliveredAt: overrides.deliveredAt ?? validAt,
      staleness: overrides.staleness ?? Staleness.Fresh,
    }),
    epoch: overrides.epoch ?? 0,
  };
}

describe("TimelineStore.sampleStatus (M2 T4 — staleness/absence surface)", () => {
  it("a fresh point is 'live'", () => {
    const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
    const store = new TimelineStore(clock);

    store.ingest("vessel.target", point(10, 1));
    store.beginFrame();

    expect(store.sampleStatus("vessel.target")).toBe("live");
  });

  it("no point ever ingested for a topic -> 'resyncing'", () => {
    const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
    const store = new TimelineStore(clock);

    store.ingest("other.topic", point(10, 1));
    store.beginFrame();

    expect(store.sampleStatus("vessel.target")).toBe("resyncing");
  });

  it("a tombstone (payload: null) -> 'absent', confidently, not 'held-stale'", () => {
    const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
    const store = new TimelineStore(clock);

    store.ingest("vessel.target", point(10, null));
    store.beginFrame();

    expect(store.sampleStatus("vessel.target")).toBe("absent");
  });

  describe("server-stamped meta.staleness wins outright", () => {
    it("Staleness.HeldStale on the latest point -> 'held-stale' even with on-time heartbeats", () => {
      const clock = new ViewClock({
        delaySeconds: () => 0,
        warpRate: () => 1,
      });
      const store = new TimelineStore(clock);

      store.ingest(
        "vessel.target",
        point(10, 1, { staleness: Staleness.HeldStale }),
      );
      store.beginFrame();

      expect(store.sampleStatus("vessel.target")).toBe("held-stale");
    });

    it("Staleness.LastBeforeBlackout on the latest point -> 'last-before-blackout'", () => {
      const clock = new ViewClock({
        delaySeconds: () => 0,
        warpRate: () => 1,
      });
      const store = new TimelineStore(clock);

      store.ingest(
        "vessel.target",
        point(10, 1, { staleness: Staleness.LastBeforeBlackout }),
      );
      store.beginFrame();

      expect(store.sampleStatus("vessel.target")).toBe("last-before-blackout");
    });
  });

  describe("cold-start / post-reset resynchronizing", () => {
    it("a topic that hasn't re-sampled since a rewind reads 'resyncing', not a carried-over 'held-stale'", () => {
      const clock = new ViewClock({
        delaySeconds: () => 0,
        warpRate: () => 1,
      });
      const store = new TimelineStore(clock);

      store.ingest("fast.a", point(100, 1, { epoch: 0 }));
      store.ingest("slow.b", point(100, 2, { epoch: 0 }));
      store.beginFrame();
      expect(store.sampleStatus("slow.b")).toBe("live");

      // Quickload rewind confirmed on fast.a only — slow.b never re-samples.
      store.ingest("fast.a", point(50, 999, { epoch: 1 }));
      store.beginFrame();

      expect(store.sampleStatus("slow.b")).toBe("resyncing");
    });
  });

  describe("the trap — heartbeat-inferred HeldStale, never validAt age", () => {
    it("a change-gated topic whose value never changes (frozen validAt) stays 'live' as long as keyframe heartbeats (deliveredAt) keep arriving on cadence", () => {
      const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
      const store = new TimelineStore(clock, {
        heartbeatOptions: {
          defaultKeyframeIntervalUt: 30,
          marginMultiplier: 1,
          jitterAllowanceUt: 0,
        },
      });

      const FROZEN_VALID_AT = 0; // the "true" causal time of the unchanged value
      const UNCHANGED_VALUE = 42;

      for (const deliveredAt of [0, 30, 60, 90, 120]) {
        // A companion topic whose OWN validAt keeps advancing — feeds the
        // shared ViewClock's sample clamp so the view UT genuinely advances
        // (a realistic stand-in for the many other channels reporting on a
        // real client), independent of vessel.target's frozen validAt.
        store.ingest("pacer.tick", point(deliveredAt, 1, { deliveredAt }));

        // vessel.target: the payload and validAt NEVER change (change-gated,
        // no state transition) — only meta.deliveredAt advances, one
        // keyframe re-announcement per cadence tick.
        store.ingest(
          "vessel.target",
          point(FROZEN_VALID_AT, UNCHANGED_VALUE, { deliveredAt }),
        );

        const token = store.beginFrame();

        // The naive, WRONG check this design forbids: age = viewUt - validAt.
        // By the last iteration this is 120 — far past one keyframe interval
        // + margin (60) — a naive age-based implementation WOULD flag this
        // stale. Ours must not.
        const naiveAge = token.viewUt - FROZEN_VALID_AT;
        if (deliveredAt >= 90) {
          expect(naiveAge).toBeGreaterThan(60); // the trap really is live here
        }

        expect(store.sampleStatus("vessel.target")).toBe("live");
      }
    });
  });

  describe("heartbeat miss -> held-stale", () => {
    it("stops confirming after its last heartbeat and flips to 'held-stale' once the view UT passes the expected next heartbeat + margin", () => {
      const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
      const store = new TimelineStore(clock, {
        heartbeatOptions: {
          defaultKeyframeIntervalUt: 30,
          marginMultiplier: 1,
          jitterAllowanceUt: 0,
        },
      });

      // Both topics heartbeat together through UT 90.
      for (const t of [0, 30, 60, 90]) {
        store.ingest("pacer.tick", point(t, 1, { deliveredAt: t }));
        store.ingest("vessel.target", point(t, 1, { deliveredAt: t }));
      }
      store.beginFrame();
      expect(store.sampleStatus("vessel.target")).toBe("live");

      // vessel.target goes silent (comms blackout); pacer.tick alone keeps
      // advancing the shared view clock.
      store.ingest("pacer.tick", point(140, 1, { deliveredAt: 140 }));
      const token = store.beginFrame();

      // threshold = last heartbeat (90) + interval (30) + margin (30) = 150.
      expect(token.viewUt).toBe(140);
      expect(store.sampleStatus("vessel.target")).toBe("live"); // not overdue yet

      store.ingest("pacer.tick", point(160, 1, { deliveredAt: 160 }));
      store.beginFrame();

      expect(store.sampleStatus("vessel.target")).toBe("held-stale"); // 160 > 150
    });
  });

  describe("confidence-scaled margin, driven by a real (injected) clock", () => {
    it("a 'coasting' estimate (silence past coastingAfterSeconds) keeps a topic 'live' at a view UT that WOULD already be held-stale under 'locked' confidence", () => {
      const wall = fakeWall();
      const clock = new ViewClock({
        nowWall: wall.now,
        delaySeconds: () => 0,
        warpRate: () => 10, // 10 UT per wall-second
        coastingAfterSeconds: 8,
        slackSeconds: 1000, // sample clamp stays generous; the estimate is the binding constraint
      });
      const store = new TimelineStore(clock, {
        heartbeatOptions: {
          defaultKeyframeIntervalUt: 30,
          marginMultiplier: 1,
          jitterAllowanceUt: 0,
          degradedMarginMultiplier: 3,
        },
      });

      store.ingest("vessel.target", point(100, 1, { deliveredAt: 100 }));
      store.beginFrame();
      expect(store.sampleStatus("vessel.target")).toBe("live");

      // locked threshold: 100 + 30 + 30  = 160
      // coasting threshold: 100 + 30 + 90 = 220
      // Advance wall by 10s (past coastingAfterSeconds=8) -> UT = 100+100=200,
      // squarely between the two thresholds.
      wall.advanceBy(10);
      const token = store.beginFrame();

      expect(token.viewUt).toBe(200);
      expect(clock.confidence()).toBe("coasting");
      // Prove the counterfactual explicitly: under "locked" this UT WOULD be
      // overdue.
      expect(store.heartbeats.isOverdue("vessel.target", 200, "locked")).toBe(
        true,
      );
      // But the real, confidence-scaled status stays live.
      expect(store.sampleStatus("vessel.target")).toBe("live");

      // Push further out, past even the widened coasting threshold.
      wall.advanceBy(3); // UT = 100 + 130 = 230
      store.beginFrame();
      expect(store.sampleStatus("vessel.target")).toBe("held-stale");
    });
  });

  describe("vessel.state — worst-of-inputs wired end to end through a real store", () => {
    const CIRCULAR_ORBIT: VesselOrbitPayload = {
      referenceBodyIndex: 1,
      sma: 700_000,
      ecc: 0,
      inc: 0,
      lan: null,
      argPe: null,
      meanAnomalyAtEpoch: 0,
      epoch: 0,
      mu: 3.5316e12,
    };

    function orbitPoint(
      validAt: number,
      overrides: { deliveredAt?: number; staleness?: Staleness } = {},
    ): TimelinePoint<VesselOrbitPayload> {
      return {
        validAt,
        payload: CIRCULAR_ORBIT,
        meta: makeMeta({
          validAt,
          deliveredAt: overrides.deliveredAt ?? validAt,
          quality: Quality.OnRails,
          staleness: overrides.staleness ?? Staleness.Fresh,
          source: "vessel:abc-123",
        }),
        epoch: 0,
      };
    }

    it("propagates vessel.orbit's held-stale status onto vessel.state (OnRails basis never touches vessel.flight)", () => {
      const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
      const store = new TimelineStore(clock);
      store.registerDerivedChannel(vesselStateChannel);

      store.ingest(
        "vessel.orbit",
        orbitPoint(10, { staleness: Staleness.HeldStale }),
      );
      store.beginFrame();

      expect(store.sampleStatus("vessel.state")).toBe("held-stale");
      // The field subtopic shares the parent's status too.
      expect(store.sampleStatus("vessel.state.altitudeAsl")).toBe("held-stale");
    });

    it("a tombstoned vessel.orbit makes vessel.state 'absent'", () => {
      const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
      const store = new TimelineStore(clock);
      store.registerDerivedChannel(vesselStateChannel);

      store.ingest("vessel.orbit", {
        validAt: 10,
        payload: null,
        meta: makeMeta({ validAt: 10, deliveredAt: 10 }),
        epoch: 0,
      });
      store.beginFrame();

      expect(store.sampleStatus("vessel.state")).toBe("absent");
    });

    it("vessel.orbit not yet ingested -> vessel.state is 'resyncing'", () => {
      const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
      const store = new TimelineStore(clock);
      store.registerDerivedChannel(vesselStateChannel);

      store.beginFrame();

      expect(store.sampleStatus("vessel.state")).toBe("resyncing");
    });

    it("a fresh, on-time vessel.orbit yields a 'live' vessel.state", () => {
      const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
      const store = new TimelineStore(clock);
      store.registerDerivedChannel(vesselStateChannel);

      store.ingest("vessel.orbit", orbitPoint(10));
      store.beginFrame();

      expect(store.sampleStatus("vessel.state")).toBe("live");
    });
  });
});
