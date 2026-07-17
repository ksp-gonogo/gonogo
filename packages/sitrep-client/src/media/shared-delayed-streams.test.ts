/**
 * `SharedDelayedStreams` — the per-camera delayed-pipeline cache. Proves the
 * headline correctness claim of the 2026-07-17 sharing work: delay is a
 * property of the CAMERA, so N consumers of one track share ONE build (one
 * processor), the last consumer tears it down, and a SECOND camera is
 * independent. A mid-stream late consumer joins the existing pipeline rather
 * than spawning a second.
 */

import { describe, expect, it, vi } from "vitest";
import {
  type BuiltDelayedStream,
  type DelayedStreamBuildContext,
  SharedDelayedStreams,
} from "./shared-delayed-streams";

/** A build that resolves synchronously to a tagged result, counting builds
 *  and disposes so a test can assert "one processor". */
function trackedBuild(tag: string) {
  const dispose = vi.fn();
  const flush = vi.fn();
  const build = vi.fn(
    (_ctx: DelayedStreamBuildContext<unknown>): BuiltDelayedStream<string> => ({
      result: tag,
      dispose,
      flush,
    }),
  );
  return { build, dispose, flush };
}

/** Drain the microtask queue so the cache's async build IIFE settles. */
const flushMicrotasks = () => Promise.resolve();

describe("SharedDelayedStreams — one pipeline per camera, shared by all consumers", () => {
  it("two consumers of ONE camera build the pipeline exactly once and see the same output", async () => {
    const cache = new SharedDelayedStreams<string, unknown>();
    const camera = {}; // stands in for the shared MediaStream object
    const { build } = trackedBuild("delayed@A");

    const a = cache.acquire(camera, build);
    const b = cache.acquire(camera, build); // second consumer, same camera
    await flushMicrotasks();

    // ONE build — a MediaStreamTrack admits only one processor; this is the
    // whole point.
    expect(build).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(1);
    // Both consumers see the SAME delayed output.
    expect(a.get()).toBe("delayed@A");
    expect(b.get()).toBe("delayed@A");
  });

  it("the LAST consumer to release tears the pipeline down; earlier releases do not", async () => {
    const cache = new SharedDelayedStreams<string, unknown>();
    const camera = {};
    const { build, dispose } = trackedBuild("delayed@A");

    const a = cache.acquire(camera, build);
    const b = cache.acquire(camera, build);
    await flushMicrotasks();

    a.release();
    expect(dispose).not.toHaveBeenCalled(); // b still watching
    expect(cache.has(camera)).toBe(true);

    b.release();
    expect(dispose).toHaveBeenCalledTimes(1); // last one out disposes
    expect(cache.has(camera)).toBe(false);
  });

  it("a DIFFERENT camera builds its own independent pipeline", async () => {
    const cache = new SharedDelayedStreams<string, unknown>();
    const cameraA = {};
    const cameraB = {};
    const a = trackedBuild("delayed@A");
    const b = trackedBuild("delayed@B");

    const la = cache.acquire(cameraA, a.build);
    const lb = cache.acquire(cameraB, b.build);
    await flushMicrotasks();

    expect(a.build).toHaveBeenCalledTimes(1);
    expect(b.build).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(2);
    expect(la.get()).toBe("delayed@A");
    expect(lb.get()).toBe("delayed@B");

    // Tearing one down leaves the other running.
    la.release();
    lb.release();
    expect(a.dispose).toHaveBeenCalledTimes(1);
    expect(b.dispose).toHaveBeenCalledTimes(1);
  });

  it("a consumer attaching MID-STREAM joins the existing pipeline, no second build", async () => {
    const cache = new SharedDelayedStreams<string, unknown>();
    const camera = {};
    const { build } = trackedBuild("delayed@A");

    const first = cache.acquire(camera, build);
    await flushMicrotasks(); // pipeline is up
    expect(first.get()).toBe("delayed@A");

    // A late consumer appears AFTER the build settled.
    const late = cache.acquire(camera, build);
    await flushMicrotasks();

    expect(build).toHaveBeenCalledTimes(1); // still one processor
    expect(late.get()).toBe("delayed@A"); // gets the existing output immediately
  });

  it("notifies subscribers when an async build settles", async () => {
    const cache = new SharedDelayedStreams<string, unknown>();
    const camera = {};
    let resolve!: (b: BuiltDelayedStream<string>) => void;
    const build = vi.fn(
      () => new Promise<BuiltDelayedStream<string>>((r) => (resolve = r)),
    );

    const lease = cache.acquire(camera, build);
    const changed = vi.fn();
    lease.subscribe(changed);

    // Still building: no result, no notification yet.
    expect(lease.get()).toBeUndefined();
    expect(changed).not.toHaveBeenCalled();

    resolve({ result: "delayed@A" });
    await flushMicrotasks();

    expect(lease.get()).toBe("delayed@A");
    expect(changed).toHaveBeenCalled();
  });

  it("disposes a build that settles AFTER the last consumer already released (teardown race)", async () => {
    const cache = new SharedDelayedStreams<string, unknown>();
    const camera = {};
    let resolve!: (b: BuiltDelayedStream<string>) => void;
    const dispose = vi.fn();
    const build = vi.fn(
      () => new Promise<BuiltDelayedStream<string>>((r) => (resolve = r)),
    );

    const lease = cache.acquire(camera, build);
    lease.release(); // gone before the build resolves
    expect(cache.has(camera)).toBe(false);

    resolve({ result: "delayed@A", dispose });
    await flushMicrotasks();

    // The pipeline nobody is watching is disposed, never published.
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(cache.has(camera)).toBe(false);
  });

  it("reads the FIRST still-live lease's contribution, re-pointing when the builder releases", async () => {
    const cache = new SharedDelayedStreams<string, string>();
    const camera = {};
    let ctx!: DelayedStreamBuildContext<string>;
    const build = vi.fn((c: DelayedStreamBuildContext<string>) => {
      ctx = c;
      return { result: "delayed@A" };
    });

    const a = cache.acquire(camera, build);
    const b = cache.acquire(camera, build);
    await flushMicrotasks();

    a.setContribution("from-A");
    b.setContribution("from-B");
    expect(ctx.contribution()).toBe("from-A"); // first live lease

    a.release(); // the builder leaves; b keeps the pipeline alive
    expect(ctx.contribution()).toBe("from-B"); // re-points, never goes stale
  });

  it("flush is forwarded to the shared pipeline", async () => {
    const cache = new SharedDelayedStreams<string, unknown>();
    const camera = {};
    const { build, flush } = trackedBuild("delayed@A");

    const a = cache.acquire(camera, build);
    const b = cache.acquire(camera, build);
    await flushMicrotasks();

    // Either consumer's flush hits the one shared buffer.
    b.flush();
    expect(flush).toHaveBeenCalledTimes(1);
    a.flush();
    expect(flush).toHaveBeenCalledTimes(2);
  });
});
