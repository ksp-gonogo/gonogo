import type { DataKey } from "@gonogo/core";
import { getDataSource, getDataSources } from "@gonogo/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MockDataSourceFixture } from "./setupMockDataSource";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "./setupMockDataSource";

const KEYS: DataKey[] = [{ key: "v.altitude" }, { key: "v.name" }];

describe("setupMockDataSource", () => {
  let fixture: Awaited<ReturnType<typeof setupMockDataSource>> | null = null;

  afterEach(() => {
    if (fixture) {
      teardownMockDataSource(fixture);
      fixture = null;
    }
  });

  it("registers the buffered source under the default id", async () => {
    fixture = await setupMockDataSource({ keys: KEYS });
    // BufferedDataSource defaults to id "data" when none is passed.
    expect(getDataSource("data")).toBe(fixture.buffered);
    // The buffered layer reflects the upstream source's status. The shared
    // pattern doesn't connect the upstream MockDataSource (existing widget
    // tests follow the same convention), so status remains "disconnected" —
    // emit() still flows because subscription is map-based.
    expect(fixture.buffered.status).toBe("disconnected");
  });

  it("clears the registry on each setup call", async () => {
    fixture = await setupMockDataSource({ keys: KEYS });
    const before = getDataSources().length;
    expect(before).toBe(1);

    // A second call should wipe the prior registration.
    teardownMockDataSource(fixture);
    fixture = await setupMockDataSource({ keys: KEYS });
    expect(getDataSources().length).toBe(1);
  });

  it("delivers emitted values to subscribers via the buffered layer", async () => {
    fixture = await setupMockDataSource({ keys: KEYS });
    const cb = vi.fn();
    const unsub = fixture.buffered.subscribe("v.altitude", cb);
    fixture.source.emit("v.altitude", 1234);
    expect(cb).toHaveBeenCalledWith(1234);
    unsub();
  });

  it("forwards onExecute and affectedBySignalLoss to the mock source", async () => {
    const onExecute = vi.fn();
    fixture = await setupMockDataSource({
      keys: KEYS,
      affectedBySignalLoss: true,
      onExecute,
    });
    expect(fixture.source.affectedBySignalLoss).toBe(true);
    await fixture.source.execute("f.ag1");
    expect(onExecute).toHaveBeenCalledWith("f.ag1");
  });

  it("returns a usable fixture even when connect: false", async () => {
    // Skipping connect() bypasses detector hydration and the upstream
    // status-bridge, but the registered fixture is still usable.
    fixture = await setupMockDataSource({ keys: KEYS, connect: false });
    expect(fixture.source).toBeDefined();
    expect(fixture.buffered).toBeDefined();
    expect(getDataSource("data")).toBe(fixture.buffered);
  });

  it("teardownMockDataSource runs without throwing", async () => {
    fixture = await setupMockDataSource({ keys: KEYS });
    expect(() => {
      teardownMockDataSource(fixture as MockDataSourceFixture);
    }).not.toThrow();
    fixture = null; // already torn down
  });
});
