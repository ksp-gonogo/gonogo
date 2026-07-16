/**
 * Backend 0: encoded transform on the receiver (encoded-video-delay work,
 * 2026-07-16 — `local_docs/reports/encoded-video-delay-report.md`'s
 * reconciliation). Proves the wiring is real: when
 * `KerbcastDataSource.getReceiverForStream` resolves a receiver and
 * `RTCRtpScriptTransform` exists, this backend is tried FIRST and, on
 * success, surfaces `raw` itself (unchanged) as the delayed stream — no new
 * track, the delay happens in place upstream of decode.
 *
 * DELIBERATELY A SEPARATE FILE from `useKerbcastStream.delay.test.tsx`:
 * `kerbcastDelayWorkerClient.ts` caches its shared `Worker` in module-level
 * state (`getSharedWorker()`, `sharedWorker !== undefined` short-circuit) —
 * once any test in a given module graph resolves it to `null` (because
 * `Worker` was undefined in jsdom at that moment), every later test in the
 * SAME file inherits that cached `null`, even after stubbing `Worker`.
 * Vitest gives each test FILE its own fresh module graph by default, so a
 * separate file is the correct isolation boundary here — not reordering
 * (fragile to future edits) and not `vi.resetModules()` (this module has no
 * exported reset hook, and reaching into its internals would be more
 * fragile than just not sharing the file).
 */

import { clearRegistry, registerDataSource } from "@ksp-gonogo/core";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DelayClockLike } from "../DelayedPlayoutBuffer";
import {
  type DelayedPlayoutResult,
  useDelayedPlayout,
} from "./useKerbcastStream";

afterEach(() => {
  cleanup();
  clearRegistry();
  vi.unstubAllGlobals();
});

function manualClock(initialEdge = Number.NEGATIVE_INFINITY): DelayClockLike & {
  setEdge(v: number): void;
  snapshot(): unknown;
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
    // Backend 0 (like backend 2) only attempts when the clock is
    // snapshot()-capable — see useKerbcastStream.ts's module doc.
    snapshot: () => ({
      epoch: 0,
      anchorWall: undefined,
      anchorUt: undefined,
      maxSampleUt: Number.NEGATIVE_INFINITY,
      delaySeconds: 0,
      warpRate: 1,
      slackSeconds: 0,
    }),
  };
}

/** A fake `KerbcastDataSource` implementing `getReceiverForStream` — the
 *  encoded-transform backend's attach point. `receiverFor` maps any `raw`
 *  stream to whatever fake `RTCRtpReceiver` stand-in the test wants Backend
 *  0 to resolve (or `undefined`, to prove it's skipped cleanly). */
function registerFakeKerbcastSourceWithReceiver(
  receiverFor: (stream: unknown) => unknown,
) {
  const fake = { id: "kerbcast", getReceiverForStream: receiverFor };
  registerDataSource(
    fake as unknown as Parameters<typeof registerDataSource>[0],
  );
}

/**
 * Minimal fake `Worker` — `getSharedWorker()` is shared, module-level
 * state (`kerbcastDelayWorkerClient.ts`), so stubbing `Worker` to make
 * Backend 0 reachable ALSO makes Backend 2 (`createWorkerFrameDelayStream`)
 * reachable if Backend 0 falls through: it awaits a `pipelineReady`/
 * `pipelineError` reply that a truly no-op fake would never send, hanging
 * the test forever at `{kind: "connecting"}`. Replying `pipelineError`
 * immediately to any `createPipeline` message keeps Backend 2 resolving
 * to `"unavailable"` quickly instead, matching what a real browser without
 * genuine worker-side track support would do. Backend 0
 * (`attachEncodedWorkerFrameDelay`) never awaits a reply at all (see
 * `kerbcastDelayWorkerClient.ts`'s doc on why that attach is effectively
 * synchronous), so this only matters for tests that fall through to
 * Backend 2.
 */
class FakeWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  postMessage(msg: { type?: string; pipelineId?: string }) {
    if (msg?.type === "createPipeline") {
      queueMicrotask(() => {
        this.onmessage?.({
          data: {
            type: "pipelineError",
            pipelineId: msg.pipelineId,
            reason: "fake worker: no real pipeline support in this test",
          },
        } as MessageEvent);
      });
    }
  }
}

function StreamProbe({
  raw,
  clock,
  onResult,
}: {
  raw: MediaStream | null;
  clock: DelayClockLike;
  onResult: (r: DelayedPlayoutResult) => void;
}): null {
  const result = useDelayedPlayout(raw, {
    view: clock,
    captureUt: () => 10,
  });
  onResult(result);
  return null;
}

