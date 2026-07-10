import { DashboardItemContext } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import kerbinLaunchpad from "./__fixtures__/kerbin-launchpad.json";
import { MapViewComponent } from "./index";

/**
 * MapView's M3 mechanical-tail-batch behavior-preservation golden dual-run
 * (mirrors `AtmosphereProfile/dual-run.test.tsx`, batch 2): the SAME
 * pre-launch state, rendered once off the legacy `DataSource` and once off
 * the stream, must produce byte-identical DOM at `delay=0`.
 *
 * `kerbin-launchpad` is chosen because it populates every mapped field
 * (`v.lat`/`v.long`/`v.altitude`/`v.dynamicPressure`/`v.mach`/
 * `v.surfaceSpeed`/`v.verticalSpeed`) plus every GAPPED field the compact
 * mode reads (`v.body`, `n.pitch`/`n.heading` — declared but unread,
 * included anyway for parity with the fixture, `t.universalTime`,
 * `o.encounterExists`, `o.orbitPatches`, `o.maneuverNodes`,
 * `a.physicsMode`). Mode `4x5` selects the compact (`!showMap`) branch —
 * the one MapView render path whose Lat/Lon/Alt readout is plain DOM text
 * rather than canvas drawing, so the mapped values are directly comparable.
 */
afterEach(() => {
  cleanup();
});

const GAPPED_KEYS = [
  "v.body",
  "n.pitch",
  "n.heading",
  "t.universalTime",
  "o.encounterExists",
  "o.orbitPatches",
  "o.maneuverNodes",
  "a.physicsMode",
] as const;

describe("MapView — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same launchpad state", async () => {
    const mode = { name: "compact-4x5", w: 4, h: 5 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: MapViewComponent,
      fixture: kerbinLaunchpad,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      // vessel.identity/system.bodies: vessel.state's carried-channels gate
      // is parent-channel-scoped (M3 vessel-state-extend) — see the matching
      // note in stream.test.tsx.
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
      keys: GAPPED_KEYS.map((key) => ({ key })),
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "mapview-dual" }}>
          <MapViewComponent id="mapview-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      for (const key of GAPPED_KEYS) {
        legacyAux.source.emit(
          key,
          kerbinLaunchpad[key as keyof typeof kerbinLaunchpad],
        );
      }
      streamFixture.emit("vessel.orbit", {}, { quality: Quality.Loaded });
      streamFixture.emit("vessel.flight", {
        latitude: kerbinLaunchpad["v.lat"],
        longitude: kerbinLaunchpad["v.long"],
        altitudeAsl: kerbinLaunchpad["v.altitude"],
        dynamicPressureKPa: kerbinLaunchpad["v.dynamicPressure"],
        mach: kerbinLaunchpad["v.mach"],
        surfaceSpeed: kerbinLaunchpad["v.surfaceSpeed"],
        verticalSpeed: kerbinLaunchpad["v.verticalSpeed"],
      });
    });

    // "0.1 km"-style altitude text alone isn't sufficient — the compact
    // readout only shows Alt once altSea has landed, so wait on that
    // specific mapped value so the race can't produce a false green.
    await waitFor(() => {
      if (!container.textContent?.includes("0.1 km")) {
        throw new Error("stream leg has not rendered altitude yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
