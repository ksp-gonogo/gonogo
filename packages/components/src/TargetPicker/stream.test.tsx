import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TargetPickerComponent } from "./index";

/**
 * Stream test-adapter proof for TargetPicker's
 * vessel roster: genuinely running off the real `TelemetryProvider`/
 * `TelemetryClient`/`TimelineStore` pipeline via `StubTransport`.
 * `tar.availableVessels` maps onto `system.vessels` (map-topic.ts) — a
 * structurally different roster shape (`{vessels:[{vesselId,name,
 * vesselType,situation,bodyIndex}]}`, no position/distance field) —
 * normalized into `DisplayVesselEntry` (index.tsx's `normalizeRoster`) so
 * the rendered rows/sort/click-to-target behave the same either way. Bodies
 * come off `useCelestialBodies` → the `system.bodies` stream Topic, so a
 * `system.bodies` emit (Kerbin at index 1) resolves the roster entries'
 * `bodyIndex` to "Kerbin". A small `setupMockDataSource` AUX still feeds the
 * legacy-shim target-detail reads (`tar.name`/`tar.type`).
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

function emitKerbinBodies(fixture: { emit: (t: string, p: unknown) => void }) {
  fixture.emit("system.bodies", {
    bodies: [
      { index: 0, name: "Sun", parentIndex: null, orbit: null },
      { index: 1, name: "Kerbin", parentIndex: 0, orbit: null },
    ],
  });
}

describe("TargetPicker — genuinely runs off the stream (M3 vessel-gap batch)", () => {
  it("renders the system.vessels roster (no legacy AvailableVesselEntry shape anywhere)", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["system.vessels", "system.bodies"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "tar.name" }, { key: "tar.type" }],
      connectSource: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "tp-stream" }}>
          <TargetPickerComponent id="tp-stream" w={10} h={12} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(fixture.transport.isSubscribed("system.vessels")).toBe(true);

    act(() => {
      emitKerbinBodies(fixture);
      fixture.emit("system.vessels", {
        vessels: [
          {
            vesselId: "aaaa-1111",
            name: "Kerbin Station I",
            vesselType: 1, // Station
            situation: 3, // Orbiting
            bodyIndex: 1,
          },
          {
            vesselId: "bbbb-2222",
            name: "Ast. UQR-118",
            vesselType: 10, // SpaceObject
            situation: 3,
            bodyIndex: 1,
          },
        ],
      });
    });

    // Switch to the Vessels tab.
    const vesselsTab = await screen.findByRole("tab", { name: "Vessels" });
    act(() => {
      vesselsTab.click();
    });

    await waitFor(() =>
      expect(screen.getByText("Kerbin Station I")).toBeTruthy(),
    );
    // No position on the new roster shape -> distance renders "—".
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
    // vesselType 1 -> "Station"; bodyIndex 1 -> "Kerbin" (resolved via the
    // still-legacy useCelestialBodies roster).
    expect(screen.getByText("Station · Kerbin")).toBeTruthy();
    // The SpaceObject entry is hidden by default (asteroid toggle).
    expect(screen.queryByText("Ast. UQR-118")).toBeNull();
    expect(screen.getByText("Asteroids: hidden (1)")).toBeTruthy();

    teardownMockDataSource(legacyAux);
  });

  it("clicking a roster vessel dispatches vessel.target.set with the real vesselId, never a positional index", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["system.vessels", "system.bodies", "vessel.target.set"],
      pinnedUt: 10,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "tar.name" }, { key: "tar.type" }],
      connectSource: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "tp-cmd" }}>
          <TargetPickerComponent id="tp-cmd" w={10} h={12} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      emitKerbinBodies(fixture);
      fixture.emit("system.vessels", {
        vessels: [
          {
            vesselId: "aaaa-1111",
            name: "Kerbin Station I",
            vesselType: 1,
            situation: 3,
            bodyIndex: 1,
          },
        ],
      });
    });

    const vesselsTab = await screen.findByRole("tab", { name: "Vessels" });
    act(() => {
      vesselsTab.click();
    });

    const row = await screen.findByRole("button", {
      name: /Kerbin Station I/,
    });
    act(() => {
      row.click();
    });

    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith("vessel.target.set", {
        kind: 0,
        vesselId: "aaaa-1111",
      }),
    );

    teardownMockDataSource(legacyAux);
  });
});
