import { clearRegistry, DashboardItemContext } from "@ksp-gonogo/core";
import { fireEvent, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
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
    meanAnomalyAtEpoch: 44.3 * DEG, // ≈ Hohmann ideal at epoch → ideal now
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
  renderedTrees.push(view.unmount);
  return { fixture, view };
}

// Rendered trees, tracked so afterEach can unmount them BEFORE clearRegistry()
// notifies the DataSource-registry subscribers: every useTelemetry call
// keeps its legacy useDataSourceSubscription wired unconditionally, so
// clearRegistry() firing on a still-mounted widget is a state update outside
// act(). RTL auto-cleanup runs after this file's afterEach, too late to
// unmount first.
const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearRegistry();
});

describe("TransferWindow widget", () => {
  it("shows the live current-phase dial readout + status badge", async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByText("Current phase")).toBeInTheDocument(),
    );
    expect(screen.getByText("IDEAL")).toBeInTheDocument(); // status badge
    expect(visibleText()).toMatch(/ideal 44\.3°/);
  });

  it("lists several upcoming windows to the target", async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByText("Windows to Mars")).toBeInTheDocument(),
    );
    // one selectable row per upcoming window (WINDOW_COUNT of them)
    expect(
      screen.getAllByRole("button", { name: /in |now/i }).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("expands the selected window's detail (window 0 selected by default)", async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByText("Windows to Mars")).toBeInTheDocument(),
    );
    expect(screen.getByText("Departs")).toBeInTheDocument();
    expect(screen.getByText("Ejection Δv")).toBeInTheDocument();
    expect(screen.getByText("Ejection angle")).toBeInTheDocument();
  });

  it("selecting another window expands it (list drives the selection)", async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByText("Windows to Mars")).toBeInTheDocument(),
    );
    // window 0 is expanded by default; the rest are collapsed window-row buttons
    const collapsed = screen.getAllByRole("button", { expanded: false });
    expect(collapsed.length).toBeGreaterThan(0);
    fireEvent.click(collapsed[0]);
    expect(collapsed[0]).toHaveAttribute("aria-expanded", "true");
  });

  it("lets the operator pick the destination (labelled select)", async () => {
    setup();
    const select = await screen.findByLabelText(/Earth to/);
    expect(select).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Mars" })).toBeInTheDocument();
  });

  it("defaults the destination to the current target body (Target API)", async () => {
    setup(3); // Venus targeted via target.available (default sibling would be Mars)
    const select = await screen.findByLabelText(/Earth to/);
    expect((select as HTMLSelectElement).value).toBe("3");
    expect(screen.getByRole("option", { name: "Venus" })).toBeInTheDocument();
  });

  it("renders the Δv map", async () => {
    setup();
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: /Δv contour/i }),
      ).toBeInTheDocument(),
    );
  });

  it("shows a Δv-map cell's details on hover (the inspector)", async () => {
    const { view } = setup();
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: /Δv contour/i }),
      ).toBeInTheDocument(),
    );
    const rect = view.container.querySelector(".porkchop-cell");
    expect(rect).not.toBeNull();
    if (!rect) return;
    fireEvent.mouseEnter(rect);
    expect(screen.getByText(/Departs \+/)).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { view } = setup();
    await waitFor(() => expect(screen.getByText("IDEAL")).toBeInTheDocument());
    expect(await axe(view.container)).toHaveNoViolations();
  });
});
