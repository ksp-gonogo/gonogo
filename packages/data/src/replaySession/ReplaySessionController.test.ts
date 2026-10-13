import type { ReplayFixture } from "@ksp-gonogo/sitrep-client";
import type { Meta, ServerMessage, Value } from "@ksp-gonogo/sitrep-sdk";
import { Quality, Staleness } from "@ksp-gonogo/sitrep-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MissionMeta } from "../storage/MissionStore";
import {
  getReplaySessionController,
  resetReplaySessionControllerForTests,
} from "./ReplaySessionController";

function meta(overrides: Partial<Meta> = {}): Meta {
  return {
    source: "test",
    validAt: 0,
    seq: 0,
    deliveredAt: 0,
    vantage: "test",
    quality: Quality.OnRails,
    active: false,
    staleness: Staleness.Fresh,
    timelineEpoch: 0,
    ...overrides,
  };
}

function frame(topic: string, payload: unknown, deliveredAt: number): string {
  const message: ServerMessage = {
    type: "stream-data",
    topic,
    payload,
    meta: meta({ validAt: deliveredAt, deliveredAt }),
  };
  return JSON.stringify(message);
}

const META: MissionMeta = {
  id: "m1",
  vesselName: "Kerbal X",
  launchedAt: 1000,
  firstFrameUt: 0,
  lastFrameUt: 10,
  frameCount: 3,
};

const FIXTURE: ReplayFixture = {
  subscribedTopics: ["vessel.orbit"],
  frames: [
    frame("vessel.orbit", { sma: 700_000 }, 0),
    frame("vessel.orbit", { sma: 710_000 }, 5),
    frame("vessel.orbit", { sma: 720_000 }, 10),
  ],
};

