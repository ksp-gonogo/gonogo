import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import type { OrbitElements } from "./kepler";
import { solve } from "./kepler";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import type { VesselFlightPayload, VesselOrbitPayload } from "./vessel-state";
import { vesselStateChannel } from "./vessel-state";
import { ViewClock } from "./view-clock";

/**
 * Confirmed-vs-predicted views + the certainty horizon (M2 design §3.3,
 * m2-sdk-delay-design.md). Complements `view-clock.test.ts` (the clock's own
 * mode/scrub/horizon mechanics) with `TimelineStore`-level integration:
 * real interpolation filling the `ClientTimeline.straddle` seam, real
 * propagation past the horizon for `vessel.state`, and the composition of
 * `certainty` alongside T4's `StreamStatusValue` and T3's undefined/null.
 */

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

function numberPoint(
  validAt: number,
  payload: number | null,
  overrides: { epoch?: number; deliveredAt?: number } = {},
): TimelinePoint<number | null> {
  return {
    validAt,
    payload,
    meta: makeMeta({ validAt, deliveredAt: overrides.deliveredAt ?? validAt }),
    epoch: overrides.epoch ?? 0,
  };
}

const CIRCULAR_ORBIT: VesselOrbitPayload = {
  referenceBodyIndex: 1,
  sma: 700_000,
  ecc: 0,
  inc: 0,
  lan: null,
  argPe: null,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  mu: 3.5316e12, // Kerbin's GM
};

function orbitPoint(
  payload: VesselOrbitPayload | null,
  overrides: {
    validAt?: number;
    quality?: Quality;
    epoch?: number;
    deliveredAt?: number;
  } = {},
): TimelinePoint<VesselOrbitPayload> {
  const validAt = overrides.validAt ?? 0;
  return {
    validAt,
    payload,
    meta: makeMeta({
      validAt,
      deliveredAt: overrides.deliveredAt ?? validAt,
      quality: overrides.quality ?? Quality.OnRails,
      source: "vessel:abc-123",
    }),
    epoch: overrides.epoch ?? 0,
  };
}

function flightPoint(
  payload: VesselFlightPayload | null,
  overrides: { validAt?: number; deliveredAt?: number } = {},
): TimelinePoint<VesselFlightPayload> {
  const validAt = overrides.validAt ?? 0;
  return {
    validAt,
    payload,
    meta: makeMeta({
      validAt,
      deliveredAt: overrides.deliveredAt ?? validAt,
      quality: Quality.Loaded,
      source: "vessel:abc-123",
    }),
    epoch: 0,
  };
}

