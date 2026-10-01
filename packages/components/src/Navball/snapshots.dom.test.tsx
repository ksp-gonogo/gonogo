import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import banked from "./__fixtures__/banked-90-right.json";
import gravityTurn from "./__fixtures__/gravity-turn-east.json";
import inverted from "./__fixtures__/inverted-level.json";
import launchpad from "./__fixtures__/launchpad-vertical.json";
import maneuver from "./__fixtures__/maneuver-burn.json";
import noSasSource from "./__fixtures__/no-sas-source.json";
import north from "./__fixtures__/north-level.json";
import progradeLevel from "./__fixtures__/prograde-east-level.json";
import sasWireOnly from "./__fixtures__/sas-wire-only.json";
import steepDive from "./__fixtures__/steep-dive-west.json";
import uncontrollable from "./__fixtures__/uncontrollable-drift.json";
import { NavballComponent } from "./index";

const FIXTURES: Record<string, Record<string, unknown>> = {
  "launchpad-vertical": launchpad,
  "prograde-east-level": progradeLevel,
  "gravity-turn-east": gravityTurn,
  "banked-90-right": banked,
  "inverted-level": inverted,
  "steep-dive-west": steepDive,
  "maneuver-burn": maneuver,
  "uncontrollable-drift": uncontrollable,
  "north-level": north,
  "sas-wire-only": sasWireOnly,
  "no-sas-source": noSasSource,
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
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
