import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { TechTreeComponent } from "./index";

/**
 * Characterisation: what TechTree DOES today when its telemetry reads are
 * `undefined`, recorded ahead of `useTelemetry` returning a `Reading`.
 *
 * Three reads, and TWO of them fail open on absence:
 *
 * - `career.status.tech.nodes` feeds `parseTechNodes`, which maps `undefined`
 *   and `null` alike to `null`, and the widget branches on `allNodes === null`.
 *   That one fails closed (placeholder)
 * - `spaceCenter.scene`: `upgradesEnabled = scene === undefined || scene ===
 *   "SpaceCenter"`. An unknown scene ENABLES spending
 * - `career.status.economy.science`: `canAfford = sciAvailable === null ||
 *   sciAvailable >= n.scienceCost`, and `computeResearchable` skips its own
 *   cost check on `science !== null`. An unknown balance makes every node
 *   affordable AND researchable
 *
 * Both fail-opens leave the Unlock button live on a node the operator may not
 * be able to buy, from a screen where KSP will not accept the spend. Pinned as
 * observed, not endorsed.
 */

const CARRIED = ["career.status", "spaceCenter.scene"];

function newFixture() {
  return setupStreamFixture({ carriedChannels: CARRIED, pinnedUt: 10 });
}

function renderTree(fixture: StreamFixture) {
  return render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "tt-char" }}>
        <TechTreeComponent config={{}} id="tt-char" />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
}

/**
 * An explicitly-Researchable node costing far more than any test balance.
 * `state: "Researchable"` is trusted by `computeResearchable` regardless of
 * science, which is what isolates the `canAfford` gate from the researchable
 * gate.
 */
const PRICEY_RESEARCHABLE = {
  id: "pricey",
  title: "Pricey Tech",
  description: "Costs a lot of science.",
  scienceCost: 500,
  state: "Researchable",
  parents: [],
  parts: [],
};

/** Unavailable-with-unlocked-parent: whether it is RESEARCHABLE is the science gate. */
const OWNED_ROOT = {
  id: "root",
  title: "Root Tech",
  description: "Already ours.",
  scienceCost: 0,
  state: "Available",
  parents: [],
  parts: [],
};
const DERIVED_PRICEY = {
  id: "derived",
  title: "Derived Tech",
  description: "Needs the root, and a lot of science.",
  scienceCost: 500,
  state: "Unavailable",
  parents: ["root"],
  parts: [],
};

function careerStatus(
  nodes: unknown,
  economy: Record<string, unknown> | null,
): Record<string, unknown> {
  return {
    economy,
    facilities: null,
    contracts: null,
    strategies: null,
    tech:
      nodes === undefined ? null : { unlockedCount: 0, unlockedIds: [], nodes },
  };
}

beforeEach(() => {
  clearActionHandlers();
});

describe("TechTree: nothing has arrived at all", () => {
  it("renders the awaiting placeholder and none of the browsing chrome", () => {
    renderTree(newFixture());

    // `parseTechNodes(undefined) === null` reaches the `allNodes === null` gate.
    expect(screen.getByText(/Awaiting tech telemetry/i)).toBeInTheDocument();
    // The gate returns before the filter bar, the search box and the subtitle
    // exist, so a cold widget offers nothing to interact with.
    expect(
      screen.queryByRole("group", { name: "Filter tech nodes" }),
    ).toBeNull();
    expect(
      screen.queryByRole("searchbox", { name: /Filter tech nodes by text/i }),
    ).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(visibleText()).toBe("TECH TREEAwaiting tech telemetry");
  });
});

