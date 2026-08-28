import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SeriesRange } from "../types";
import { useDataSeries } from "./useDataSeries";

function Probe({ onRender }: { onRender: (range: SeriesRange) => void }) {
  const range = useDataSeries("data", "v.altitude", 60);
  onRender(range);
  return null;
}

describe("useDataSeries", () => {
  let mock: MockDataSource;
  let store: MemoryStore;
  let clock: number;
  let buffered: BufferedDataSource;
  let view: ReturnType<typeof render> | undefined;

  beforeEach(async () => {
    clearRegistry();
    mock = new MockDataSource({
      keys: [
        { key: "v.name" },
        { key: "v.missionTime" },
        { key: "v.altitude" },
      ],
    });
    store = new MemoryStore();
    // Offset 10s into the past so small clock advances in the tests still
    // land inside the hook's [now - windowMs, now] backfill window (the
    // hook reads the real Date.now for that bound).
    clock = Date.now() - 10_000;
    buffered = new BufferedDataSource({
      source: mock,
      store,
      now: () => clock,
    });
    registerDataSource(buffered);
    await buffered.connect();
    // Establish a flight so samples start landing.
    mock.emit("v.name", "KX");
    mock.emit("v.missionTime", 0);
  });

  afterEach(() => {
    // Unmount the tree before tearing the source down, disconnecting while
    // a subscribed component is still mounted flips the source status and
    // fires a state update outside act().
    view?.unmount();
    view = undefined;
    buffered.disconnect();
  });

  it("returns empty on mount, then appends live samples", async () => {
    const renders: SeriesRange[] = [];
    view = render(<Probe onRender={(r) => renders.push(r)} />);

    expect(renders[0]).toEqual({ t: [], v: [] });

    // Give the async backfill a tick.
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      clock += 1000;
      mock.emit("v.altitude", 100);
    });
    await act(async () => {
      clock += 1000;
      mock.emit("v.altitude", 200);
    });

    const latest = renders[renders.length - 1];
    expect(latest.v.slice(-2)).toEqual([100, 200]);
  });

  it("backfills from queryRange on mount", async () => {
    // Seed samples before the hook mounts.
    clock += 1000;
    mock.emit("v.altitude", 42);
    clock += 1000;
    mock.emit("v.altitude", 43);
    await store.flush();

    const renders: SeriesRange[] = [];
    view = render(<Probe onRender={(r) => renders.push(r)} />);

    await waitFor(() => {
      const latest = renders[renders.length - 1];
      expect(latest.v).toContain(42);
      expect(latest.v).toContain(43);
    });
  });

  it("trims samples older than the window", async () => {
    const renders: SeriesRange[] = [];
    view = render(<Probe onRender={(r) => renders.push(r)} />);

    await act(async () => {
      clock += 1000;
      mock.emit("v.altitude", 1);
    });
    await act(async () => {
      // Jump forward past the 60-second window.
      clock += 70_000;
      mock.emit("v.altitude", 2);
    });

    const latest = renders[renders.length - 1];
    expect(latest.v).toEqual([2]);
  });

  it("clears on upstream disconnect", async () => {
    const renders: SeriesRange[] = [];
    view = render(<Probe onRender={(r) => renders.push(r)} />);

    // Let the backfill subscription settle before emitting, mirrors the
    // "appends live samples" test above which does the same.
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      clock += 1000;
      mock.emit("v.altitude", 99);
    });

    await waitFor(() => {
      expect(renders[renders.length - 1].v).toContain(99);
    });

    await act(async () => {
      mock.disconnect();
    });

    expect(renders[renders.length - 1]).toEqual({ t: [], v: [] });
  });

  /**
   * The backfill's window closes the moment the hook mounts, so a live sample
   * is always newer than its upper bound and can never appear in its answer.
   * Whichever of the two lands second used to win outright, which made the
   * series depend on how long the store took to reply: fast enough and the
   * sample survived, slow enough and it was erased with nothing to say so.
   */
  it("keeps a live sample that arrived while the backfill query was in flight", async () => {
    let releaseBackfill: (() => void) | undefined;
    const query = buffered.queryRange.bind(buffered);
    buffered.queryRange = (
      key: string,
      tStart: number,
      tEnd: number,
      flightId?: string,
    ) =>
      new Promise((resolve) => {
        releaseBackfill = () => {
          resolve(query(key, tStart, tEnd, flightId));
        };
      });

    const renders: SeriesRange[] = [];
    view = render(<Probe onRender={(r) => renders.push(r)} />);

    await act(async () => {
      // Past the backfill's upper bound (the real Date.now at mount), where
      // every live sample after mount sits.
      clock += 20_000;
      mock.emit("v.altitude", 100);
    });
    expect(renders[renders.length - 1].v).toContain(100);

    await act(async () => {
      releaseBackfill?.();
      await Promise.resolve();
    });

    expect(renders[renders.length - 1].v).toContain(100);
  });
});
