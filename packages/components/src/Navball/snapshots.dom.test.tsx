/**
 * Widget-level DOM snapshots — complements the dial-only SVG snapshot
 * in `snapshots.test.ts` by covering the full Navball widget (header,
 * mode badges, dial, throttle column, control surface) across every
 * registered mode. The matching PNG renders live in
 * `local_docs/renders/navball-widget/`.
 *
 * Re-seed with `vitest run -u src/Navball/snapshots.dom.test`.
 */
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import banked from "./__fixtures__/banked-90-right.json";
import gravityTurn from "./__fixtures__/gravity-turn-east.json";
import inverted from "./__fixtures__/inverted-level.json";
import launchpad from "./__fixtures__/launchpad-vertical.json";
import maneuver from "./__fixtures__/maneuver-burn.json";
import north from "./__fixtures__/north-level.json";
import progradeLevel from "./__fixtures__/prograde-east-level.json";
import steepDive from "./__fixtures__/steep-dive-west.json";
import uncontrollable from "./__fixtures__/uncontrollable-drift.json";
import { NavballComponent } from "./index";

const FIXTURES = {
  "launchpad-vertical": launchpad,
  "prograde-east-level": progradeLevel,
  "gravity-turn-east": gravityTurn,
  "banked-90-right": banked,
  "inverted-level": inverted,
  "steep-dive-west": steepDive,
  "maneuver-burn": maneuver,
  "uncontrollable-drift": uncontrollable,
  "north-level": north,
};

const config = getWidget("navball");
if (!config) throw new Error("navball missing from widgets.ts");

describe("Navball widget DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: NavballComponent,
          fixture,
          mode,
          // Navball uses useDataStreamStatus — connect the raw
          // MockDataSource so its rendered status badge reflects the
          // realistic "connected, streaming" scenario every one of these
          // fixtures actually depicts, instead of the shared harness's
          // opt-out-by-default "disconnected" convention (see
          // setupMockDataSource.ts's connectSource doc comment, and
          // WarpControl/snapshots.test.tsx for the precedent).
          connectSource: true,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
