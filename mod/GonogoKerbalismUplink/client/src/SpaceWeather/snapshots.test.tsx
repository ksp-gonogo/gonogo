/**
 * DOM-snapshot regression tests for the SpaceWeather widget.
 *
 * Catches structural drift (rendered text, element order, attribute changes)
 * across every fixture × mode combination registered for the widget. The
 * matching PNG renders cover the visual layer DOM snapshots can't
 * (styled-components CSS, the flux chart / belt rings SVG paint, fonts).
 *
 * Each fixture declares its own wire in the `_stream` block its `_scene` sits
 * beside, so the scenario is replayed through a real `TelemetryProvider` onto
 * the canonical `kerbalism.spaceweather` Topic (plus `vessel.flight` for the
 * belt-ring altitude), off exactly the emits the render harness photographs.
 *
 * If the widget output intentionally changes, regenerate with
 * `pnpm --filter @ksp-gonogo/gonogo-kerbalism-uplink exec vitest run src/SpaceWeather/snapshots -u`.
 */
import { getComponent } from "@ksp-gonogo/sitrep-sdk";
import { setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import { renderWidget } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import {
  flushProviderFrame,
  flushResizeObservers,
  installSizedResizeObserver,
  modePixels,
  replayStreamBlock,
  resolveStreamBlock,
  stripVolatile,
} from "../test/widgetDomSnapshot";
import binary from "./__fixtures__/binary.json";
import innerBelt from "./__fixtures__/inner-belt.json";
import interplanetary from "./__fixtures__/interplanetary.json";
import nominal from "./__fixtures__/nominal.json";
import stormInbound from "./__fixtures__/storm-inbound.json";
import stormPeak from "./__fixtures__/storm-peak.json";
// Side-effect import: the widget self-registers on module load, and
// `renderWidget` looks it up by id rather than importing the component.
import "./index";

const FIXTURES: Record<string, Record<string, unknown>> = {
  nominal,
  "inner-belt": innerBelt,
  "storm-inbound": stormInbound,
  "storm-peak": stormPeak,
  // The two scenarios the sun-vantage half exists for: more than one star, and
  // a CME aimed at the craft itself rather than at a body under it.
  binary,
  interplanetary,
};

/**
 * The carried set is read off the widget's own registration rather than
 * repeated per fixture, so a scene cannot silently carry a topic the widget
 * has stopped reading. Same source the render harness derives its own carried
 * set from.
 */
const SW = getComponent("space-weather");
if (!SW) throw new Error("space-weather is not registered");
const CARRIED = [...(SW.channels ?? []), ...(SW.optionalChannels ?? [])];

async function snapshotSpaceWeatherMode(
  fixture: Record<string, unknown>,
  mode: { name: string; w: number; h: number },
): Promise<string> {
  const block = resolveStreamBlock(fixture);
  if (!block) throw new Error("fixture carries no _stream block");
  const stream = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: block.pinnedUt,
    delaySeconds: block.delaySeconds,
  });
  const restoreResizeObserver = installSizedResizeObserver(modePixels(mode));
  try {
    const { container } = renderWidget("space-weather", {
      instanceId: "snap",
      w: mode.w,
      h: mode.h,
      wrapper: stream.Provider,
    });

    await replayStreamBlock(stream, block);
    await flushProviderFrame();
    await flushResizeObservers();

    return stripVolatile(container.innerHTML);
  } finally {
    restoreResizeObserver();
  }
}

const config = getWidget("space-weather");
if (!config) throw new Error("space-weather missing from widgets.ts");

describe("SpaceWeather DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotSpaceWeatherMode(fixture, mode);
        expect(html).toMatchSnapshot();
      });
    }
  }
});
