import { memoryStorage } from "@ksp-gonogo/core/test";
import {
  resolveValueTopic,
  StubTransport,
  setActiveCarriedChannelsForTests,
  setActiveTelemetryClientForTests,
  setActiveTimelineStoreForTests,
  setActiveViewClockForTests,
  TelemetryClient,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { WarpMode } from "@ksp-gonogo/sitrep-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlarmHostService } from "./AlarmHostService";

/**
 * The warp ladder has to be the INSTALL's, not stock's.
 *
 * `WarpControl` picks a warp index by looking a rate up in a hardcoded
 * `HIGH_WARP_RATES` table that is KSP's stock one, and `AlarmBanner` mirrors the
 * same list to tell the operator what rate they are at. Neither reads the rate
 * the game keeps sending on `time.warp`, and an install is free to publish a
 * different table: Kopernicus and RealSolarSystem both do.
 *
 * Measured on the Deck against the shipped RSS/RO/RP-1 install on 2026-09-12 by
 * commanding each index and reading `time.warp.warpRate` back:
 *
 * | index | this install | `HIGH_WARP_RATES` |
 * |-------|--------------|-------------------|
 * | 2     | 100          | 10                |
 * | 3     | 1000         | 50                |
 * | 4     | 10000        | 100               |
 * | 5     | 100000       | 1000              |
 * | 6     | 1000000      | 10000             |
 * | 7     | 6000000      | 100000            |
 *
 * So the ladder asks for an index believing it to be one rate and the game runs
 * it at another, between 10x and 60x faster. The safety margin is the thing that
 * breaks: a session computed as "at most 350x so the last ten seconds are still
 * ten seconds" commanded index 4 and the game ran at 10000x, which stepped the
 * clock 2080 seconds inside one tick. A warp window cannot be aborted from
 * inside, so an overshoot is spent before the next tick can answer for it.
 *
 * Seen live, not derived: the run recorded one `time.setWarpIndex[4]` dispatch
 * at 01:45:43 and `time.warp` reading `{warpRate: 10000, warpRateIndex: 4}` at
 * 01:45:44.
 */
const INSTALL_WARP_RATES: readonly number[] = [
  1, 10, 100, 1000, 10000, 100000, 1000000, 6000000,
];

function fakeStream(): { calls: string[]; set(key: string, v: unknown): void } {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const store = new TimelineStore(
    new ViewClock({
      nowWall: () => 0,
      warpRate: () => 1,
      delaySeconds: () => 0,
    }),
  );
  client.attachStore(store);

  const calls: string[] = [];
  transport.setCommandHandler((command, args) => {
    if (command === "time.setWarpIndex") {
      const index =
        typeof args === "object" && args !== null && "index" in args
          ? args.index
          : undefined;
      calls.push(String(index));
    }
    return null;
  });

  setActiveTimelineStoreForTests(store);
  setActiveTelemetryClientForTests(client);
  setActiveCarriedChannelsForTests(new Set(["time.setWarpIndex"]));

  const subscribed = new Set<string>();
  function publish(topic: string, value: unknown): void {
    if (!subscribed.has(topic)) {
      subscribed.add(topic);
      client.subscribe(topic, () => {});
    }
    transport.emit(topic, value);
    store.beginFrame();
  }

  let warp = {
    warpRate: 1,
    warpRateIndex: 0,
    warpMode: WarpMode.High,
    paused: false,
  };

  return {
    calls,
    set(key, v) {
      if (key === "t.universalTime" && typeof v === "number") {
        setActiveViewClockForTests({ viewUt: () => v });
        return;
      }
      if (key === "t.currentRateIndex") {
        if (typeof v !== "number") {
          throw new Error(`"t.currentRateIndex" needs a rung number`);
        }
        warp = {
          ...warp,
          warpRateIndex: v,
          warpRate: INSTALL_WARP_RATES[v],
        };
        publish("time.warp", warp);
        return;
      }
      const topic = resolveValueTopic("data", key);
      if (topic === undefined) throw new Error(`no stream home for "${key}"`);
      publish(topic, v);
    },
  };
}

describe("warp ladder against the install's own rate table", () => {
  let nowMs: number;

  beforeEach(() => {
    vi.useFakeTimers();
    nowMs = 1_700_000_000_000;
  });

  afterEach(() => {
    vi.useRealTimers();
    setActiveViewClockForTests(undefined);
    setActiveTimelineStoreForTests(undefined);
    setActiveTelemetryClientForTests(undefined);
    setActiveCarriedChannelsForTests(undefined);
  });

  it("never commands an index the install runs faster than the safety margin allows", async () => {
    const telemetry = fakeStream();
    telemetry.set("t.universalTime", 1000);
    telemetry.set("t.currentRateIndex", 0);

    const svc = new AlarmHostService(null, {
      nowMs: () => nowMs,
      tickIntervalMs: 1000,
      storage: memoryStorage(),
      getOwltSeconds: () => 0,
    });
    svc.setWarpSafetyMargin(10);
    svc.addAlarm({
      name: "Rig warp target",
      trigger: { kind: "time", ut: 1000 + 3500, leadSeconds: 30 },
    });

    svc.beginWarpTo();
    await Promise.resolve();
    await Promise.resolve();

    /* 3500 seconds to run and ten seconds of margin: any rate at or under 350x
       leaves the operator the margin they asked for, and every rate above it
       spends the whole window inside one tick. */
    const permitted = 3500 / 10;
    const commanded = telemetry.calls.map((index) => ({
      index: Number(index),
      rateOnThisInstall: INSTALL_WARP_RATES[Number(index)],
    }));

    expect(commanded.length).toBeGreaterThan(0);
    for (const step of commanded) {
      expect(step.rateOnThisInstall).toBeLessThanOrEqual(permitted);
    }

    svc.dispose();
  });
});
