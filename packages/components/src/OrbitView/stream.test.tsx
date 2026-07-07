import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { OrbitViewComponent } from "./index";

/**
 * The M3 mechanical-tail-batch stream test-adapter proof for OrbitView —
 * genuinely running off the real `TelemetryProvider`/`TelemetryClient`/
 * `TimelineStore` pipeline via `StubTransport`; no legacy `DataSource` is
 * registered anywhere in this file.
 *
 * OrbitView's keys split MAPPED / GAPPED / custom-hook (`map-topic.ts`):
 * - MAPPED: `o.sma` -> raw `vessel.orbit.sma`, `o.eccentricity` -> raw
 *   `vessel.orbit.ecc`, `o.argumentOfPeriapsis` -> raw `vessel.orbit.argPe`
 *   — all three read via plain `useDataValue` calls in `index.tsx`, so all
 *   three migrate transparently once `vessel.orbit` is carried.
 * - GAPPED: `o.trueAnomaly`, `v.body`, and every key `useOrbitElements`
 *   reads (`o.ApR`/`o.PeR`/`o.ApA`/`o.PeA`/`o.timeToAp`/`o.timeToPe`) —
 *   none has a new home yet.
 * - Custom-hook bypass: `useBodyRotation` is fed by `useCelestialBodies`
 *   (`SystemView/useCelestialBodies.ts`), which calls `getDataSource()`
 *   directly rather than `useDataValue` — the shim never sees it, so the
 *   rotation marker stays legacy regardless of `b.*`'s own mapping status.
 *
 * Because `apoapsisRadius`/`periapsisRadius` (`o.ApR`/`o.PeR`, GAPPED) can
 * never arrive with no legacy source registered, `hasOrbit` can never go
 * true — the diagram/pill never render off this test's DOM alone, the same
 * correlated-gap shape as `AtmosphereProfile/stream.test.tsx`. This test
 * instead samples the same three topics `useDataValue`'s stream path reads
 * (`getStreamSnapshot`'s own `store.sample(topic, store.currentFrame())`),
 * proving the mapped reads genuinely resolve off the real `TimelineStore`,
 * and separately proves the gap holds (no fabricated orbit) once they land.
 */
afterEach(() => {
  cleanup();
});

describe("OrbitView — genuinely runs off the stream (M3 mechanical-tail batch)", () => {
  it("reads sma/eccentricity/argumentOfPeriapsis off the real stream pipeline, not legacy", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.orbit"],
      pinnedUt: 10,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider
          value={{ instanceId: "orbitview-stream" }}
        >
          <OrbitViewComponent id="orbitview-stream" w={9} h={18} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // No legacy source anywhere in this file — apoapsisRadius/
    // periapsisRadius (o.ApR/o.PeR) can never resolve, so hasOrbit stays
    // false and the empty state renders regardless of the mapped orbit
    // elements below.
    expect(container.textContent).toContain("No orbital data");

    // A real subscription must have happened for this to deliver at all —
    // StubTransport.emit is subscription-gated (see its own doc comment).
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(true);

    act(() => {
      fixture.emit("vessel.orbit", {
        sma: 681_500,
        ecc: 0.003,
        argPe: 12,
      });
    });

    await waitFor(() => {
      const sma = fixture.store.sample<number>(
        "vessel.orbit.sma",
        fixture.store.currentFrame(),
      );
      if (sma?.payload !== 681_500) {
        throw new Error("vessel.orbit.sma has not resolved yet");
      }
      const ecc = fixture.store.sample<number>(
        "vessel.orbit.ecc",
        fixture.store.currentFrame(),
      );
      if (ecc?.payload !== 0.003) {
        throw new Error("vessel.orbit.ecc has not resolved yet");
      }
      const argPe = fixture.store.sample<number>(
        "vessel.orbit.argPe",
        fixture.store.currentFrame(),
      );
      if (argPe?.payload !== 12) {
        throw new Error("vessel.orbit.argPe has not resolved yet");
      }
    });

    // The correlated gap holds — the mapped orbit elements landing doesn't
    // fabricate an apoapsis/periapsis or otherwise change the empty state.
    expect(container.textContent).toContain("No orbital data");
  });
});
