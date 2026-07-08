import { clearActionHandlers, DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TargetPickerComponent } from "./index";

/**
 * The M3 vessel-gap batch's stream test-adapter proof for TargetPicker's
 * vessel roster: genuinely running off the real `TelemetryProvider`/
 * `TelemetryClient`/`TimelineStore` pipeline via `StubTransport`.
 * `tar.availableVessels` maps onto `system.vessels` (map-topic.ts) — a
 * structurally different roster shape (`{vessels:[{vesselId,name,
 * vesselType,situation,bodyIndex}]}`, no position/distance field) —
 * normalized into `DisplayVesselEntry` (index.tsx's `normalizeRoster`) so
 * the rendered rows/sort/click-to-target behave the same either way. Bodies
 * still come off `useCelestialBodies` (a `getDataSource()` shim-BYPASS —
 * that hook subscribes directly, never through `useDataValue` — so it stays
 * legacy-only regardless of whether a TelemetryProvider is mounted; a small
 * `setupMockDataSource` AUX feeds it here, same as `tar.name`/`tar.type`).
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

const BODY_KEYS = [
  { key: "b.number" },
  { key: "b.name[0]" },
  { key: "b.referenceBody[0]" },
  { key: "b.name[1]" },
  { key: "b.referenceBody[1]" },
];

function emitKerbinBodies(source: { emit: (k: string, v: unknown) => void }) {
  source.emit("b.number", 2);
  source.emit("b.name[0]", "Sun");
  source.emit("b.referenceBody[0]", "Sun");
  source.emit("b.name[1]", "Kerbin");
  source.emit("b.referenceBody[1]", "Sun");
}

describe("TargetPicker — genuinely runs off the stream (M3 vessel-gap batch)", () => {
  it("renders the system.vessels roster (no legacy AvailableVesselEntry shape anywhere)", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["system.vessels"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [...BODY_KEYS, { key: "tar.name" }, { key: "tar.type" }],
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
      emitKerbinBodies(legacyAux.source);
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
      carriedChannels: ["system.vessels", "vessel.target.set"],
      pinnedUt: 10,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [...BODY_KEYS, { key: "tar.name" }, { key: "tar.type" }],
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
      emitKerbinBodies(legacyAux.source);
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
