import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { isDisabled } from "../test/isDisabled";
import { openSections } from "../test/openSections";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { NavballComponent } from "./index";

const CONTROL_SIZE = { w: 9, h: 21 };

/** A craft that cannot be flown, with the one-way delay its commands cross. */
function mountUncontrollable(oneWaySeconds: number | null) {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "nav" }}>
        <NavballComponent
          config={{ controlMode: true }}
          id="nav"
          w={CONTROL_SIZE.w}
          h={CONTROL_SIZE.h}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  openSections();
  act(() => {
    if (oneWaySeconds !== null) {
      fixture.emit("comms.delay", { oneWaySeconds });
    }
    fixture.emit("system.uplink.delays", {
      activeVessel: [
        "vessel.control.setSasMode",
        "vessel.control.setThrottle",
        "vessel.control.setFlyByWire",
      ],
      elsewhere: [],
    });
    fixture.emit("vessel.comms", { controlState: 0 });
    fixture.emitFrame();
  });
  return fixture;
}

const REASON = "the vessel is not controllable";

describe("Navball controls and how long the verdict is held", () => {
  it.each([
    [4.9, "stopped"],
    [5, "advised"],
    [10, "advised"],
  ] as const)("a SAS mode button on an uncontrollable craft with %s s one way is %s", async (seconds, outcome) => {
    const user = userEvent.setup();
    const fixture = mountUncontrollable(seconds);
    const button = await screen.findByRole("button", { name: /^PRO$/ });
    if (outcome === "advised") {
      await waitFor(() =>
        expect(button).toHaveAttribute(
          "data-tooltip",
          "SAS mode: Prograde likely to be refused: the vessel is not controllable.",
        ),
      );
    }
    await user.click(button);
    const sent = () =>
      fixture.transport.sentCommands.filter(
        (c) => c.command === "vessel.control.setSasMode",
      );
    if (outcome === "stopped") {
      await waitFor(() => expect(isDisabled(button)).toBe(true));
      expect(button).toHaveAttribute(
        "data-tooltip",
        `SAS mode: Prograde unavailable: ${REASON}.`,
      );
      expect(sent()).toHaveLength(0);
    } else {
      await waitFor(() =>
        expect(button).toHaveAttribute("data-predicted", "at-risk"),
      );
      expect(isDisabled(button)).toBe(false);
      await waitFor(() => expect(sent()).toHaveLength(1));
    }
    await act(async () => {});
  });

  it("stops ZERO, FULL, the fly-by-wire toggle and the throttle slider while the verdict is fresh", async () => {
    const user = userEvent.setup();
    const fixture = mountUncontrollable(1);
    for (const name of [/^ZERO$/, /^FULL$/, /Arm FBW/]) {
      const button = await screen.findByRole("button", { name });
      await waitFor(() => expect(isDisabled(button)).toBe(true));
      await user.click(button);
    }
    expect(isDisabled(screen.getByRole("slider", { name: "Throttle" }))).toBe(
      true,
    );
    expect(
      fixture.transport.sentCommands.filter((c) =>
        /setThrottle|setFlyByWire/.test(c.command),
      ),
    ).toHaveLength(0);
    await act(async () => {});
  });
});
