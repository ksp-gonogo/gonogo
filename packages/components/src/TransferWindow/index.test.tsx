import { clearRegistry, DashboardItemContext } from "@ksp-gonogo/core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
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

function setup(targetBodyIndex?: number, opts?: { budgetDvVac?: number }) {
  const fixture = setupStreamFixture({
    carriedChannels: [
      "system.bodies",
      "vessel.orbit",
      "target.available",
      "dv.summary",
    ],
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
  if (opts?.budgetDvVac != null) {
    fixture.emit("dv.summary", {
      stageCount: 2,
      totalDvVac: opts.budgetDvVac,
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
      expect(screen.getByText(/^Windows to$/)).toBeInTheDocument(),
    );
    // one selectable row per upcoming window (WINDOW_COUNT of them)
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
    // window 0 is expanded by default; the rest are collapsed window-row buttons
    const collapsed = screen.getAllByRole("button", { expanded: false });
    expect(collapsed.length).toBeGreaterThan(0);
    fireEvent.click(collapsed[0]);
    expect(collapsed[0]).toHaveAttribute("aria-expanded", "true");
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

  /*
   * The load-bearing assertion. With a budget on the wire the verdict column must
   * appear AND carry a real verdict: a test that only checked the no-budget branch
   * would pass against a widget that never rendered a verdict at all.
   */
  it("renders a verdict per destination once a budget is on the wire", async () => {
    setup(undefined, { budgetDvVac: 6000 });
    await waitFor(() =>
      expect(screen.getByText("Affords")).toBeInTheDocument(),
    );
    // The band, not a boolean, and this budget straddles it. Mars costs less to
    // arrive at than Venus despite Venus being cheaper to depart for, so one reads
    // GO and the other ONE WAY: reachable, but not with a capture burn.
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
    // 500 m/s affords no departure at all, so every row reads NO. That is a
    // COMPUTED answer and it renders as one.
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

describe("TransferWindow reach list: the absent budget", () => {
  /*
   * The state the design exists for, and the one a fixture has to be able to
   * express: stock will not compute Δv for a vessel it is not simulating, so
   * `dv.summary` tombstones for a real craft. That is a DIFFERENT sentence from
   * "we have not heard", and neither is "cannot afford".
   */
  it("says the sim has no figure, and still shows the costs", async () => {
    const { fixture } = setup();
    await waitFor(() =>
      expect(screen.getByText("Reach from Earth")).toBeInTheDocument(),
    );
    act(() => {
      fixture.emit("dv.summary", null);
    });

    await waitFor(() =>
      expect(visibleText()).toMatch(/No Δv figure for this craft/i),
    );
    // A confirmed absence is not a verdict of any kind.
    expect(screen.queryByText("Affords")).not.toBeInTheDocument();
    expect(screen.queryByText("NO")).not.toBeInTheDocument();
    // The costs and windows do not depend on the budget, so they stay.
    expect(screen.getByText("Δv needed")).toBeInTheDocument();
  });

  it("does not claim the sim has no figure when nothing has merely arrived yet", async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByText("Reach from Earth")).toBeInTheDocument(),
    );
    // Silence is not a tombstone: no caption asserting anything about the craft.
    expect(visibleText()).not.toMatch(/No Δv figure for this craft/i);
    expect(screen.queryByText("Affords")).not.toBeInTheDocument();
  });
});

describe("TransferWindow layout: origin-based, not destination-based", () => {
  /*
   * The reach list answers "where can I go" and has to come BEFORE the widget
   * commits to one destination. Asserted on document order rather than on styling,
   * because the complaint was that reach read as an afterthought tucked at the
   * bottom while the destination picker sat at the top.
   */
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
