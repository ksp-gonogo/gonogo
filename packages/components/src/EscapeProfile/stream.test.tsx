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
 * - `v.orbitalVelocity` (MAPPED -> `vessel.state.orbitalSpeed`) and
 *   `v.altitude` (MAPPED -> `vessel.state.altitudeAsl`) are both read only
 *   via `GraphView` -> `GraphSeries` -> `useDataSeries`.
 *
 * **Re-verified in the M3 mechanical-tail batch**, after `useDataSeries`
 * grew its own stream shim: unlike `OrbitalAscent`/`KeplerPeriod`,
 * EscapeProfile's plot was genuinely the best CANDIDATE for this unlock —
 * both `xKey` (`v.altitude`) and the series `key` (`v.orbitalVelocity`) are
 * mapped, so a migrated plot wouldn't hit the `alignXY` unit-mismatch
 * problem the other two widgets' comments describe (both axes would read
 * off the same UT-seconds clock). It's still blocked, but for a different,
 * structural reason: both mapped topics are DERIVED `vessel.state.*`
 * field-subtopics. `TimelineStore.isDerivedTopic` gates `sampleRange` to
 * return `undefined` for any derived channel (a derived value is computed
 * fresh per frame from its inputs, never buffered as its own history), so
 * `useDataSeries` can NEVER serve a `vessel.state.*` series regardless of
 * carried-channel status — the SAME structural block `OrbitalAscent` hits
 * on `v.altitude` alone, just doubled up here since EscapeProfile's *other*
 * axis is derived too. Only a RAW-topic mapped pair (like `SemiMajorAxis`'s
 * `o.sma`) can ever unlock a `GraphView` plot.
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
