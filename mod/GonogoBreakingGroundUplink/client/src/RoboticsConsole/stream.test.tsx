import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { RoboticsConsoleComponent } from "./index";

// Rendered trees, tracked so afterEach can unmount them BEFORE clearing the
// action-handler registry: clearActionHandlers() firing on a still-mounted
// widget is a state update outside act(). RTL auto-cleanup runs after this
// file's afterEach, too late to unmount first.
const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

/**
 * RoboticsConsole runs genuinely off the real `TelemetryProvider`/
 * `TelemetryClient`/`TimelineStore` pipeline via `StubTransport`:
 * `robotics.servos` is its whole identity list (partId-keyed selection), and
 * `robotics.servo.*` command dispatch rides the same stream via
 * `useCommand`, asserted against `fixture.transport.sentCommands`.
 */
afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

describe("RoboticsConsole: genuinely runs off the stream", () => {
  it("builds the hinge/piston list from robotics.servos and drives commands with its string partId", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["robotics.servos", "robotics.available"],
      pinnedUt: 10,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "rc-stream" }}>
          <RoboticsConsoleComponent id="rc-stream" />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(fixture.transport.isSubscribed("robotics.servos")).toBe(true);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("robotics.servos", [
        {
          partName: "Arm Hinge",
          partId: "11",
          type: "hinge",
          servoIsLocked: false,
          servoIsMotorized: true,
          servoMotorIsEngaged: true,
          servoMotorLimit: 100,
          currentAngle: 22,
          targetAngle: 60,
        },
        {
          partName: "EM-32S Standard Rotor",
          partId: "13",
          type: "rotor",
          servoIsLocked: false,
          servoIsMotorized: true,
          servoMotorIsEngaged: true,
          servoMotorLimit: 0,
          currentRPM: 0,
          rpmLimit: 200,
        },
      ]);
    });

    // The hinge's angle renders; the rotor entry is ignored (RoboticsConsole
    // is hinges/pistons-only, rotors are Rotor Tachometer's domain).
    await waitFor(() => expect(visibleText(container)).toContain("22°"));
    expect(screen.queryByText(/EM-32S Standard Rotor/)).not.toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: /Increase target/i }).click();
    });
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "robotics.servo.setTarget",
      );
      expect(sent).toBeDefined();
      expect(sent?.args).toEqual({ partId: "11", value: 65 });
    });
  });

  it("selects among symmetric same-named hinges by their distinct partId", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["robotics.servos", "robotics.available"],
      pinnedUt: 10,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "rc-symmetric" }}>
          <RoboticsConsoleComponent id="rc-symmetric" />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    const hingeName = "Symmetric Hinge";
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit(
        "robotics.servos",
        [1, 2, 3, 4].map((n) => ({
          partName: hingeName,
          partId: String(n),
          type: "hinge",
          servoIsLocked: false,
          servoIsMotorized: true,
          servoMotorIsEngaged: true,
          servoMotorLimit: 100,
          currentAngle: n * 10,
          targetAngle: n * 10,
        })),
      );
    });

    // Default selection is the first entry (partId "1", 10deg).
    await waitFor(() => expect(visibleText(container)).toContain("10°"));

    const rows = screen.getAllByRole("button", {
      name: new RegExp(hingeName),
    });
    const targetRow = rows.find((r) => visibleText(r).includes("30°/30°"));
    if (!targetRow) {
      throw new Error("could not find the partId 3 (30deg) hinge row");
    }
    await act(async () => {
      targetRow.click();
    });
    await waitFor(() => expect(visibleText(container)).toContain("30°"));
  });
});
