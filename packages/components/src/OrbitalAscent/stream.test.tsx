import { DashboardItemContext } from "@gonogo/core";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { OrbitalAscentComponent } from "./index";

/**
 * The M3 batch-3 stream test-adapter proof for OrbitalAscent — same
 * degenerate shape as `KeplerPeriod` (see its `stream.test.tsx` doc
 * comment for the full explanation): ZERO keys the read shim can migrate.
 *
 * - Its only `useDataValue` call, `v.body`, is a declared GAP in
 *   `map-topic.ts`.
 * - `v.horizontalVelocity` (GAPPED anyway — "derived quantities with no
 *   named field on any M1/M2 channel yet") and `v.altitude` (itself MAPPED
 *   -> `vessel.state.altitudeAsl`, but irrelevantly so) are both read only
 *   via `GraphView` -> `GraphSeries` -> `useDataSeries`, which has no
 *   `mapTopic` awareness at all (the batch-2 `SemiMajorAxis` footgun).
 *
 * No `useDataStreamStatus`/`StreamStatusBadge` were added to `index.tsx` —
 * there is no representative mapped key. This test locks in that the
 * widget still renders its normal no-data state under a real
 * `TelemetryProvider` with no legacy source, proving the harness doesn't
 * disturb a widget it leaves untouched.
 */
afterEach(() => {
  cleanup();
});

describe("OrbitalAscent — zero migratable keys, stream-safe no-op (M3 batch 3)", () => {
  it("renders its normal no-data state under a TelemetryProvider with no legacy source, nothing streams", () => {
    const fixture = setupStreamFixture({ carriedChannels: [] });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ascent-stream" }}>
          <OrbitalAscentComponent id="ascent-stream" w={10} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(container.textContent).toContain("ORBITAL ASCENT");
    expect(container.textContent).not.toContain("Unknown body");
    expect(container.textContent).not.toContain("No reference data");
  });
});
