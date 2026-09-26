import type { DataKey } from "@ksp-gonogo/core";
import {
  clearActionHandlers,
  clearAugments,
  DashboardItemContext,
  getAugmentsForSlot,
  registerAugment,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { useWidgetScope } from "@ksp-gonogo/ui-kit";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { PowerSystemsComponent } from "./index";

// Unmount before clearing the registries: RTL's auto-cleanup runs after afterEach, and clearing a mounted widget updates state outside act().
const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

/** An empty `power-systems.sections` slot renders cleanly, and a registered augment appears and reads the widget's resource focus from its scope. */

const KEYS: DataKey[] = [
  { key: "r.resource[ElectricCharge]" },
  { key: "parts.power" },
];

const VESSEL_PARTS_WIRE = {
  parts: [
    {
      id: "1",
      name: "probeCore",
      title: "Probe Core",
      position: { x: 0, y: 0, z: 0 },
      bounds: { size: { x: 1, y: 1, z: 1 } },
      dryMass: 0.1,
      inverseStage: 0,
      maxTemp: 1200,
      category: "Pods",
      modules: [],
      isRobotics: false,
      isPowerRelated: false,
      resources: {
        ElectricCharge: { amount: 10, maxAmount: 100, flow: 5, nominalFlow: 5 },
      },
      moduleStates: [],
    },
  ],
};

// Drives the widget to its full-list layout, where the `sections` body slot renders.
async function renderFullList() {
  const streamFixture = setupStreamFixture({
    carriedChannels: ["vessel.parts"],
    pinnedUt: 10,
    suspendFrames: true,
  });
  const legacyAux = await setupMockDataSource({
    id: "data",
    keys: KEYS,
    connectSource: true,
  });
  render(
    <streamFixture.Provider>
      {/* `Panel` completes `${componentId}.${segment}` from this identity for its universal seams. */}
      <WidgetMetaContext.Provider
        value={{ componentId: "power-systems", contributionSlots: [] }}
      >
        <DashboardItemContext.Provider value={{ instanceId: "ps-slot" }}>
          <PowerSystemsComponent id="ps-slot" w={8} h={12} />
        </DashboardItemContext.Provider>
      </WidgetMetaContext.Provider>
    </streamFixture.Provider>,
  );
  act(() => {
    streamFixture.emit("vessel.parts", VESSEL_PARTS_WIRE);
  });
  await waitFor(() => expect(screen.getByText("PROD")).toBeTruthy());
  return legacyAux;
}

describe("PowerSystems: augment slots", () => {
  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    clearActionHandlers();
    clearAugments();
  });

  it("exposes its slot on the component definition", () => {
    expect(getAugmentsForSlot("power-systems.sections")).toEqual([]);
  });

  it("renders the full list with no augment bound (an empty slot is inert)", async () => {
    const fixture = await renderFullList();
    expect(screen.getByText("Producers")).toBeTruthy();
    expect(screen.getByText("Consumers")).toBeTruthy();
    expect(screen.queryByTestId("ps-section-augment")).toBeNull();
    teardownMockDataSource(fixture);
  });

  it("renders a test augment bound to the sections slot, which reads the focused resource from the widget's scope", async () => {
    // The slot is propless; the focused resource reaches the augment through the widget's scope.
    function SectionAugment() {
      const resource = useWidgetScope("power-systems")?.resource;
      return <div data-testid="ps-section-augment">EC-BROKER: {resource}</div>;
    }
    const fixture = await renderFullList();

    act(() => {
      registerAugment({
        id: "test-ps-section",
        augments: "power-systems.sections",
        component: SectionAugment,
      });
    });

    const augment = await screen.findByTestId("ps-section-augment");
    expect(augment).toBeTruthy();
    expect(augment.textContent).toBe("EC-BROKER: ElectricCharge");
    teardownMockDataSource(fixture);
  });
});
