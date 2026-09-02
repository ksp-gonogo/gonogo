import {
  act,
  render,
  screen,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { StartResearch } from "./index";

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

const CARRIED = ["rp1.available", "career.status", "rp1.research"];

function mount() {
  const stream = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 1000,
  });
  const result = render(
    <stream.Provider>
      <StartResearch />
    </stream.Provider>,
  );
  renderedTrees.push(result.unmount);
  return { ...stream, container: result.container };
}

function emit(
  stream: ReturnType<typeof mount>,
  career: Record<string, unknown> | undefined,
  research: unknown[] = [],
) {
  act(() => {
    stream.emit("rp1.available", true, { validAt: 1000 });
    stream.emit("rp1.research", research, { validAt: 1000 });
    if (career !== undefined) {
      stream.emit("career.status", career, { validAt: 1000 });
    }
  });
}

/**
 * A small tree: one owned root, two nodes it reaches, and one behind an
 * unresearched parent.
 */
function tree(science: number) {
  return {
    economy: { funds: 289848, science, reputation: 62 },
    tech: {
      unlockedCount: 1,
      unlockedIds: ["start"],
      nodes: [
        {
          id: "start",
          title: "Start",
          scienceCost: 0,
          unlocked: true,
          parents: [],
        },
        {
          id: "basicRocketry",
          title: "Basic Rocketry",
          scienceCost: 12,
          unlocked: false,
          parents: ["start"],
        },
        {
          id: "earlyFlight",
          title: "Early Flight",
          scienceCost: 45,
          unlocked: false,
          parents: ["start"],
        },
        {
          id: "advRocketry",
          title: "Advanced Rocketry",
          scienceCost: 90,
          unlocked: false,
          parents: ["basicRocketry"],
        },
      ],
    },
  };
}

describe("StartResearch: putting a node on RP-1's research queue", () => {
  /**
   * Invisible without RP-1, which is most installs. On a stock career the tech
   * tree's own Unlock buys a node outright and is the right control for it.
   */
  it("draws nothing at all when RP-1 is not present", () => {
    mount();

    expect(screen.queryByText("START RESEARCH")).not.toBeInTheDocument();
  });

  /**
   * No tree is not an empty tree. A `career.status` with no `tech` group is a
   * producer that has not answered, and "nothing left to queue" over it would
   * state the one thing that reading is silent about.
   */
  it("draws nothing rather than an empty tree when no tech has arrived", async () => {
    const stream = mount();

    emit(stream, { economy: { science: 340 } });

    expect(visibleText(stream.container)).not.toContain("START RESEARCH");
  });

  /**
   * The prerequisite rule, and the one this section exists to enforce:
   * `rp1.tech.research` builds a `ResearchProject` directly and never asks
   * whether a node's parents are researched, so a node the tree cannot reach
   * would be queued rather than refused. Only the client can enumerate the
   * tree, so the picker is where the rule lives.
   */
  it("offers only nodes whose parents are all researched", async () => {
    const stream = mount();

    emit(stream, tree(340));
    await screen.findByText("START RESEARCH");

    const picker = screen.getByRole("combobox", {
      name: /tech node to research/i,
    });
    const offered = [...picker.querySelectorAll("option")].map(
      (o) => o.textContent,
    );
    expect(offered).toEqual(["Basic Rocketry", "Early Flight"]);
    // The owned root is not on offer either: there is nothing to start.
    expect(offered).not.toContain("Start");
  });

  /**
   * RP-1 asks this itself, ahead of the charge, so offering a queued node is
   * offering a press that cannot land. It matters more here than elsewhere
   * because the charge is the thing a second press would repeat.
   */
  it("offers no node that is already on the queue", async () => {
    const stream = mount();

    emit(stream, tree(340), [{ techId: "basicRocketry" }]);
    await screen.findByText("START RESEARCH");

    const offered = [
      ...screen
        .getByRole("combobox", { name: /tech node to research/i })
        .querySelectorAll("option"),
    ].map((o) => o.textContent);
    expect(offered).toEqual(["Early Flight"]);
  });

  /**
   * The house rule, in the currency this control actually spends. RP-1 charges
   * `scienceCost` in full at ENQUEUE, so the balance beside the press is the
   * science balance; funds are not spent here at all.
   */
  it("shows the science balance and says the charge lands at the press", async () => {
    const stream = mount();

    emit(stream, tree(340));
    await screen.findByText("START RESEARCH");

    const text = visibleText(stream.container);
    expect(text).toContain("Science");
    expect(text).toContain("340");
    expect(text).toContain("Charged in full when the node is queued");
  });

  /**
   * Cheapest first, because the reachable frontier is what an operator is
   * choosing between and RP-1's tree runs to several hundred nodes.
   */
  it("opens on the cheapest node the career can start", async () => {
    const stream = mount();

    emit(stream, tree(340));
    await screen.findByText("START RESEARCH");

    expect(
      screen.getByRole("combobox", { name: /tech node to research/i }),
    ).toHaveValue("basicRocketry");
    expect(visibleText(stream.container)).toContain("at the press");
  });

  /**
   * Dark on STATE rather than on the press: the science comparison is one the
   * client can make from the wire, and RP-1's own `CanAfford(Science)` asks it
   * again at the press so a stale view cannot spend anything.
   */
  it("refuses on state when the career is short of the science", async () => {
    const stream = mount();

    emit(stream, tree(5));
    await screen.findByText("START RESEARCH");

    expect(screen.getByRole("button", { name: /^research$/i })).toBeDisabled();
    expect(visibleText(stream.container)).toContain("SHORT");
  });

  /**
   * A tree whose reachable nodes are all owned or all queued is a real answer,
   * and one worth stating: it reads the same as a section that failed to draw
   * if it is left out.
   */
  it("says nothing is reachable rather than drawing an empty picker", async () => {
    const stream = mount();

    emit(stream, {
      economy: { science: 340 },
      tech: {
        unlockedCount: 1,
        unlockedIds: ["start"],
        nodes: [
          {
            id: "start",
            title: "Start",
            scienceCost: 0,
            unlocked: true,
            parents: [],
          },
        ],
      },
    });
    await screen.findByText("START RESEARCH");

    expect(visibleText(stream.container)).toContain(
      "Nothing the tree can reach is left to queue",
    );
    expect(
      screen.queryByRole("combobox", { name: /tech node to research/i }),
    ).not.toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const stream = mount();

    emit(stream, tree(340));
    await screen.findByText("START RESEARCH");

    await expectNoA11yViolations(stream.container);
  });
});
