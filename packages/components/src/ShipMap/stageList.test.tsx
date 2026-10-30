import type { VesselTopology } from "@ksp-gonogo/core";
import { getComponent } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { topologyToVesselPartsWire } from "../test/topologyToVesselPartsWire";
import {
  flushResizeObservers,
  installSizedResizeObserver,
} from "../test/widgetDomSnapshot";
import fuellinePrelaunch from "./__fixtures__/fuelline-tester-22parts-prelaunch.json";
import { ShipMapComponent } from "./index";
import { STAGE_COLUMN_MIN_WIDGET_WIDTH } from "./StageColumn";

const WIRE = topologyToVesselPartsWire(
  fuellinePrelaunch["v.topology"] as VesselTopology,
  new Map(),
);

let restoreObserver: (() => void) | undefined;

afterEach(() => {
  restoreObserver?.();
  restoreObserver = undefined;
});

async function mountAtWidth(width: number, columns = 8) {
  restoreObserver = installSizedResizeObserver({ w: width, h: 500 });
  const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
  const { container } = render(
    <fixture.Provider>
      <ShipMapComponent id="ship-map-width" w={columns} h={10} />
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.parts", WIRE);
    fixture.emit("vessel.structure", { currentStage: 0 });
  });
  await waitFor(() =>
    expect(screen.getByRole("region", { name: "Staging" })).toBeTruthy(),
  );
  await flushResizeObservers();
  return container;
}

describe("Ship Map by tile size", () => {
  it("shows the stage list alone at five columns, with the next stage marked", async () => {
    const container = await mountAtWidth(185, 5);

    expect(screen.queryByLabelText("Ship diagram")).toBeNull();
    expect(screen.getByRole("region", { name: "Staging" })).toBeTruthy();
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(screen.getAllByText("Next")).toHaveLength(1);
    await expectNoA11yViolations(container);
  });

  it("shows the diagram alone from six columns, however narrow the tile is", async () => {
    const container = await mountAtWidth(189, 6);

    expect(screen.getByLabelText("Ship diagram")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Staging" })).toBeNull();
    await expectNoA11yViolations(container);
  });

  it("shows the diagram and the stage list together once the tile is wide enough", async () => {
    const container = await mountAtWidth(STAGE_COLUMN_MIN_WIDGET_WIDTH);

    expect(screen.getByLabelText("Ship diagram")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Staging" })).toBeTruthy();
    await expectNoA11yViolations(container);
  });
});

describe("Ship Map in the picker", () => {
  it("is added 12 columns wide, so a fresh tile shows the diagram and the stage list", () => {
    expect(getComponent("ship-map")?.defaultSize).toEqual({ w: 12, h: 10 });
  });

  it("is found by a search for staging or stages", () => {
    const tags = getComponent("ship-map")?.tags ?? [];
    expect(tags).toContain("staging");
    expect(tags).toContain("stages");
  });
});
