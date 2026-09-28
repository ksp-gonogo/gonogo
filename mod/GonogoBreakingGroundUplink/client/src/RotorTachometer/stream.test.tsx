import {
  act,
  clearActionHandlers,
  render as rtlRender,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { renderWidget, visibleText } from "@ksp-gonogo/ui-kit/testing";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
// Side-effect import: the widget self-registers on module load.
import "./index";

// Unmounted in afterEach before the action-handler registry is cleared, since RTL's own cleanup runs too late.
const renderedTrees: Array<() => void> = [];

function _render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

/** Proves RotorTachometer reads and commands over the real stream pipeline via `StubTransport`. */
afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

describe("RotorTachometer: genuinely runs off the stream", () => {
  it("builds the rotor list from robotics.servos and drives commands with its string partId", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
    });

    const { container } = renderWidget("rotor-tachometer", {
      instanceId: "rt-stream",
      h: 9,
      wrapper: fixture.Provider,
    });

    expect(fixture.transport.isSubscribed("robotics.servos")).toBe(true);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("robotics.servos", [
        {
          partName: "Main Rotor",
          partId: "101",
          type: "rotor",
          servoIsLocked: false,
          servoIsMotorized: true,
          servoMotorIsEngaged: true,
          servoMotorLimit: 80,
          currentRPM: 240,
          rpmLimit: 300,
          normalizedOutput: 0.8,
          brakePercentage: 0,
          counterClockwise: false,
          maxTorque: 400,
        },
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
      ]);
    });

    // The hinge entry is ignored; hinges and pistons belong to Robotics Console.
    await waitFor(() => expect(visibleText(container)).toContain("240"));
    expect(screen.queryByText(/Arm Hinge/)).not.toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: /Raise RPM cap/i }).click();
    });
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "robotics.rotor.setRpmLimit",
      );
      expect(sent).toBeDefined();
      expect(sent?.args).toEqual({ partId: "101", value: 310 });
    });
  });

  it("selects among coaxial same-named rotors by their distinct partId", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
    });

    const { container } = renderWidget("rotor-tachometer", {
      instanceId: "rt-coaxial",
      h: 9,
      wrapper: fixture.Provider,
    });

    const rotorName = "Coaxial Rotor";
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit(
        "robotics.servos",
        [1, 2].map((n) => ({
          partName: rotorName,
          partId: String(n),
          type: "rotor",
          servoIsLocked: false,
          servoIsMotorized: true,
          servoMotorIsEngaged: true,
          servoMotorLimit: 100,
          currentRPM: n * 100,
          rpmLimit: 300,
          normalizedOutput: 0.5,
          brakePercentage: 0,
          counterClockwise: n === 2,
        })),
      );
    });

    await waitFor(() => expect(visibleText(container)).toContain("100"));

    const rows = screen.getAllByRole("button", {
      name: new RegExp(rotorName),
    });
    const targetRow = rows.find((r) => visibleText(r).includes("200/300 rpm"));
    if (!targetRow) {
      throw new Error("could not find the partId 2 (200 RPM) rotor row");
    }
    await act(async () => {
      targetRow.click();
    });
    await waitFor(() => expect(visibleText(container)).toContain("↺ CCW"));
  });
});
