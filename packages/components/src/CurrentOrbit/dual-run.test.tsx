import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import circularLko from "./__fixtures__/circular-lko.json";
import { CurrentOrbitComponent } from "./index";

/**
 * CurrentOrbit's M3 batch-2 behavior-preservation golden dual-run (mirrors
 * `ThermalStatus/dual-run.test.tsx`, batch 1): the SAME orbit state,
 * rendered once off the legacy `DataSource` and once off the stream, must
 * produce byte-identical DOM at `delay=0`.
 *
 * `circular-lko` is chosen because it populates every field the widget
 * reads, including `showDiagram`'s default-true mini orbit diagram
 * (`hasOrbit` needs `o.ApR`/`o.PeR`, both GAPPED) — the widest MIXED-source
 * shape of the batch-2 four: 4 MAPPED `vessel.orbit.*` fields (sma/
 * eccentricity/inclination/argumentOfPeriapsis) coexisting with 10 GAPPED
 * legacy-AUX fields (ApA/PeA/ApR/PeR/trueAnomaly/period/timeToAp/timeToPe/
 * referenceBody/v.body) feeding the SAME diagram and grid on one render.
 */
afterEach(() => {
  cleanup();
});

const GAPPED_KEYS = [
  "o.ApA",
  "o.PeA",
  "o.ApR",
  "o.PeR",
  "o.trueAnomaly",
  "o.period",
  "o.timeToAp",
  "o.timeToPe",
  "o.referenceBody",
  "v.body",
] as const;

describe("CurrentOrbit — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same orbit state", async () => {
    const mode = { name: "default-9x18", w: 9, h: 18 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: CurrentOrbitComponent,
      fixture: circularLko,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: ["vessel.orbit"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: GAPPED_KEYS.map((key) => ({ key })),
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "orbit-dual" }}>
          <CurrentOrbitComponent id="orbit-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      for (const key of GAPPED_KEYS) {
        legacyAux.source.emit(
          key,
          circularLko[key as keyof typeof circularLko],
        );
      }
      streamFixture.emit("vessel.orbit", {
        sma: circularLko["o.sma"],
        ecc: circularLko["o.eccentricity"],
        inc: circularLko["o.inclination"],
        argPe: circularLko["o.argumentOfPeriapsis"],
      });
    });

    // "Kerbin" alone isn't sufficient — that text comes from the legacy AUX
    // source's o.referenceBody, which can land before the STREAM leg's
    // mapped vessel.orbit emission has actually propagated through the
    // store. Wait on a value the stream leg alone produces (the
    // inclination readout) so the race can't produce a false green.
    await waitFor(() => {
      if (!container.textContent?.includes("0.3°")) {
        throw new Error("stream leg has not rendered inclination yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
