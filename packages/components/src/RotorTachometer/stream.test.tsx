import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { RotorTachometerComponent } from "./index";

// Rendered trees, tracked so afterEach can unmount them BEFORE clearing the
// action-handler registry — clearActionHandlers() firing on a still-mounted
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
 * `TelemetryClient`/`TimelineStore` pipeline via `StubTransport` —
 * `parts.robotics` (filtered to `type === "rotor"`) is its whole identity
 * list, not a merge onto a separate legacy read. Command dispatch
 * (`robotics.rotor.*`) still routes through the legacy `DataSource`'s
 * `execute()` — no mod command handler exists for it yet — so a plain
 * `setupMockDataSource` registered under `"data"` captures those calls; it
 * carries no keys of its own and is never emitted to.
 */
afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

describe("RotorTachometer — genuinely runs off the stream", () => {
  it("builds the rotor list from parts.robotics and drives commands with its string partId", async () => {
    const onExecute = vi.fn();
    const fixture = setupStreamFixture({
      carriedChannels: ["parts.robotics", "robotics.available"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [],
      onExecute,
      connectSource: true,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "rt-stream" }}>
          <RotorTachometerComponent id="rt-stream" h={9} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(fixture.transport.isSubscribed("parts.robotics")).toBe(true);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("parts.robotics", [
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
    await waitFor(() => expect(container.textContent).toContain("240"));
    expect(screen.queryByText(/Arm Hinge/)).not.toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: /Raise RPM cap/i }).click();
    });
    expect(onExecute).toHaveBeenCalledWith(
      "robotics.rotor.setRpmLimit[101,310]",
    );

    teardownMockDataSource(legacyAux);
  });

  it("selects among coaxial same-named rotors by their distinct partId", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["parts.robotics", "robotics.available"],
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
        "parts.robotics",
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
    await waitFor(() => expect(container.textContent).toContain("100"));

    const rows = screen.getAllByRole("button", {
      name: new RegExp(rotorName),
    });
    const targetRow = rows.find((r) => r.textContent?.includes("200/300 RPM"));
    if (!targetRow) {
      throw new Error("could not find the partId 2 (200 RPM) rotor row");
    }
    await act(async () => {
      targetRow.click();
    });
    await waitFor(() => expect(container.textContent).toContain("↺ CCW"));
  });
});
