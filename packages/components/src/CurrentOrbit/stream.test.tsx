import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CurrentOrbitComponent } from "./index";

/**
 * The M3 batch-2 stream test-adapter proof for CurrentOrbit (mirrors
 * `ThermalStatus/stream.test.tsx`, batch 1): genuinely running off the real
 * `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport` — no legacy `DataSource` is registered anywhere in this
 * file.
 *
 * CurrentOrbit is the most GAP-heavy of the batch-2 four: only `o.sma`,
 * `o.eccentricity`, `o.inclination`, `o.argumentOfPeriapsis` are MAPPED
 * (all raw fields on `vessel.orbit`). Everything else this widget reads —
 * `o.ApA`/`o.PeA`/`o.ApR`/`o.PeR`/`o.timeToAp`/`o.timeToPe` (via the shared
 * `useOrbitElements` hook), `o.trueAnomaly`, `o.period`, `o.referenceBody`,
 * `v.body` — is a declared GAP (`map-topic.ts`'s `TELEMACHUS_KNOWN_GAPS`)
 * and stays legacy. With no legacy source registered in this file, every
 * gapped field renders its normal "no data" fallback ("—"), which is
 * itself the assertion that a partially-mapped widget degrades gracefully.
 */
afterEach(() => {
  cleanup();
});

describe("CurrentOrbit — genuinely runs off the stream (M3 batch 2)", () => {
  it("reads sma/eccentricity/inclination/argPe off the real stream pipeline, not legacy", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.orbit"],
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "orbit-stream" }}>
          <CurrentOrbitComponent id="orbit-stream" w={9} h={18} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Nothing arrived yet — every field (mapped and gapped alike) is
    // undefined, so every row shows its "—" placeholder.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(6);

    // A real subscription must have happened for this to deliver at all —
    // StubTransport.emit is subscription-gated (see its own doc comment).
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(true);

    act(() => {
      fixture.emit("vessel.orbit", {
        sma: 682500,
        ecc: 0.00367,
        inc: 0.3,
        argPe: 12.5,
      });
    });

    // Inclination renders off the mapped stream value.
    await waitFor(() => expect(screen.getByText("0.3°")).toBeTruthy());
    // Eccentricity (toFixed(4)) also renders off the mapped stream value.
    expect(screen.getByText("0.0037")).toBeTruthy();
    // Ap/Pe/t-Ap/t-Pe/T/subtitle all read GAPPED keys — with no legacy
    // source here they stay "—"/hidden rather than a fabricated value.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });
});