describe("confirmed-range interpolation (M2 design §3.3)", () => {
  it("reads at a viewUt strictly between two buffered samples get an INTERPOLATED value, not hold-last", () => {
    const wall = fakeWall();
    // delaySeconds pins the confirmed edge behind the latest sample, so
    // viewUt lands strictly inside the [100, 200] bracket instead of
    // sample-clamping right onto it.
    const clock = new ViewClock({
      nowWall: wall.now,
      warpRate: () => 1,
      delaySeconds: () => 25,
    });
    const store = new TimelineStore(clock);

    store.ingest("temperature", numberPoint(100, 10, { deliveredAt: 100 }));
    store.ingest("temperature", numberPoint(200, 20, { deliveredAt: 200 }));
    store.beginFrame();

    const token = store.currentFrame();
    expect(token.viewUt).toBe(175); // 200 (last deliveredAt) - 25 delay
    expect(token.certainty).toBe("confirmed");

    // Contrast: sample()/get stays hold-last (the "cause" semantics, used
    // by e.g. orbit elements) — it must NOT have started interpolating.
    expect(store.sample<number>("temperature")?.payload).toBe(10);

    const interpolated = store.sampleInterpolated<number>("temperature");
    expect(interpolated?.payload).toBeCloseTo(17.5);
    expect(interpolated?.payload).toBeGreaterThan(10);
    expect(interpolated?.payload).toBeLessThan(20);
    expect(interpolated?.validAt).toBe(175);
  });

  it("vessel.state's Loaded/measured basis interpolates vessel.flight via getInterpolated", () => {
    const wall = fakeWall();
    const clock = new ViewClock({
      nowWall: wall.now,
      warpRate: () => 1,
      delaySeconds: () => 25,
    });
    const store = new TimelineStore(clock);
    store.registerDerivedChannel(vesselStateChannel);

    store.ingest(
      "vessel.orbit",
      orbitPoint(CIRCULAR_ORBIT, { validAt: 0, quality: Quality.Loaded }),
    );
    store.ingest(
      "vessel.flight",
      flightPoint(
        {
          latitude: 0,
          longitude: 0,
          altitudeAsl: 1000,
          altitudeTerrain: 1000,
          verticalSpeed: 5,
          surfaceSpeed: 100,
          orbitalSpeed: 100,
          gForce: 1,
          dynamicPressureKPa: 1,
          mach: 0.3,
          atmDensity: 1,
        },
        { validAt: 100, deliveredAt: 100 },
      ),
    );
    store.ingest(
      "vessel.flight",
      flightPoint(
        {
          latitude: 0,
          longitude: 0,
          altitudeAsl: 2000,
          altitudeTerrain: 2000,
          verticalSpeed: 5,
          surfaceSpeed: 100,
          orbitalSpeed: 100,
          gForce: 1,
          dynamicPressureKPa: 1,
          mach: 0.3,
          atmDensity: 1,
        },
        { validAt: 200, deliveredAt: 200 },
      ),
    );
    store.beginFrame();
    expect(store.currentFrame().viewUt).toBe(175);
    expect(store.currentFrame().certainty).toBe("confirmed");

    const state = store.sample<{
      altitudeAsl: number | null;
      basis: string;
    }>("vessel.state");
    expect(state?.payload?.basis).toBe("measured");
    expect(state?.payload?.altitudeAsl).toBeCloseTo(1750); // interpolated, not hold-last (1000)
  });
});

describe("predicted-range reads (M2 design §3.3)", () => {
  it("vessel.state (orbital) past the horizon equals kepler.solve(elements, viewUt) — propagated, marked predicted", () => {
    const wall = fakeWall();
    const clock = new ViewClock({
      nowWall: wall.now,
      warpRate: () => 1,
      delaySeconds: () => 0,
    });
    const store = new TimelineStore(clock);
    store.registerDerivedChannel(vesselStateChannel);

    store.ingest(
      "vessel.orbit",
      orbitPoint(CIRCULAR_ORBIT, { validAt: 100, deliveredAt: 100 }),
    );

    clock.setMode("predicted");
    wall.advanceBy(50); // utNowEstimate = 100 + 50 = 150, well past the horizon (sample-clamped to 100)

    store.beginFrame();
    const token = store.currentFrame();
    expect(token.viewUt).toBe(150);
    expect(token.certainty).toBe("predicted");
    expect(store.sampleCertainty()).toBe("predicted");
    // The horizon itself did not move — only the estimate ran ahead of it.
    expect(store.certaintyHorizonUt()).toBe(100);

    const state = store.sample<{
      position: readonly [number, number, number] | null;
      velocity: readonly [number, number, number] | null;
      basis: string;
    }>("vessel.state");

    const elements: OrbitElements = {
      sma: CIRCULAR_ORBIT.sma,
      ecc: CIRCULAR_ORBIT.ecc,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: CIRCULAR_ORBIT.meanAnomalyAtEpoch,
      epoch: CIRCULAR_ORBIT.epoch,
      mu: CIRCULAR_ORBIT.mu,
    };
    const expected = solve(elements, 150);

    expect(state?.payload?.basis).toBe("propagated");
    expect(state?.payload?.position).toEqual(expected.position);
    expect(state?.payload?.velocity).toEqual(expected.velocity);
  });

  it("certainty flips exactly at the horizon for a real TimelineStore frame", () => {
    const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
    const store = new TimelineStore(clock);

    store.ingest("a", numberPoint(100, 1, { deliveredAt: 100 }));

    clock.scrubTo(100); // exactly at the horizon
    store.beginFrame();
    expect(store.currentFrame().certainty).toBe("confirmed");

    clock.scrubTo(100.001); // strictly past it
    store.beginFrame();
    expect(store.currentFrame().certainty).toBe("predicted");
  });
});

