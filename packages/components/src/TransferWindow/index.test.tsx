import {
  clearActionHandlers,
  clearRegistry,
  DashboardItemContext,
  dispatchAction,
} from "@ksp-gonogo/core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TransferWindowComponent } from "./index";

const DEG = Math.PI / 180;

// Wire `trackingStation.bodies` entries (BodyEntry shape; angles in radians).
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

function setup(targetBodyIndex?: number, opts?: { budgetDvVac?: number }) {
  const fixture = setupStreamFixture({
    pinnedUt: 0,
    suspendFrames: true,
  });
  // A fixture with no propagation provider refuses the body-state ask, so the grid falls back to the client's own conic without a hanging dispatch.
  fixture.transport.setCommandHandler(() => ({
    solved: false,
    refusal: "this fixture elects no propagation provider",
  }));
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "transfer-test" }}>
        <TransferWindowComponent
          id="transfer-test"
          config={{ showPorkchop: true }}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  // Inside `act`: the fixture's clock is suspended, so each emit publishes and renders on the spot.
  act(() => {
    fixture.emit("trackingStation.bodies", {
      bodies: [SUN, EARTH, MARS, VENUS],
    });
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
    if (opts?.budgetDvVac != null) {
      fixture.emit("dv.summary", {
        stageCount: 2,
        totalDvVac: opts.budgetDvVac,
      });
    }
  });
  renderedTrees.push(view.unmount);
  return { fixture, view };
}

// Unmounted before clearRegistry, whose notification on a mounted widget lands outside act().
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

  it("announces the window verdict and never the streaming phase figure", async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByText("Current phase")).toBeInTheDocument(),
    );
    expect(screen.getByText("IDEAL").closest("[aria-live]")).not.toBeNull();
    expect(screen.getByText("Current phase").closest("[aria-live]")).toBeNull();
    for (const region of document.querySelectorAll("[aria-live]")) {
      expect(region.textContent).not.toMatch(/°/);
    }
  });

  it("lists several upcoming windows to the target", async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByText(/^Windows to$/)).toBeInTheDocument(),
    );
    // One selectable row per upcoming window.
    expect(
      screen.getAllByRole("button", { name: /in |now/i }).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("expands the selected window's detail (window 0 selected by default)", async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByText(/^Windows to$/)).toBeInTheDocument(),
    );
    expect(screen.getByText("Departs")).toBeInTheDocument();
    expect(screen.getByText("Ejection Δv")).toBeInTheDocument();
    expect(screen.getByText("Ejection angle")).toBeInTheDocument();
  });

  it("selecting another window expands it (list drives the selection)", async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByText(/^Windows to$/)).toBeInTheDocument(),
    );
    // Window 0 is expanded by default; the rest are collapsed window-row buttons.
    const collapsed = screen.getAllByRole("button", { expanded: false });
    expect(collapsed.length).toBeGreaterThan(0);
    fireEvent.click(collapsed[0]);
    expect(collapsed[0]).toHaveAttribute("aria-expanded", "true");
    // Selecting a window re-asks for the body states, answered after the body returns, so the scope is held open across it.
    await act(async () => {});
  });

  it("lets the operator pick the destination (labelled select)", async () => {
    setup();
    const select = await screen.findByLabelText(/Windows to/);
    expect(select).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Mars" })).toBeInTheDocument();
  });

  it("defaults the destination to the current target body (Target API)", async () => {
    setup(3); // Venus targeted via target.available (default sibling would be Mars)
    const select = await screen.findByLabelText(/Windows to/);
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
    await expectNoA11yViolations(view.container);
  });
});

