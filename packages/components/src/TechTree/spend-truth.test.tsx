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
 * What the Unlock control may claim about a spend.
 *
 * Two ways a science verdict can be false: a price that never arrived read as
 * free, and a command the career model refuses outright (RP-1 researches
 * through its own queue) drawn as a purchase the balance decides.
 */

const CARRIED = ["career.status", "spaceCenter.scene", "system.uplink.gates"];

function careerStatus(
  science: number,
  node: Record<string, unknown>,
): Record<string, unknown> {
  return {
    economy: { funds: 0, reputation: 0, science },
    facilities: null,
    contracts: null,
    strategies: null,
    tech: { unlockedCount: 0, unlockedIds: [], nodes: [node] },
  };
}

const PRICEY = {
  id: "pricey",
  title: "Pricey Tech",
  description: "Costs a lot of science.",
  scienceCost: 500,
  state: "Researchable",
  parents: [],
};

describe("TechTree spend truth", () => {
  let stream: StreamFixture;

  beforeEach(() => {
    clearActionHandlers();
    stream = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  function mount() {
    render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "tt-spend" }}>
          <TechTreeComponent config={{}} id="tt-spend" />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  async function openNode(title: string) {
    await waitFor(() => expect(screen.getByText(title)).toBeInTheDocument());
    await userEvent.setup().click(screen.getByText(title));
    // The row's own control: "Unlock", or, once a gate blocks the command, "Unlock <node> unavailable: <reason>". Never the "Unlocked" filter.
    return screen.getByRole("button", { name: /^Unlock( |$)/ });
  }

  it("never arms Unlock on a price that did not arrive, and does not show it as free", async () => {
    mount();
    act(() => {
      stream.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      stream.emit(
        "career.status",
        careerStatus(5000, { ...PRICEY, scienceCost: undefined }),
      );
    });
    const unlock = await openNode("Pricey Tech");

    expect(unlock).toBeDisabled();
    expect(unlock.getAttribute("title")).toBe(
      "No price reported for this node",
    );
    expect(visibleText(document.body)).not.toMatch(/\b0\s*science/);
  });

  it("draws a science verdict when money decides the unlock", async () => {
    mount();
    act(() => {
      stream.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      stream.emit("career.status", careerStatus(10, PRICEY));
    });
    const unlock = await openNode("Pricey Tech");

    expect(unlock).toBeDisabled();
    expect(unlock.getAttribute("title")).toMatch(/^Need /);
    expect(
      document.querySelector("[data-afford]")?.getAttribute("data-afford"),
    ).toBe("no");
  });

  it("draws no science verdict on an unlock the career model refuses", async () => {
    mount();
    act(() => {
      stream.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      stream.emit("career.status", careerStatus(10, PRICEY));
      stream.emit("system.uplink.gates", {
        gates: [
          {
            command: "career.tech.unlock",
            verdict: {
              outcome: 1,
              errorCode: 3,
              detail: "Use rp1.tech.research",
            },
          },
        ],
      });
    });
    const unlock = await openNode("Pricey Tech");

    expect(unlock.getAttribute("title") ?? "").not.toMatch(/^Need /);
    // No affordability verdict on the row either: the grey and the red cost are a claim the balance decides.
    expect(document.querySelector("[data-afford]")).toBeNull();
    // What it says instead is the career model's own reason, which is the one thing the control can truthfully tell.
    expect(unlock).toHaveAccessibleName(/rp1\.tech\.research/);
  });
});
