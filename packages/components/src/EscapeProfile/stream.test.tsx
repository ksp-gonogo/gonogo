import { DashboardItemContext } from "@gonogo/core";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { EscapeProfileComponent } from "./index";

/**
 * The M3 batch-4 stream test-adapter proof for EscapeProfile — same
 * degenerate shape as `OrbitalAscent`/`KeplerPeriod` (see their
 * `stream.test.tsx` doc comments for the full explanation): ZERO keys the
 * read shim can migrate.
 *
 * - Its only `useDataValue` call, `v.body`, is a declared GAP in
 *   `map-topic.ts`.
 * - `v.orbitalVelocity` (itself MAPPED -> `vessel.state.orbitalSpeed`, but
 *   irrelevantly so) and `v.altitude` (also MAPPED ->
 *   `vessel.state.altitudeAsl`, same story) are both read only via
 *   `GraphView` -> `GraphSeries` -> `useDataSeries`, which has no
 *   `mapTopic` awareness at all (the batch-2 `SemiMajorAxis` footgun,
 *   reproduced here since EscapeProfile is another `GraphView` consumer).
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

describe("EscapeProfile — zero migratable keys, stream-safe no-op (M3 batch 4)", () => {
  it("renders its normal no-data state under a TelemetryProvider with no legacy source, nothing streams", () => {
    const fixture = setupStreamFixture({ carriedChannels: [] });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "escape-stream" }}>
          <EscapeProfileComponent id="escape-stream" w={10} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(container.textContent).toContain("ESCAPE PROFILE");
    expect(container.textContent).not.toContain("Unknown body");
    expect(container.textContent).not.toContain("No reference data");
  });
});