describe("ReplaySessionController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetReplaySessionControllerForTests();
    vi.useRealTimers();
  });

  it("is idle until start() is called", () => {
    const controller = getReplaySessionController();
    expect(controller.getSnapshot().active).toBe(false);
  });

  it("start() builds an active session and delivers the fixture over time", () => {
    const controller = getReplaySessionController();
    controller.start(META, FIXTURE);
    const snapshot = controller.getSnapshot();
    expect(snapshot.active).toBe(true);
    expect(snapshot.playing).toBe(true);
    expect(snapshot.client).not.toBeNull();
    expect(snapshot.store).not.toBeNull();

    snapshot.client?.subscribe("vessel.orbit", () => {});
    vi.advanceTimersByTime(0);
    snapshot.store?.beginFrame();
    expect(
      snapshot.store?.sample<{ sma: Value<"m"> }>("vessel.orbit")?.payload?.sma
        .magnitude,
    ).toBe(700_000);

    vi.advanceTimersByTime(5000);
    snapshot.store?.beginFrame();
    expect(
      snapshot.store?.sample<{ sma: Value<"m"> }>("vessel.orbit")?.payload?.sma
        .magnitude,
    ).toBe(710_000);
  });

  it("pause() stops further delivery without tearing down the session", () => {
    const controller = getReplaySessionController();
    controller.start(META, FIXTURE);
    controller.getSnapshot().client?.subscribe("vessel.orbit", () => {});
    vi.advanceTimersByTime(0);

    controller.pause();
    expect(controller.getSnapshot().playing).toBe(false);
    expect(controller.getSnapshot().active).toBe(true);

    vi.advanceTimersByTime(20_000);
    controller.getSnapshot().store?.beginFrame();
    // Still at the pre-pause value: nothing past the pause point arrived.
    expect(
      controller
        .getSnapshot()
        .store?.sample<{ sma: Value<"m"> }>("vessel.orbit")?.payload?.sma
        .magnitude,
    ).toBe(700_000);
  });

  it("seekTo() snapshots the keyframe as-of the target and keeps playing forward from there", () => {
    const controller = getReplaySessionController();
    controller.start(META, FIXTURE);
    controller.getSnapshot().client?.subscribe("vessel.orbit", () => {});

    controller.seekTo(5);
    const snapshot = controller.getSnapshot();
    vi.advanceTimersByTime(0);
    snapshot.store?.beginFrame();
    expect(
      snapshot.store?.sample<{ sma: Value<"m"> }>("vessel.orbit")?.payload?.sma
        .magnitude,
    ).toBe(710_000);

    // Playback continues past the seek point.
    vi.advanceTimersByTime(5000);
    snapshot.store?.beginFrame();
    expect(
      snapshot.store?.sample<{ sma: Value<"m"> }>("vessel.orbit")?.payload?.sma
        .magnitude,
    ).toBe(720_000);
  });

  describe("a recording made across a signal delay", () => {
    /** Four seconds one way: each frame says what was true four seconds before it arrived. */
    const DELAY = 4;
    const delayed = (sma: number, deliveredAt: number): string =>
      JSON.stringify({
        type: "stream-data",
        topic: "vessel.orbit",
        payload: { sma },
        meta: meta({ validAt: deliveredAt - DELAY, deliveredAt }),
      } satisfies ServerMessage);
    const DELAYED: ReplayFixture = {
      subscribedTopics: ["vessel.orbit"],
      frames: [
        delayed(700_000, 10),
        delayed(710_000, 15),
        delayed(720_000, 20),
        delayed(730_000, 25),
      ],
    };
    const DELAYED_META: MissionMeta = {
      ...META,
      firstFrameUt: 10,
      lastFrameUt: 25,
    };
    const smaNow = () => {
      const { store } = getReplaySessionController().getSnapshot();
      store?.beginFrame();
      return store?.sample<{ sma: Value<"m"> }>("vessel.orbit")?.payload?.sma
        .magnitude;
    };

    it("says where it has got to on the time frames arrived at", () => {
      const controller = getReplaySessionController();
      controller.start(DELAYED_META, DELAYED);
      controller.getSnapshot().client?.subscribe("vessel.orbit", () => {});

      vi.advanceTimersByTime(6000);

      expect(controller.cursorUt()).toBeCloseTo(16, 3);
    });

    it("resumes where it was paused, not a signal delay earlier", () => {
      const controller = getReplaySessionController();
      controller.start(DELAYED_META, DELAYED);
      controller.getSnapshot().client?.subscribe("vessel.orbit", () => {});
      // Six seconds in: the frame that arrived at 15 has been shown.
      vi.advanceTimersByTime(6000);
      expect(smaNow()).toBe(710_000);

      controller.pause();
      vi.advanceTimersByTime(60_000);
      expect(controller.cursorUt()).toBeCloseTo(16, 3);
      controller.play();
      controller.getSnapshot().client?.subscribe("vessel.orbit", () => {});
      vi.advanceTimersByTime(0);

      // Still the frame from 15. Resuming at 12, where the view clock sits, would show the one from 10 again.
      expect(smaNow()).toBe(710_000);
      vi.advanceTimersByTime(4100);
      expect(smaNow()).toBe(720_000);
    });

    it("reaches the end of the recording", () => {
      const controller = getReplaySessionController();
      controller.start(DELAYED_META, DELAYED);
      controller.getSnapshot().client?.subscribe("vessel.orbit", () => {});

      vi.advanceTimersByTime(120_000);

      expect(controller.cursorUt()).toBe(DELAYED_META.lastFrameUt);
    });

    it("keeps its place through a change of rate", () => {
      const controller = getReplaySessionController();
      controller.start(DELAYED_META, DELAYED);
      vi.advanceTimersByTime(6000);

      controller.setRate(2);
      expect(controller.cursorUt()).toBeCloseTo(16, 3);
      vi.advanceTimersByTime(1000);

      expect(controller.cursorUt()).toBeCloseTo(18, 3);
    });
  });

  it("stop() tears the session down entirely", () => {
    const controller = getReplaySessionController();
    controller.start(META, FIXTURE);
    controller.stop();
    const snapshot = controller.getSnapshot();
    expect(snapshot.active).toBe(false);
    expect(snapshot.client).toBeNull();
    expect(snapshot.store).toBeNull();
  });
});
