import { DashboardItemContext } from "@ksp-gonogo/core";
import { render, screen, within } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { FleetCommsActions } from "./index";
import { __resetFleetCommsTogglesForTests } from "./toggles";

/**
 * Two SystemView tiles on one dashboard each carry their own Commlinks and
 * Traffic controls, and pressing one tile's control leaves the other tile's
 * state alone.
 */
describe("FleetComms toggles across two dashboard instances", () => {
  beforeEach(() => {
    __resetFleetCommsTogglesForTests();
  });

  function renderTwoTiles() {
    render(
      <>
        <section aria-label="tile a">
          <DashboardItemContext.Provider value={{ instanceId: "sv-a" }}>
            <FleetCommsActions />
          </DashboardItemContext.Provider>
        </section>
        <section aria-label="tile b">
          <DashboardItemContext.Provider value={{ instanceId: "sv-b" }}>
            <FleetCommsActions />
          </DashboardItemContext.Provider>
        </section>
      </>,
    );
    return {
      a: within(screen.getByRole("region", { name: "tile a" })),
      b: within(screen.getByRole("region", { name: "tile b" })),
    };
  }

  it("toggling Commlinks in one tile leaves the other tile's Commlinks on", async () => {
    const user = userEvent.setup();
    const { a, b } = renderTwoTiles();

    await user.click(a.getByRole("button", { name: "Commlinks" }));

    expect(
      a.getByRole("button", { name: "Commlinks" }).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      b.getByRole("button", { name: "Commlinks" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("toggling Traffic in one tile leaves the other tile's Traffic on", async () => {
    const user = userEvent.setup();
    const { a, b } = renderTwoTiles();

    await user.click(b.getByRole("button", { name: "Traffic" }));

    expect(
      b.getByRole("button", { name: "Traffic" }).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      a.getByRole("button", { name: "Traffic" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
