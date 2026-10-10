import { DashboardItemContext } from "@ksp-gonogo/core";
import { SignalQuantity } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CommSignalComponent } from "./index";
import { describeQuantity } from "./signalVerdict";

function mount() {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "comm-quantity" }}>
        <CommSignalComponent id="comm-quantity" w={6} h={5} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, container: view.container };
}

describe("CommSignal says which quantity the strength is", () => {
  it("names the quantity of the strength sent to the command centre", async () => {
    const { fixture, container } = mount();

    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("vessel.comms", {
        connected: true,
        signalStrength: 0.6,
        signalQuantity: SignalQuantity.RangeFraction,
      });
      fixture.emit("comms.signal", {
        strength: 0.4,
        quantity: SignalQuantity.DataRateHeadroom,
        modelled: false,
        otherPath: false,
      });
    });

    await waitFor(() =>
      expect(screen.getByText("40% data-rate headroom")).toBeTruthy(),
    );
    expect(screen.queryByText("60% of range left")).toBeNull();
    await expectNoA11yViolations(container);
  });

  it("names the craft's own quantity until the centre is sent a strength", async () => {
    const { fixture } = mount();

    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("vessel.comms", {
        connected: true,
        signalStrength: 0.6,
        signalQuantity: SignalQuantity.RangeFraction,
      });
    });

    await waitFor(() =>
      expect(screen.getByText("60% of range left")).toBeTruthy(),
    );
  });

  it("draws no row where nothing says which quantity it is", async () => {
    const { fixture } = mount();

    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("vessel.comms", {
        connected: true,
        signalStrength: 0.6,
        signalQuantity: SignalQuantity.Unknown,
      });
    });

    await waitFor(() => expect(screen.getByText("Control")).toBeTruthy());
    expect(screen.queryByText("Strength")).toBeNull();
  });
});

describe("describeQuantity", () => {
  it("states the figure with what it measures, and nothing for unknown", () => {
    expect(describeQuantity(SignalQuantity.RangeFraction, 0.62)).toBe(
      "62% of range left",
    );
    expect(describeQuantity(SignalQuantity.DataRateHeadroom, 0.62)).toBe(
      "62% data-rate headroom",
    );
    expect(describeQuantity(SignalQuantity.RangeFraction, null)).toBeNull();
    expect(describeQuantity(SignalQuantity.NoModel, 1)).toBe("Not modelled");
    expect(describeQuantity(SignalQuantity.Unknown, 0.5)).toBeNull();
    expect(describeQuantity(undefined, 0.5)).toBeNull();
  });
});
