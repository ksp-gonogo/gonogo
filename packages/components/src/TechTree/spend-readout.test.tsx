import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { TechTreeComponent } from "./index";

/**
 * Tech is paid up front, in science, so the balance has to sit beside the Unlock it is spent by, in the widget body, at every tile size.
 */

const OWNED = {
  id: "start",
  title: "Start",
  description: "",
  scienceCost: 0,
  state: "Available",
  parents: [],
  parts: [],
};

const PRICEY = {
  id: "pricey",
  title: "Pricey Tech",
  description: "Costs a lot of science.",
  scienceCost: 500,
  state: "Researchable",
  parents: ["start"],
  parts: [],
};

function careerStatus(science: number): Record<string, unknown> {
  return {
    balances: { funds: 0, reputation: 0, science },
    facilities: null,
    contracts: null,
    strategies: null,
    tech: { unlockedCount: 1, unlockedIds: ["start"], nodes: [OWNED, PRICEY] },
  };
}

describe("TechTree spend readout", () => {
  let stream: StreamFixture;

  beforeEach(() => {
    clearActionHandlers();
    stream = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  });

  function mount(w: number, h: number, science: number) {
    const view = render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "tt-readout" }}>
          <TechTreeComponent config={{}} id="tt-readout" w={w} h={h} />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
    act(() => {
      stream.emit("career.status", careerStatus(science));
    });
    return view;
  }

  it("draws the balance beside Unlock in an expanded list row at the smallest list tile", async () => {
    const { container } = mount(5, 4, 5000);
    await waitFor(() =>
      expect(screen.getByText("Pricey Tech")).toBeInTheDocument(),
    );
    await userEvent.setup().click(screen.getByText("Pricey Tech"));

    const row = screen.getByRole("button", { name: "Unlock" }).closest("li");
    if (row === null) throw new Error("Unlock is not inside a list row");
    expect(within(row).getByText("Balance")).toBeInTheDocument();
    expect(row.textContent).toContain("5,000");
    expect(row.textContent).toContain("Price");
    await expectNoA11yViolations(container);
  });

  it("draws the balance beside Unlock in the graph's detail pane", async () => {
    const user = userEvent.setup();
    const { container } = mount(16, 10, 5000);
    await user.click(
      await screen.findByRole("button", { name: /Pricey Tech/ }),
    );

    const pane = screen.getByRole("region", { name: "Pricey Tech details" });
    expect(within(pane).getByText("Balance")).toBeInTheDocument();
    expect(pane.textContent).toContain("5,000");
    expect(
      within(pane).getByRole("button", { name: "Unlock" }),
    ).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("closes the pane and removes the sidebar", async () => {
    const user = userEvent.setup();
    mount(16, 10, 5000);
    await user.click(
      await screen.findByRole("button", { name: /Pricey Tech/ }),
    );
    await user.click(screen.getByRole("button", { name: "Close details" }));
    expect(screen.queryByRole("region", { name: /details/ })).toBeNull();
  });

  it("marks the price short only against a current balance that cannot cover it", async () => {
    const user = userEvent.setup();
    mount(5, 9, 10);
    await waitFor(() =>
      expect(screen.getByText("Pricey Tech")).toBeInTheDocument(),
    );
    await user.click(screen.getByText("Pricey Tech"));
    expect(
      document.querySelector("[data-afford]")?.getAttribute("data-afford"),
    ).toBe("no");
  });
});
