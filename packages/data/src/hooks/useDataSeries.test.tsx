import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@ksp-gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BufferedDataSource } from "../BufferedDataSource";
import { MemoryStore } from "../storage/MemoryStore";
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
    cleanup();
    buffered.disconnect();
  });

  it("returns empty on mount, then appends live samples", async () => {
    const renders: SeriesRange[] = [];
    render(<Probe onRender={(r) => renders.push(r)} />);

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
    render(<Probe onRender={(r) => renders.push(r)} />);

    await waitFor(() => {
      const latest = renders[renders.length - 1];
      expect(latest.v).toContain(42);
      expect(latest.v).toContain(43);
    });
  });

  it("trims samples older than the window", async () => {
    const renders: SeriesRange[] = [];
    render(<Probe onRender={(r) => renders.push(r)} />);

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
    render(<Probe onRender={(r) => renders.push(r)} />);

    // Let the backfill subscription settle before emitting — mirrors the
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
});
