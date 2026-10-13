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
  it("names the ladder position of the strength sent to the command centre", async () => {
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
      expect(screen.getByText("Data-rate ladder position")).toBeTruthy(),
    );
    expect(screen.queryByText(/range left/)).toBeNull();
    await expectNoA11yViolations(container);
  });

  it("names the craft's own quantity on the headline's tooltip while the active route's strength is awaited", async () => {
    const { fixture } = mount();

    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("vessel.comms", {
        connected: true,
        signalStrength: 0.6,
        signalQuantity: SignalQuantity.DataRateHeadroom,
      });
    });

    await waitFor(() =>
      expect(
        [...document.querySelectorAll("[data-tooltip]")].map((el) =>
          el.getAttribute("data-tooltip"),
        ),
      ).toContain(
        "The craft's own radio reports 60 % (data-rate ladder position), on the route it was using. The strength of the active route has not arrived yet",
      ),
    );
  });

  it("draws no strength row for KSP's own signal strength, the headline already reads it", async () => {
    const { fixture } = mount();

    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("vessel.comms", {
        connected: true,
        signalStrength: 0.6,
        signalQuantity: SignalQuantity.RangeFraction,
      });
      fixture.emit("comms.signal", {
        strength: 0.6,
        quantity: SignalQuantity.RangeFraction,
        modelled: false,
        otherPath: false,
      });
    });

    await waitFor(() => expect(screen.getByText("Control")).toBeTruthy());
    expect(screen.queryByText("Strength")).toBeNull();
    expect(screen.queryByText(/range left/)).toBeNull();
    expect(screen.getByText("Signal connected")).toBeTruthy();
    expect(document.body.textContent).toMatch(/60\s*%/);
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
  it("words only the quantities the headline figure does not already say", () => {
    expect(describeQuantity(SignalQuantity.RangeFraction)).toBeNull();
    expect(describeQuantity(SignalQuantity.DataRateHeadroom)).toBe(
      "Data-rate ladder position",
    );
    expect(describeQuantity(SignalQuantity.NoModel)).toBe("Not modelled");
    expect(describeQuantity(SignalQuantity.Unknown)).toBeNull();
    expect(describeQuantity(undefined)).toBeNull();
  });
});
