import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { NavballComponent } from "./index";

afterEach(() => clearActionHandlers());

async function mountWithSas(sas: boolean) {
  const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "nav-sas" }}>
        <NavballComponent
          config={{ controlMode: true }}
          id="nav-sas"
          w={10}
          h={21}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.comms", { controlState: 4 });
    fixture.emit("vessel.control", {
      sas,
      sasMode: 0,
      sasModesAvailable: [0],
      rcs: false,
      precisionControl: false,
      throttle: 0,
    });
  });
  await userEvent.click(
    await screen.findByRole("button", { name: "SAS Mode" }),
  );
}

/** The pressed buttons of the mode grid: every pressed button except the SAS, RCS and precision toggles. */
const pressedModes = () =>
  screen
    .getAllByRole("button")
    .filter(
      (b) =>
        b.getAttribute("aria-pressed") === "true" &&
        !/^(SAS (ON|OFF)|RCS|PRECISION)/.test(b.textContent ?? ""),
    );

describe("Navball SAS mode grid", () => {
  it("shows no mode as selected while SAS is off", async () => {
    await mountWithSas(false);
    await screen.findByRole("button", { name: "SAS OFF" });
    expect(pressedModes()).toHaveLength(0);
    await act(async () => {});
  });

  it("shows the reported mode as selected while SAS is on", async () => {
    await mountWithSas(true);
    await screen.findByRole("button", { name: "SAS ON" });
    expect(pressedModes()).toHaveLength(1);
    await act(async () => {});
  });
});
