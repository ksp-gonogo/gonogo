import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import kerbinAscent from "./__fixtures__/kerbin-ascent-to-67km.json";
import { OrbitalAscentComponent } from "./index";

/**
 * OrbitalAscent's stream render golden. This began life as a legacy-`DataSource`
 * ↔ stream byte-identical dual-run; `v.body` now comes off the client-derived
 * `vessel.state.parentBodyName` field with NO legacy fallback at all (see
 * `stream.test.tsx`), so the legacy leg is gone — same "the legacy leg is gone"
 * story as the sibling widgets' own dual-runs. What remains proves the widget
 * renders correctly off the real stream pipeline for the same ascent state.
 *
 * The two plotted series (`v.altitude`/`v.horizontalVelocity`) stay on a legacy
 * AUX source: both map to DERIVED `vessel.state.*` channels, and this file
 * never emits `vessel.flight`, so `deriveVesselState` never gets a whole record
 * and the series would resolve empty off the stream regardless — the AUX keeps
 * the GraphView backfill path exercised.
 *
 * An UNKNOWN body ("Gargantua") is streamed so the body's presence is
 * race-safely observable: the "Unknown body" notice appears only if `v.body`
 * actually streamed (the AUX source never feeds it), so waiting on it can't
 * false-green on an empty stream.
 */
const LEGACY_SERIES_KEYS = ["v.altitude", "v.horizontalVelocity"] as const;

// A body name getBody() doesn't recognise, driving the "Unknown body" notice.
const UNKNOWN_BODY = "Gargantua";

describe("OrbitalAscent — stream render golden (delay=0)", () => {
  it("renders the ascent state off the stream with v.body streamed", async () => {
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
          <OrbitalAscentComponent id="ascent-dual" w={10} h={8} />
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
    expect(container.textContent).toContain("ORBITAL ASCENT");
    expect(container.textContent).toContain(UNKNOWN_BODY);

    teardownMockDataSource(legacyAux);
  });
});
