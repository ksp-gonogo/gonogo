import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import adminShut from "./__fixtures__/administration-shut-derived.json";
import atCap from "./__fixtures__/at-admin-cap.json";
import unavailable from "./__fixtures__/feature-unavailable.json";
import highCommit from "./__fixtures__/high-commitment-conversion.json";
import noStrategies from "./__fixtures__/no-strategies-early-career.json";
import oneActive from "./__fixtures__/one-active-room-for-more.json";
import overCap from "./__fixtures__/over-cap-quirk.json";
import { StrategiesComponent } from "./index";

/**
 * DOM snapshots off the stream pipeline, driven by each fixture's own
 * `_stream` block.
 *
 * This spec used to build the stream itself and emit a `career.status` payload
 * assembled from the fixtures' flat keys. Every fixture declares that emit, so
 * the assembly is gone.
 */

const FIXTURES: Record<string, Record<string, unknown>> = {
  "no-strategies-early-career": noStrategies,
  "one-active-room-for-more": oneActive,
  "at-admin-cap": atCap,
  "over-cap-quirk": overCap,
  "high-commitment-conversion": highCommit,
  "feature-unavailable": unavailable,
  /*
   * The only fixture carrying `activateVerdictSource`, and the only one whose
   * rows were judged without the Administration Building. The DOM snapshot is
   * where that field is legible at all: its live effect is on the Activate
   * button's `title`, and every button in this scene is already dark for the
   * verdict's sake, so a pixel diff would not show it.
   */
  "administration-shut-derived": adminShut,
};

const config = getWidget("strategies");
if (!config) throw new Error("strategies missing from widgets.ts");

describe("Strategies DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    /*
     * A mode narrowed to certain fixtures is narrowed here too. Without this
     * a mode added for one scenario snapshots against every other, and since
     * this harness never dispatches a mode's `clicks` those extra snapshots
     * are byte-identical to the mode they were copied from.
     */
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
