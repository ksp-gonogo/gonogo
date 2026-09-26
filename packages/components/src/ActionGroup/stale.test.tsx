import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AlarmsLauncherProvider } from "../shared/AlarmsLauncher";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ActionGroupComponent } from "./index";

/**
 * A group's state pill is withheld, and says so, once its state stops being
 * current, since the toggle inverts it to build its command. Which groups exist,
 * and Stage's number, are facts and stay held.
 */

const CARRIED = [
  "vessel.control",
  "vessel.structure",
  "time.warp",
  "comms.link",
];

const CONTROL_ALL_OFF = {
  sas: false,
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

const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

function mount(groupId: string, instanceId = `ag-stale-${groupId}`) {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 0,
    suspendFrames: true,
  });
  const commandHandler = vi.fn(() => ({ ok: true }));
  fixture.transport.setCommandHandler(commandHandler);
  const launcher = vi.fn();
  const rendered = render(
    <fixture.Provider>
      <AlarmsLauncherProvider launcher={launcher}>
        <DashboardItemContext.Provider value={{ instanceId }}>
          <ActionGroupComponent
            config={{ actionGroupId: groupId }}
            id={instanceId}
            w={6}
            h={6}
          />
        </DashboardItemContext.Provider>
      </AlarmsLauncherProvider>
    </fixture.Provider>,
  );
  return { fixture, commandHandler, ...rendered };
}

/** Stop the stream delivering, so what has already arrived goes stale. */
function stopDelivering(fixture: ReturnType<typeof mount>["fixture"]) {
  act(() => {
    fixture.store.setTransportConnected(false);
    fixture.store.beginFrame();
  });
}

/** Let a fire-and-forget command settle, so "no dispatch" is a real observation. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ActionGroup when the group's state is not current", () => {
  it("shows the state while it is current", async () => {
    // Control: without it a widget that never shows a state would pass.
    const { fixture } = mount("SAS");
    act(() => {
      fixture.emit("vessel.control", { ...CONTROL_ALL_OFF, sas: true });
    });

    const toggle = () => screen.getByRole("button", { name: "Toggle SAS" });
    await waitFor(() => expect(toggle().textContent).toBe("ON"));
    expect(toggle().getAttribute("title")).toBe("Toggle SAS");
    expect(toggle()).not.toBeDisabled();
  });

  it("withholds the state once it stops arriving, and says why the press is refused", async () => {
    const { fixture, container } = mount("SAS");
    act(() => {
      fixture.emit("vessel.control", { ...CONTROL_ALL_OFF, sas: true });
    });
    const toggle = () => screen.getByRole("button", { name: "Toggle SAS" });
    await waitFor(() => expect(toggle().textContent).toBe("ON"));

    stopDelivering(fixture);

    // A blank pill alone is indistinguishable from waiting for the first sample; the disabled toggle and its reason tell them apart.
    await waitFor(() => expect(toggle()).toBeDisabled());
    expect(toggle().textContent).toBe(NULL_DISPLAY);
    expect(toggle().getAttribute("title")).toBe("Cannot invert a held state");
    // Time is only ever shown through Unit, so the widget writes no currency wording of its own.
    expect(visibleText(container)).not.toMatch(/not current|last contact/i);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("stops presenting the pill as operable, rather than swallowing the press", async () => {
    const { fixture, commandHandler } = mount("SAS");
    act(() => {
      fixture.emit("vessel.control", { ...CONTROL_ALL_OFF, sas: true });
    });
    const toggle = () => screen.getByRole("button", { name: "Toggle SAS" });
    await waitFor(() => expect(toggle().textContent).toBe("ON"));

    // The press reaches the wire while current, so the refusal below is a refusal.
    act(() => {
      toggle().click();
    });
    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith("vessel.control.setSas", {
        enabled: false,
      }),
    );
    expect(fixture.transport.sentCommands).toHaveLength(1);

    stopDelivering(fixture);
    await waitFor(() => expect(toggle()).toBeDisabled());

    act(() => {
      toggle().click();
    });
    await settle();
    // An inverted held boolean is a command to the wrong state, not a late one.
    expect(fixture.transport.sentCommands).toHaveLength(1);
  });

  it("says nothing about a withheld state before anything has ever arrived", async () => {
    // A cold start is not a dropped link, though both read NULL_DISPLAY.
    mount("SAS");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Toggle SAS" }).textContent,
      ).toBe(NULL_DISPLAY),
    );
    expect(
      screen.getByRole("button", { name: "Toggle SAS" }).getAttribute("title"),
    ).toBe("Toggle SAS");
    expect(
      screen.getByRole("button", { name: "Toggle SAS" }),
    ).not.toBeDisabled();
  });
});

describe("ActionGroup: what a stale link does NOT take away", () => {
  it("keeps the group the vessel reported, toggle key and all", async () => {
    // The bell renders only for a group with a toggle key, so it proves the key survived.
    const { fixture } = mount("Radiators", "ag-stale-agx");
    act(() => {
      fixture.emit("vessel.control", {
        ...CONTROL_ALL_OFF,
        actionGroups: [{ index: 5, name: "Radiators", state: true }],
      });
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Toggle Radiators" }).textContent,
      ).toBe("ON"),
    );
    expect(
      screen.getByRole("button", { name: "Set alarm to fire Radiators" }),
    ).toBeTruthy();

    stopDelivering(fixture);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Toggle Radiators" }),
      ).toBeDisabled(),
    );
    expect(screen.queryByText("No action group configured")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Set alarm to fire Radiators" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Rename Radiators" }),
    ).toBeTruthy();
  });

  it("keeps Stage's number and keeps staging available", async () => {
    const { fixture, commandHandler } = mount("Stage", "ag-stale-stage");
    act(() => {
      fixture.emit("vessel.structure", { currentStage: 4 });
    });
    const toggle = () => screen.getByRole("button", { name: "Toggle Stage" });
    await waitFor(() => expect(toggle().textContent).toBe("4"));

    stopDelivering(fixture);

    // Stage's render does not change, so prove the reading did go stale.
    await waitFor(() =>
      expect(fixture.store.sampleReading("vessel.structure").state).toBe(
        "stale",
      ),
    );
    expect(toggle().textContent).toBe("4");
    expect(toggle().getAttribute("title")).toBe("Toggle Stage");
    expect(toggle()).not.toBeDisabled();

    act(() => {
      toggle().click();
    });
    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith("vessel.control.stage", null),
    );
  });
});