describe("TransferWindow reach list", () => {
  it("lists every sibling destination with a cost, cheapest first", async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByText("Reach from Earth")).toBeInTheDocument(),
    );
    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    const names = rows.map((r) => r.textContent ?? "");
    expect(names.some((t) => t.includes("Mars"))).toBe(true);
    expect(names.some((t) => t.includes("Venus"))).toBe(true);
  });

  // With a budget on the wire the verdict column must appear AND carry a real verdict.
  it("renders a verdict per destination once a budget is on the wire", async () => {
    setup(undefined, { budgetDvVac: 6000 });
    await waitFor(() =>
      expect(screen.getByText("Affords")).toBeInTheDocument(),
    );
    // This budget straddles the band: Mars reads GO and Venus ONE WAY (reachable, but not with a capture burn).
    expect(screen.getByText("GO")).toBeInTheDocument();
    expect(screen.getByText("ONE WAY")).toBeInTheDocument();
    expect(visibleText()).toMatch(/Budget/);
    expect(visibleText()).toMatch(/6,?000 m\/s/);
  });

  it("distinguishes cannot-afford from no-verdict: one is a NO, the other has no column", async () => {
    setup(undefined, { budgetDvVac: 500 });
    await waitFor(() =>
      expect(screen.getByText("Affords")).toBeInTheDocument(),
    );
    // A computed NO renders as one.
    expect(screen.getAllByText("NO").length).toBeGreaterThanOrEqual(1);
  });

  it("drops the verdict column entirely when no budget has arrived, keeping the costs", async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByText("Reach from Earth")).toBeInTheDocument(),
    );
    // No budget: no verdict column, and no placeholder inviting one.
    expect(screen.queryByText("Affords")).not.toBeInTheDocument();
    expect(screen.queryByText("GO")).not.toBeInTheDocument();
    // The costs and windows are still fully useful without it.
    expect(screen.getByText("Δv needed")).toBeInTheDocument();
    expect(screen.getByText("Window")).toBeInTheDocument();
  });

  it("marks a held budget through its figure, with no written age", async () => {
    const { fixture, view } = setup(undefined, { budgetDvVac: 6000 });
    await waitFor(() => expect(screen.getByText("GO")).toBeInTheDocument());
    const budgetFigure = () =>
      screen
        .getByText("Budget")
        .parentElement?.querySelector("[data-unit-currency]") ?? null;
    expect(budgetFigure()).toBeNull();

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    await waitFor(() => expect(budgetFigure()).not.toBeNull());
    expect(
      screen.getByText("Budget").parentElement?.querySelector("[data-held]"),
    ).not.toBeNull();
    expect(visibleText(view.container)).not.toMatch(/last heard|ago\b/i);
  });

  it("names the ISP assumption and the capture convention on screen", async () => {
    setup(undefined, { budgetDvVac: 6000 });
    await waitFor(() =>
      expect(screen.getByText("Affords")).toBeInTheDocument(),
    );
    expect(visibleText()).toMatch(/vac/);
    expect(visibleText()).toMatch(/plane change not included/i);
  });

  it("has no accessibility violations with the reach list populated", async () => {
    const { view } = setup(undefined, { budgetDvVac: 6000 });
    await waitFor(() =>
      expect(screen.getByText("Affords")).toBeInTheDocument(),
    );
    await expectNoA11yViolations(view.container);
  });
});

describe("TransferWindow reach list: a budget that is not a figure", () => {
  // The Budget slot holds the no-data token and the reason is its tip; the tile carries no sentence about the game.
  const budgetToken = () =>
    screen.getByText("Budget").parentElement?.querySelector("[data-tooltip]");
  const noDeltaVSentence = () => {
    expect(visibleText()).not.toMatch(/No Δv figure/i);
    expect(visibleText()).not.toMatch(/stock simulation/i);
    for (const status of screen.queryAllByRole("status")) {
      expect(status.textContent).not.toMatch(/Δv|delta-v/i);
    }
  };

  it("confirmed absent: shows the token with the reason as its tip, keeps the costs, offers no verdict", async () => {
    const { fixture } = setup();
    await waitFor(() =>
      expect(screen.getByText("Reach from Earth")).toBeInTheDocument(),
    );
    act(() => {
      fixture.emit("dv.summary", null);
    });

    await waitFor(() =>
      expect(budgetToken()?.getAttribute("data-tooltip")).toBe(
        "The game has no delta-v figure for this craft right now, so destinations show cost only",
      ),
    );
    expect(budgetToken()?.textContent).toBe(NULL_DISPLAY);
    noDeltaVSentence();
    expect(screen.queryByText("Affords")).not.toBeInTheDocument();
    expect(screen.queryByText("NO")).not.toBeInTheDocument();
    // The costs and windows do not depend on the budget, so they stay.
    expect(screen.getByText("Δv needed")).toBeInTheDocument();
  });

  it("not heard yet: shows the token and says it is waiting, never that the game has none", async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByText("Reach from Earth")).toBeInTheDocument(),
    );

    expect(budgetToken()?.getAttribute("data-tooltip")).toBe(
      "Waiting for the craft's delta-v",
    );
    expect(budgetToken()?.textContent).toBe(NULL_DISPLAY);
    noDeltaVSentence();
    expect(screen.queryByText("Affords")).not.toBeInTheDocument();
  });

  it("a summary whose total is not a number: shows the token with its own tip, not nothing", async () => {
    const { fixture } = setup();
    await waitFor(() =>
      expect(screen.getByText("Reach from Earth")).toBeInTheDocument(),
    );
    act(() => {
      fixture.emit("dv.summary", { stageCount: 2, totalDvVac: null });
    });

    await waitFor(() =>
      expect(budgetToken()?.getAttribute("data-tooltip")).toBe(
        "The game returned a delta-v figure that cannot be used, so destinations show cost only",
      ),
    );
    expect(budgetToken()?.textContent).toBe(NULL_DISPLAY);
    noDeltaVSentence();
    expect(screen.queryByText("Affords")).not.toBeInTheDocument();
  });

  it("a figure: shows it, with no token", async () => {
    setup(undefined, { budgetDvVac: 6000 });
    await waitFor(() =>
      expect(screen.getByText("Affords")).toBeInTheDocument(),
    );
    expect(screen.getByText("Budget").parentElement?.textContent).not.toContain(
      NULL_DISPLAY,
    );
    expect(visibleText()).toMatch(/Budget.*6[, ]?000/);
  });

  it("has no accessibility violations for each state of the budget", async () => {
    const { fixture, view } = setup();
    await waitFor(() =>
      expect(screen.getByText("Reach from Earth")).toBeInTheDocument(),
    );
    await expectNoA11yViolations(view.container);
    act(() => {
      fixture.emit("dv.summary", null);
    });
    await waitFor(() => expect(budgetToken()).not.toBeNull());
    await expectNoA11yViolations(view.container);
    act(() => {
      fixture.emit("dv.summary", { stageCount: 2, totalDvVac: null });
    });
    await expectNoA11yViolations(view.container);
  });
});