describe("useDelayedPlayout — Backend 0: encoded transform on the receiver", () => {
  it("attaches directly to the resolved receiver and surfaces the SAME raw stream (no new track) when the platform supports RTCRtpScriptTransform", async () => {
    class FakeRTCRtpScriptTransform {
      static instances: FakeRTCRtpScriptTransform[] = [];
      constructor(
        public worker: unknown,
        public options: unknown,
      ) {
        FakeRTCRtpScriptTransform.instances.push(this);
      }
    }
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("RTCRtpScriptTransform", FakeRTCRtpScriptTransform);

    const fakeReceiver = { transform: null as unknown };
    const rawStream = { getVideoTracks: () => [{}] } as unknown as MediaStream;
    registerFakeKerbcastSourceWithReceiver(() => fakeReceiver);
    const clock = manualClock();

    let latest: DelayedPlayoutResult | "unset" = "unset";
    render(
      <StreamProbe
        raw={rawStream}
        clock={clock}
        onResult={(r) => {
          latest = r;
        }}
      />,
    );

    await waitFor(() => {
      expect(latest).toMatchObject({ kind: "delayed" });
    });
    // The transform was actually constructed and assigned onto the real
    // receiver object — this is the "wired, not just unit-tested in
    // isolation" proof: attachEncodedWorkerFrameDelay reached the platform
    // API, not a mock of itself.
    expect(FakeRTCRtpScriptTransform.instances).toHaveLength(1);
    expect(fakeReceiver.transform).toBe(FakeRTCRtpScriptTransform.instances[0]);
    // No new stream — the SAME raw reference, unlike backends 1/2 which
    // always produce a fresh generator-backed stream.
    const delayed = latest as unknown as DelayedPlayoutResult & {
      kind: "delayed";
    };
    expect(delayed.stream).toBe(rawStream);
  });

  it("falls through (never throws) when RTCRtpScriptTransform's constructor throws", async () => {
    class ThrowingTransform {
      constructor() {
        throw new Error("receiver already has a transform");
      }
    }
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("RTCRtpScriptTransform", ThrowingTransform);

    const fakeReceiver = { transform: null as unknown };
    const rawStream = { getVideoTracks: () => [{}] } as unknown as MediaStream;
    registerFakeKerbcastSourceWithReceiver(() => fakeReceiver);
    const clock = manualClock();

    let latest: DelayedPlayoutResult | "unset" = "unset";
    expect(() => {
      render(
        <StreamProbe
          raw={rawStream}
          clock={clock}
          onResult={(r) => {
            latest = r;
          }}
        />,
      );
    }).not.toThrow();

    // Backend 1 (no WebCodecs stubbed here) can't build either, so this
    // lands on "unavailable" — the point under test is narrower: a
    // THROWING encoded-transform attach must degrade to "try the next
    // backend", never an unhandled exception or a stuck "connecting".
    await waitFor(() => {
      expect(latest).toMatchObject({ kind: "unavailable" });
    });
  });

  it("does not attempt backend 0 when getReceiverForStream resolves nothing (falls through silently, same as every other backend's null case)", async () => {
    class FakeRTCRtpScriptTransform {
      static instances: FakeRTCRtpScriptTransform[] = [];
      constructor() {
        FakeRTCRtpScriptTransform.instances.push(this);
      }
    }
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("RTCRtpScriptTransform", FakeRTCRtpScriptTransform);

    const rawStream = { getVideoTracks: () => [{}] } as unknown as MediaStream;
    registerFakeKerbcastSourceWithReceiver(() => undefined);
    const clock = manualClock();

    let latest: DelayedPlayoutResult | "unset" = "unset";
    render(
      <StreamProbe
        raw={rawStream}
        clock={clock}
        onResult={(r) => {
          latest = r;
        }}
      />,
    );

    await waitFor(() => {
      expect(latest).toMatchObject({ kind: "unavailable" });
    });
    expect(FakeRTCRtpScriptTransform.instances).toHaveLength(0);
  });

  it("skips backend 0 (but doesn't throw) when the data source has no getReceiverForStream at all — matches the existing decoded-backend fakes' shape", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    // RTCRtpScriptTransform deliberately left unstubbed/absent too.
    const fake = { id: "kerbcast" }; // no getReceiverForStream, like the pre-existing test fakes
    registerDataSource(
      fake as unknown as Parameters<typeof registerDataSource>[0],
    );
    const rawStream = { getVideoTracks: () => [{}] } as unknown as MediaStream;
    const clock = manualClock();

    let latest: DelayedPlayoutResult | "unset" = "unset";
    expect(() => {
      render(
        <StreamProbe
          raw={rawStream}
          clock={clock}
          onResult={(r) => {
            latest = r;
          }}
        />,
      );
    }).not.toThrow();

    await waitFor(() => {
      expect(latest).toMatchObject({ kind: "unavailable" });
    });
  });
});
