import { DashboardItemContext } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { LandingStatusComponent } from "./index";

/**
 * LandingStatus genuinely running OFF THE STREAM (a real `TelemetryProvider`/
 * `TelemetryClient`/`TimelineStore` pipeline via `StubTransport`) — no legacy
 * `DataSource` is registered anywhere in this file, so a value only reaches the
 * widget if it actually streamed.
 *
 * The four ballistic `land.*` scalars (`timeToImpact`/`speedAtImpact`/
 * `bestSpeedAtImpact`/`suicideBurnCountdown`) are now client-derived
 * `vessel.state.landing*` fields (`vessel-state.ts` `deriveLanding`): a vacuum
 * ballistic solve off `vessel.flight` + `vessel.orbit.mu` + the `system.bodies`
 * radius + `vessel.propulsion`, MEASURED basis only. `noPrediction` (the gate
 * deciding whether the metric `Body` or the `EmptyState` renders) is driven by
 * `land.timeToImpact`, so with the descent streamed the full suicide-burn /
 * impact / descent readout appears — no legacy source needed.
 *
 * `carriedChannels` lists all EIGHT of `vessel.state`'s declared inputs — the
 * carried-channels gate is parent-channel-scoped, not per-field (see
 * `vessel-state.ts`'s `vesselStateChannel` doc comment). `vessel.orbit` is
 * emitted with `{ quality: Quality.Loaded }` so the derivation runs the
 * MEASURED branch (the landing scalars are null in the propagated basis).
 * Gravity uses a synthetic body (mu = 8e10, radius = 200_000 → g = 2 m/s² at
 * sea level) so the arithmetic is easy to reason about.
 */
afterEach(() => {
  cleanup();
});

describe("LandingStatus — derived landing scalars genuinely run off the stream", () => {
  it("shows the suicide-burn / impact readout from the derived vessel.state.landing* fields, not legacy", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [
        "vessel.orbit",
        "vessel.flight",
        "vessel.identity",
        "system.bodies",
        "vessel.control",
        "vessel.target",
        "vessel.comms",
        "vessel.propulsion",
      ],
      pinnedUt: 10,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "landing-stream" }}>
          <LandingStatusComponent id="landing-stream" w={8} h={10} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Nothing arrived yet — the empty state shows.
    expect(container.textContent).toContain("No landing in progress");

    // A real subscription must have happened for StubTransport (which is
    // subscription-gated) to deliver at all.
    expect(fixture.transport.isSubscribed("vessel.flight")).toBe(true);

    act(() => {
      // Loaded quality -> measured branch, where the landing scalars are live.
      fixture.emit(
        "vessel.orbit",
        {
          referenceBodyIndex: 3,
          sma: 250_000,
          ecc: 0,
          inc: 0,
          argPe: 0,
          mu: 8e10,
          meanAnomalyAtEpoch: 0,
          epoch: 10,
          // A short (60s) synthetic patch — see vessel-state.test.ts's
          // "landing predicted impact" describe block for why the period is
          // independent of sma/mu here (just an input to patchStateAt).
          // Starts at apoapsis (r=400_000, above the 200_000 body radius)
          // and crosses periapsis (r=100_000, below it) half a period later
          // — well within the ~54s horizon `landingTimeToImpact` bounds the
          // walk to.
          patches: [
            {
              sma: 250_000,
              ecc: 0.6,
              inc: 0,
              lan: 0,
              argPe: 0,
              meanAnomalyAtEpoch: Math.PI,
              epoch: 10,
              period: 60,
              startUt: 10,
              endUt: 200,
              patchStartTransition: 0,
              patchEndTransition: 1,
              peA: 0,
              apA: 0,
              semiLatusRectum: 0,
              semiMinorAxis: 0,
              referenceBody: "Kerbin",
              closestEncounterBody: null,
            },
          ],
        },
        { quality: Quality.Loaded },
      );
      // Descending at 42.5 m/s, 2800 m above terrain, at sea level (r = radius).
      fixture.emit("vessel.flight", {
        // Calibration reference for the predicted-impact patch-walk
        // (findImpactPoint's body-rotation fit) — arbitrary but finite.
        latitude: 0,
        longitude: 0,
        altitudeAsl: 0,
        altitudeTerrain: 2800,
        verticalSpeed: -42.5,
        surfaceSpeed: 50,
        orbitalSpeed: 50,
        atmDensity: 0,
      });
      fixture.emit("system.bodies", {
        bodies: [
          {
            name: "Testmun",
            index: 3,
            parentIndex: 0,
            radius: 200_000,
            orbit: null,
          },
        ],
      });
      // aMax = availableThrust/totalMass = 6 m/s² -> TWR 3 over g = 2.
      fixture.emit("vessel.propulsion", {
        totalMass: 1,
        dryMass: 0.5,
        currentThrust: 0,
        availableThrust: 6,
      });
    });

    // The derived land.timeToImpact opens the gate — the full readout renders.
    await waitFor(() => {
      if (!container.textContent?.includes("Impact in")) {
        throw new Error(
          "derived landing scalars have not streamed through yet",
        );
      }
    });
    expect(container.textContent).toContain("Suicide burn");
    expect(container.textContent).not.toContain("No landing in progress");
    expect(container.textContent).not.toContain(
      "Waiting for a landing prediction",
    );

    // White-box: the same derived field useDataValue's stream path reads is a
    // finite number in the store — proving it went through the derivation, not
    // a legacy fallback that isn't wired here.
    const timeToImpact = fixture.store.sample<number>(
      "vessel.state.landingTimeToImpact",
      fixture.store.currentFrame(),
    );
    expect(timeToImpact?.payload).toBeCloseTo(
      (-42.5 + Math.sqrt(42.5 * 42.5 + 2 * 2 * 2800)) / 2,
      4,
    );

    // The predicted-impact patch-walk streams too, off the SAME
    // vessel.orbit sample's patches array — no separate mod predictor.
    const predictedLat = fixture.store.sample<number>(
      "vessel.state.landingPredictedLat",
      fixture.store.currentFrame(),
    );
    const predictedLon = fixture.store.sample<number>(
      "vessel.state.landingPredictedLon",
      fixture.store.currentFrame(),
    );
    expect(predictedLat?.payload).not.toBeNull();
    expect(Number.isFinite(predictedLat?.payload)).toBe(true);
    expect(predictedLon?.payload).not.toBeNull();
    expect(Number.isFinite(predictedLon?.payload)).toBe(true);
  });
});
