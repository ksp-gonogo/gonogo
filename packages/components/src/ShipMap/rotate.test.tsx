import type { PartStateModule, VesselTopology } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { topologyToVesselPartsWire } from "../test/topologyToVesselPartsWire";
import fuellinePrelaunch from "./__fixtures__/fuelline-tester-22parts-prelaunch.json";
import { ShipMapComponent } from "./index";

const TOPOLOGY = fuellinePrelaunch["v.topology"] as VesselTopology;
const WIRE = topologyToVesselPartsWire(
  TOPOLOGY,
  new Map<number, { partState: { seq: number; modules: PartStateModule[] } }>(),
);

function mount(config: { turn?: number } | undefined) {
  const onConfigChange = vi.fn();
  const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
  const { container } = render(
    <fixture.Provider>
      <ShipMapComponent
        id="ship-map-rotate"
        w={8}
        h={10}
        config={config}
        onConfigChange={onConfigChange}
      />
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.parts", WIRE);
  });
  return { container, onConfigChange };
}

/** Where each part's centre is drawn, so a turn of the view shows as a change in it. */
function layoutOf(container: HTMLElement): string {
  return Array.from(container.querySelectorAll("svg g[transform]"))
    .map((g) => g.getAttribute("transform"))
    .join("|");
}

describe("the Ship Map rotate control", () => {
  it("leaves the look of Reset and Turn to the kit's button, so hover and focus change them", async () => {
    mount({ turn: 1 });
    await screen.findByRole("button", { name: "Rotate view clockwise" });
    for (const name of [
      "Reset view",
      "Rotate view anticlockwise",
      "Rotate view clockwise",
    ]) {
      const style = screen.getByRole("button", { name }).getAttribute("style");
      expect(style ?? "", name).not.toMatch(/background|color|border/);
    }
  });

  it("turns the view a step each way and saves it in the widget's own config", async () => {
    const user = userEvent.setup();
    const { onConfigChange } = mount({ turn: 3 });
    await user.click(
      await screen.findByRole("button", { name: "Rotate view clockwise" }),
    );
    expect(onConfigChange).toHaveBeenLastCalledWith({ turn: 4 });
    await user.click(
      screen.getByRole("button", { name: "Rotate view anticlockwise" }),
    );
    expect(onConfigChange).toHaveBeenLastCalledWith({ turn: 2 });
  });

  it("goes round a full turn in eight steps", async () => {
    const user = userEvent.setup();
    const { onConfigChange } = mount({ turn: 7 });
    await user.click(
      await screen.findByRole("button", { name: "Rotate view clockwise" }),
    );
    expect(onConfigChange).toHaveBeenLastCalledWith({ turn: 0 });
  });

  it("has no separate default-angle button, and Reset returns a turned view to its default angle", async () => {
    const user = userEvent.setup();
    const { onConfigChange } = mount({ turn: 2 });
    await screen.findByRole("button", { name: "Rotate view clockwise" });
    expect(
      screen.queryByRole("button", { name: "Default view angle" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Reset view" }));
    expect(onConfigChange).toHaveBeenLastCalledWith({ turn: 0 });
  });

  it("labels the turn buttons with arrows and not the word Turn", async () => {
    mount({ turn: 0 });
    for (const name of ["Rotate view clockwise", "Rotate view anticlockwise"]) {
      const button = await screen.findByRole("button", { name });
      expect(button.textContent).toBe("");
      expect(button.querySelector("svg")).not.toBeNull();
    }
  });

  it("draws the craft differently once turned, and as it was after a full turn", async () => {
    const base = mount({ turn: 0 });
    await waitFor(() => expect(layoutOf(base.container)).not.toBe(""));
    const before = base.container.innerHTML;
    base.container.remove();

    const turned = mount({ turn: 1 });
    await waitFor(() => expect(turned.container.innerHTML).not.toBe(""));
    expect(turned.container.innerHTML).not.toBe(before);
    turned.container.remove();

    const full = mount({ turn: 8 });
    await waitFor(() => expect(full.container.innerHTML).not.toBe(""));
    expect(full.container.innerHTML).toBe(before);
  });
});
