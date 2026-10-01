import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import adminShut from "./__fixtures__/administration-shut-derived.json";
import atCap from "./__fixtures__/at-admin-cap.json";
import unavailable from "./__fixtures__/feature-unavailable.json";
import gatedPerStrategy from "./__fixtures__/gated-per-strategy.json";
import highCommit from "./__fixtures__/high-commitment-conversion.json";
import noStrategies from "./__fixtures__/no-strategies-early-career.json";
import oneActive from "./__fixtures__/one-active-room-for-more.json";
import overCap from "./__fixtures__/over-cap-quirk.json";
import { StrategiesComponent } from "./index";

/** DOM snapshots off the stream pipeline, driven by each fixture's own `_stream` block. */

const FIXTURES: Record<string, Record<string, unknown>> = {
  "no-strategies-early-career": noStrategies,
  "one-active-room-for-more": oneActive,
  "at-admin-cap": atCap,
  "over-cap-quirk": overCap,
  "high-commitment-conversion": highCommit,
  "feature-unavailable": unavailable,
  "administration-shut-derived": adminShut,
  // A per-strategy gate verdict shows in the control's accessible name, which a pixel diff cannot read.
  "gated-per-strategy": gatedPerStrategy,
};

const config = getWidget("strategies");
if (!config) throw new Error("strategies missing from widgets.ts");

describe("Strategies DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    // This harness never dispatches a mode's `clicks`, so a mode snapshots only the fixtures it names.
    const modes = config.modes.filter(
      (m) => m.forFixtures === undefined || m.forFixtures.includes(name),
    );
    for (const mode of modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: StrategiesComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
