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
 * When `career.status` stops being current, TechTree keeps the node list (nobody can spend down a dead link, so the tree is still the tree) and keeps the science balance on screen marked held, without letting Unlock turn it into a claim about now. The assertions that matter separate held from never-arrived.
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
    expect(document.querySelector("[data-held]")).toBeNull();
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
      expect(
        screen.getByRole("status").querySelector("[data-held]"),
      ).not.toBeNull(),
    );
    expect(screen.getByText("Pricey Tech")).toBeInTheDocument();
    expect(visibleText(document.body)).not.toContain("Awaiting tech telemetry");
    expect(visibleText(document.body)).not.toContain("No tech nodes loaded");
  });

  it("disarms Unlock and says the balance is held, not that none arrived", async () => {
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
      "affordability cannot be checked against a held balance",
    );
    expect(unlock.getAttribute("title")).not.toContain(
      "no science balance has arrived",
    );
    expect(unlock.getAttribute("title")).not.toContain(
      "Unlock from the Space Center scene",
    );
  });

  it("keeps the held balance in the subtitle, marked by Unit rather than captioned", async () => {
    renderTree();
    emitAffordableCareer();
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("5000"),
    );

    goNotCurrent();

    await waitFor(() =>
      expect(
        screen.getByTitle("Available science").querySelector("[data-held]"),
      ).not.toBeNull(),
    );
    const status = screen.getByRole("status").textContent ?? "";
    expect(status).toContain("5,000");
    expect(status).not.toContain("not current");
    expect(status).not.toContain("science unknown");
  });

  it("draws no affordability verdict on a node while the balance is held", async () => {
    renderTree();
    emitAffordableCareer();
    await waitFor(() =>
      expect(
        document.querySelector("[data-afford]")?.getAttribute("data-afford"),
      ).toBe("yes"),
    );

    goNotCurrent();

    await waitFor(() =>
      expect(
        screen.getByTitle("Available science").querySelector("[data-held]"),
      ).not.toBeNull(),
    );
    // The last balance covered the price, but a held figure can say neither yes nor no.
    expect(document.querySelector("[data-afford]")).toBeNull();
  });

  it("keeps tiny mode's balance line, marked held rather than replaced", async () => {
    // A held balance must not reuse tiny mode's no-balance path, or a dropped link looks like a save with no science.
    const { container } = renderTree(4, 3);
    emitAffordableCareer();
    await waitFor(() => expect(visibleText(container)).toContain("5000"));
    expect(container.querySelector("[data-held]")).toBeNull();

    goNotCurrent();

    await waitFor(() =>
      expect(container.querySelector("[data-held]")).not.toBeNull(),
    );
    expect(visibleText(container)).toContain("5,000");
    expect(visibleText(container)).not.toContain("NOT CURRENT");
  });

  it("says nothing about currency before anything has ever arrived", async () => {
    // A cold start is not a suspension, or first paint would accuse the link of dropping.
    const { container } = renderTree();
    await waitFor(() =>
      expect(visibleText(container)).toContain("Awaiting tech telemetry"),
    );
    expect(container.querySelector("[data-held]")).toBeNull();
  });
});