describe("scrubTo (M2 design §3.2)", () => {
  it("scrubTo(pastUt) inside the retained window reads confirmed; scrubbing before it resyncs", () => {
    const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
    const store = new TimelineStore(clock, {
      timelineOptions: { retentionSeconds: 50 },
    });

    store.ingest("b", numberPoint(100, 1, { deliveredAt: 100 }));
    store.ingest("b", numberPoint(150, 2, { deliveredAt: 150 }));
    store.ingest("b", numberPoint(200, 3, { deliveredAt: 200 })); // evicts validAt < 150

    clock.scrubTo(150);
    store.beginFrame();
    expect(store.currentFrame().viewUt).toBe(150);
    expect(store.currentFrame().certainty).toBe("confirmed");
    expect(store.sample<number>("b")?.payload).toBe(2);
    expect(store.sampleStatus("b")).toBe("live");

    clock.scrubTo(80); // below the retention floor — evicted
    store.beginFrame();
    expect(store.sample<number>("b")).toBeUndefined();
    expect(store.sampleStatus("b")).toBe("resyncing");
  });
});

describe("quickload epoch bump (M2 design §7.6)", () => {
  it("resets the horizon and refuses to predict off pre-reset elements", () => {
    const wall = fakeWall();
    const clock = new ViewClock({
      nowWall: wall.now,
      warpRate: () => 1,
      delaySeconds: () => 0,
    });
    const store = new TimelineStore(clock);
    store.registerDerivedChannel(vesselStateChannel);

    store.ingest(
      "vessel.orbit",
      orbitPoint(CIRCULAR_ORBIT, { validAt: 100, deliveredAt: 100, epoch: 0 }),
    );
    clock.setMode("predicted");
    wall.advanceBy(20);
    store.beginFrame();

    // Sanity: predicted mode is genuinely propagating before the rewind.
    expect(store.sample("vessel.state")).toBeDefined();
    expect(store.currentFrame().certainty).toBe("predicted");

    // Quickload rewind: some topic delivers a higher-epoch point (the
    // engine's reset broadcast, mirrored here as any epoch-bumping ingest).
    store.ingest(
      "system.clock",
      numberPoint(4500, 4500, { deliveredAt: 4500, epoch: 1 }),
    );
    store.beginFrame();

    // vessel.orbit's pre-reset point was swept away by the epoch bump
    // (TimelineStore's cross-topic sweep) — no post-reset keyframe has
    // landed for it yet, so vessel.state must be undefined ("resyncing"),
    // never a propagation off the dead pre-reset elements.
    expect(store.sample("vessel.state")).toBeUndefined();
    expect(store.sampleStatus("vessel.state")).toBe("resyncing");
  });
});

