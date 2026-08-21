import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import deepSpace from "./__fixtures__/deep-space-delay.json";
import noSignalData from "./__fixtures__/no-signal-data.json";
import noSignalOccluded from "./__fixtures__/no-signal-occluded.json";
import relay from "./__fixtures__/relay-probe-network.json";
import strong from "./__fixtures__/strong-direct-ksc.json";
import weak from "./__fixtures__/weak-fading-occlusion.json";
import { CommSignalComponent } from "./index";

/**
 * DOM snapshots off the stream pipeline, driven by each fixture's own
 * `_stream` block.
 *
 * This spec used to build that stream itself, carrying four channels and
 * emitting `vessel.comms`/`comms.link`/`comms.delay`/`vessel.orbit` from the
 * fixtures' flat keys. Each fixture already declares those and two more, the
 * `vessel.identity` and `system.bodies` the reference-body name resolves
 * against, so the hand-built copy is gone.
 *
 * `no-signal-data` carries no `_stream` block at all: loss of signal is its
 * subject, and its render is the empty state by design (it is named in the
 * un-fed gate's `EMPTY_BY_DESIGN` for exactly that reason).
 */

const FIXTURES: Record<string, Record<string, unknown>> = {
  "strong-direct-ksc": strong,
  "weak-fading-occlusion": weak,
  "no-signal-occluded": noSignalOccluded,
  "relay-probe-network": relay,
  "deep-space-delay": deepSpace,
  "no-signal-data": noSignalData,
};

const config = getWidget("comm-signal");
if (!config) throw new Error("comm-signal missing from widgets.ts");

describe("CommSignal DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: CommSignalComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
