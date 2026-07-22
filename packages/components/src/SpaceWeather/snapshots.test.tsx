/**
 * DOM-snapshot regression tests for the SpaceWeather widget.
 *
 * Catches structural drift (rendered text, element order, attribute changes)
 * across every fixture × mode combination registered for the widget. The
 * matching PNG renders live in `local_docs/renders/space-weather-widget/` and
 * cover the visual layer DOM snapshots can't (styled-components CSS, the flux
 * chart / belt rings SVG paint, fonts).
 *
 * SpaceWeather reads flat `sw.*` keys off the `"data"` source (see its
 * `useSpaceWeather` hook), so these render through the shared MockDataSource
 * harness like the widget's own index.test.tsx — no TelemetryProvider needed.
 * Missing keys default to 0, so the board always renders populated.
 *
 * If the widget output intentionally changes, regenerate with
 * `pnpm --filter @ksp-gonogo/components exec vitest run src/SpaceWeather/snapshots -u`.
 */
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import innerBelt from "./__fixtures__/inner-belt.json";
import nominal from "./__fixtures__/nominal.json";
import stormInbound from "./__fixtures__/storm-inbound.json";
import stormPeak from "./__fixtures__/storm-peak.json";
import { SpaceWeatherComponent } from "./index";

const FIXTURES = {
  nominal,
  "inner-belt": innerBelt,
  "storm-inbound": stormInbound,
  "storm-peak": stormPeak,
};

const config = getWidget("space-weather");
if (!config) throw new Error("space-weather missing from widgets.ts");

describe("SpaceWeather DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: SpaceWeatherComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
