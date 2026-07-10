import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
 *
 * P4a shared-map batch: `robotics.available` (-> `robotics.available.
 * available`) now streams too — the fixture carries it directly, no legacy
 * AUX needed for that key any more. Only `robotics.rotors` still rides the
 * `setupMockDataSource` AUX.
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

describe("RotorTachometer — genuinely runs off the stream (M3 science/parts batch)", () => {
  it("merges parts.robotics' live rotor fields onto the selected legacy rotor by name", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["parts.robotics", "robotics.available"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "robotics.rotors" }],
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
      fixture.emit("robotics.available", { available: true });
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

  it("M3 review #1: refuses to merge-by-name when the selected rotor's name is NOT unique in the streamed list", async () => {
    // KSP multirotors are N identically-named parts. Four rotors share the
    // name "EM-16S Light Rotor" at 100/200/300/400 RPM (legacy, the correct
    // per-part values). The operator selects the partId:3 rotor (true 300
    // RPM). The stream ALSO carries four same-named entries — with no
    // partId — deliberately ordered so a first-match `.find` would report
    // partId:1's decoy value (111) for whichever row gets selected. The
    // fix must refuse the ambiguous name-join and keep the correct legacy
    // 300, never rendering another rotor's value.
    const fixture = setupStreamFixture({
      carriedChannels: ["parts.robotics", "robotics.available"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "robotics.rotors" }],
      connectSource: true,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "rt-ambiguous" }}>
          <RotorTachometerComponent id="rt-ambiguous" h={9} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    const rotorName = "EM-16S Light Rotor";
    act(() => {
      fixture.emit("robotics.available", { available: true });
      legacyAux.source.emit(
        "robotics.rotors",
        [1, 2, 3, 4].map((partId, i) => ({
          partId,
          name: rotorName,
          rpm: (i + 1) * 100,
          rpmLimit: 460,
          torqueLimit: 80,
          maxTorque: 400,
          brakePercentage: 0,
          motorEngaged: true,
          locked: false,
          counterClockwise: false,
          output: 0.5,
        })),
      );
    });

    // Default selection is the first rotor (partId 1, 100 RPM).
    await waitFor(() => expect(container.textContent).toContain("100"));

    const rows = screen.getAllByRole("button", {
      name: new RegExp(rotorName),
    });
    const targetRow = rows.find((r) => r.textContent?.includes("300/460"));
    if (!targetRow) {
      throw new Error("could not find the partId:3 (300 RPM) rotor row");
    }
    await act(async () => {
      targetRow.click();
    });
    await waitFor(() => expect(container.textContent).toContain("300"));

    act(() => {
      fixture.emit(
        "parts.robotics",
        [1, 2, 3, 4].map((_, i) => ({
          partName: rotorName,
          type: "rotor",
          servoIsLocked: false,
          servoIsMotorized: true,
          servoMotorIsEngaged: true,
          servoMotorLimit: 80,
          currentRPM: (i + 1) * 111, // decoys: 111/222/333/444, no partId on the wire
          rpmLimit: 460,
          normalizedOutput: 0.5,
          brakePercentage: 0,
        })),
      );
    });

    expect(fixture.transport.isSubscribed("parts.robotics")).toBe(true);
    // Give the stream leg a chance to settle (mirrors dual-run.test.tsx's
    // "has not settled to live yet" idiom) before asserting on the outcome
    // — otherwise the assertion can race an async store update and pass
    // for the wrong reason (checked before the merge would even apply).
    await waitFor(() => {
      if (container.textContent?.includes("SYNCING")) {
        throw new Error("stream status has not settled to live yet");
      }
    });

    // The dangerous outcome: a first-match `.find` on "EM-16S Light Rotor"
    // would report partId:1's decoy (111) for the selected partId:3 rotor.
    // Correct behavior: refuse the ambiguous merge and keep legacy 300.
    expect(container.textContent).not.toContain("111");
    expect(container.textContent).toContain("300");

    teardownMockDataSource(legacyAux);
  });

  it("M3 review #1: prefers a stable partId join over name when the wire carries partId, even amid duplicate names", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["parts.robotics", "robotics.available"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "robotics.rotors" }],
      connectSource: true,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "rt-idjoin" }}>
          <RotorTachometerComponent id="rt-idjoin" h={9} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    const rotorName = "EM-16S Light Rotor";
    act(() => {
      fixture.emit("robotics.available", { available: true });
      legacyAux.source.emit(
        "robotics.rotors",
        [1, 2, 3, 4].map((partId, i) => ({
          partId,
          name: rotorName,
          rpm: (i + 1) * 100,
          rpmLimit: 460,
          torqueLimit: 80,
          maxTorque: 400,
          brakePercentage: 0,
          motorEngaged: true,
          locked: false,
          counterClockwise: false,
          output: 0.5,
        })),
      );
    });
    await waitFor(() => expect(container.textContent).toContain("100"));

    const rows = screen.getAllByRole("button", {
      name: new RegExp(rotorName),
    });
    const targetRow = rows.find((r) => r.textContent?.includes("300/460"));
    if (!targetRow) {
      throw new Error("could not find the partId:3 (300 RPM) rotor row");
    }
    await act(async () => {
      targetRow.click();
    });
    await waitFor(() => expect(container.textContent).toContain("300"));

    act(() => {
      fixture.emit(
        "parts.robotics",
        [1, 2, 3, 4].map((partId, i) => ({
          // The real wire's partId is Part.flightID STRINGIFIED (see
          // index.tsx's StreamRotorEntry doc comment) — a STRING, not the
          // legacy list's numeric partId. String() here mirrors that.
          partId: String(partId),
          partName: rotorName,
          type: "rotor",
          servoIsLocked: false,
          servoIsMotorized: true,
          servoMotorIsEngaged: true,
          servoMotorLimit: 80,
          currentRPM: (i + 1) * 111, // 111/222/333/444 — partId:3 => 333
          rpmLimit: 460,
          normalizedOutput: 0.5,
          brakePercentage: 0,
        })),
      );
    });

    // With a stable partId on the wire, the join must find partId:3's own
    // reading (333) — not another rotor's, and not a legacy-fallback 300.
    await waitFor(() => expect(container.textContent).toContain("333"));
    expect(container.textContent).not.toContain("111");

    teardownMockDataSource(legacyAux);
  });
});
