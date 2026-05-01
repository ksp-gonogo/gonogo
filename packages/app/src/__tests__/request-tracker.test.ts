import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestTracker } from "../peer/RequestTracker";

describe("RequestTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves the pending entry when resolve(id) is called", async () => {
    const tracker = new RequestTracker<number>();
    const pending = tracker.track("a", 1_000, "timed out");
    tracker.resolve("a", 42);
    await expect(pending).resolves.toBe(42);
  });

  it("rejects with the timeout message when no resolve arrives in time", async () => {
    const tracker = new RequestTracker<number>();
    const pending = tracker.track("a", 100, "boom").catch((e: Error) => e);
    vi.advanceTimersByTime(100);
    const result = await pending;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe("boom");
  });

  it("a late resolve after timeout is a no-op", async () => {
    const tracker = new RequestTracker<number>();
    const pending = tracker.track("a", 50, "timed out").catch((e: Error) => e);
    vi.advanceTimersByTime(50);
    await pending;
    // Should not throw or resolve a second time
    tracker.resolve("a", 7);
  });

  it("rejectAll empties pending and rejects each promise", async () => {
    const tracker = new RequestTracker<number>();
    const a = tracker.track("a", 5_000, "to-a").catch((e: Error) => e);
    const b = tracker.track("b", 5_000, "to-b").catch((e: Error) => e);
    tracker.rejectAll("conn dropped");

    const [aRes, bRes] = await Promise.all([a, b]);
    expect((aRes as Error).message).toBe("conn dropped");
    expect((bRes as Error).message).toBe("conn dropped");

    // Subsequent resolve/reject for the same ids must not throw.
    tracker.resolve("a", 1);
    tracker.reject("b", new Error("ignored"));
  });

  it("clears the timer on resolve so it doesn't fire later", async () => {
    const tracker = new RequestTracker<number>();
    const pending = tracker.track("a", 100, "timed out");
    tracker.resolve("a", 1);
    vi.advanceTimersByTime(100); // timer would have fired here, but it's cleared
    await expect(pending).resolves.toBe(1);
  });
});
