import type { ReplayFixture } from "@ksp-gonogo/sitrep-client";
import type { Meta, ServerMessage } from "@ksp-gonogo/sitrep-sdk";
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
      snapshot.store?.sample<{ sma: number }>("vessel.orbit")?.payload.sma,
    ).toBe(700_000);

    vi.advanceTimersByTime(5000);
    snapshot.store?.beginFrame();
    expect(
      snapshot.store?.sample<{ sma: number }>("vessel.orbit")?.payload.sma,
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
    // Still at the pre-pause value — nothing past the pause point arrived.
    expect(
      controller.getSnapshot().store?.sample<{ sma: number }>("vessel.orbit")
        ?.payload.sma,
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
      snapshot.store?.sample<{ sma: number }>("vessel.orbit")?.payload.sma,
    ).toBe(710_000);

    // Playback continues past the seek point.
    vi.advanceTimersByTime(5000);
    snapshot.store?.beginFrame();
    expect(
      snapshot.store?.sample<{ sma: number }>("vessel.orbit")?.payload.sma,
    ).toBe(720_000);
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
