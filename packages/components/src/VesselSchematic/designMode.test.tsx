import type { VesselTopology } from "@ksp-gonogo/core";
import { registerUplinkTopic, wrapTopicPayload } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { topologyToVesselPartsWire } from "../test/topologyToVesselPartsWire";
import fuellinePrelaunch from "./__fixtures__/fuelline-tester-22parts-prelaunch.json";
import { VesselSchematicComponent } from "./index";

/*
 * The Schematic draws the editor craft while design mode is on, and the
 * flying vessel otherwise, with nothing set in its config. The mode line
 * marks the screen, so the widget carries no design tag of its own.
 */

const PARTS = topologyToVesselPartsWire(
  fuellinePrelaunch["v.topology"] as VesselTopology,
  new Map(),
);

const DESIGN_PARTS = "design.editor.parts";
// The design Uplink registers its Topic when it loads; nothing loads it here.
registerUplinkTopic(DESIGN_PARTS);
// The design Uplink's Topic carries the vessel.parts row with its units, which its own contract declares.
const DESIGN_PAYLOAD = wrapTopicPayload(
  "vessel.parts",
  structuredClone(PARTS) as never,
);

const diagram = () => screen.queryByLabelText("Ship diagram");

function mount(scene: "Editor" | "Flight") {
  const fixture = setupStreamFixture({ pinnedUt: 0 });
  render(
    <fixture.Provider>
      <VesselSchematicComponent id="vessel-schematic-design" w={8} h={10} />
    </fixture.Provider>,
  );
  act(() => fixture.emit("spaceCenter.scene", { scene }));
  return fixture;
}

describe("VesselSchematic follows the active mode", () => {
  it("draws the editor craft in design mode, under the plain title", async () => {
    const fixture = mount("Editor");
    await waitFor(() =>
      expect(fixture.transport.isSubscribed(DESIGN_PARTS)).toBe(true),
    );
    act(() => fixture.emit(DESIGN_PARTS, DESIGN_PAYLOAD));
    await waitFor(() => expect(diagram()).toBeTruthy());
    expect(screen.getByText("VESSEL SCHEMATIC")).toBeTruthy();
    expect(screen.queryByText(/design/i)).toBeNull();
  });

  it("draws the flying vessel in flight, not the editor craft", async () => {
    const fixture = mount("Flight");
    await act(async () => {});
    expect(fixture.transport.isSubscribed(DESIGN_PARTS)).toBe(false);
    act(() => fixture.emit("vessel.parts", PARTS));
    await waitFor(() => expect(diagram()).toBeTruthy());
  });
});