describe("raw frame-cache defeats the epoch guard — the LENS-4 ghost (M2 T5 close-review Fix 1)", () => {
  it("sample() must not replay a cached pre-bump point after a mid-token epoch bump (same FrameToken, no beginFrame())", () => {
    const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
    const store = new TimelineStore(clock);

    store.ingest(
      "vessel.orbit",
      orbitPoint(CIRCULAR_ORBIT, { validAt: 100, deliveredAt: 100, epoch: 0 }),
    );
    store.beginFrame();
    const token = store.currentFrame();

    const first = store.sample<VesselOrbitPayload>("vessel.orbit", token);
    expect(first?.payload?.sma).toBe(CIRCULAR_ORBIT.sma);

    // Mid-token quickload: an UNRELATED topic's ingest bumps the shared
    // epoch. vessel.orbit itself hasn't re-sampled, so its ClientTimeline is
    // swept to the new epoch (no points) by the store's cross-topic sweep —
    // exactly like the existing "cross-topic epoch ghost" coverage, except
    // this read happens WITHIN the same token/read-cycle instead of across a
    // beginFrame() boundary.
    store.ingest(
      "system.clock",
      numberPoint(4500, 4500, { deliveredAt: 4500, epoch: 1 }),
    );

    // SAME token, no beginFrame() — a caller's rAF loop reading twice within
    // one read cycle.
    const second = store.sample<VesselOrbitPayload>("vessel.orbit", token);
    expect(second).toBeUndefined(); // must NOT be the dead epoch-0 point
  });

  it("sampleInterpolated() must not replay a cached pre-bump point after a mid-token epoch bump", () => {
    const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
    const store = new TimelineStore(clock);

    store.ingest("temperature", numberPoint(100, 10, { deliveredAt: 100 }));
    store.ingest("temperature", numberPoint(200, 20, { deliveredAt: 200 }));
    store.beginFrame();
    const token = store.currentFrame();

    const first = store.sampleInterpolated<number>("temperature", token);
    expect(first).toBeDefined();

    store.ingest(
      "system.clock",
      numberPoint(4500, 4500, { deliveredAt: 4500, epoch: 1 }),
    );

    const second = store.sampleInterpolated<number>("temperature", token);
    expect(second).toBeUndefined(); // must NOT be the dead epoch-0 point
  });

  it("vessel.state read via get() must not propagate the pre-bump orbit as a ghost after a mid-token epoch bump", () => {
    const wall = fakeWall();
    const clock = new ViewClock({
      nowWall: wall.now,
      warpRate: () => 1,
      delaySeconds: () => 0,
    });
    const store = new TimelineStore(clock);
    store.registerDerivedChannel(vesselStateChannel);

    store.ingest(
      "vessel.orbit",
      orbitPoint(CIRCULAR_ORBIT, { validAt: 100, deliveredAt: 100, epoch: 0 }),
    );
    clock.setMode("predicted");
    wall.advanceBy(20);
    store.beginFrame();
    const token = store.currentFrame();

    const first = store.sample<{
      position: readonly [number, number, number] | null;
      basis: string;
    }>("vessel.state", token);
    // Sanity: genuinely propagating off the live orbit before the bump.
    expect(first?.payload?.basis).toBe("propagated");

    // Mid-token quickload rewind via an UNRELATED topic — vessel.orbit
    // hasn't re-sampled, so it's swept to the new epoch with no points.
    store.ingest(
      "system.clock",
      numberPoint(4500, 4500, { deliveredAt: 4500, epoch: 1 }),
    );

    // SAME token — no beginFrame(). vessel.state's OWN derived-memo key
    // already folds epoch, so it recomputes — but that recompute calls
    // get("vessel.orbit"), i.e. sample("vessel.orbit", token). If THAT raw
    // read still serves its pre-bump cache entry, the recompute propagates
    // off the dead epoch-0 orbit and stamps the result with the NEW epoch —
    // a ghost `vessel.state` masquerading as post-rewind truth.
    const second = store.sample<{
      position: readonly [number, number, number] | null;
      basis: string;
    }>("vessel.state", token);
    expect(second).toBeUndefined(); // must NOT be a ghost propagated off the dead orbit
  });

  // M2 finalization Fix 4 (owed): the sibling of the two `sample()`/
  // `sampleInterpolated()` LENS-4 cases above, for the STATUS surface. The
  // raw-status memo key folds epoch (`\0status\0${topic}\0epoch\0${epoch}`)
  // for exactly this reason — a status read taken before a mid-token epoch
  // bump must not survive it (and thereby disagree with the epoch-folded
  // value read for the same topic in the same frame). The value/derived-
  // status paths already had dedicated LENS-4 coverage; the raw-status path
  // did not.
  it("sampleStatus() (raw topic) must recompute to the new epoch after a mid-token epoch bump, not replay the stale pre-bump status", () => {
    const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
    const store = new TimelineStore(clock);

    // A live, fresh raw topic — reads "live" before the bump.
    store.ingest("temperature", numberPoint(100, 10, { deliveredAt: 100 }));
    store.beginFrame();
    const token = store.currentFrame();

    const first = store.sampleStatus("temperature", token);
    expect(first).toBe("live");

    // Mid-token quickload rewind via an UNRELATED topic — temperature hasn't
    // re-sampled, so the store's cross-topic sweep clears its timeline to the
    // new (empty) epoch. No point at all in the new epoch now.
    store.ingest(
      "system.clock",
      numberPoint(4500, 4500, { deliveredAt: 4500, epoch: 1 }),
    );

    // SAME token, no beginFrame() — a caller reading status twice within one
    // read cycle. Must recompute against the new epoch: temperature has no
    // post-reset point, so it's "resyncing" (cold in the new epoch), NOT the
    // cached pre-bump "live". Without the epoch fold in the raw-status memo
    // key, this would replay "live" — a ghost status for a dead timeline.
    const second = store.sampleStatus("temperature", token);
    expect(second).toBe("resyncing");
  });
});

