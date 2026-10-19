import {
  clearActionHandlers,
  dispatchAction,
  PerfBudget,
} from "@ksp-gonogo/core";
import { act, waitFor } from "@ksp-gonogo/test-utils";
import {
  expectNoA11yViolations,
  renderWidget,
} from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import "./index";

beforeEach(() => {
  PerfBudget.getAll()
    .find((b) => b.name.startsWith("useActionInput register"))
    ?.reset();
});

afterEach(() => clearActionHandlers());

function part(id: string, resources: Record<string, unknown>) {
  return {
    id,
    name: `part${id}`,
    title: `Part ${id}`,
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

const EC = (flow: number) => ({
  ElectricCharge: { amount: 10, maxAmount: 100, flow, nominalFlow: flow },
});

function essentialTexts(): string[] {
  return [...document.querySelectorAll("[data-tiny-essential]")].map(
    (e) => e.textContent ?? "",
  );
}

function mountTiny() {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  const mounted = renderWidget("power-systems", {
    w: 3,
    h: 3,
    instanceId: "ps-tiny",
    wrapper: fixture.Provider,
  });
  return { ...mounted, fixture };
}

describe("PowerSystems tiny mode", () => {
  it("draws the net rate of the picked resource below four columns", async () => {
    const { container, fixture } = mountTiny();
    act(() => {
      fixture.emit("vessel.parts", {
        parts: [part("1", EC(5)), part("2", EC(-2))],
      });
    });
    await waitFor(() => expect(essentialTexts()[0]).toMatch(/NET\s*3\s*EC\/s/));
    expect(essentialTexts()[0]).toContain("EC NET");
    await expectNoA11yViolations(container);
  });

  it("says no flow when nothing on the vessel reports one", async () => {
    const { fixture } = mountTiny();
    act(() => {
      fixture.emit("vessel.parts", { parts: [part("1", {})] });
    });
    await waitFor(() => expect(essentialTexts()[0]).toContain("NO FLOW"));
    await act(async () => {});
  });

  it("keeps the next-resource input live at the tiny size", async () => {
    const { fixture } = mountTiny();
    act(() => {
      fixture.emit("vessel.parts", {
        parts: [
          part("1", {
            ...EC(5),
            LiquidFuel: {
              amount: 10,
              maxAmount: 100,
              flow: -1,
              nominalFlow: -1,
            },
          }),
        ],
      });
    });
    await waitFor(() => expect(essentialTexts()[0]).toContain("EC NET"));
    let result: unknown;
    act(() => {
      result = dispatchAction("ps-tiny", "cycle-resource", {
        kind: "button",
        value: true,
      });
    });
    expect(result).toEqual({ resource: "LiquidFuel" });
    await waitFor(() =>
      expect(essentialTexts()[0]).toContain("Liquid Fuel NET"),
    );
  });

  it("draws the body from four columns", async () => {
    const { unmount, fixture } = mountTiny();
    unmount();
    renderWidget("power-systems", { w: 4, h: 3, wrapper: fixture.Provider });
    act(() => {
      fixture.emit("vessel.parts", { parts: [part("1", EC(5))] });
    });
    await waitFor(() => expect(document.body.textContent).toContain("5.00"));
    expect(document.querySelector("[data-tiny-essential]")).toBeNull();
  });
});
