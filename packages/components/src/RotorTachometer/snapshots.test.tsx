import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import rotors from "./__fixtures__/rotors.json";
import unavailable from "./__fixtures__/unavailable.json";
import { RotorTachometerComponent } from "./index";

const FIXTURES = {
  rotors,
  unavailable,
};

const config = getWidget("rotor-tachometer");
if (!config) throw new Error("rotor-tachometer missing from widgets.ts");

describe("RotorTachometer DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: RotorTachometerComponent,
          fixture,
          mode,
          // RotorTachometer uses useDataStreamStatus — connect the raw
          // MockDataSource so the rendered status badge reflects "connected,
          // streaming" rather than the shared
          // harness's opt-out-by-default "disconnected" convention (see
          // setupMockDataSource.ts's connectSource doc comment, and
          // FuelStatus/snapshots.test.tsx for the precedent).
          connectSource: true,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
