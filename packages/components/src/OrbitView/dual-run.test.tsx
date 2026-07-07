import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import lkoCircular from "./__fixtures__/lko-circular.json";
import { OrbitViewComponent } from "./index";

/**
 * OrbitView's M3 mechanical-tail-batch behavior-preservation golden dual-run
 * (mirrors `CurrentOrbit/dual-run.test.tsx`, batch 2): the SAME orbit state,
 * rendered once off the legacy `DataSource` and once off the stream, must
 * produce byte-identical DOM at `delay=0`.
 *
 * `lko-circular` is chosen because it's a stable low-Kerbin orbit — `hasOrbit`
 * is true and `isOrbiting` resolves true (`o.PeA` clears the atmosphere
 * ceiling), landing the `StatusPill` "Stable orbit" text. Mode `4x18` keeps
 * `showDiagram` false (`cols < 5`) so the pill text renders directly instead
 * of the SVG diagram, giving the test a DOM string to assert on before
 * comparing full markup.
 *
 * `o.sma`/`o.eccentricity`/`o.argumentOfPeriapsis` are the three MAPPED keys
 * (-> raw `vessel.orbit.sma`/`.ecc`/`.argPe`) and stream in this file.
 * Everything else — `o.trueAnomaly`, `v.body`, `useOrbitElements`'s six keys
 * (`o.ApR`/`o.PeR`/`o.ApA`/`o.PeA`/`o.timeToAp`/`o.timeToPe`), and the
 * `useCelestialBodies`-fed rotation marker's `b.number`/`b.name[0]`/
 * `b.rotates[0]`/`b.rotationAngle[0]` (a custom `getDataSource()` bypass the
 * shim never touches) — reads off a legacy AUX source in the stream leg.
 */
afterEach(() => {
  cleanup();
});

const GAPPED_KEYS = [
  "v.body",
  "o.trueAnomaly",
  "o.ApR",
  "o.PeR",
  "o.ApA",
  "o.PeA",
  "b.number",
  "b.name[0]",
  "b.rotates[0]",
  "b.rotationAngle[0]",
] as const;

describe("OrbitView — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same orbit state", async () => {
    const mode = { name: "portrait-4x18", w: 4, h: 18 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: OrbitViewComponent,
      fixture: lkoCircular,
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
        <DashboardItemContext.Provider value={{ instanceId: "orbitview-dual" }}>
          <OrbitViewComponent id="orbitview-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      for (const key of GAPPED_KEYS) {
        legacyAux.source.emit(
          key,
          lkoCircular[key as keyof typeof lkoCircular],
        );
      }
      streamFixture.emit("vessel.orbit", {
        sma: lkoCircular["o.sma"],
        ecc: lkoCircular["o.eccentricity"],
        argPe: lkoCircular["o.argumentOfPeriapsis"],
      });
    });

    await waitFor(() => {
      if (!container.textContent?.includes("Stable orbit")) {
        throw new Error("stream leg has not rendered the orbit pill yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
