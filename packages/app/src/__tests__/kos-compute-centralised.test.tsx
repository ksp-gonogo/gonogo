/**
 * Integration tests for the centralised kOS compute fanout. Drives the kOS
 * data source through FakeKosUplink (a fake `kos.run` Uplink responder —
 * no PeerJS, no xterm, and since `executeScript` cut over from telnet, no
 * MockKosTelnet either), registers a kOS script via the @ksp-gonogo/core
 * registry, and asserts that subscribers on `kos.compute.<id>.<field>` keys
 * share one dispatch per cycle.
 *
 * The matching unit-level tests for the parser + registry live alongside
 * their modules — these tests are about the wiring through KosDataSource.
 */

import { clearRegistry, registerKosScript } from "@ksp-gonogo/core";
import { hashKosScript } from "@ksp-gonogo/kos";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KosDataSource } from "../dataSources/kos";
import { FakeKosUplink } from "./fixtures/FakeKosUplink";

const SCRIPT_ID = "shipmap";
const SCRIPT_PATH = `0:/widget_scripts/${SCRIPT_ID}.ks`;
const SCRIPT_BODY = `PRINT "[KOSDATA:${SCRIPT_ID}]parts=[][/KOSDATA]".`;

function registerSampleScript(intervalMs = 50) {
  registerKosScript({
    id: SCRIPT_ID,
    name: "Ship Map",
    script: SCRIPT_BODY,
    intervalMs,
    fields: [{ name: "parts", type: "json" }],
  });
}

function makeSource() {
  return new KosDataSource(
    { activeCpu: "datastream" },
    {
      callTimeoutMs: 2_000,
      postAttachDrainDelayMs: 0,
    },
  );
}

/**
 * Wait until `predicate()` is truthy, polling on each microtask. Faster
 * than waitFor for non-React tests and avoids dragging in React test utils.
 */