describe("TechTree: the `allNodes === null` absence gate", () => {
  it("fires for a never-arrived topic and yields a DIFFERENT message from a confirmed-empty tree", async () => {
    const fixture = newFixture();
    renderTree(fixture);

    expect(screen.getByText(/Awaiting tech telemetry/i)).toBeInTheDocument();

    act(() => {
      fixture.emit("career.status", careerStatus([], null));
    });

    // An empty array parses to `[]`: the widget switches to a second, distinct
    // placeholder. Waiting and confirmed-empty ARE separated here, unlike in
    // this widget's sibling career widgets.
    await waitFor(() =>
      expect(screen.getByText(/No tech nodes loaded/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Awaiting tech telemetry/i)).toBeNull();
  });

  it("fires for a partial payload whose `tech` field is null", async () => {
    const fixture = newFixture();
    renderTree(fixture);

    act(() => {
      // The record arrived carrying a science balance but no tech sub-tree.
      fixture.emit(
        "career.status",
        careerStatus(undefined, { funds: 0, reputation: 0, science: 5000 }),
      );
    });

    await waitFor(() =>
      expect(fixture.transport.isSubscribed("career.status")).toBe(true),
    );
    expect(screen.getByText(/Awaiting tech telemetry/i)).toBeInTheDocument();
    // The science figure the payload DID carry never reaches the screen.
    expect(visibleText()).not.toContain("5000");
  });

  it("fires when `tech.nodes` itself is null", async () => {
    const fixture = newFixture();
    renderTree(fixture);

    act(() => {
      fixture.emit("career.status", careerStatus(null, null));
    });

    await waitFor(() =>
      expect(fixture.transport.isSubscribed("career.status")).toBe(true),
    );
    expect(screen.getByText(/Awaiting tech telemetry/i)).toBeInTheDocument();
  });
});

describe("TechTree: null versus undefined", () => {
  it("does NOT distinguish a whole-topic tombstone from a topic that never arrived", async () => {
    const fixture = newFixture();
    renderTree(fixture);

    act(() => {
      // The hook hands back `null` for a tombstone rather than `undefined`, so
      // the widget could tell them apart. `null?.tech?.nodes` is `undefined`
      // and `parseTechNodes` folds both into the same placeholder.
      fixture.emit("career.status", null);
    });

    await waitFor(() =>
      expect(fixture.transport.isSubscribed("career.status")).toBe(true),
    );
    expect(screen.getByText(/Awaiting tech telemetry/i)).toBeInTheDocument();
  });
});

describe("TechTree: the spaceCenter.scene absence gate", () => {
  /**
   * Recorded prior behaviour: "FAIL-OPEN: leaves Unlock enabled while the scene
   * is unknown". `scene === undefined || scene === "SpaceCenter"` read "we have
   * not been told" as "we are in the Space Center", leaving a control that spends
   * science live on the strength of an absence.
   */
  it("withholds Unlock while the scene is unknown, for the stated reason", async () => {
    const user = userEvent.setup();
    const fixture = newFixture();
    renderTree(fixture);

    act(() => {
      // Deliberately NO spaceCenter.scene emit.
      fixture.emit(
        "career.status",
        careerStatus([PRICEY_RESEARCHABLE], {
          funds: 0,
          reputation: 0,
          science: 5000,
        }),
      );
    });

    await waitFor(() =>
      expect(screen.getByText("Pricey Tech")).toBeInTheDocument(),
    );
    await user.click(screen.getByText("Pricey Tech"));

    // No scene means no permission, and the button says which scene it wants
    // rather than being inert without explanation.
    const unlock = screen.getByRole("button", { name: "Unlock" });
    expect(unlock).toBeDisabled();
    expect(unlock).toHaveAttribute(
      "title",
      "Unlock from the Space Center scene",
    );
  });

  it("disables Unlock once a non-SpaceCenter scene actually arrives", async () => {
    const user = userEvent.setup();
    const fixture = newFixture();
    renderTree(fixture);

    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "Flight" });
      fixture.emit(
        "career.status",
        careerStatus([PRICEY_RESEARCHABLE], {
          funds: 0,
          reputation: 0,
          science: 5000,
        }),
      );
    });

    await waitFor(() =>
      expect(screen.getByText("Pricey Tech")).toBeInTheDocument(),
    );
    await user.click(screen.getByText("Pricey Tech"));

    // The other side of the same gate, proving the test above records an
    // absence rather than a control that is always live.
    const unlock = screen.getByRole("button", { name: "Unlock" });
    expect(unlock).toBeDisabled();
    expect(unlock).toHaveAttribute(
      "title",
      "Unlock from the Space Center scene",
    );
  });
});

