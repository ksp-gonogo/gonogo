import {
  clearActionHandlers,
  DashboardItemContext,
  dispatchAction,
  PerfBudget,
} from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { NavballComponent } from "./index";

/**
 * Navball's discrete commands carry no refusal line of their own: each handle
 * is registered on the panel's delay rail, which says what the game refused and
 * why. The test render mounts a rail, as the dashboard does around every widget.
 */

beforeEach(() => {
  PerfBudget.getAll()
    .find((b) => b.name.startsWith("useActionInput register"))
    ?.reset();
});

afterEach(() => {
  clearActionHandlers();
});

const REFUSAL = "the vessel is not controllable";

function mountRefusing(instanceId: string) {
  const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
  fixture.transport.setCommandHandler(() => ({
    success: false,
    errorCode: 9,
    detail: REFUSAL,
  }));
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <NavballComponent
          config={{ controlMode: true }}
          id={instanceId}
          w={10}
          h={20}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.control", {
      sas: true,
      sasMode: 0,
      rcs: false,
      gear: false,
      brakes: false,
      lights: false,
      throttle: 0,
      actionGroups: [],
    });
  });
}

function railText(): string {
  return document.querySelector("[data-panel-rail-frame]")?.textContent ?? "";
}

const PRESS = { kind: "button", value: true } as const;

describe("a refused Navball command is shown on the panel's delay rail", () => {
  it.each([
    ["toggle-sas", PRESS, "Toggle SAS"],
    ["toggle-rcs", PRESS, "Toggle RCS"],
    ["sas-prograde", PRESS, "SAS mode: Prograde"],
    ["arm-fbw", PRESS, "Arm FBW"],
    ["disarm-fbw", PRESS, "Disarm FBW"],
    ["kill-rotation", PRESS, "SAS on"],
    ["set-pitch-trim", { kind: "analog", value: 0.25 }, "Pitch trim"],
  ] as const)("%s", async (action, payload, label) => {
    const id = `nav-refused-${action}`;
    mountRefusing(id);
    act(() => {
      dispatchAction(id, action, payload);
    });
    await waitFor(() => expect(railText()).toContain(`refused: ${REFUSAL}`));
    expect(railText()).toContain(label);
  });
});
