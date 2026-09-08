import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AlarmsLauncherProvider } from "../shared/AlarmsLauncher";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ActionGroupComponent } from "./index";

/**
 * What ActionGroup does with a group whose state the backend could not read.
 *
 * `ActionGroupState.state` is three-valued (`bool?` in the contract) precisely
 * so a backend that reads each group separately can fail on ONE of them: AGX
 * reflects into its own scenario module per group, and the whole-tick null on
 * `actionGroups` cannot say "these nine answered and that one did not". While
 * the field was a plain bool the failure published as `false`, and `false` here
 * is a claim: the group is disengaged, the toggle draws OFF, and inverting that
 * reading commands the wrong way.
 *
 * Stock cannot produce this state (its indexer answers for all ten of its
 * groups whenever the vessel has an ActionGroups list at all), so the fixture
 * emits the payload directly rather than going through a backend. That is what
 * the widget sees on the wire either way.
 */

const CARRIED = [
  "vessel.control",
  "vessel.structure",
  "time.warp",
  "comms.link",
];

const CONTROL_BASE = {
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

function mount(groupId: string, instanceId = `ag-unreadable-${groupId}`) {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 0,
    suspendFrames: true,
  });
  const commandHandler = vi.fn(() => ({ ok: true }));
  fixture.transport.setCommandHandler(commandHandler);
  const rendered = render(
    <fixture.Provider>
      <AlarmsLauncherProvider launcher={vi.fn()}>
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

/** Let a fire-and-forget command settle, so "no dispatch" is a real observation. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ActionGroup when the backend could not read the group", () => {
  it("draws a readable group's state, so the withholding below is a decision", async () => {
    /*
     * The control. `false` is a real answer and must keep reading OFF on an
     * operable toggle. Every assertion below would also pass on a widget that
     * had simply stopped rendering group state at all.
     */
    const { fixture } = mount("Radiators", "ag-unreadable-control");
    act(() => {
      fixture.emit("vessel.control", {
        ...CONTROL_BASE,
        actionGroups: [{ index: 5, name: "Radiators", state: false }],
      });
    });

    const toggle = () =>
      screen.getByRole("button", { name: "Toggle Radiators" });
    await waitFor(() => expect(toggle().textContent).toBe("OFF"));
    expect(toggle()).not.toBeDisabled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("refuses to call an unread group OFF, and says which kind of unknown it is", async () => {
    const { fixture } = mount("Radiators");
    act(() => {
      fixture.emit("vessel.control", {
        ...CONTROL_BASE,
        actionGroups: [{ index: 5, name: "Radiators", state: null }],
      });
    });

    const toggle = () =>
      screen.getByRole("button", { name: "Toggle Radiators" });
    await waitFor(() => expect(toggle().textContent).toBe(NULL_DISPLAY));

    /*
     * The empty pill alone is not the fix. It is what this widget shows before
     * anything arrives and while a link is stale, so the reason has to be
     * legible from outside. Asserted through the TITLE, a sentence only this
     * widget writes, rather than the badge's two words, which several widgets
     * could plausibly render for their own absences.
     */
    const reason = screen.getByRole("status");
    expect(reason.textContent).toBe("State unreadable");
    expect(reason.getAttribute("title")).toBe(
      "The backend reported this group but could not read whether it is engaged, so the toggle is held",
    );
  });

  it("holds the toggle rather than swallowing a press it cannot invert", async () => {
    const { fixture, commandHandler } = mount(
      "Radiators",
      "ag-unreadable-press",
    );
    act(() => {
      fixture.emit("vessel.control", {
        ...CONTROL_BASE,
        actionGroups: [{ index: 5, name: "Radiators", state: true }],
      });
    });
    const toggle = () =>
      screen.getByRole("button", { name: "Toggle Radiators" });
    await waitFor(() => expect(toggle().textContent).toBe("ON"));

    // Proof the press reaches the wire while the state is readable, so the
    // refusal below is a refusal and not a broken command path.
    act(() => {
      toggle().click();
    });
    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith(
        "vessel.control.setActionGroup",
        { group: 5, state: false },
      ),
    );
    expect(fixture.transport.sentCommands).toHaveLength(1);

    act(() => {
      fixture.emit("vessel.control", {
        ...CONTROL_BASE,
        actionGroups: [{ index: 5, name: "Radiators", state: null }],
      });
    });
    await waitFor(() => expect(toggle()).toBeDisabled());

    act(() => {
      toggle().click();
    });
    await settle();
    /*
     * Nothing further on the wire. There is no boolean to invert, so a press
     * here would have to guess a state, and a guessed absolute-set is a command
     * to the wrong state rather than a late one.
     */
    expect(fixture.transport.sentCommands).toHaveLength(1);
  });

  it("explains the empty pill rather than yielding to Paused, which explains nothing about it", async () => {
    /*
     * Ordering pin. The reason ladder is read top-down and this arm sits
     * immediately above the two game/link conditions, so those are exactly the
     * cases it takes. "Paused" is true and irrelevant here: the game being
     * paused is not why nobody knows what this group is doing, and putting it
     * on the line leaves the operator reading a confident sentence about a
     * different screen.
     */
    const { fixture } = mount("Radiators", "ag-unreadable-paused");
    act(() => {
      fixture.emit("time.warp", { paused: true });
      fixture.emit("comms.link", { connected: true });
      fixture.emit("vessel.control", {
        ...CONTROL_BASE,
        actionGroups: [{ index: 5, name: "Radiators", state: null }],
      });
    });

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("State unreadable"),
    );
  });

  it("leaves a group nobody reported on its own reason line", async () => {
    /*
     * The other ordering edge, and the one an arm placed too greedily would
     * steal. A configured group missing from the reported list is
     * `provenance: "assumed"`: the registry invented it out of the saved
     * config, which is a different fact from a backend reporting a group and
     * then failing to read it. Both leave the pill empty, so only the sentence
     * separates them.
     */
    const { fixture } = mount("Radiators", "ag-unreadable-assumed");
    act(() => {
      fixture.emit("vessel.control", {
        ...CONTROL_BASE,
        actionGroups: [{ index: 9, name: "Something else", state: true }],
      });
    });

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Not reported"),
    );
  });
});
