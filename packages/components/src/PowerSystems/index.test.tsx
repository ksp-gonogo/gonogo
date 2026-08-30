import {
  clearActionHandlers,
  DashboardItemContext,
  dispatchAction,
} from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { PowerSystemsComponent } from "./index";

// Unmount tracked trees BEFORE clearActionHandlers() (same rationale as
// stream.test.tsx: clearing the registry on a mounted widget is a state
// update outside act()).
const renderedTrees: Array<() => void> = [];
function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}
afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

interface PartResources {
  [name: string]: {
    amount: number;
    maxAmount: number;
    flow?: number;
    nominalFlow?: number;
  };
}

function part(id: string, title: string, resources: PartResources) {
  return {
    id,
    name: id,
    title,
    position: { x: 0, y: 0, z: 0 },
    bounds: { size: { x: 1, y: 1, z: 1 } },
    dryMass: 0.1,
    inverseStage: 0,
    maxTemp: 1200,
    category: "Pods",
    modules: [],
    isRobotics: false,
    isPowerRelated: false,
    resources,
    moduleStates: [],
  };
}

// Two resources with live flow: EC (from a panel) + LiquidFuel (from a tank
// draining into an engine). resourcesWithFlow => ["ElectricCharge","LiquidFuel"].
// NOTE: part `id` must be numeric, the topology adapter does `Number(p.id)`
// for the flightId key (vesselPartsAdapter.ts), so non-numeric ids collide.
const TWO_RESOURCE_WIRE = {
  parts: [
    part("1", "Solar Panel", {
      ElectricCharge: { amount: 10, maxAmount: 100, flow: 5, nominalFlow: 5 },
    }),
    part("2", "Fuel Tank", {
      LiquidFuel: { amount: 200, maxAmount: 400, flow: -2 },
    }),
  ],
};

// Same craft, but LiquidFuel flow has vanished (engine cutoff): only EC flows.
const EC_ONLY_WIRE = {
  parts: [
    part("1", "Solar Panel", {
      ElectricCharge: { amount: 10, maxAmount: 100, flow: 5, nominalFlow: 5 },
    }),
    part("2", "Fuel Tank", {
      LiquidFuel: { amount: 200, maxAmount: 400 },
    }),
  ],
};

// A craft with storage but no flow anywhere.
const NO_FLOW_WIRE = {
  parts: [
    part("1", "Battery", {
      ElectricCharge: { amount: 50, maxAmount: 100 },
    }),
  ],
};

function renderWidget(instanceId: string) {
  const fixture = setupStreamFixture({
    carriedChannels: ["vessel.parts"],
    pinnedUt: 10,
    suspendFrames: true,
  });
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <PowerSystemsComponent id={instanceId} w={8} h={12} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, ...view };
}

describe("PowerSystems: states + resource pick", () => {
  it("shows a hint while vessel topology is unavailable", () => {
    renderWidget("ps-no-topo");
    expect(screen.getByText("Waiting for vessel topology...")).toBeTruthy();
  });

  it("shows the deploy-a-panel hint when no resource has live flow", async () => {
    const { fixture } = renderWidget("ps-no-flow");
    act(() => fixture.emit("vessel.parts", NO_FLOW_WIRE));
    await waitFor(() =>
      expect(screen.getByText("No active flow on any resource")).toBeTruthy(),
    );
    expect(screen.getByText(/Deploy a solar panel/)).toBeTruthy();
  });

  it("cycles the focused resource via the cycleResource action", async () => {
    const { fixture } = renderWidget("ps-cycle");
    act(() => fixture.emit("vessel.parts", TWO_RESOURCE_WIRE));
    await waitFor(() => expect(screen.getByLabelText("Resource")).toBeTruthy());
    const select = screen.getByLabelText("Resource") as HTMLSelectElement;
    expect(select.value).toBe("ElectricCharge");

    act(() => {
      dispatchAction("ps-cycle", "cycleResource", {
        kind: "button",
        value: true,
      });
    });
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Resource") as HTMLSelectElement).value,
      ).toBe("LiquidFuel"),
    );
  });

  it("keeps a deliberately-picked resource when its flow transiently vanishes (RO cutoff)", async () => {
    const { fixture } = renderWidget("ps-sticky");
    act(() => fixture.emit("vessel.parts", TWO_RESOURCE_WIRE));
    await waitFor(() => expect(screen.getByLabelText("Resource")).toBeTruthy());

    // Operator deliberately picks LiquidFuel (via the action = an explicit pick).
    act(() => {
      dispatchAction("ps-sticky", "cycleResource", {
        kind: "button",
        value: true,
      });
    });
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Resource") as HTMLSelectElement).value,
      ).toBe("LiquidFuel"),
    );

    // Engine cuts off: LiquidFuel stops flowing (only EC flows now).
    act(() => fixture.emit("vessel.parts", EC_ONLY_WIRE));

    // The pick MUST survive: it stays LiquidFuel (with a no-flow note), rather
    // than silently resetting to ElectricCharge.
    await waitFor(() =>
      expect(screen.getByText(/No active Liquid Fuel flow/)).toBeTruthy(),
    );
    expect((screen.getByLabelText("Resource") as HTMLSelectElement).value).toBe(
      "LiquidFuel",
    );
  });

  it("has no axe violations", async () => {
    const { fixture, container } = renderWidget("ps-axe");
    act(() => fixture.emit("vessel.parts", TWO_RESOURCE_WIRE));
    await waitFor(() => expect(screen.getByLabelText("Resource")).toBeTruthy());
    await expectNoA11yViolations(container);
  });
});
