import { clearActionHandlers, DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { RotorTachometerComponent } from "./index";

/**
 * The M3 science/parts batch's stream test-adapter proof for
 * RotorTachometer: genuinely running off the real `TelemetryProvider`/
 * `TelemetryClient`/`TimelineStore` pipeline via `StubTransport` for
 * `parts.robotics` — a NEW capability, no legacy Telemachus analogue. The
 * identity list (partId-keyed selection + commands) stays entirely on
 * `robotics.rotors` (still-gapped, no stable id on the new wire —
 * map-topic.ts) — a `setupMockDataSource` AUX carries that, same
 * MIXED-source shape DistanceToTarget/TargetPicker's own M3 batches
 * established. `parts.robotics` merges live `currentRPM`/`rpmLimit`/
 * `normalizedOutput`/`brakePercentage` onto the selected legacy rotor by
 * name.
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

describe("RotorTachometer — genuinely runs off the stream (M3 science/parts batch)", () => {
  it("merges parts.robotics' live rotor fields onto the selected legacy rotor by name", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["parts.robotics"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "robotics.rotors" }, { key: "robotics.available" }],
      connectSource: true,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "rt-stream" }}>
          <RotorTachometerComponent id="rt-stream" h={9} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      legacyAux.source.emit("robotics.available", true);
      legacyAux.source.emit("robotics.rotors", [
        {
          partId: 101,
          name: "Main Rotor",
          rpm: 240,
          rpmLimit: 300,
          torqueLimit: 80,
          maxTorque: 400,
          brakePercentage: 0,
          motorEngaged: true,
          locked: false,
          counterClockwise: false,
          output: 0.8,
        },
      ]);
    });

    await waitFor(() => expect(container.textContent).toContain("240"));

    expect(fixture.transport.isSubscribed("parts.robotics")).toBe(true);
    act(() => {
      fixture.emit("parts.robotics", [
        {
          partName: "Main Rotor",
          type: "rotor",
          servoIsLocked: false,
          servoIsMotorized: true,
          servoMotorIsEngaged: true,
          servoMotorLimit: 80,
          currentRPM: 275,
          rpmLimit: 300,
          normalizedOutput: 0.92,
          brakePercentage: 0,
        },
        {
          partName: "Some Hinge",
          type: "hinge",
          servoIsLocked: false,
          servoIsMotorized: true,
          servoMotorIsEngaged: true,
          servoMotorLimit: 100,
          currentAngle: 10,
          targetAngle: 10,
        },
      ]);
    });

    // The stream's currentRPM (275) wins over the legacy rpm (240); the
    // hinge entry in the same payload is ignored (RotorTachometer is
    // rotors-only, hinges are Robotics Console's domain).
    await waitFor(() => expect(container.textContent).toContain("275"));

    teardownMockDataSource(legacyAux);
  });
});
