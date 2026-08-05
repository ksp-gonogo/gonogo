import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CommandSourcePickerComponent } from "./index";

const ROSTER = [
  { id: "ksc", displayName: "KSC", kind: "ksc", active: true },
  {
    id: "ground:gs1",
    displayName: "Ground Station 1",
    kind: "ground",
    active: true,
  },
  {
    id: "ground:gs2",
    displayName: "Inactive Station",
    kind: "ground",
    active: false,
  },
];

function newFixture() {
  return setupStreamFixture({
    carriedChannels: ["commandCentre.roster"],
    pinnedUt: 10,
  });
}

function renderPicker(fixture: ReturnType<typeof newFixture>) {
  return render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "csp-test" }}>
        <CommandSourcePickerComponent config={{}} id="csp-test" w={6} h={3} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
}

describe("CommandSourcePicker", () => {
  it("lists active centres, marks the selected (default KSC), and selects on click", async () => {
    const fixture = newFixture();
    renderPicker(fixture);
    act(() => {
      fixture.emit("commandCentre.roster", ROSTER);
    });

    const ksc = await screen.findByRole("button", { name: "KSC" });
    const gs1 = screen.getByRole("button", { name: "Ground Station 1" });
    // Inactive centre is not offered.
    expect(
      screen.queryByRole("button", { name: "Inactive Station" }),
    ).toBeNull();
    // Default selection is KSC.
    expect(ksc).toHaveAttribute("aria-pressed", "true");
    expect(gs1).toHaveAttribute("aria-pressed", "false");

    // Selecting GS1 re-points the vantage (setVantage -> reactive useSelectedVantage).
    act(() => {
      gs1.click();
    });
    expect(gs1).toHaveAttribute("aria-pressed", "true");
    expect(ksc).toHaveAttribute("aria-pressed", "false");
  });

  it("shows KSC alone honestly when it is the only centre", async () => {
    const fixture = newFixture();
    renderPicker(fixture);
    act(() => {
      fixture.emit("commandCentre.roster", [
        { id: "ksc", displayName: "KSC", active: true },
      ]);
    });
    expect(
      await screen.findByRole("button", { name: "KSC" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("has no accessible violations", async () => {
    const fixture = newFixture();
    const { container } = renderPicker(fixture);
    act(() => {
      fixture.emit("commandCentre.roster", ROSTER);
    });
    await screen.findByRole("button", { name: "KSC" });
    expect(await axe(container)).toHaveNoViolations();
  });
});
