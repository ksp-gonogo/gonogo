import { clearActionHandlers } from "@ksp-gonogo/core";
import { makeMeta } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, screen } from "@ksp-gonogo/test-utils";
import { renderWidget } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import "./index";

const TOPICS = [
  "vessel.control",
  "vessel.structure",
  "time.warp",
  "comms.link",
  "comms.delay",
  "system.uplink.pending",
  "system.uplink.gates",
];

describe("ActionGroup across a reconnect that meets a booting game", () => {
  afterEach(() => {
    clearActionHandlers();
    vi.useRealTimers();
  });

  it.each([
    ["tile", { w: 2, h: 2 }],
    ["body", { w: 6, h: 6 }],
  ])("%s survives loading with no vessel, then ready", async (_name, size) => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, "error");
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
      decidesTopicOwnership: true,
    });
    renderWidget("action-group", {
      ...size,
      config: { actionGroupId: "AG1" },
      wrapper: fixture.Provider,
    });

    act(() => {
      fixture.emit("vessel.control", {
        sasMode: 0,
        throttle: 0,
        sas: true,
        actionGroups: [],
      });
    });
    act(() => {
      fixture.store.setTransportConnected(false);
      vi.advanceTimersByTime(40000);
      fixture.emitFrame();
    });
    act(() => {
      fixture.store.setTransportConnected(true);
      fixture.emitFrame();
    });
    act(() => {
      fixture.store.setGameState("loading", "MAINMENU");
      vi.advanceTimersByTime(1000);
      fixture.emitFrame();
    });
    act(() => {
      fixture.store.setGameState("loading", "FLIGHT");
      vi.advanceTimersByTime(1000);
      fixture.emitFrame();
    });
    act(() => {
      fixture.store.setGameState("ready", "FLIGHT");
      fixture.emitFrame();
    });
    act(() => {
      fixture.transport.emitRaw({
        type: "game-state",
        state: "ready",
        scene: "LOADING",
      });
      for (const topic of TOPICS) {
        fixture.transport.ackSubscribe(topic);
        fixture.transport.ackSubscribe(topic);
      }
      fixture.emitFrame();
    });
    act(() => {
      for (const topic of TOPICS) {
        fixture.transport.emitRaw({
          type: "event",
          topic,
          name: "timeline-reset",
          meta: makeMeta(),
        });
      }
      fixture.emitFrame();
    });
    act(() => {
      fixture.emit(
        "vessel.control",
        {
          sasMode: 0,
          throttle: 0,
          sas: false,
          actionGroups: [],
        },
        { timelineEpoch: 1, validAt: 2 },
      );
      for (const topic of ["time.warp", "comms.link", "vessel.structure"]) {
        fixture.emit(
          topic,
          topic === "comms.link"
            ? { connected: true }
            : topic === "time.warp"
              ? { paused: false }
              : { currentStage: 3 },
          { timelineEpoch: 1, validAt: 2 },
        );
      }
    });

    expect(screen.getByRole("button", { name: "Toggle AG1" })).toBeTruthy();
    const messages = errors.mock.calls.map((c) => String(c[0]));
    expect(
      messages.filter((m) => /Maximum update|getSnapshot/.test(m)),
    ).toEqual([]);
  });
});
