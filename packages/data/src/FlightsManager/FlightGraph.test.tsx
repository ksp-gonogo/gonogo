import { clearRegistry, registerDataSource } from "@ksp-gonogo/core";
import type { ReplayFixture } from "@ksp-gonogo/sitrep-client";
import type { ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import { Quality, Staleness } from "@ksp-gonogo/sitrep-sdk";
import { render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MissionStore } from "../storage/MissionStore";
import { FlightGraph } from "./FlightGraph";
import { MissionHistorySource } from "./MissionHistorySource";

function frame(topic: string, payload: unknown, deliveredAt: number): string {
  const message: ServerMessage = {
    type: "stream-data",
    topic,
    payload,
    meta: {
      source: "stub",
      validAt: deliveredAt,
      seq: 0,
      deliveredAt,
      vantage: "stub",
      quality: Quality.OnRails,
      active: false,
      staleness: Staleness.Fresh,
      timelineEpoch: 0,
    },
  };
  return JSON.stringify(message);
}

let dbCounter = 0;

describe("FlightGraph", () => {
  let store: MissionStore;
  let historySource: MissionHistorySource;
  let missionId: string;
  const firstFrameUt = 0;
  const lastFrameUt = 20; // 5 samples, 5s apart

  beforeEach(async () => {
    clearRegistry();
    dbCounter += 1;
    store = new MissionStore({ dbName: `flightgraph-test-${dbCounter}` });
    historySource = new MissionHistorySource(store);
    registerDataSource(historySource);

    const fixture: ReplayFixture = {
      subscribedTopics: ["vessel.state", "vessel.flight"],
      frames: Array.from({ length: 5 }, (_, i) => [
        frame("vessel.state", { altitudeAsl: 1000 + i * 100 }, i * 5),
        frame("vessel.flight", { verticalSpeed: 10 + i }, i * 5),
      ]).flat(),
    };

    missionId = "m1";
    await store.saveMission({
      meta: {
        id: missionId,
        vesselName: "Test",
        launchedAt: Date.now(),
        firstFrameUt,
        lastFrameUt,
        frameCount: 10,
      },
      fixture,
    });
  });

  it("renders a placeholder until the user picks a data key", () => {
    render(
      <FlightGraph
        missionId={missionId}
        firstFrameUt={firstFrameUt}
        lastFrameUt={lastFrameUt}
      />,
    );

    expect(
      screen.getByText(/pick one or more numeric telemetry keys/i),
    ).toBeTruthy();
  });

  it("excludes non-numeric keys (enum/bool/raw) from the picker", async () => {
    render(
      <FlightGraph
        missionId={missionId}
        firstFrameUt={firstFrameUt}
        lastFrameUt={lastFrameUt}
      />,
    );

    // v.name is enum — should never appear among the picker's rendered options.
    // v.altitude carries the "m" unit — should appear.
    await waitFor(() => {
      expect(screen.queryByText("Vessel name")).toBeNull();
      expect(screen.getByText("Altitude")).toBeTruthy();
    });
  });

  it("evicts the mission's cached full-history store when the panel unmounts", async () => {
    // Populate the cache the same way the graph does once a key is picked
    // (queryRange -> getFullHistoryStore -> buildFullHistoryStore, memoized
    // by missionId).
    await historySource.queryRange(
      "v.altitude",
      firstFrameUt,
      lastFrameUt,
      missionId,
    );

    const { unmount } = render(
      <FlightGraph
        missionId={missionId}
        firstFrameUt={firstFrameUt}
        lastFrameUt={lastFrameUt}
      />,
    );

    const evictSpy = vi.spyOn(historySource, "evictFullHistoryStore");
    unmount();

    // Regression coverage: evictFullHistoryStore existed and was unit
    // tested but had no call site outside its own test — historyCache grew
    // unboundedly on the shared, module-level MissionHistorySource. The
    // graph panel's unmount must actually free its mission's cache entry.
    expect(evictSpy).toHaveBeenCalledWith(missionId);
  });

  it("evicts under the previous missionId, not the new one, when the mission changes without unmounting", () => {
    const { rerender } = render(
      <FlightGraph
        missionId={missionId}
        firstFrameUt={firstFrameUt}
        lastFrameUt={lastFrameUt}
      />,
    );

    const evictSpy = vi.spyOn(historySource, "evictFullHistoryStore");
    rerender(
      <FlightGraph
        missionId="m2"
        firstFrameUt={firstFrameUt}
        lastFrameUt={lastFrameUt}
      />,
    );

    expect(evictSpy).toHaveBeenCalledWith(missionId);
    expect(evictSpy).not.toHaveBeenCalledWith("m2");
  });
});
