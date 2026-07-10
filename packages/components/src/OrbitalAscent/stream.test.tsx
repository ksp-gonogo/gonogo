import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { OrbitalAscentComponent } from "./index";

/**
 * The R6 stream test-adapter proof for OrbitalAscent: the widget's own read
 * (`v.body`) genuinely runs off the real `TelemetryProvider`/`TelemetryClient`/
 * `TimelineStore` pipeline via `StubTransport` — no legacy `DataSource` is
 * registered anywhere in this file, so a value only reaches the widget if it
 * actually streamed.
 *
 * `v.body` is mapped (R6 / Step-2 migration) to the DERIVED
 * `vessel.state.parentBodyName` field — the index→name display map
 * `deriveVesselState` resolves from `vessel.identity.parentBodyIndex` against
 * `system.bodies` (`vessel-state.ts`). Emitting `vessel.orbit` (which gates the
 * whole `vessel.state` record; default `StubTransport` meta quality is
 * `OnRails`, so the propagated branch runs) plus `vessel.identity` +
 * `system.bodies` makes the derived body name resolve. Streaming an UNKNOWN
 * body name (one `getBody` doesn't know) is what proves the value came off the
 * stream: the widget renders its "Unknown body" notice, which it could not do
 * from a legacy fallback that isn't wired here.
 *
 * `carriedChannels` lists all EIGHT of `vessel.state`'s declared inputs — the
 * carried-channels gate is parent-channel-scoped, not per-field (see
 * `vessel-state.ts`'s `vesselStateChannel` doc comment), so even a field that
 * only consults `vessel.identity`/`system.bodies` needs the whole set carried
 * to route.
 *
 * The two plotted series (`v.altitude`/`v.horizontalVelocity`) are NOT asserted
 * here: both map to DERIVED `vessel.state.*` channels, and `useDataSeries`
 * structurally cannot serve a derived channel's windowed history off the stream
 * (`TimelineStore.sampleRange` returns `undefined` for a derived topic), so the
 * GraphView series stay on the legacy path — absent here, hence an empty graph.
 * The widget still renders its chrome, which the assertions below confirm.
 */
afterEach(() => {
  cleanup();
});

describe("OrbitalAscent — v.body genuinely runs off the stream (R6)", () => {
  it("resolves the streamed parent-body name off the real pipeline, not legacy", async () => {
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
        <DashboardItemContext.Provider value={{ instanceId: "ascent-stream" }}>
          <OrbitalAscentComponent id="ascent-stream" w={10} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Chrome renders immediately; nothing has streamed yet so no body notice.
    expect(container.textContent).toContain("ORBITAL ASCENT");
    expect(container.textContent).not.toContain("Unknown body");

    // A real subscription must have happened for StubTransport (which is
    // subscription-gated) to deliver at all.
    expect(fixture.transport.isSubscribed("system.bodies")).toBe(true);

    act(() => {
      fixture.emit("vessel.orbit", {
        referenceBodyIndex: 1,
        sma: 682500,
        ecc: 0.00367,
        inc: 0.3,
        argPe: 12.5,
        mu: 3.5316e12,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
      });
      fixture.emit("system.bodies", {
        bodies: [
          {
            name: "Gargantua",
            index: 1,
            parentIndex: 0,
            radius: 600_000,
            orbit: null,
          },
        ],
      });
      fixture.emit("vessel.identity", { parentBodyIndex: 1, launchUt: 0 });
    });

    // The derived vessel.state.parentBodyName streams through as "Gargantua",
    // which getBody() doesn't recognise -> the "Unknown body" notice appears.
    await waitFor(() => {
      if (!container.textContent?.includes("Unknown body")) {
        throw new Error("streamed body name has not resolved yet");
      }
    });
    expect(container.textContent).toContain("Gargantua");
  });
});
