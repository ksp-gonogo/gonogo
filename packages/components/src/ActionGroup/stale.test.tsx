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
 * What ActionGroup does when the state behind its pill is no longer current.
 *
 * The decision, not a description of the migration: the state pill is WITHHELD.
 * "ON" is a two-state verdict about the vessel now (an operator reads it as the
 * gear being down, not as the gear having been down a while ago), and the same
 * boolean is inverted to build the toggle's absolute-set command, so a held
 * value would both misstate the craft and command the wrong way. This file's
 * companion assertion is the one that earns it: an empty pill is also what the
 * widget shows before anything has ever arrived, so "withheld" has to be
 * legible from outside the component or the failure mode is a control that looks
 * merely slow.
 *
 * Two things are deliberately NOT withheld, and each has its own case below:
 * which action groups the vessel has, and Stage's number. Both change only when
 * an event changes them, and no event can reach us down a link that has stopped
 * delivering.
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
    // The control. Without it every assertion below would also pass on a widget
    // that never shows a state at all.
    const { fixture } = mount("SAS");
    act(() => {
      fixture.emit("vessel.control", { ...CONTROL_ALL_OFF, sas: true });
    });

    const toggle = () => screen.getByRole("button", { name: "Toggle SAS" });
    await waitFor(() => expect(toggle().textContent).toBe("ON"));
    expect(screen.queryByText("State not current")).toBeNull();
    expect(toggle()).not.toBeDisabled();
  });

  it("withholds the state once it stops arriving, and SAYS SO", async () => {
    const { fixture, container } = mount("SAS");
    act(() => {
      fixture.emit("vessel.control", { ...CONTROL_ALL_OFF, sas: true });
    });
    const toggle = () => screen.getByRole("button", { name: "Toggle SAS" });
    await waitFor(() => expect(toggle().textContent).toBe("ON"));

    stopDelivering(fixture);

    await waitFor(() => {
      // Deliberate and readable from the outside. The blank pill on its own
      // would satisfy "not claiming ON" while being indistinguishable from a
      // widget still waiting for its first sample.
      expect(visibleText(container)).toContain("State not current");
    });
    expect(toggle().textContent).toBe(NULL_DISPLAY);
    expect(toggle().getAttribute("title")).toBe("State not current");
  });

  it("stops presenting the pill as operable, rather than swallowing the press", async () => {
    const { fixture, commandHandler } = mount("SAS");
    act(() => {
      fixture.emit("vessel.control", { ...CONTROL_ALL_OFF, sas: true });
    });
    const toggle = () => screen.getByRole("button", { name: "Toggle SAS" });
    await waitFor(() => expect(toggle().textContent).toBe("ON"));

    // Prove the press reaches the wire while the state is current, so the
    // refusal below is a refusal and not a broken command path.
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
    // Nothing further on the wire: an inverted held boolean is not a stale
    // command, it is a command to the wrong state.
    expect(fixture.transport.sentCommands).toHaveLength(1);
  });

  it("says nothing about a withheld state before anything has ever arrived", async () => {
    // A cold start is not a dropped link, and the pill reads NULL_DISPLAY in
    // both cases. Conflating them would accuse the stream of dropping on first
    // paint, every paint.
    mount("SAS");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Toggle SAS" }).textContent,
      ).toBe(NULL_DISPLAY),
    );
    expect(screen.queryByText("State not current")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Toggle SAS" }),
    ).not.toBeDisabled();
  });
});

describe("ActionGroup: what a stale link does NOT take away", () => {
  it("keeps the group the vessel reported, toggle key and all", async () => {
    // The registry half of `vessel.control` is a fact: an AGX group named
    // something other than AG{n} exists ONLY in the arrived list, and losing it
    // would silently demote the control to a nameless read-only pill with no
    // toggle key. The bell is the visible proof the key survived, it renders
    // only for a group that has one.
    const { fixture, container } = mount("Radiators", "ag-stale-agx");
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
      expect(visibleText(container)).toContain("State not current"),
    );
    // The group is still there and still identified; only its state went.
    expect(screen.queryByText("No action group configured")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Set alarm to fire Radiators" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Rename Radiators" }),
    ).toBeTruthy();
  });

  it("keeps Stage's number and keeps staging available", async () => {
    // Stage is the one state here that cannot drift while nobody is looking:
    // it moves when something stages. And the stage command never inverts the
    // number, so nothing unsafe rides on it being current. Blanking it would
    // cost the operator a readout and buy no honesty.
    const { fixture, commandHandler, container } = mount(
      "Stage",
      "ag-stale-stage",
    );
    act(() => {
      fixture.emit("vessel.structure", { currentStage: 4 });
    });
    const toggle = () => screen.getByRole("button", { name: "Toggle Stage" });
    await waitFor(() => expect(toggle().textContent).toBe("4"));

    stopDelivering(fixture);

    // Proof the reading really did go stale. Stage's render is unchanged by
    // design, so without this the case would pass on a fixture that never
    // stopped delivering at all.
    await waitFor(() =>
      expect(fixture.store.sampleReading("vessel.structure").state).toBe(
        "stale",
      ),
    );
    expect(toggle().textContent).toBe("4");
    expect(visibleText(container)).not.toContain("State not current");
    expect(toggle()).not.toBeDisabled();

    act(() => {
      toggle().click();
    });
    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith("vessel.control.stage", null),
    );
  });
});