describe("TechTree: the economy.science absence gate", () => {
  /**
   * Recorded prior behaviour: "FAIL-OPEN: leaves Unlock enabled on a 500-science
   * node while the balance is unknown". `sciAvailable === null || ...` read an
   * unknown balance as sufficient for any cost, which is the opposite of what
   * the comment above `sciAvailable` in the widget already claimed it did.
   */
  it("withholds Unlock on a 500-science node while the balance is unknown", async () => {
    const user = userEvent.setup();
    const fixture = newFixture();
    renderTree(fixture);

    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      fixture.emit("career.status", careerStatus([PRICEY_RESEARCHABLE], null));
    });

    await waitFor(() =>
      expect(screen.getByText("Pricey Tech")).toBeInTheDocument(),
    );
    await user.click(screen.getByText("Pricey Tech"));

    // An unknown balance cannot cover 500 science, and the tooltip names the
    // absence rather than reporting a balance of "null".
    const unlock = screen.getByRole("button", { name: "Unlock" });
    expect(unlock).toBeDisabled();
    expect(unlock).toHaveAttribute(
      "title",
      expect.stringContaining("no science balance has arrived"),
    );
  });

  it("disables Unlock once a balance arrives and is too small", async () => {
    const user = userEvent.setup();
    const fixture = newFixture();
    renderTree(fixture);

    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      fixture.emit(
        "career.status",
        careerStatus([PRICEY_RESEARCHABLE], {
          funds: 0,
          reputation: 0,
          science: 10,
        }),
      );
    });

    await waitFor(() =>
      expect(screen.getByText("Pricey Tech")).toBeInTheDocument(),
    );
    await user.click(screen.getByText("Pricey Tech"));

    const unlock = screen.getByRole("button", { name: "Unlock" });
    expect(unlock).toBeDisabled();
    expect(unlock.getAttribute("title")).toContain("(have 10)");
  });

  /**
   * Recorded prior behaviour: "omits the science readout from the subtitle while
   * the balance is unknown". The balance the Unlock buttons are judged against
   * disappeared exactly when they had nothing to judge against.
   */
  it("reports the science balance as unknown in the subtitle rather than omitting it", async () => {
    const fixture = newFixture();
    renderTree(fixture);

    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      fixture.emit("career.status", careerStatus([PRICEY_RESEARCHABLE], null));
    });

    await waitFor(() =>
      expect(screen.getByText("Pricey Tech")).toBeInTheDocument(),
    );
    expect(screen.getByRole("status").textContent).toBe(
      "0/1 unlocked · 1 researchable · science unknown",
    );
  });
});

describe("TechTree: computeResearchable's own science gate", () => {
  /**
   * `computeResearchable` skips its cost filter entirely when the balance is
   * absent, and that is left alone deliberately.
   *
   * The count is a claim about the shape of the tree, not an offer to spend. A
   * node whose parents are unlocked IS reachable; whether the operator can pay
   * for it is a separate question, and the Unlock button now answers that one by
   * refusing with a stated reason. Zeroing the count instead would hide the
   * reachable node and make a warming-up widget look like an empty tree, while
   * the button, which is the thing that spends, is already closed.
   */
  it("still counts a 500-science node as researchable while the balance is unknown", async () => {
    const fixture = newFixture();
    renderTree(fixture);

    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      fixture.emit(
        "career.status",
        careerStatus([OWNED_ROOT, DERIVED_PRICEY], null),
      );
    });

    await waitFor(() =>
      expect(screen.getByText("Derived Tech")).toBeInTheDocument(),
    );
    // Counted, and the missing balance is named in the same line, so the count
    // reads as "reachable" rather than as "affordable".
    expect(screen.getByRole("status").textContent).toBe(
      "1/2 unlocked · 1 researchable · science unknown",
    );
  });

  it("stops counting it once a balance arrives and is too small", async () => {
    const fixture = newFixture();
    renderTree(fixture);

    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      fixture.emit(
        "career.status",
        careerStatus([OWNED_ROOT, DERIVED_PRICEY], {
          funds: 0,
          reputation: 0,
          science: 10,
        }),
      );
    });

    await waitFor(() =>
      expect(screen.getByText("Derived Tech")).toBeInTheDocument(),
    );
    // The other side of the same gate.
    expect(screen.getByRole("status").textContent).toContain("0 researchable");
  });
});
