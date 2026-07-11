import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import kerbinAscent from "./__fixtures__/kerbin-ascent-to-67km.json";
import { OrbitalAscentComponent } from "./index";

/**
 * OrbitalAscent's behavior-preservation golden dual-run: the SAME ascent
 * state, rendered once off the legacy `DataSource` and once with `v.body`
 * migrated onto the stream, must produce byte-identical DOM at `delay=0`.
 *
 * `v.body` reads through `useTelemetry`, which resolves it
 * to the DERIVED `vessel.state.parentBodyName` field and streams it — so the
 * stream leg feeds it via `vessel.orbit`/`system.bodies`/`vessel.identity`
 * emissions, NOT the legacy AUX source. The AUX source here carries ONLY the
 * two plotted series (`v.altitude`/`v.horizontalVelocity`): both map to DERIVED
 * `vessel.state.*` channels, and `useDataSeries` structurally cannot serve a
 * derived channel's windowed history off the stream (`TimelineStore.sampleRange`
 * returns `undefined` for a derived topic — see that hook's doc), so the
 * GraphView series stay on the legacy path in BOTH legs. That is a shared-infra
 * property of derived-channel series, not a per-widget gap.
 *
 * An UNKNOWN body ("Gargantua") is streamed so the body's presence is
 * race-safely observable in the stream leg: the "Unknown body" notice appears
 * only if `v.body` actually streamed (the AUX source never feeds it), so
 * waiting on it can't false-green on an empty stream.
 */
afterEach(() => {
  cleanup();
});

// The two plotted series stay on the legacy AUX source in the stream leg —
// derived-channel series aren't stream-servable (see the doc comment above).
const LEGACY_SERIES_KEYS = ["v.altitude", "v.horizontalVelocity"] as const;

// A body name getBody() doesn't recognise, driving the "Unknown body" notice
// in BOTH legs — the legacy golden reads it as `v.body`, the stream leg derives
// it as vessel.state.parentBodyName.
const UNKNOWN_BODY = "Gargantua";

describe("OrbitalAscent — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup with v.body streamed as it does off the legacy DataSource", async () => {
    const mode = { name: "default-10x8", w: 10, h: 8 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: OrbitalAscentComponent,
      fixture: { ...kerbinAscent, "v.body": UNKNOWN_BODY },
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
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
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: LEGACY_SERIES_KEYS.map((key) => ({ key })),
      connectSource: true,
    });
    registerStockBodies();

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ascent-dual" }}>
          <OrbitalAscentComponent id="ascent-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      for (const key of LEGACY_SERIES_KEYS) {
        legacyAux.source.emit(
          key,
          kerbinAscent[key as keyof typeof kerbinAscent],
        );
      }
      streamFixture.emit("vessel.orbit", {
        referenceBodyIndex: 1,
        sma: 682500,
        ecc: 0.00367,
        inc: 0.3,
        argPe: 12.5,
        mu: 3.5316e12,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
      });
      streamFixture.emit("system.bodies", {
        bodies: [
          {
            name: UNKNOWN_BODY,
            index: 1,
            parentIndex: 0,
            radius: 600_000,
            orbit: null,
          },
        ],
      });
      streamFixture.emit("vessel.identity", {
        parentBodyIndex: 1,
        launchUt: 0,
      });
    });

    // The "Unknown body" notice is produced ONLY by the streamed v.body (the
    // AUX source never feeds it), so this can't false-green on an empty stream.
    await waitFor(() => {
      if (!container.textContent?.includes("Unknown body")) {
        throw new Error("stream leg has not resolved v.body yet");
      }
    });
    // Drain the GraphView series backfill so the graph settles identically to
    // the legacy golden before snapshotting.
    await waitFor(() => {
      if (legacyAux.pendingQueries() !== 0) {
        throw new Error("series backfill pending");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
