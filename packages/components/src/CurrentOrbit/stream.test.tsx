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
 * `o.sma`/`o.eccentricity`/`o.inclination`/`o.argumentOfPeriapsis` are MAPPED
 * raw fields on `vessel.orbit`; `o.period`/`o.trueAnomaly`/`o.timeToAp`/
 * `o.timeToPe` are MAPPED derived fields on `vessel.state` (M3
 * vessel-state-extend — un-gapped now that `deriveVesselState` actually
 * produces them). `o.timeToAp`/`o.timeToPe` (read via the shared
 * `useOrbitElements` hook) resolve to REAL values here because they only
 * need `vessel.orbit`'s elements, already emitted below — no `system.bodies`
 * dependency, unlike their apsis-altitude siblings. `o.ApA`/`o.PeA` (also via
 * `useOrbitElements`) ARE mapped too, but stay `undefined` in this file:
 * they need `system.bodies` for the reference body's radius
 * (`vessel-state.ts`'s `deriveApsides`), and nothing here emits it — genuine
 * "still resyncing," not a gap. `o.ApR`/`o.PeR`/`o.referenceBody`/`v.body`
 * are the still-declared GAPS (`map-topic.ts`'s `TELEMACHUS_KNOWN_GAPS`) and
 * stay legacy. With no legacy source registered in this file, every
 * gapped/unresolved field renders its normal "no data" fallback ("—"), which
 * is itself the assertion that a partially-mapped widget degrades
 * gracefully.
 *
 * `carriedChannels` lists all EIGHT of `vessel.state`'s declared inputs
 * (`vessel.orbit`/`vessel.flight`/`vessel.identity`/`system.bodies` plus the
 * enum-display-map sources `vessel.control`/`vessel.target`/`vessel.comms` and
 * the R6 TWR source `vessel.propulsion`) even though most of the fields this
 * widget reads only actually consult
 * `vessel.orbit` — the carried-channels gate is parent-channel-scoped, not
 * per-field (see `vessel-state.ts`'s `vesselStateChannel` doc comment).
 */
afterEach(() => {
  cleanup();
});

describe("CurrentOrbit — genuinely runs off the stream (M3 batch 2)", () => {
  it("reads sma/eccentricity/inclination/argPe/period off the real stream pipeline, not legacy", async () => {
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

    // meanAnomalyAtEpoch: 0, epoch: pinnedUt (10) -> elapsed time is 0 at
    // this frame, so trueAnomaly is exactly 0° (periapsis) regardless of
    // eccentricity — a clean, hand-checkable value with no float-formatting
    // ambiguity.
    const sma = 682500;
    const mu = 3.5316e12; // Kerbin's GM
    act(() => {
      fixture.emit("vessel.orbit", {
        sma,
        ecc: 0.00367,
        inc: 0.3,
        argPe: 12.5,
        mu,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
      });
    });

    // Inclination renders off the mapped stream value.
    await waitFor(() => expect(screen.getByText("0.3°")).toBeTruthy());
    // Eccentricity (toFixed(4)) also renders off the mapped stream value.
    expect(screen.getByText("0.0037")).toBeTruthy();
    // Period (T row, formatDuration) renders off the newly-mapped
    // vessel.state.period — 2π·sqrt(sma³/mu), floored to whole seconds.
    // (Hand-checked: 2π·sqrt(682500³ / 3.5316e12) ≈ 1885.16s -> "31m 25s";
    // the formula itself has its own dedicated unit coverage in
    // vessel-state.test.ts.)
    await waitFor(() => expect(screen.getByText("31m 25s")).toBeTruthy());
    // timeToAp/timeToPe (t-Ap/t-Pe rows) also render off the newly-mapped
    // vessel.state.timeToAp/timeToPe — meanAnomalyAtEpoch: 0, epoch: 10 ==
    // pinnedUt means meanAnomaly is exactly 0 (periapsis) at this frame, so
    // timeToPe is 0 and timeToAp is exactly half the period.
    expect(screen.getByText("0s")).toBeTruthy();
    expect(screen.getByText("15m 42s")).toBeTruthy();
    // Ap/Pe are MAPPED but still unresolved here (system.bodies isn't
    // emitted in this file); ApR/PeR/referenceBody/v.body are still declared
    // GAPS. Either way they stay "—" rather than a fabricated value.
    expect(screen.getAllByText("—").length).toBe(2);
  });
});
