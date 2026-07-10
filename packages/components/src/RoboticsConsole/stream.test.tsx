import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
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
 *
 * P4a shared-map batch: `robotics.available` (-> `robotics.available.
 * available`) is migrated too — it streams through the fixture's
 * `robotics.available` topic instead of the legacy AUX now; only
 * `robotics.servos` (the still-gapped identity list) needs the AUX
 * `DataSource` below.
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

describe("RoboticsConsole — genuinely runs off the stream (M3 science/parts batch)", () => {
  it("merges parts.robotics' live hinge fields onto the selected legacy servo by name", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["parts.robotics", "robotics.available"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "robotics.servos" }],
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
      fixture.emit("robotics.available", { available: true });
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

  it("M3 review #1: refuses to merge-by-name when the selected hinge's name is NOT unique in the streamed list", async () => {
    // Symmetric arms/legs are N identically-named hinges. Four hinges share
    // the name "Symmetric Hinge" at current 10/20/30/40deg (legacy, correct
    // per-part). The operator selects the partId:3 hinge (true 30deg). The
    // stream ALSO carries four same-named entries with no partId, ordered
    // so a first-match `.find` would report partId:1's decoy (11) for
    // whichever row gets selected. Must refuse the ambiguous merge.
    const fixture = setupStreamFixture({
      carriedChannels: ["parts.robotics", "robotics.available"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "robotics.servos" }],
      connectSource: true,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "rc-ambiguous" }}>
          <RoboticsConsoleComponent id="rc-ambiguous" />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    const hingeName = "Symmetric Hinge";
    act(() => {
      fixture.emit("robotics.available", { available: true });
      legacyAux.source.emit(
        "robotics.servos",
        [1, 2, 3, 4].map((partId, i) => ({
          partId,
          name: hingeName,
          type: "hinge",
          current: (i + 1) * 10,
          target: (i + 1) * 10,
          atTarget: true,
          motorEngaged: true,
          locked: false,
          torqueLimit: 100,
        })),
      );
    });

    // Default selection is the first hinge (partId 1, 10deg).
    await waitFor(() => expect(container.textContent).toContain("10°"));

    const rows = screen.getAllByRole("button", {
      name: new RegExp(hingeName),
    });
    const targetRow = rows.find((r) => r.textContent?.includes("30°/30°"));
    if (!targetRow) {
      throw new Error("could not find the partId:3 (30deg) hinge row");
    }
    await act(async () => {
      targetRow.click();
    });
    await waitFor(() => expect(container.textContent).toContain("30°"));

    act(() => {
      fixture.emit(
        "parts.robotics",
        [1, 2, 3, 4].map((_, i) => ({
          partName: hingeName,
          type: "hinge",
          servoIsLocked: false,
          servoIsMotorized: true,
          servoMotorIsEngaged: true,
          servoMotorLimit: 100,
          currentAngle: (i + 1) * 11, // decoys: 11/22/33/44, no partId on the wire
          targetAngle: (i + 1) * 11,
        })),
      );
    });

    expect(fixture.transport.isSubscribed("parts.robotics")).toBe(true);
    // Give the stream leg a chance to settle before asserting — otherwise
    // the check can race the async store update and pass for the wrong
    // reason (checked before the merge would even have applied).
    await waitFor(() => {
      if (container.textContent?.includes("SYNCING")) {
        throw new Error("stream status has not settled to live yet");
      }
    });

    // The dangerous outcome: a first-match `.find` on "Symmetric Hinge"
    // would report partId:1's decoy (11deg) for the selected partId:3
    // hinge. Correct behavior: refuse the ambiguous merge, keep legacy 30.
    expect(container.textContent).not.toContain("11°");
    expect(container.textContent).toContain("30°");

    teardownMockDataSource(legacyAux);
  });
});
