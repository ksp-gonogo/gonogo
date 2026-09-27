import {
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
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CommSignalComponent } from "./index";

// Unmounted before `clearAugments()`, which would otherwise notify a mounted slot outside act().
const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

function unmountAll() {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
}

// The `comm-signal.sections` slot is empty by default and composes a registered augment.
const CARRIED = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
  "comms.delay",
];

function renderWithSignal() {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
    suspendFrames: true,
  });
  const utils = render(
    <fixture.Provider>
      <WidgetMetaContext.Provider
        value={{ componentId: "comm-signal", contributionSlots: [] }}
      >
        <DashboardItemContext.Provider value={{ instanceId: "comm-slot" }}>
          <CommSignalComponent id="comm-slot" w={6} h={5} />
        </DashboardItemContext.Provider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.orbit", {
      sma: 680000,
      ecc: 0.0,
      inc: 0.0,
      argPe: 0.0,
      mu: 3.5316e12,
      meanAnomalyAtEpoch: 0,
      epoch: 10,
      referenceBodyIndex: 1,
    });
    fixture.emit("vessel.comms", {
      connected: true,
      signalStrength: 0.87,
      controlState: 4,
    });
    fixture.emit("comms.delay", { oneWaySeconds: 0.0004 });
  });
  return { fixture, ...utils };
}

afterEach(() => {
  unmountAll();
  clearAugments();
});

describe("CommSignal: augment slots", () => {
  it("declares the slot empty by default and renders its own readout unchanged", async () => {
    expect(getAugmentsForSlot("comm-signal.sections")).toHaveLength(0);

    renderWithSignal();

    await waitFor(() => expect(visibleText()).toContain("87 %"));
    expect(screen.getByLabelText("Signal 4 of 4")).toBeTruthy();
    expect(screen.getByText("Full")).toBeTruthy();
  });

  it("composes a registered augment into the body sections slot", async () => {
    registerAugment({
      id: "test-comm-sections",
      augments: "comm-signal.sections",
      component: () => <div data-testid="ra-breakdown">RA breakdown</div>,
    });

    renderWithSignal();

    await waitFor(() =>
      expect(screen.getByTestId("ra-breakdown")).toBeInTheDocument(),
    );
    expect(screen.getByText("RA breakdown")).toBeInTheDocument();
  });
});
