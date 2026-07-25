import { clearRegistry, DashboardItemContext } from "@ksp-gonogo/core";
import { render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TransferWindowComponent } from "./index";

const DEG = Math.PI / 180;

// Wire `system.bodies` entries (BodyEntry shape; angles in radians).
const SUN = {
  index: 0,
  name: "Sun",
  gravParameter: 1.32712440018e20,
  radius: 6.957e8,
};
const EARTH = {
  index: 1,
  name: "Earth",
  parentIndex: 0,
  gravParameter: 3.986004418e14,
  radius: 6.371e6,
  orbit: {
    sma: 1.495978707e11,
    ecc: 0,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
  },
};
const MARS = {
  index: 2,
  name: "Mars",
  parentIndex: 0,
  gravParameter: 4.282837e13,
  radius: 3.3895e6,
  orbit: {
    sma: 2.279392e11,
    ecc: 0,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 44.3 * DEG, // ≈ Hohmann ideal at epoch → GO now
    epoch: 0,
  },
};

const VENUS = {
  index: 3,
  name: "Venus",
  parentIndex: 0,
  gravParameter: 3.24859e14,
  radius: 6.0518e6,
  orbit: {
    sma: 1.08208e11,
    ecc: 0,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
  },
};

function setup(targetBodyIndex?: number) {
  const fixture = setupStreamFixture({
    carriedChannels: ["system.bodies", "vessel.orbit", "target.available"],
    pinnedUt: 0,
  });
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "transfer-test" }}>
        <TransferWindowComponent config={{ showPorkchop: true }} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  fixture.emit("system.bodies", { bodies: [SUN, EARTH, MARS, VENUS] });
  // Vessel in a 700 km-ish LEO around Earth (index 1).
  fixture.emit("vessel.orbit", {
    referenceBodyIndex: 1,
    sma: 7.071e6,
    ecc: 0,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
    mu: 3.986004418e14,
  });
  if (targetBodyIndex != null) {
    fixture.emit("target.available", {
      entries: [
        {
          kind: 1, // TargetKind.Body
          name: targetBodyIndex === 3 ? "Venus" : "Mars",
          bodyIndex: targetBodyIndex,
          isCurrent: true,
        },
      ],
    });
  }
  return { fixture, view };
}

afterEach(() => {
  clearRegistry();
});

describe("TransferWindow widget", () => {
  it("renders the Earth→Mars phase status as GO at the ideal phase", async () => {
    setup();
    await waitFor(() => expect(screen.getByText("GO")).toBeInTheDocument());
    // ideal ≈ current ≈ 44.3°
    expect(screen.getByText(/ideal 44\.3°/)).toBeInTheDocument();
  });

  it("shows the ejection readout (Δv, angle, v∞) and the next-window row", async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByText("Ejection Δv")).toBeInTheDocument(),
    );
    expect(screen.getByText("Ejection angle")).toBeInTheDocument();
    expect(screen.getByText("v∞")).toBeInTheDocument();
    expect(screen.getByText("Next window")).toBeInTheDocument();
  });

  it("lets the operator pick the destination (labelled select)", async () => {
    setup();
    const select = await screen.findByLabelText(/Earth →/);
    expect(select).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Mars" })).toBeInTheDocument();
  });

  it("defaults the destination to the current target body (Target API)", async () => {
    setup(3); // Venus targeted via target.available (default sibling would be Mars)
    const select = await screen.findByLabelText(/Earth →/);
    expect((select as HTMLSelectElement).value).toBe("3");
    expect(screen.getByRole("option", { name: "Venus" })).toBeInTheDocument();
  });

  it("renders the porkchop plot", async () => {
    setup();
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: /porkchop plot/i }),
      ).toBeInTheDocument(),
    );
  });

  it("has no axe violations", async () => {
    const { view } = setup();
    await waitFor(() => expect(screen.getByText("GO")).toBeInTheDocument());
    expect(await axe(view.container)).toHaveNoViolations();
  });
});