describe("TransferWindow layout: origin-based, not destination-based", () => {
  // The reach list answers "where can I go", so it comes BEFORE the destination picker in document order.
  it("puts REACH above the windows list in document order", async () => {
    setup(undefined, { budgetDvVac: 6000 });
    await waitFor(() =>
      expect(screen.getByText("Reach from Earth")).toBeInTheDocument(),
    );
    const reach = screen.getByText("Reach from Earth");
    const windows = screen.getByText(/^Windows to$/);
    expect(
      reach.compareDocumentPosition(windows) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("scopes the destination select to the windows section, not the panel header", async () => {
    setup(undefined, { budgetDvVac: 6000 });
    const select = await screen.findByLabelText(/Windows to/);
    // The heading IS the label, so the control and the section title are one thing.
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByText(/^Windows to$/)).toBeInTheDocument();
  });

  it("a reach row picks the destination the windows list is scoped to", async () => {
    setup(undefined, { budgetDvVac: 6000 });
    await waitFor(() =>
      expect(screen.getByText("Reach from Earth")).toBeInTheDocument(),
    );
    // Mars is the fixture's targeted body, so the windows list starts scoped to it.
    const select = await screen.findByLabelText(/Windows to/);
    expect((select as HTMLSelectElement).selectedOptions[0].textContent).toBe(
      "Mars",
    );

    fireEvent.click(screen.getByRole("button", { name: "Venus" }));

    await waitFor(() =>
      expect((select as HTMLSelectElement).selectedOptions[0].textContent).toBe(
        "Venus",
      ),
    );
    expect(screen.getByRole("button", { name: "Venus" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Mars" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("TransferWindow actions", () => {
  const destination = () =>
    (screen.getByLabelText(/Windows to/) as HTMLSelectElement).value;
  const press = (value = true) =>
    dispatchAction("transfer-test", "cycle-destination", {
      kind: "button",
      value,
    });

  afterEach(() => {
    clearActionHandlers();
  });

  it("cycle-destination steps to the next sibling body and wraps round", async () => {
    setup();
    await screen.findByLabelText(/Windows to/);
    expect(destination()).toBe("2");

    act(() => {
      press();
    });
    await waitFor(() => expect(destination()).toBe("3"));

    act(() => {
      press();
    });
    await waitFor(() => expect(destination()).toBe("2"));
    await act(async () => {});
  });

  it("cycle-destination steps once per press, not again on the release", async () => {
    setup();
    await screen.findByLabelText(/Windows to/);

    act(() => {
      press(true);
    });
    await waitFor(() => expect(destination()).toBe("3"));

    act(() => {
      press(false);
    });
    await act(async () => {});
    expect(destination()).toBe("3");
  });
});
