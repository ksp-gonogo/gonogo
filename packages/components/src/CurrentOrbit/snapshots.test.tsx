import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import circular from "./__fixtures__/circular-lko.json";
import eccentric from "./__fixtures__/eccentric-capture.json";
import escapeTrajectory from "./__fixtures__/escape-trajectory.json";
import polar from "./__fixtures__/polar-orbit.json";
import retrograde from "./__fixtures__/retrograde-orbit.json";
import subOrbital from "./__fixtures__/sub-orbital.json";
import { CurrentOrbitComponent } from "./index";

/**
 * DOM snapshots off the stream pipeline, driven by each fixture's own
 * `_stream` block.
 *
 * This spec used to build that stream itself: six orbits declared inline as
 * `{sma, ecc, inc, argPe}`, a `setupStreamFixture` per render, and its own
 * `vessel.orbit`/`vessel.identity`/`system.bodies` emits. The six fixtures next
 * door said the same thing already and are what the playwright probe renders,
 * so the two descriptions of one scenario have been collapsed onto the fixture.
 *
 * The hand-built copy cost two things the shared harness supplies. It never
 * installed a `ResizeObserver` that reports a size, so the diagram, which is
 * gated on a measured box and is the reason five of the seven modes differ at
 * all, was absent from every one of the 42 baselines; and it passed only the
 * per-mode config, so the registered `showDiagram: true` never applied either.
 *
 * What it got RIGHT, and the fixtures did not, is the propagation horizon:
 * `vessel.orbit.horizon` is not nullable on the wire, and a sample without one
 * is read as unpropagatable, so a fixture omitting it asks for an orbit that
 * cannot be drawn. The six fixtures now state it, matching what the stock
 * analytic provider sends.
 */

const FIXTURES: Record<string, Record<string, unknown>> = {
  "circular-lko": circular,
  "eccentric-capture": eccentric,
  "escape-trajectory": escapeTrajectory,
  "polar-orbit": polar,
  "retrograde-orbit": retrograde,
  "sub-orbital": subOrbital,
};

const config = getWidget("current-orbit");
if (!config) throw new Error("current-orbit missing from widgets.ts");

describe("CurrentOrbit DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: CurrentOrbitComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
