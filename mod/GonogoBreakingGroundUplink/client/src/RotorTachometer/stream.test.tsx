import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { RotorTachometerComponent } from "./index";

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
 * RotorTachometer runs genuinely off the real `TelemetryProvider`/
 * `TelemetryClient`/`TimelineStore` pipeline via `StubTransport`:
 * `robotics.servos` (filtered to `type === "rotor"`) is its whole identity
 * list, and `robotics.rotor.*` command dispatch rides the same stream via
 * `useCommand`, asserted against `fixture.transport.sentCommands`.
 */
afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

describe("RotorTachometer: genuinely runs off the stream", () => {
  it("builds the rotor list from robotics.servos and drives commands with its string partId", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["robotics.servos", "robotics.available"],
      pinnedUt: 10,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "rt-stream" }}>
          <RotorTachometerComponent id="rt-stream" h={9} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

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

    // The rotor's RPM renders; the hinge entry is ignored (RotorTachometer is
    // rotors-only, hinges/pistons are Robotics Console's domain).
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
      carriedChannels: ["robotics.servos", "robotics.available"],
      pinnedUt: 10,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "rt-coaxial" }}>
          <RotorTachometerComponent id="rt-coaxial" h={9} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

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

    // Default selection is the first entry (partId "1", 100 RPM).
    await waitFor(() => expect(visibleText(container)).toContain("100"));

    const rows = screen.getAllByRole("button", {
      name: new RegExp(rotorName),
    });
    const targetRow = rows.find((r) => visibleText(r).includes("200/300 RPM"));
    if (!targetRow) {
      throw new Error("could not find the partId 2 (200 RPM) rotor row");
    }
    await act(async () => {
      targetRow.click();
    });
    await waitFor(() => expect(visibleText(container)).toContain("↺ CCW"));
  });
});
