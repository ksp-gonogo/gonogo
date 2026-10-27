// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, setupStreamFixture } from "../testing";
import { type TopicClockState, useTopicClock } from "./use-topic-clock";

const FEED = "planted.camera.7.state";

let latest: TopicClockState | undefined;

function Probe() {
  latest = useTopicClock(FEED);
  return <output>{latest.link}</output>;
}

function mount() {
  const stream = setupStreamFixture();
  render(
    <stream.Provider>
      <Probe />
    </stream.Provider>,
  );
  return stream;
}

describe("useTopicClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    latest = undefined;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds everything and reads unknown before the first sample", () => {
    mount();
    expect(screen.getByRole("status").textContent).toBe("unknown");
    expect(latest?.clock?.confirmedEdgeUt()).toBe(Number.NEGATIVE_INFINITY);
  });

  it("releases up to the newest sample once one arrives, at that Topic's own delay", () => {
    const stream = mount();
    act(() => {
      stream.emit(FEED, { cameraId: 7 }, { validAt: 100, deliveredAt: 130 });
      vi.advanceTimersByTime(50);
    });
    expect(screen.getByRole("status").textContent).toBe("live");
    expect(latest?.clock?.confirmedEdgeUt()).toBe(100);
  });

  it("reads silent once the game has run on without a new sample, and live again on the next", () => {
    const stream = mount();
    stream.subscribe("planted.heard.state");
    act(() => {
      stream.emit(FEED, { cameraId: 7 }, { validAt: 100, deliveredAt: 130 });
    });
    act(() => {
      stream.emit(
        "planted.heard.state",
        {},
        { validAt: 200, deliveredAt: 200 },
      );
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("status").textContent).toBe("silent");

    act(() => {
      stream.emit(FEED, { cameraId: 7 }, { validAt: 195, deliveredAt: 200 });
      vi.advanceTimersByTime(50);
    });
    expect(screen.getByRole("status").textContent).toBe("live");
  });

  it("does not read a paused game as silent", () => {
    const stream = mount();
    act(() => {
      stream.emit(FEED, { cameraId: 7 }, { validAt: 100, deliveredAt: 130 });
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole("status").textContent).toBe("live");
  });

  it("reports the delay the newest live sample was held for", () => {
    const stream = mount();
    expect(latest?.delaySeconds).toBeUndefined();
    act(() => {
      stream.emit(FEED, { cameraId: 7 }, { validAt: 100, deliveredAt: 104.2 });
      vi.advanceTimersByTime(50);
    });
    expect(latest?.delaySeconds).toBeCloseTo(4.2);
  });

  it("subscribes to nothing for an empty topic", () => {
    const stream = setupStreamFixture();
    function Empty() {
      latest = useTopicClock("");
      return <output>{latest.link}</output>;
    }
    render(
      <stream.Provider>
        <Empty />
      </stream.Provider>,
    );
    expect(screen.getByRole("status").textContent).toBe("unknown");
    expect(stream.transport.isSubscribed("")).toBe(false);
  });

  it("has no clock with no stream mounted", () => {
    render(<Probe />);
    expect(latest?.clock).toBeUndefined();
  });
});
