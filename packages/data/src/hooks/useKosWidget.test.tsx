import { clearRegistry, registerDataSource } from "@ksp-gonogo/core";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KosScriptError } from "../kos/KosScriptError";
import { type UseKosWidgetResult, useKosWidget } from "./useKosWidget";

/**
 * Tiny ad-hoc kOS-compute mock. useKosWidget duck-types `executeScript`
 * so we don't need the full DataSource surface — only what's read.
 */
function makeFakeKosSource(opts: {
  id?: string;
  exec: () => Promise<Record<string, unknown>>;
}) {
  const id = opts.id ?? "kos";
  const calls = { count: 0 };
  const source = {
    id,
    name: "Fake kOS",
    status: "connected" as const,
    schema: () => [],
    subscribe: () => () => {},
    onStatusChange: () => () => {},
    connect: async () => {},
    disconnect: () => {},
    execute: async () => {},
    configSchema: () => [],
    configure: () => {},
    getConfig: () => ({}),
    executeScript: () => {
      calls.count += 1;
      return opts.exec();
    },
  };
  return { source, calls };
}

function Probe({
  onRender,
  mode,
  intervalMs,
  sourceId,
}: {
  onRender: (r: UseKosWidgetResult) => void;
  mode: "command" | "interval";
  intervalMs?: number;
  sourceId?: string;
}) {
  const r = useKosWidget({
    cpu: "cpu1",
    script: "test.ks",
    args: [],
    mode,
    intervalMs,
    sourceId,
  });
  onRender(r);
  return null;
}

describe("useKosWidget interval-mode breaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    clearRegistry();
    vi.useRealTimers();
  });

  it("trips after THRESHOLD consecutive KosScriptErrors and stops dispatching", async () => {
    const { source, calls } = makeFakeKosSource({
      exec: () => Promise.reject(new KosScriptError("boom")),
    });
    registerDataSource(source);

    let last: UseKosWidgetResult | null = null;
    render(
      <Probe
        mode="interval"
        intervalMs={50}
        onRender={(r) => {
          last = r;
        }}
      />,
    );

    // Drain three error ticks. The first dispatch fires synchronously
    // on mount; ticks 2 and 3 fire from setInterval.
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60);
      });
    }

    expect(last?.disabled).toBe(true);
    expect(last?.disabledReason).toBe("boom");
    const callsAtTrip = calls.count;

    // Past the trip, advancing time must not produce more dispatches —
    // the whole point of the breaker is that no more bytes go on the wire.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(calls.count).toBe(callsAtTrip);
  });

  it("does not trip on infrastructure errors (plain Error)", async () => {
    const { source, calls } = makeFakeKosSource({
      exec: () => Promise.reject(new Error("session disconnected")),
    });
    registerDataSource(source);

    let last: UseKosWidgetResult | null = null;
    render(
      <Probe
        mode="interval"
        intervalMs={50}
        onRender={(r) => {
          last = r;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(last?.disabled).toBe(false);
    // Dispatching keeps happening — a transient infra hiccup shouldn't
    // freeze the widget.
    expect(calls.count).toBeGreaterThan(3);
  });

  it("a single success resets the consecutive-error counter", async () => {
    let mode: "fail" | "ok" = "fail";
    const { source } = makeFakeKosSource({
      exec: () =>
        mode === "fail"
          ? Promise.reject(new KosScriptError("nope"))
          : Promise.resolve({ ok: true }),
    });
    registerDataSource(source);

    let last: UseKosWidgetResult | null = null;
    // Huge intervalMs so we drive dispatches manually for fine-grained
    // control over the consecutive-error count. Mount fires one
    // dispatch synchronously — that's our first failure.
    render(
      <Probe
        mode="interval"
        intervalMs={1_000_000}
        onRender={(r) => {
          last = r;
        }}
      />,
    );

    // Mount-dispatch failure resolves on next microtask.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Trigger one more failure manually — counter at 2, still not tripped.
    await act(async () => {
      last?.dispatch();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(last?.disabled).toBe(false);

    // Recover. A single success should zero the counter.
    mode = "ok";
    await act(async () => {
      last?.dispatch();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(last?.data).toEqual({ ok: true });

    // Two more failures — would have tripped if the counter wasn't reset.
    mode = "fail";
    for (let i = 0; i < 2; i += 1) {
      await act(async () => {
        last?.dispatch();
        await vi.advanceTimersByTimeAsync(0);
      });
    }
    expect(last?.disabled).toBe(false);
  });

  it("reEnable() resumes dispatching with a one-error grace window", async () => {
    const { source, calls } = makeFakeKosSource({
      exec: () => Promise.reject(new KosScriptError("still broken")),
    });
    registerDataSource(source);

    let last: UseKosWidgetResult | null = null;
    render(
      <Probe
        mode="interval"
        intervalMs={50}
        onRender={(r) => {
          last = r;
        }}
      />,
    );

    // Trip the breaker.
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60);
      });
    }
    expect(last?.disabled).toBe(true);
    const callsAtTrip = calls.count;

    // Re-enable. Fires one immediate dispatch (the grace tick) — that
    // failure should NOT count, so we need 3 more failures before the
    // breaker trips again. Total: 1 grace + 3 counted = 4 calls past trip.
    await act(async () => {
      last?.reEnable();
    });

    await act(async () => {
      // Drain interval ticks. Grace tick already fired during reEnable;
      // 3 more interval ticks should trip the breaker again.
      await vi.advanceTimersByTimeAsync(180);
    });

    expect(calls.count - callsAtTrip).toBeGreaterThanOrEqual(4);
    expect(last?.disabled).toBe(true);
  });

  it("never trips in command mode", async () => {
    const { source, calls } = makeFakeKosSource({
      exec: () => Promise.reject(new KosScriptError("boom")),
    });
    registerDataSource(source);

    let last: UseKosWidgetResult | null = null;
    render(
      <Probe
        mode="command"
        onRender={(r) => {
          last = r;
        }}
      />,
    );

    // Manually fire 5 dispatches — far more than the threshold.
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        last?.dispatch();
        await vi.advanceTimersByTimeAsync(10);
      });
    }

    expect(last?.disabled).toBe(false);
    expect(calls.count).toBe(5);
  });
});
