import { value } from "@ksp-gonogo/sitrep-sdk";
import { act, render } from "@ksp-gonogo/test-utils";
import { describe, expect, it, vi } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { makeMeta, StubTransport } from "./stub-transport";
import { useStreamEvent } from "./use-stream-event";

interface Crash {
  vesselName: string;
  ut: number;
}

function CrashListener({ onCrash }: { onCrash: (c: Crash) => void }) {
  useStreamEvent<Crash>("crash.lastCrash", onCrash);
  return null;
}

describe("useStreamEvent", () => {
  it("fires the handler for each event delivered on the topic", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const onCrash = vi.fn();

    render(
      <TelemetryProvider client={client}>
        <CrashListener onCrash={onCrash} />
      </TelemetryProvider>,
    );

    expect(onCrash).not.toHaveBeenCalled();

    act(() => {
      transport.emit("crash.lastCrash", { vesselName: "Kerbal X", ut: 100 });
    });
    act(() => {
      transport.emit("crash.lastCrash", { vesselName: "Kerbal Y", ut: 200 });
    });

    // The ReliableOrdered lane delivers every crash: both fire, in order, and the second is not coalesced away by the store's per-frame batching.
    expect(onCrash).toHaveBeenCalledTimes(2);
    // `ut` arrives wrapped: `crash.lastCrash` declares it in seconds and the transport wraps on the way out, same as the wire decode.
    expect(onCrash).toHaveBeenNthCalledWith(1, {
      vesselName: "Kerbal X",
      ut: value("ut", 100),
    });
    expect(onCrash).toHaveBeenNthCalledWith(2, {
      vesselName: "Kerbal Y",
      ut: value("ut", 200),
    });
  });

  it("does not re-fire the sticky last event when a later subscriber mounts", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const first = vi.fn();
    const second = vi.fn();

    render(
      <TelemetryProvider client={client}>
        <CrashListener onCrash={first} />
      </TelemetryProvider>,
    );

    act(() => {
      transport.emit("crash.lastCrash", { vesselName: "Kerbal A", ut: 1 });
    });
    expect(first).toHaveBeenCalledTimes(1);

    // A second widget mounts after a crash already sits in the sticky cache.
    // Its handler must NOT fire for that replayed value, the crash already
    // happened; only a NEW crash is an event for it.
    render(
      <TelemetryProvider client={client}>
        <CrashListener onCrash={second} />
      </TelemetryProvider>,
    );
    expect(second).not.toHaveBeenCalled();

    act(() => {
      transport.emit("crash.lastCrash", { vesselName: "Kerbal B", ut: 2 });
    });
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith({
      vesselName: "Kerbal B",
      ut: value("ut", 2),
    });
    expect(first).toHaveBeenCalledTimes(2);
  });

  it("does not fire again when the mod sends the same event after a reconnect", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const onCrash = vi.fn();
    render(
      <TelemetryProvider client={client}>
        <CrashListener onCrash={onCrash} />
      </TelemetryProvider>,
    );

    act(() => {
      transport.emit(
        "crash.lastCrash",
        { vesselName: "Kerbal X", ut: 100 },
        { validAt: 100, deliveredAt: 100, seq: 7 },
      );
    });
    expect(onCrash).toHaveBeenCalledTimes(1);

    // The mod answers a resubscribe with its last sample, stamped as a new frame.
    act(() => {
      transport.emit(
        "crash.lastCrash",
        { vesselName: "Kerbal X", ut: 100 },
        { validAt: 100, deliveredAt: 460, seq: 31 },
      );
    });
    expect(onCrash).toHaveBeenCalledTimes(1);

    // A second crash in the same instant is still its own event.
    act(() => {
      transport.emit(
        "crash.lastCrash",
        { vesselName: "Kerbal Y", ut: 100 },
        { validAt: 100, deliveredAt: 460, seq: 32 },
      );
    });
    expect(onCrash).toHaveBeenCalledTimes(2);
  });

  it("does not fire for an event it mounted after, when the mod sends it again", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const early = vi.fn();
    const late = vi.fn();
    render(
      <TelemetryProvider client={client}>
        <CrashListener onCrash={early} />
      </TelemetryProvider>,
    );
    act(() => {
      transport.emit(
        "crash.lastCrash",
        { vesselName: "Kerbal X", ut: 100 },
        { validAt: 100, deliveredAt: 100, seq: 7 },
      );
    });
    render(
      <TelemetryProvider client={client}>
        <CrashListener onCrash={late} />
      </TelemetryProvider>,
    );

    act(() => {
      transport.emit(
        "crash.lastCrash",
        { vesselName: "Kerbal X", ut: 100 },
        { validAt: 100, deliveredAt: 460, seq: 31 },
      );
    });

    expect(late).not.toHaveBeenCalled();
  });

  it("fires for each of two identical events at one instant, told apart by their sample ids", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const onCrash = vi.fn();
    render(
      <TelemetryProvider client={client}>
        <CrashListener onCrash={onCrash} />
      </TelemetryProvider>,
    );

    act(() => {
      transport.emit(
        "crash.lastCrash",
        { vesselName: "Kerbal X", ut: 100 },
        { validAt: 100, deliveredAt: 100, seq: 7, sampleId: 40 },
      );
      transport.emit(
        "crash.lastCrash",
        { vesselName: "Kerbal X", ut: 100 },
        { validAt: 100, deliveredAt: 100, seq: 8, sampleId: 41 },
      );
    });
    expect(onCrash).toHaveBeenCalledTimes(2);

    // The mod's answer to a resubscribe is the last of them again.
    act(() => {
      transport.emit(
        "crash.lastCrash",
        { vesselName: "Kerbal X", ut: 100 },
        { validAt: 100, deliveredAt: 460, seq: 31, sampleId: 41 },
      );
    });
    expect(onCrash).toHaveBeenCalledTimes(2);
  });

  it("does not fire for a sample that reached the client before anything subscribed, when the mod sends it again", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const onCrash = vi.fn();
    // A frame still in flight when the last subscriber let go.
    act(() => {
      transport.emitRaw({
        type: "stream-data",
        topic: "crash.lastCrash",
        payload: { vesselName: "Kerbal X", ut: 100 },
        meta: makeMeta({
          validAt: 100,
          deliveredAt: 100,
          seq: 7,
          sampleId: 40,
        }),
      });
    });
    render(
      <TelemetryProvider client={client}>
        <CrashListener onCrash={onCrash} />
      </TelemetryProvider>,
    );

    act(() => {
      transport.emit(
        "crash.lastCrash",
        { vesselName: "Kerbal X", ut: 100 },
        { validAt: 100, deliveredAt: 460, seq: 31, sampleId: 40 },
      );
    });

    expect(onCrash).not.toHaveBeenCalled();
  });

  it("stops firing after the subscriber unmounts", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const onCrash = vi.fn();

    const view = render(
      <TelemetryProvider client={client}>
        <CrashListener onCrash={onCrash} />
      </TelemetryProvider>,
    );

    act(() => {
      transport.emit("crash.lastCrash", { vesselName: "Kerbal A", ut: 1 });
    });
    expect(onCrash).toHaveBeenCalledTimes(1);

    view.unmount();

    // Last subscriber gone: the client sends `unsubscribe`, so the transport no longer delivers this topic and the handler never fires again.
    act(() => {
      transport.emit("crash.lastCrash", { vesselName: "Kerbal B", ut: 2 });
    });
    expect(onCrash).toHaveBeenCalledTimes(1);
  });
});
