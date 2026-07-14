/**
 * Block-colour proof of the delay contract at the hook level — one layer
 * below `useDelayedKerbcastStream` (the hook `CameraFeed` actually uses;
 * see its docstring). `DelayedPlayoutBuffer` itself is proven directly in
 * `../DelayedPlayoutBuffer.blockColour.test.ts`; this file drives the SAME
 * real `useDelayedPlayout` hook `useDelayedKerbcastStream` composes, so the
 * proof also covers the React wiring (state/effects) between a raw stream
 * reference and the delayed one a widget renders.
 *
 * Same no-hook-mocking discipline as `useKerbcastStream.delay.test.tsx`:
 * a fake `KerbcastDataSource`-shaped data source stands in for the SDK (a
 * `MediaStream` can't be minted in jsdom), and a manually-driven clock
 * double stands in for the delay clock. Each "colour" is an opaque stream
 * token (`"red"` / `"green"` / `"blue"`) read straight off the hook's
 * return value.
 */

import { clearRegistry, registerDataSource } from "@ksp-gonogo/core";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DelayClockLike } from "../DelayedPlayoutBuffer";
import { useDelayedPlayout, useKerbcastStream } from "./useKerbcastStream";

afterEach(() => {
  cleanup();
  clearRegistry();
});

/** Mirrors `useKerbcastStream.delay.test.tsx`'s `manualClock`. */
function manualClock(initialEdge = Number.NEGATIVE_INFINITY): DelayClockLike & {
  setEdge(v: number): void;
} {
  let edge = initialEdge;
  const listeners = new Set<(viewUt: number) => void>();
  return {
    confirmedEdgeUt: () => edge,
    onFrame: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    setEdge(v: number) {
      edge = v;
      listeners.forEach((cb) => {
        cb(v);
      });
    },
  };
}

/** Mirrors `useKerbcastStream.delay.test.tsx`'s `fakeCameraHandle`. */
function fakeCameraHandle(initial: unknown = null) {
  let stream = initial;
  const listeners = new Set<(s: unknown) => void>();
  return {
    get mediaStream() {
      return stream;
    },
    on(event: string, cb: (s: unknown) => void) {
      if (event !== "stream") return () => {};
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    emit(next: unknown) {
      stream = next;
      listeners.forEach((cb) => {
        cb(next);
      });
    },
  };
}

function registerFakeKerbcastSource(cam: ReturnType<typeof fakeCameraHandle>) {
  const fake = {
    id: "kerbcast",
    getClient: () => ({ camera: () => cam }),
    subscribeCamera: () => {},
    unsubscribeCamera: () => {},
  };
  registerDataSource(
    fake as unknown as Parameters<typeof registerDataSource>[0],
  );
}

function StreamProbe({
  flightId,
  clock,
  captureUt,
  onStream,
}: {
  flightId: number | null;
  clock: DelayClockLike;
  captureUt: () => number;
  onStream: (s: MediaStream | null) => void;
}): null {
  const raw = useKerbcastStream(flightId);
  const stream = useDelayedPlayout(raw, { view: clock, captureUt });
  onStream(stream);
  return null;
}

describe("useDelayedPlayout — block-colour delay proof (hook level)", () => {
  const T0 = 100; // red captured
  const T1 = 101; // green captured
  const T2 = 102; // blue captured

  it("with delay D > 0, the on-screen colour flips exactly D seconds after each capture, never before", () => {
    const D = 5;
    const cam = fakeCameraHandle(null);
    registerFakeKerbcastSource(cam);
    const clock = manualClock(Number.NEGATIVE_INFINITY);
    let capturedAt = T0;

    let latest: unknown = "unset";
    render(
      <StreamProbe
        flightId={7}
        clock={clock}
        captureUt={() => capturedAt}
        onStream={(s) => {
          latest = s;
        }}
      />,
    );
    expect(latest).toBeNull();

    // All three colours are captured well before the delayed edge catches
    // up — feed red@T0, green@T1, blue@T2 while the edge sits far behind.
    act(() => {
      capturedAt = T0;
      cam.emit("red");
    });
    act(() => {
      capturedAt = T1;
      cam.emit("green");
    });
    act(() => {
      capturedAt = T2;
      cam.emit("blue");
    });
    expect(latest).toBeNull(); // nothing due yet at any capture instant

    const edgeFor = (t: number) => t - D;

    act(() => {
      clock.setEdge(edgeFor(T0 + D - 1));
    });
    expect(latest).toBeNull(); // just before red's due instant

    act(() => {
      clock.setEdge(edgeFor(T0 + D));
    });
    expect(latest).toBe("red"); // exactly on time

    act(() => {
      clock.setEdge(edgeFor(T1 + D - 1));
    });
    expect(latest).toBe("red"); // just before green's due instant — still red

    act(() => {
      clock.setEdge(edgeFor(T1 + D));
    });
    expect(latest).toBe("green");

    act(() => {
      clock.setEdge(edgeFor(T2 + D - 1));
    });
    expect(latest).toBe("green"); // just before blue's due instant

    act(() => {
      clock.setEdge(edgeFor(T2 + D));
    });
    expect(latest).toBe("blue");
  });

  it("control: with delay = 0, the same colour sequence flips the instant each frame is captured — no lag", () => {
    const cam = fakeCameraHandle(null);
    registerFakeKerbcastSource(cam);
    const clock = manualClock(Number.NEGATIVE_INFINITY);
    let capturedAt = T0;

    let latest: unknown = "unset";
    render(
      <StreamProbe
        flightId={7}
        clock={clock}
        captureUt={() => capturedAt}
        onStream={(s) => {
          latest = s;
        }}
      />,
    );

    // Edge tracks capture time directly (D = 0) — same hook, same buffer,
    // just no delay: each frame surfaces on the same push that captures it.
    act(() => {
      clock.setEdge(T0);
      capturedAt = T0;
      cam.emit("red");
    });
    expect(latest).toBe("red");

    act(() => {
      clock.setEdge(T1);
      capturedAt = T1;
      cam.emit("green");
    });
    expect(latest).toBe("green");

    act(() => {
      clock.setEdge(T2);
      capturedAt = T2;
      cam.emit("blue");
    });
    expect(latest).toBe("blue");
  });
});
