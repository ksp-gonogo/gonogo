import {
  clearRegistry,
  type DataSource,
  getDataSource,
  registerDataSource,
} from "@ksp-gonogo/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BufferedDataSource } from "../BufferedDataSource";
import { MemoryStore } from "../storage/MemoryStore";
import { importFixtureToStore } from "./fixtureIO";
import { getReplayController, resetReplayController } from "./ReplayController";
import { synthesizeFlight } from "./synthesizeFlight";

const FIXTURE = synthesizeFlight({
  vesselName: "Replay Subject",
  launchedAt: 1_000_000,
  samples: {
    "v.altitude": [
      [0, 0],
      [5_000, 100],
      [10_000, 1_000],
    ],
    "v.body": [[0, "Kerbin"]],
  },
});

class FakeUpstream {
  readonly id = "fake-upstream";
  readonly name = "Fake";
  status: "connected" | "disconnected" = "disconnected";
  affectedBySignalLoss = false;
  async connect() {
    this.status = "connected";
  }
  disconnect() {
    this.status = "disconnected";
  }
  schema() {
    return [{ key: "v.altitude" }, { key: "v.body" }];
  }
  subscribe() {
    return () => {};
  }
  onStatusChange() {
    return () => {};
  }
  async execute() {}
  configSchema() {
    return [];
  }
  configure() {}
  getConfig() {
    return {};
  }
}

describe("ReplayController", () => {
  let live: BufferedDataSource;

  beforeEach(async () => {
    clearRegistry();
    resetReplayController();
    const store = new MemoryStore();
    await importFixtureToStore(store, FIXTURE);
    const upstream = new FakeUpstream();
    live = new BufferedDataSource({
      // biome-ignore lint/suspicious/noExplicitAny: tests substitute a minimal upstream
      source: upstream as any,
      store,
    });
    registerDataSource(live);
    await live.connect();
  });

  afterEach(async () => {
    const ctrl = getReplayController();
    if (ctrl.getState().active) await ctrl.stop();
    clearRegistry();
    resetReplayController();
  });

  it("starts idle with no active replay", () => {
    const state = getReplayController().getState();
    expect(state.active).toBe(false);
    expect(state.replay).toBeNull();
  });

  it("start() swaps the registered 'data' source for the replay", async () => {
    await getReplayController().start(live, FIXTURE.flight.id);
    const state = getReplayController().getState();
    expect(state.active).toBe(true);
    expect(state.flight?.vesselName).toBe("Replay Subject");
    expect(state.durationMs).toBe(10_000);
    // Registry now points at the replay source under the same id.
    const registered = getDataSource(live.id);
    expect(registered).toBe(state.replay);
    expect(registered).not.toBe(live);
  });

  it("stop() restores the original live source", async () => {
    const ctrl = getReplayController();
    await ctrl.start(live, FIXTURE.flight.id);
    await ctrl.stop();
    expect(ctrl.getState().active).toBe(false);
    expect(getDataSource(live.id)).toBe(live);
  });

  it("seekTo() clamps to [0, durationMs]", async () => {
    const ctrl = getReplayController();
    await ctrl.start(live, FIXTURE.flight.id);
    ctrl.seekTo(-500);
    expect(ctrl.getState().positionMs).toBe(0);
    ctrl.seekTo(99_999);
    expect(ctrl.getState().positionMs).toBe(10_000);
    ctrl.seekTo(5_000);
    expect(ctrl.getState().positionMs).toBe(5_000);
  });

  it("subscribe() fires the current state immediately and on every update", async () => {
    const ctrl = getReplayController();
    const states: boolean[] = [];
    const unsub = ctrl.subscribe((s) => states.push(s.active));
    await ctrl.start(live, FIXTURE.flight.id);
    await ctrl.stop();
    unsub();
    // Initial false (idle), true (start), false (stop).
    expect(states).toEqual([false, true, false]);
  });

  it("seekToChapter() jumps to the chapter's startMs", async () => {
    // Add a chapter to the underlying flight, then start replay.
    await live.addChapter(FIXTURE.flight.id, {
      label: "Mid-flight",
      startMs: 5_000,
      endMs: 8_000,
    });
    const ctrl = getReplayController();
    await ctrl.start(live, FIXTURE.flight.id);
    const ch = ctrl.getState().chapters[0];
    expect(ch).toBeDefined();
    ctrl.seekToChapter(ch.id);
    expect(ctrl.getState().positionMs).toBe(5_000);
  });

  it("rejects start() for an unknown flight id", async () => {
    await expect(
      getReplayController().start(live, "no-such-flight"),
    ).rejects.toThrow();
  });

  it("also displaces the 'kos' source so kOS widgets read from replay", async () => {
    // Register a stand-in kOS source.
    const kosLive: DataSource = {
      id: "kos",
      name: "Live kOS",
      status: "connected",
      affectedBySignalLoss: false,
      connect: async () => {},
      disconnect: () => {},
      schema: () => [],
      subscribe: () => () => {},
      onStatusChange: () => () => {},
      execute: async () => {},
      configSchema: () => [],
      configure: () => {},
      getConfig: () => ({}),
    };
    registerDataSource(kosLive);

    await getReplayController().start(live, FIXTURE.flight.id);

    const kosNow = getDataSource("kos");
    expect(kosNow).not.toBe(kosLive);
    // The proxy reports id "kos" so widgets keying off source.id agree
    // with the registry slot.
    expect(kosNow?.id).toBe("kos");

    await getReplayController().stop();
    expect(getDataSource("kos")).toBe(kosLive);
  });
});
