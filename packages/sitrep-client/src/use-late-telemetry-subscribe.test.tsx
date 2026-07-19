import { act, render } from "@ksp-gonogo/test-utils";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { StubTransport } from "./stub-transport";
import type { LateTelemetrySubscribe } from "./use-late-telemetry-subscribe";
import { useLateTelemetrySubscribe } from "./use-late-telemetry-subscribe";

/** Captures the hook's own return value + lets a test drive it imperatively. */
function Probe({
  onReady,
}: {
  onReady: (subscribe: LateTelemetrySubscribe) => void;
}) {
  const subscribe = useLateTelemetrySubscribe();
  useEffect(() => {
    onReady(subscribe);
  }, [subscribe, onReady]);
  return null;
}

describe("useLateTelemetrySubscribe", () => {
  it("subscribes late (after render, from an async callback) and delivers arriving values", async () => {
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    let subscribe: LateTelemetrySubscribe | undefined;
    render(
      <TelemetryProvider client={client}>
        <Probe
          onReady={(s) => {
            subscribe = s;
          }}
        />
      </TelemetryProvider>,
    );

    const onValue = vi.fn();
    await act(async () => {
      // Simulate the scansat "acquire resolves, then subscribe" shape: the
      // topic is only known after this microtask, well after mount.
      await Promise.resolve();
      subscribe?.("scansat.mask.Kerbin.2", onValue);
    });

    expect(t.isSubscribed("scansat.mask.Kerbin.2")).toBe(true);

    act(() => {
      t.emit("scansat.mask.Kerbin.2", { width: 1, height: 1, bits: "AA" });
    });
    expect(onValue).toHaveBeenCalledWith({ width: 1, height: 1, bits: "AA" });
  });

  it("delivers the sticky last value synchronously on subscribe", () => {
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    let subscribe: LateTelemetrySubscribe | undefined;
    render(
      <TelemetryProvider client={client}>
        <Probe
          onReady={(s) => {
            subscribe = s;
          }}
        />
      </TelemetryProvider>,
    );

    act(() => {
      // Subscribe once to open the topic on the transport, then emit.
      subscribe?.("scansat.mask.Kerbin.2", () => {});
      t.emit("scansat.mask.Kerbin.2", "first");
    });

    const onValue = vi.fn();
    act(() => {
      subscribe?.("scansat.mask.Kerbin.2", onValue);
    });
    expect(onValue).toHaveBeenCalledWith("first");
  });

  it("can be called any number of times for distinct topics, discovered dynamically", () => {
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    let subscribe: LateTelemetrySubscribe | undefined;
    render(
      <TelemetryProvider client={client}>
        <Probe
          onReady={(s) => {
            subscribe = s;
          }}
        />
      </TelemetryProvider>,
    );

    const bodies = ["Kerbin", "Mun", "Minmus"];
    const handlers = bodies.map(() => vi.fn());
    act(() => {
      bodies.forEach((body, i) => {
        subscribe?.(`scansat.mask.${body}.2`, handlers[i]);
      });
    });
    for (const body of bodies) {
      expect(t.isSubscribed(`scansat.mask.${body}.2`)).toBe(true);
    }

    act(() => {
      t.emit("scansat.mask.Mun.2", "mun-data");
    });
    expect(handlers[1]).toHaveBeenCalledWith("mun-data");
    expect(handlers[0]).not.toHaveBeenCalled();
    expect(handlers[2]).not.toHaveBeenCalled();
  });

  it("returns an idempotent unsubscribe that can be called early, more than once, safely", () => {
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    let subscribe: LateTelemetrySubscribe | undefined;
    render(
      <TelemetryProvider client={client}>
        <Probe
          onReady={(s) => {
            subscribe = s;
          }}
        />
      </TelemetryProvider>,
    );

    const onValue = vi.fn();
    let unsubscribe: (() => void) | undefined;
    act(() => {
      unsubscribe = subscribe?.("scansat.mask.Kerbin.2", onValue);
    });
    expect(t.isSubscribed("scansat.mask.Kerbin.2")).toBe(true);

    act(() => {
      unsubscribe?.();
      unsubscribe?.(); // second call must be a no-op, not throw
    });
    expect(t.isSubscribed("scansat.mask.Kerbin.2")).toBe(false);

    act(() => {
      t.emit("scansat.mask.Kerbin.2", "after-unsubscribe");
    });
    expect(onValue).not.toHaveBeenCalledWith("after-unsubscribe");
  });

  it("tears down every still-open subscription automatically on unmount", () => {
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    let subscribe: LateTelemetrySubscribe | undefined;
    const { unmount } = render(
      <TelemetryProvider client={client}>
        <Probe
          onReady={(s) => {
            subscribe = s;
          }}
        />
      </TelemetryProvider>,
    );

    act(() => {
      subscribe?.("scansat.mask.Kerbin.2", () => {});
      subscribe?.("scansat.mask.Mun.2", () => {});
    });
    expect(t.isSubscribed("scansat.mask.Kerbin.2")).toBe(true);
    expect(t.isSubscribed("scansat.mask.Mun.2")).toBe(true);

    unmount();

    expect(t.isSubscribed("scansat.mask.Kerbin.2")).toBe(false);
    expect(t.isSubscribed("scansat.mask.Mun.2")).toBe(false);
  });

  it("degrades to a no-op subscribe (no throw) with no TelemetryProvider mounted", () => {
    let subscribe: LateTelemetrySubscribe | undefined;
    render(
      <Probe
        onReady={(s) => {
          subscribe = s;
        }}
      />,
    );

    const onValue = vi.fn();
    let unsubscribe: (() => void) | undefined;
    expect(() => {
      unsubscribe = subscribe?.("scansat.mask.Kerbin.2", onValue);
    }).not.toThrow();
    expect(() => unsubscribe?.()).not.toThrow();
    expect(onValue).not.toHaveBeenCalled();
  });
});
