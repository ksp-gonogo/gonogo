import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import rotors from "./__fixtures__/rotors.json";
import { RotorTachometerComponent } from "./index";

/**
 * RotorTachometer's M3 science/parts batch behavior-preservation golden
 * dual-run (mirrors `DistanceToTarget/dual-run.test.tsx`): the SAME "Main
 * Rotor" state, rendered once off the legacy `DataSource` alone and once
 * with `parts.robotics` carried (merged onto the selected rotor by name),
 * must produce byte-identical DOM at `delay=0` — the stream leg's
 * `currentRPM`/`rpmLimit`/`normalizedOutput`/`brakePercentage`/
 * `servoMotorIsEngaged`/`servoIsLocked`/`servoMotorLimit` are chosen to
 * match `rotors.json`'s "Main Rotor" entry exactly, proving the merge is a
 * genuine no-op parity case.
 *
 * P4a shared-map batch: `robotics.available` (-> `robotics.available.
 * available`) is carried by the stream fixture too now — only
 * `robotics.rotors` (still-gapped, no stable id on the wire) rides the
 * legacy `DataSource` AUX on the stream leg.
 */
afterEach(() => {
  cleanup();
});

describe("RotorTachometer — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup with parts.robotics carried as without it, when its fields match the legacy rotor", async () => {
    const mode = { name: "default-6x10", w: 6, h: 10 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: RotorTachometerComponent,
      fixture: rotors,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: ["parts.robotics", "robotics.available"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: Object.keys(rotors)
        .filter((k) => k !== "_meta" && k !== "robotics.available")
        .map((key) => ({ key })),
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "rt-dual" }}>
          <RotorTachometerComponent id="rt-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      for (const [key, value] of Object.entries(rotors)) {
        if (key === "_meta" || key === "robotics.available") continue;
        legacyAux.source.emit(key, value);
      }
      streamFixture.emit("robotics.available", {
        available: rotors["robotics.available"],
      });
      streamFixture.emit("parts.robotics", [
        {
          partName: "Main Rotor",
          type: "rotor",
          servoIsLocked: false,
          servoIsMotorized: true,
          servoMotorIsEngaged: true,
          servoMotorLimit: 80,
          currentRPM: 240,
          rpmLimit: 300,
          normalizedOutput: 0.8,
          brakePercentage: 0,
        },
      ]);
    });

    await waitFor(() => {
      if (!container.textContent?.includes("240")) {
        throw new Error("stream leg has not rendered the merged RPM yet");
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
