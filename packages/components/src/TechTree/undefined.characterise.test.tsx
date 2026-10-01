import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ReadingProbe } from "../test/ReadingProbe";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { TechTreeComponent } from "./index";

/**
 * Pins what TechTree renders when its reads are `undefined`: absent nodes draw a placeholder, and an unknown science balance withholds Unlock with a stated reason rather than leaving a spend control live on an absence.
 */

function newFixture() {
  return setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });
}

function renderTree(
  fixture: StreamFixture,
  { probe = false }: { probe?: boolean } = {},
) {
  return render(
    <fixture.Provider>
      {probe && <ReadingProbe topic="career.status" />}
      <DashboardItemContext.Provider value={{ instanceId: "tt-char" }}>
        <TechTreeComponent config={{}} id="tt-char" />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
}

/** An explicitly Researchable node costing more than any test balance; the explicit state isolates the `canAfford` gate from the researchable gate. */
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
  balances: Record<string, unknown> | null,
): Record<string, unknown> {
  return {
    balances,
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
    // The gate returns before the filter bar, the search box and the subtitle exist, so a cold widget offers nothing to interact with.
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

    // An empty array parses to `[]`, a placeholder distinct from waiting.
    await waitFor(() =>
      expect(screen.getByText(/No tech nodes loaded/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Awaiting tech telemetry/i)).toBeNull();
  });

  it("fires for a partial payload whose `tech` field is null", async () => {
    const fixture = newFixture();
    renderTree(fixture, { probe: true });

    act(() => {
      // The record arrived carrying a science balance but no tech sub-tree.
      fixture.emit(
        "career.status",
        careerStatus(undefined, { funds: 0, reputation: 0, science: 5000 }),
      );
    });

    await screen.findByText("career.status: observed");
    expect(screen.getByText(/Awaiting tech telemetry/i)).toBeInTheDocument();
    // The science figure the payload DID carry never reaches the screen.
    expect(visibleText()).not.toContain("5000");
  });

  it("fires when `tech.nodes` itself is null", async () => {
    const fixture = newFixture();
    renderTree(fixture, { probe: true });

    act(() => {
      fixture.emit("career.status", careerStatus(null, null));
    });

    await screen.findByText("career.status: observed");
    expect(screen.getByText(/Awaiting tech telemetry/i)).toBeInTheDocument();
  });
});

describe("TechTree: null versus undefined", () => {
  it("does NOT distinguish a whole-topic tombstone from a topic that never arrived", async () => {
    const fixture = newFixture();
    renderTree(fixture, { probe: true });

    act(() => {
      // A tombstone and a never-arrived record fold into the same placeholder.
      fixture.emit("career.status", null);
    });

    await screen.findByText("career.status: absent");
    expect(screen.getByText(/Awaiting tech telemetry/i)).toBeInTheDocument();
  });
});

describe("TechTree: no building-scene gate on Unlock", () => {
  it("arms Unlock on an affordable node with no scene telemetry ever mounted", async () => {
    const user = userEvent.setup();
    const fixture = newFixture();
    renderTree(fixture);

    act(() => {
      // TechTree carries no scene channel at all: the backend enforces no scene, so the client checks none either.
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

    const unlock = screen.getByRole("button", { name: "Unlock" });
    expect(unlock).toBeEnabled();
    expect(unlock).not.toHaveAttribute("title");
  });
});

describe("TechTree: an absent balances.science", () => {
  it("leaves Unlock on a 500-science node to its gate while the balance is unknown", async () => {
    const user = userEvent.setup();
    const fixture = newFixture();
    renderTree(fixture);

    act(() => {
      fixture.emit("career.status", careerStatus([PRICEY_RESEARCHABLE], null));
    });

    await waitFor(() =>
      expect(screen.getByText("Pricey Tech")).toBeInTheDocument(),
    );
    await user.click(screen.getByText("Pricey Tech"));

    // An unknown balance decides nothing about the command; the node's per-item gate does.
    const unlock = screen.getByRole("button", { name: "Unlock" });
    expect(unlock).toBeEnabled();
    expect(unlock).not.toHaveAttribute("title");
  });

  it("marks the price short once a balance arrives and is too small, and leaves Unlock to its gate", async () => {
    const user = userEvent.setup();
    const fixture = newFixture();
    renderTree(fixture);

    act(() => {
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
    expect(unlock).toBeEnabled();
    expect(
      document.querySelector("[data-afford]")?.getAttribute("data-afford"),
    ).toBe("no");
  });

  it("reports the science balance as unknown in the subtitle rather than omitting it", async () => {
    const fixture = newFixture();
    renderTree(fixture);

    act(() => {
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
  // The count is a claim about the tree's shape, not an offer to spend: a node with unlocked parents is reachable, and the Unlock button refuses the spend on its own.
  it("still counts a 500-science node as researchable while the balance is unknown", async () => {
    const fixture = newFixture();
    renderTree(fixture);

    act(() => {
      fixture.emit(
        "career.status",
        careerStatus([OWNED_ROOT, DERIVED_PRICEY], null),
      );
    });

    await waitFor(() =>
      expect(screen.getByText("Derived Tech")).toBeInTheDocument(),
    );
    // Counted, and the missing balance is named in the same line, so the count reads as "reachable" rather than as "affordable".
    expect(screen.getByRole("status").textContent).toBe(
      "1/2 unlocked · 1 researchable · science unknown",
    );
  });

  it("stops counting it once a balance arrives and is too small", async () => {
    const fixture = newFixture();
    renderTree(fixture);

    act(() => {
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
