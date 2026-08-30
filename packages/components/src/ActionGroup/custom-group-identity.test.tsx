import {
  clearActionHandlers,
  DashboardItemContext,
  getComponent,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  ActionGroupComponent,
  buildToggleArgs,
  toggleCommandFor,
} from "./index";

/**
 * A custom action group is identified by its INDEX, never by the name a player
 * gave it. Two AGX groups may share a display name, and nothing stops a player
 * naming one after a stock singleton.
 *
 * "Stage" is the case that matters, because the stock Stage pill does not
 * toggle anything: it fires `vessel.control.stage`, which is irreversible in
 * flight. A custom group that answers to the stock name would drop a stage off
 * the vessel when the operator meant to flip a switch.
 */

const renderedTrees: Array<() => void> = [];

function renderWidget(
  fixture: ReturnType<typeof setupStreamFixture>,
  actionGroupId: string,
) {
  const { unmount } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "action-group" }}>
        <ActionGroupComponent
          config={{ actionGroupId }}
          id="action-group"
          w={6}
          h={6}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
}

describe("custom action group identity", () => {
  let fixture: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    // No `clearRegistry()`: this file READS the registry (it pulls the widget's
    // real config component out of it to find the id the picker saves), and
    // vitest isolates the registry per file anyway.
    fixture = setupStreamFixture({
      carriedChannels: [
        "vessel.control",
        "vessel.structure",
        "time.warp",
        "comms.link",
      ],
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    clearActionHandlers();
  });

  /**
   * An AGX backend reporting index 5 under the player's own label "Stage".
   * Emitted alone rather than alongside stock's ten, so the only group with an
   * index in the registry is the one under test.
   */
  function emitCustomStage(state: boolean) {
    act(() => {
      fixture.emit("vessel.control", {
        sasMode: 0,
        throttle: 0,
        actionGroups: [{ index: 5, name: "Stage", state }],
      });
      fixture.emit("vessel.structure", { currentStage: 4 });
    });
  }

  // The two pure deciders, asserted directly: they are exported, and a caller
  // holding a group descriptor must get the same answer the widget does.
  describe("the pure command deciders", () => {
    const customStage = {
      name: "Stage",
      toggle: "f.ag5",
      description: "Custom action group 5",
      index: 5,
      provenance: "reported",
    } as const;

    it("routes an indexed group to setActionGroup even when it is named Stage", () => {
      expect(toggleCommandFor(customStage)).toBe(
        "vessel.control.setActionGroup",
      );
    });

    it("builds indexed toggle args for it, not Stage's argument-free command", () => {
      expect(buildToggleArgs(customStage, true)).toEqual({
        group: 5,
        state: false,
      });
    });

    it("still routes the stock Stage singleton, which carries no index", () => {
      const stockStage = {
        name: "Stage",
        toggle: "f.stage",
        description: "Activate next stage",
        provenance: "stock",
      } as const;
      expect(toggleCommandFor(stockStage)).toBe("vessel.control.stage");
      expect(buildToggleArgs(stockStage, 4)).toBeNull();
    });
  });

  /**
   * The player-reachable path, and the reason the two deciders above are not
   * the whole fix: the CONFIG PICKER is what writes the saved id, so whatever
   * it puts in `actionGroupId` is the only id the widget ever sees. While that
   * is the group's display name, an operator who picks their own "Stage" out of
   * the dropdown saves the same six characters the stock singleton answers to,
   * and the stock singleton is first in the registry.
   *
   * Read the picked id off the real config component rather than assuming one,
   * so this test keeps checking the operator's actual route if the id scheme
   * changes again.
   */
  async function pickedIdForCustomStage(): Promise<string> {
    const def = getComponent("action-group");
    const ConfigComponent = def?.configComponent;
    if (!ConfigComponent) {
      throw new Error("action-group has no config component");
    }
    const { unmount } = render(
      <fixture.Provider>
        <ConfigComponent
          config={{ actionGroupId: "AG1" }}
          onSave={() => {}}
          onCancel={() => {}}
          id="action-group"
        />
      </fixture.Provider>,
    );
    renderedTrees.push(unmount);
    // Emitted AFTER the picker mounts: the registry's custom half is derived
    // from `vessel.control`, so the option does not exist until a sample lands.
    emitCustomStage(true);

    const stageOptions = () =>
      Array.from(
        screen.getByRole("combobox", { name: /action group/i }).children,
      ).filter(
        (el): el is HTMLOptionElement =>
          el instanceof HTMLOptionElement && el.textContent === "Stage",
      );
    // Two options now read "Stage": the stock singleton and the operator's own.
    await waitFor(() => expect(stageOptions()).toHaveLength(2));
    // Theirs is the later one, the stock half being listed first.
    return stageOptions()[1].value;
  }

  it("toggles the operator's own group instead of staging the vessel", async () => {
    const user = userEvent.setup();
    const pickedId = await pickedIdForCustomStage();
    // The operator's pick must not collapse onto the stock singleton's id.
    expect(pickedId).not.toBe("Stage");

    renderWidget(fixture, pickedId);
    emitCustomStage(true);

    // The reported group's own state, not `vessel.structure.currentStage` (4).
    await screen.findByText("ON");

    await user.click(screen.getByRole("button", { name: /toggle/i }));

    await waitFor(() => {
      expect(fixture.transport.sentCommands.map((c) => c.command)).toContain(
        "vessel.control.setActionGroup",
      );
    });
    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === "vessel.control.setActionGroup",
    );
    expect(sent?.args).toEqual({ group: 5, state: false });
    // The assertion this file exists for: no stage was dropped.
    expect(fixture.transport.sentCommands.map((c) => c.command)).not.toContain(
      "vessel.control.stage",
    );
  });

  /**
   * The regression guard on the other side: the stock Stage pill must keep
   * staging. Fixing the shadowing must not cost the singleton its command.
   */
  it("keeps the stock Stage pill firing the stage command", async () => {
    const user = userEvent.setup();
    renderWidget(fixture, "Stage");
    emitCustomStage(true);

    await screen.findByText("4");
    await user.click(screen.getByRole("button", { name: /toggle/i }));

    await waitFor(() => {
      expect(fixture.transport.sentCommands.map((c) => c.command)).toContain(
        "vessel.control.stage",
      );
    });
  });
});
