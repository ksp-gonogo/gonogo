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
 * When `career.status` stops being current, TechTree keeps the node list (nobody can spend down a dead link, so the tree is still the tree) and withholds the science balance, which Unlock would turn into a claim about now. The assertions that matter separate withheld from never-arrived.
 */

const CARRIED = ["career.status", "spaceCenter.scene"];

const PRICEY_RESEARCHABLE = {
  id: "pricey",
  title: "Pricey Tech",
  description: "Costs a lot of science.",
  scienceCost: 500,
  state: "Researchable",
  parents: [],
  parts: [],
};

function careerStatus(science: number): Record<string, unknown> {
  return {
    economy: { funds: 0, reputation: 0, science },
    facilities: null,
    contracts: null,
    strategies: null,
    tech: {
      unlockedCount: 0,
      unlockedIds: [],
      nodes: [PRICEY_RESEARCHABLE],
    },
  };
}

describe("TechTree when the career record is no longer current", () => {
  let stream: StreamFixture;

  beforeEach(() => {
    clearActionHandlers();
    stream = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  function renderTree(w?: number, h?: number) {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "tt-stale" }}>
          <TechTreeComponent config={{}} id="tt-stale" w={w} h={h} />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  /** A career at the Space Center with 5000 science: every gate open. */
  function emitAffordableCareer(): void {
    act(() => {
      stream.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      stream.emit("career.status", careerStatus(5000));
    });
  }

  function goNotCurrent(): void {
    act(() => {
      stream.store.setTransportConnected(false);
      stream.store.beginFrame();
    });
  }

  it("arms Unlock and prints the balance while the record is current", async () => {
    // The control: without it every assertion below would pass on a widget that never arms Unlock.
    const user = userEvent.setup();
    renderTree();
    emitAffordableCareer();

    await waitFor(() =>
      expect(screen.getByText("Pricey Tech")).toBeInTheDocument(),
    );
    await user.click(screen.getByText("Pricey Tech"));

    expect(screen.getByRole("button", { name: "Unlock" })).toBeEnabled();
    expect(screen.getByRole("status").textContent).toContain("5000");
  });

  it("keeps the tech tree browsable, because a node list cannot change unobserved", async () => {
    renderTree();
    emitAffordableCareer();
    await waitFor(() =>
      expect(screen.getByText("Pricey Tech")).toBeInTheDocument(),
    );

    goNotCurrent();

    // Not the awaiting placeholder and not an empty tree: both would misstate a catalogue we hold.
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("not current"),
    );
    expect(screen.getByText("Pricey Tech")).toBeInTheDocument();
    expect(visibleText(document.body)).not.toContain("Awaiting tech telemetry");
    expect(visibleText(document.body)).not.toContain("No tech nodes loaded");
  });

  it("disarms Unlock and says the balance is no longer current, not that none arrived", async () => {
    const user = userEvent.setup();
    renderTree();
    emitAffordableCareer();
    await waitFor(() =>
      expect(screen.getByText("Pricey Tech")).toBeInTheDocument(),
    );
    await user.click(screen.getByText("Pricey Tech"));
    expect(screen.getByRole("button", { name: "Unlock" })).toBeEnabled();

    goNotCurrent();

    const unlock = await waitFor(() => {
      const btn = screen.getByRole("button", { name: "Unlock" });
      expect(btn).toBeDisabled();
      return btn;
    });
    // The scene is still held, so the refusal is the balance, and the button says which kind of missing it is.
    expect(unlock.getAttribute("title")).toContain(
      "the science balance is no longer current",
    );
    expect(unlock.getAttribute("title")).not.toContain(
      "no science balance has arrived",
    );
    expect(unlock.getAttribute("title")).not.toContain(
      "Unlock from the Space Center scene",
    );
  });

  it("withholds the balance from the subtitle in words distinct from an absent one", async () => {
    renderTree();
    emitAffordableCareer();
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("5000"),
    );

    goNotCurrent();

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "0/1 unlocked · 1 researchable · science not current",
      ),
    );
  });

  it("spends its one tiny-mode line saying the balance is withheld", async () => {
    // A withheld balance must not reuse tiny mode's no-balance path, or a dropped link looks like a save with no science.
    const { container } = renderTree(4, 3);
    emitAffordableCareer();
    await waitFor(() => expect(visibleText(container)).toContain("5000"));

    goNotCurrent();

    await waitFor(() =>
      expect(visibleText(container)).toContain("SCIENCE NOT CURRENT"),
    );
    expect(visibleText(container)).not.toContain("5000");
  });

  it("says nothing about currency before anything has ever arrived", async () => {
    // A cold start is not a suspension, or first paint would accuse the link of dropping.
    const { container } = renderTree();
    await waitFor(() =>
      expect(visibleText(container)).toContain("Awaiting tech telemetry"),
    );
    expect(visibleText(container)).not.toContain("not current");
  });
});