async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 1500 } = {},
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `waitFor: predicate did not become truthy in ${timeoutMs}ms`,
      );
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("kOS compute centralised fanout", () => {
  afterEach(() => {
    FakeKosUplink.uninstall();
    clearRegistry();
  });

  it("delivers parsed JSON values to a subscriber", async () => {
    const mock = FakeKosUplink.install();
    mock.registerScript(
      SCRIPT_PATH,
      () => `[KOSDATA:${SCRIPT_ID}]parts=[{"uid":"1"},{"uid":"2"}][/KOSDATA]`,
    );
    registerSampleScript(50);

    const source = makeSource();
    const seen: unknown[] = [];
    const unsub = source.subscribe("kos.compute.shipmap.parts", (value) =>
      seen.push(value),
    );

    await waitFor(() => seen.length >= 1);
    expect(seen[0]).toEqual([{ uid: "1" }, { uid: "2" }]);

    unsub();
    source.disconnect();
  });

  it("collapses two subscribers onto a single dispatch per cycle", async () => {
    const mock = FakeKosUplink.install();
    let dispatchCount = 0;
    mock.registerScript(SCRIPT_PATH, () => {
      dispatchCount += 1;
      return `[KOSDATA:${SCRIPT_ID}]parts=[][/KOSDATA]`;
    });
    registerSampleScript(40);

    const source = makeSource();
    const seenA: unknown[] = [];
    const seenB: unknown[] = [];
    const unsubA = source.subscribe("kos.compute.shipmap.parts", (v) =>
      seenA.push(v),
    );
    const unsubB = source.subscribe("kos.compute.shipmap.parts", (v) =>
      seenB.push(v),
    );

    await waitFor(() => seenA.length >= 2 && seenB.length >= 2);

    // Both subscribers see the same fan-out events; dispatch count matches
    // the smaller of the two (i.e. NOT subscriber-count × cycle-count).
    expect(dispatchCount).toBeLessThanOrEqual(seenA.length);
    expect(seenA.length).toBe(seenB.length);

    unsubA();
    unsubB();
    source.disconnect();
  });

  it("replays the last value to a late subscriber via the sticky cache", async () => {
    const mock = FakeKosUplink.install();
    mock.registerScript(
      SCRIPT_PATH,
      () => `[KOSDATA:${SCRIPT_ID}]parts=[{"uid":"X"}][/KOSDATA]`,
    );
    registerSampleScript(50);

    const source = makeSource();
    const earlySeen: unknown[] = [];
    const unsubEarly = source.subscribe("kos.compute.shipmap.parts", (v) =>
      earlySeen.push(v),
    );
    await waitFor(() => earlySeen.length >= 1);

    // Late subscriber attaches mid-cycle — should get the cached value
    // immediately on the next microtask, no full cycle wait.
    const lateSeen: unknown[] = [];
    const unsubLate = source.subscribe("kos.compute.shipmap.parts", (v) =>
      lateSeen.push(v),
    );
    await waitFor(() => lateSeen.length >= 1);
    expect(lateSeen[0]).toEqual([{ uid: "X" }]);

    unsubEarly();
    unsubLate();
    source.disconnect();
  });

  it("kos.compute.<id>.dispatchNow forces an immediate run", async () => {
    const mock = FakeKosUplink.install();
    mock.registerScript(
      SCRIPT_PATH,
      () => `[KOSDATA:${SCRIPT_ID}]parts=[][/KOSDATA]`,
    );
    // Long interval so we know any dispatch we observe came from dispatchNow,
    // not the regular cadence.
    registerSampleScript(60_000);

    const source = makeSource();
    const seen: unknown[] = [];
    const unsub = source.subscribe("kos.compute.shipmap.parts", (v) =>
      seen.push(v),
    );
    await waitFor(() => seen.length >= 1);
    const initialCount = seen.length;

    await source.execute("kos.compute.shipmap.dispatchNow");
    await waitFor(() => seen.length > initialCount);

    expect(seen.length).toBeGreaterThan(initialCount);
    unsub();
    source.disconnect();
  });

  it("schema() exposes a key per registered field", () => {
    registerKosScript({
      id: "alpha",
      name: "Alpha",
      script: "PRINT 1.",
      intervalMs: 1000,
      fields: [
        { name: "parts", type: "json" },
        { name: "count", type: "scalar" },
      ],
    });
    registerKosScript({
      id: "beta",
      name: "Beta",
      script: "PRINT 1.",
      intervalMs: 1000,
      fields: [{ name: "x", type: "scalar" }],
    });

    const source = makeSource();
    const keys = source.schema().map((k) => k.key);
    expect(keys).toContain("kos.compute.alpha.parts");
    expect(keys).toContain("kos.compute.alpha.count");
    expect(keys).toContain("kos.compute.beta.x");
    expect(keys).toHaveLength(3);
    source.disconnect();
  });

  it("getTopicStatus / onTopicStatusChange surface lastGoodAt after a successful run", async () => {
    const mock = FakeKosUplink.install();
    mock.registerScript(
      SCRIPT_PATH,
      () => `[KOSDATA:${SCRIPT_ID}]parts=[][/KOSDATA]`,
    );
    registerSampleScript(50);

    const source = makeSource();
    const statusEvents = vi.fn();
    source.onTopicStatusChange(SCRIPT_ID, statusEvents);

    const seen: unknown[] = [];
    const unsub = source.subscribe("kos.compute.shipmap.parts", (v) =>
      seen.push(v),
    );
    await waitFor(() => seen.length >= 1);

    const status = source.getTopicStatus(SCRIPT_ID);
    expect(status?.lastGoodAt).toBeGreaterThan(0);
    expect(status?.scriptError).toBeNull();
    expect(statusEvents).toHaveBeenCalled();

    unsub();
    source.disconnect();
  });

  it("hashKosScript is stable so the wrapper version matches across dispatches", () => {
    expect(hashKosScript(SCRIPT_BODY)).toBe(hashKosScript(SCRIPT_BODY));
  });
});
