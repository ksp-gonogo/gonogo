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
      expect(screen.getByText("Fraction of data-rate headroom")).toBeTruthy(),
    );
    expect(screen.queryByText("Fraction of range")).toBeNull();
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
      expect(screen.getByText("Fraction of range")).toBeTruthy(),
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
  it("has a word for each quantity a backend can declare and none for unknown", () => {
    expect(describeQuantity(SignalQuantity.RangeFraction)).toBe(
      "Fraction of range",
    );
    expect(describeQuantity(SignalQuantity.DataRateHeadroom)).toBe(
      "Fraction of data-rate headroom",
    );
    expect(describeQuantity(SignalQuantity.NoModel)).toBe("Not modelled");
    expect(describeQuantity(SignalQuantity.Unknown)).toBeNull();
    expect(describeQuantity(undefined)).toBeNull();
  });
});
