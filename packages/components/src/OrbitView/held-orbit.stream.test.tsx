import { DashboardItemContext } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { OrbitViewComponent } from "./index";

/**
 * An orbit that was heard and then stopped arriving, with no model to carry
 * it, is still the last orbit there was: OrbitView draws it held, with the
 * craft held at its last place. An orbit never heard is absence, and draws
 * nothing.
 */
function mount() {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "ov-held" }}>
        <OrbitViewComponent id="ov-held" w={9} h={18} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, ...view };
}

describe("OrbitView: an orbit held with no model", () => {
  it("draws the held orbit and the craft as the held square at its last place, in place of the sentence", async () => {
    const { fixture, container } = mount();
    act(() => {
      fixture.emit("system.bodies", {
        bodies: [{ name: "Kerbin", index: 1, radius: 600000 }],
      });
      fixture.emit("vessel.identity", {
        vesselId: "v1",
        name: "Test Vessel",
        vesselType: 0,
        situation: 3,
        parentBodyIndex: 1,
      });
      // A loaded craft's elements are osculating, so the model declines under physics and nothing carries them once they stop arriving.
      fixture.emit(
        "vessel.orbit",
        {
          referenceBodyIndex: 1,
          sma: 682500,
          ecc: 0.00367,
          inc: 0.3,
          lan: 0,
          argPe: 12.5,
          mu: 3.5316e12,
          horizon: ANALYTIC_UNBOUNDED_HORIZON,
          meanAnomalyAtEpoch: 0,
          epoch: 10,
        },
        { quality: Quality.Loaded },
      );
    });
    const diagram = await screen.findByRole("img", { name: "Orbital diagram" });
    expect(diagram).toHaveAttribute("data-orbit-line", "current");
    expect(screen.queryByText("HELD")).toBeNull();

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });
    const reading = () => fixture.store.sampleReading("vessel.orbit");
    await waitFor(() => expect(reading().state).toBe("held"));
    expect(reading().reckoning.status).not.toBe("available");

    const held = screen.getByRole("img", { name: "Orbital diagram" });
    expect(held).toHaveAttribute("data-orbit-line", "held");
    // The line itself reads as held: the held hue, broken into squares.
    const line = held.querySelector("ellipse");
    expect(line).toHaveAttribute("stroke", "var(--color-warn-mark)");
    expect(line).toHaveAttribute("stroke-dasharray");
    expect(container.querySelector("[data-vessel-mark]")).toHaveAttribute(
      "data-vessel-mark",
      "held",
    );
    expect(screen.getByText("HELD")).toBeInTheDocument();
    expect(
      screen.queryByText(/No coast under physics|No orbital data/),
    ).toBeNull();
    await act(async () => {});
  });

  it("draws nothing and keeps its waiting sentence where no orbit was ever heard", async () => {
    const { fixture, container } = mount();
    act(() => {
      fixture.emit("system.bodies", {
        bodies: [{ name: "Kerbin", index: 1, radius: 600000 }],
      });
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });
    expect(screen.queryByRole("img", { name: "Orbital diagram" })).toBeNull();
    expect(container.querySelector("[data-vessel-mark]")).toBeNull();
    expect(screen.getByText("No orbital data")).toBeInTheDocument();
    expect(screen.queryByText("HELD")).toBeNull();
    await act(async () => {});
  });
});
