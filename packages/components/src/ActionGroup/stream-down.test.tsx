import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { STREAM_DOWN_TIP } from "@ksp-gonogo/ui-kit";
import { renderWidget } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ActionGroupComponent } from "./index";
import "./index";

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

function mountBody() {
  const fixture = setupStreamFixture({ suspendFrames: true });
  const commandHandler = vi.fn(() => ({ ok: true }));
  fixture.transport.setCommandHandler(commandHandler);
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "ag-down" }}>
        <ActionGroupComponent
          config={{ actionGroupId: "SAS" }}
          id="ag-down"
          w={6}
          h={6}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.control", CONTROL);
    fixture.emit("comms.link", { connected: true });
    fixture.emit("time.warp", { paused: false });
  });
  return { fixture, commandHandler };
}

describe("ActionGroup with the stream to the mod down", () => {
  it("greys the toggle, sends nothing on a press, and works again when the stream returns", async () => {
    const user = userEvent.setup();
    const { fixture } = mountBody();
    const toggle = await screen.findByRole("button", { name: "Toggle SAS" });
    await waitFor(() => expect(toggle).not.toHaveAttribute("aria-disabled"));

    act(() => {
      fixture.store.setTransportConnected(false);
    });
    await waitFor(() =>
      expect(toggle).toHaveAttribute("aria-disabled", "true"),
    );
    await user.click(toggle);
    await act(async () => {});
    expect(fixture.transport.sentCommands).toHaveLength(0);

    act(() => {
      fixture.store.setTransportConnected(true);
    });
    await waitFor(() => expect(toggle).not.toHaveAttribute("aria-disabled"));
    await user.click(toggle);
    await waitFor(() => expect(fixture.transport.sentCommands).toHaveLength(1));
  });

  it("greys the tiny form's toggle the same way, with the reason as its tip", async () => {
    const user = userEvent.setup();
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    renderWidget("action-group", {
      w: 4,
      h: 4,
      config: { actionGroupId: "SAS" },
      wrapper: fixture.Provider,
    });
    act(() => {
      fixture.emit("vessel.control", CONTROL);
      fixture.emit("comms.link", { connected: true });
      fixture.emit("time.warp", { paused: false });
      fixture.store.setTransportConnected(false);
    });
    const toggle = await screen.findByRole("button", { name: "Toggle SAS" });
    await waitFor(() => expect(toggle).toBeDisabled());
    expect(
      document.querySelector(`[data-tooltip="${STREAM_DOWN_TIP}"]`),
    ).not.toBeNull();
    await user.click(toggle);
    expect(fixture.transport.sentCommands).toHaveLength(0);
    await act(async () => {});
  });
});
