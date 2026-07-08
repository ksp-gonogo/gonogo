import { clearActionHandlers, DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { RoboticsConsoleComponent } from "./index";

/**
 * The M3 science/parts batch's stream test-adapter proof for RoboticsConsole:
 * genuinely running off the real `TelemetryProvider`/`TelemetryClient`/
 * `TimelineStore` pipeline via `StubTransport` for `parts.robotics` — a NEW
 * capability, no legacy Telemachus analogue. The identity list (partId-keyed
 * selection + commands) stays entirely on `robotics.servos` (still-gapped,
 * no stable id on the new wire — map-topic.ts) — a `setupMockDataSource` AUX
 * carries that, same MIXED-source shape DistanceToTarget/TargetPicker's own
 * M3 batches established. `parts.robotics` merges live numeric fields onto
 * the selected legacy servo by name.
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

describe("RoboticsConsole — genuinely runs off the stream (M3 science/parts batch)", () => {
  it("merges parts.robotics' live hinge fields onto the selected legacy servo by name", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["parts.robotics"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "robotics.servos" }, { key: "robotics.available" }],
      connectSource: true,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "rc-stream" }}>
          <RoboticsConsoleComponent id="rc-stream" />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      legacyAux.source.emit("robotics.available", true);
      legacyAux.source.emit("robotics.servos", [
        {
          partId: 11,
          name: "Arm Hinge",
          type: "hinge",
          current: 22,
          target: 60,
          atTarget: false,
          motorEngaged: true,
          locked: false,
          torqueLimit: 100,
        },
      ]);
    });

    await waitFor(() => expect(screen.getByText("MOVING")).toBeTruthy());
    // Legacy-only numbers before the stream carries anything.
    expect(container.textContent).toContain("22°");

    expect(fixture.transport.isSubscribed("parts.robotics")).toBe(true);
    act(() => {
      fixture.emit("parts.robotics", [
        {
          partName: "Arm Hinge",
          type: "hinge",
          servoIsLocked: false,
          servoIsMotorized: true,
          servoMotorIsEngaged: true,
          servoMotorLimit: 45,
          currentAngle: 33,
          targetAngle: 60,
        },
        {
          partName: "EM-32S Standard Rotor",
          type: "rotor",
          servoIsLocked: false,
          servoIsMotorized: true,
          servoMotorIsEngaged: true,
          servoMotorLimit: 0,
          currentAngle: null,
          targetAngle: null,
        },
      ]);
    });

    // The stream's currentAngle (33) wins over the legacy current (22); the
    // rotor entry in the same payload is ignored (RoboticsConsole is
    // hinges-only, rotors are Rotor Tachometer's domain).
    await waitFor(() => expect(container.textContent).toContain("33°"));

    teardownMockDataSource(legacyAux);
  });
});