describe("certainty composes with T4 status + T3 undefined/null", () => {
  it("a cold (never-ingested) topic: undefined value, resyncing status, and a defined (non-throwing) certainty", () => {
    const clock = new ViewClock();
    const store = new TimelineStore(clock);
    store.beginFrame();

    expect(store.sample("never-seen")).toBeUndefined();
    expect(store.sampleStatus("never-seen")).toBe("resyncing");
    expect(["confirmed", "predicted"]).toContain(store.sampleCertainty());
  });

  it("a tombstoned topic: null payload, absent status, certainty unaffected", () => {
    const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
    const store = new TimelineStore(clock);

    store.ingest("target", numberPoint(50, null, { deliveredAt: 50 }));
    store.beginFrame();

    expect(store.sample<number>("target")?.payload).toBeNull();
    expect(store.sampleStatus("target")).toBe("absent");
    expect(store.currentFrame().certainty).toBe("confirmed");
  });

  it("predicted mode CAN read held-stale (T4) alongside a genuine arrival gap — the two channels don't fight", () => {
    const wall = fakeWall();
    const clock = new ViewClock({
      nowWall: wall.now,
      warpRate: () => 1,
      delaySeconds: () => 0,
    });
    const store = new TimelineStore(clock);

    store.ingest("c", numberPoint(100, 1, { deliveredAt: 100 }));
    clock.setMode("predicted");
    wall.advanceBy(1000); // predicted cursor races far ahead...

    store.beginFrame();
    expect(store.currentFrame().certainty).toBe("predicted");
    // ...but the certainty HORIZON (confirmedEdgeUt) is still sample-clamped
    // near 100 — nothing has confirmed 1000s of real elapsed UT, only the
    // wall clock ran. isOverdue must not fire off the predicted cursor
    // racing ahead on its own.
    expect(store.sampleStatus("c")).toBe("live");

    // A genuine arrival gap: other traffic advances the confirmed horizon
    // (real confirmed UT elapses) while "c" itself stays silent.
    store.ingest("other", numberPoint(500, 1, { deliveredAt: 500 }));
    store.beginFrame();
    expect(store.sampleStatus("c")).toBe("held-stale");
    // The stale value is still served (hold-last past the horizon), just
    // labeled by both independent channels.
    expect(store.sample<number>("c")?.payload).toBe(1);
  });

  it("a healthy predicted-mode topic (single fresh arrival, no further traffic) reads live regardless of delay — isOverdue must key off confirmedHorizonUt(), not the far-future predicted viewUt (M2 T5 close-review Fix 2)", () => {
    for (const delay of [0, 300]) {
      const wall = fakeWall();
      const clock = new ViewClock({
        nowWall: wall.now,
        warpRate: () => 1,
        delaySeconds: () => delay,
      });
      const store = new TimelineStore(clock);

      store.ingest("c", numberPoint(100, 1, { deliveredAt: 100 }));
      clock.setMode("predicted");
      wall.advanceBy(1000); // predicted cursor races far ahead of the horizon

      store.beginFrame();
      expect(store.currentFrame().certainty).toBe("predicted");
      // Nothing else has confirmed elapsed UT beyond this one sample — the
      // confirmed horizon stays sample-clamped, so there is no genuine
      // arrival gap for "c" to be overdue against.
      expect(store.sampleStatus("c")).toBe("live");
    }
  });
});
