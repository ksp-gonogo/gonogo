import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import servos from "./__fixtures__/servos.json";
import { RoboticsConsoleComponent } from "./index";

/**
 * RoboticsConsole's M3 science/parts batch behavior-preservation golden
 * dual-run (mirrors `DistanceToTarget/dual-run.test.tsx`): the SAME "Arm
 * Hinge" servo state, rendered once off the legacy `DataSource` alone and
 * once with `parts.robotics` carried (merged onto the selected servo by
 * name), must produce byte-identical DOM at `delay=0` — the stream leg's
 * `currentAngle`/`targetAngle`/`servoMotorIsEngaged`/`servoIsLocked`/
 * `servoMotorLimit` are chosen to match `servos.json`'s "Arm Hinge" entry
 * exactly, proving the merge is a genuine no-op parity case.
 *
 * P4a shared-map batch: `robotics.available` (-> `robotics.available.
 * available`) is migrated too. The legacy leg (`snapshotWidgetMode`) never
 * mounts a `TelemetryProvider`, so it still reads it off the plain
 * `DataSource` there; the stream leg now feeds it through the fixture's
 * `robotics.available` topic instead of the legacy AUX, while
 * `robotics.servos` (still-gapped identity list) keeps the AUX.
 */
afterEach(() => {
  cleanup();
});

describe("RoboticsConsole — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup with parts.robotics carried as without it, when its fields match the legacy servo", async () => {
    const mode = { name: "default-5x8", w: 5, h: 8 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: RoboticsConsoleComponent,
      fixture: servos,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: ["parts.robotics", "robotics.available"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: Object.keys(servos)
        .filter((k) => k !== "_meta" && k !== "robotics.available")
        .map((key) => ({ key })),
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "rc-dual" }}>
          <RoboticsConsoleComponent id="rc-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      for (const [key, value] of Object.entries(servos)) {
        if (key === "_meta" || key === "robotics.available") continue;
        legacyAux.source.emit(key, value);
      }
      streamFixture.emit("robotics.available", {
        available: servos["robotics.available"],
      });
      streamFixture.emit("parts.robotics", [
        {
          partName: "Arm Hinge",
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

    await waitFor(() => {
      if (!container.textContent?.includes("22")) {
        throw new Error("stream leg has not rendered the merged angle yet");
      }
      if (container.textContent?.includes("SYNCING")) {
        throw new Error("stream status has not settled to live yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
