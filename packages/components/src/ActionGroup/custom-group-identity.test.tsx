import {
  buildToggleArgs,
  clearActionHandlers,
  DashboardItemContext,
  getComponent,
  toggleCommandFor,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ActionGroupComponent } from "./index";

/**
 * A custom action group is identified by its index, never its name, so a custom
 * group named "Stage" toggles itself and never fires the irreversible stage command.
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
    // No `clearRegistry()`: this file reads the widget's real config component out of it.
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

  /** A backend reporting index 5 as "Stage", alone, so it is the only indexed group. */
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

  /** The id the real config picker saves for the custom "Stage", since that is the only id the widget sees. */
  async function pickedIdForCustomStage(): Promise<string> {
    const def = getComponent("action-group");
    const ConfigComponent = def?.configComponent;
    if (!ConfigComponent) {
      throw new Error("action-group has no config component");
    }
    const { unmount } = render(
      <fixture.Provider>
        <ConfigComponent config={{ actionGroupId: "AG1" }} onSave={() => {}} />
      </fixture.Provider>,
    );
    renderedTrees.push(unmount);
    // The custom option exists only once a `vessel.control` sample lands.
    emitCustomStage(true);

    const stageOptions = () =>
      Array.from(
        screen.getByRole("combobox", { name: /action group/i }).children,
      ).filter(
        (el): el is HTMLOptionElement =>
          el instanceof HTMLOptionElement && el.textContent === "Stage",
      );
    await waitFor(() => expect(stageOptions()).toHaveLength(2));
    // The stock singleton is listed first.
    return stageOptions()[1].value;
  }

  it("toggles the operator's own group instead of staging the vessel", async () => {
    const user = userEvent.setup();
    const pickedId = await pickedIdForCustomStage();
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
    expect(fixture.transport.sentCommands.map((c) => c.command)).not.toContain(
      "vessel.control.stage",
    );
  });

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
