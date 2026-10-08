import {
  clearActionHandlers,
  DashboardItemContext,
  dispatchAction,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { TargetPickerComponent } from "./index";

const INSTANCE = "tp-actions";

describe("TargetPicker actions", () => {
  let fixture: StreamFixture;

  const cleared = () =>
    fixture.transport.sentCommands.filter(
      (c) => c.command === "vessel.target.clear",
    );

  beforeEach(() => {
    fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
    render(
      <fixture.Provider>
        <WidgetMetaContext.Provider
          value={{ componentId: "target-picker", contributionSlots: [] }}
        >
          <DashboardItemContext.Provider value={{ instanceId: INSTANCE }}>
            <TargetPickerComponent id={INSTANCE} w={10} h={14} />
          </DashboardItemContext.Provider>
        </WidgetMetaContext.Provider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("vessel.target", {
        name: "Test Station",
        kind: 0,
        relativePosition: { x: 1500, y: 0, z: 0 },
        relativeVelocity: { x: -2.5, y: 0, z: 0 },
      });
    });
  });

  afterEach(() => {
    clearActionHandlers();
  });

  it("clear-target sends vessel.target.clear with no arguments", async () => {
    act(() => {
      dispatchAction(INSTANCE, "clear-target", { kind: "button", value: true });
    });

    await waitFor(() => expect(cleared()).toHaveLength(1));
    expect(cleared()[0]?.args).toBeUndefined();
  });

  it("clear-target ignores the release of the button", async () => {
    act(() => {
      dispatchAction(INSTANCE, "clear-target", {
        kind: "button",
        value: false,
      });
    });
    await act(async () => {});

    expect(cleared()).toHaveLength(0);
  });
});
