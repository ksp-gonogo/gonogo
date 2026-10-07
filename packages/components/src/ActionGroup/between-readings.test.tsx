import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ActionGroupComponent } from "./index";

const CONTROL = {
  sas: true,
  sasMode: 0,
  rcs: false,
  gear: false,
  brakes: false,
  lights: false,
  abort: false,
  precisionControl: false,
  throttle: 0,
  actionGroups: [],
};

afterEach(() => {
  clearActionHandlers();
});

function mount() {
  const fixture = setupStreamFixture({ suspendFrames: true });
  const commandHandler = vi.fn(() => ({ ok: true }));
  fixture.transport.setCommandHandler(commandHandler);
  const rendered = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "ag-late" }}>
        <ActionGroupComponent
          config={{ actionGroupId: "SAS" }}
          id="ag-late"
          w={6}
          h={6}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, commandHandler, ...rendered };
}

/** Let the topic's own updates run late while the link to the game stays up. */
function runLate(fixture: ReturnType<typeof mount>["fixture"]) {
  act(() => {
    fixture.wall.advanceBy(120);
    // Another topic confirming elapsed time is what makes this one overdue.
    fixture.emit(
      "comms.link",
      { connected: true },
      { validAt: 120, deliveredAt: 120 },
    );
  });
}

describe("ActionGroup between two readings of the same value", () => {
  it("keeps the last value, marked held, and stays operable", async () => {
    const { fixture, commandHandler, container } = mount();
    act(() => {
      fixture.emit("vessel.control", CONTROL);
    });
    const toggle = () => screen.getByRole("button", { name: "Toggle SAS" });
    await waitFor(() => expect(toggle().textContent).toContain("ON"));

    runLate(fixture);
    if (process.env.AG_RENDER_DUMP) {
      (await import("node:fs")).writeFileSync(
        process.env.AG_RENDER_DUMP,
        `${toggle().outerHTML}\n`,
      );
    }
    const late = fixture.store.sampleReading("vessel.control");
    expect(late.state === "held" && late.grade).toBe("held");

    expect(toggle().textContent).toContain("ON");
    expect(toggle()).not.toBeDisabled();
    expect(toggle().querySelector("[data-held-mark]")).not.toBeNull();

    act(() => {
      toggle().click();
    });
    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith("vessel.control.setSas", {
        enabled: false,
      }),
    );
    await expectNoA11yViolations(container);
  });

  it("drops the mark when a reading lands", async () => {
    const { fixture } = mount();
    act(() => {
      fixture.emit("vessel.control", CONTROL);
    });
    const toggle = () => screen.getByRole("button", { name: "Toggle SAS" });
    await waitFor(() => expect(toggle().textContent).toContain("ON"));
    runLate(fixture);
    expect(toggle().querySelector("[data-held-mark]")).not.toBeNull();

    act(() => {
      fixture.emit("vessel.control", { ...CONTROL, sas: false });
    });
    await waitFor(() => expect(toggle().textContent).toContain("OFF"));
    expect(toggle().querySelector("[data-held-mark]")).toBeNull();
  });
});
