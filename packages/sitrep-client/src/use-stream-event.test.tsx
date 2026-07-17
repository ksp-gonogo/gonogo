import { act, render } from "@ksp-gonogo/test-utils";
import { describe, expect, it, vi } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { StubTransport } from "./stub-transport";
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

    // The ReliableOrdered lane delivers every crash — both fire, in order, and
    // the second is not coalesced away by the store's per-frame batching.
    expect(onCrash).toHaveBeenCalledTimes(2);
    expect(onCrash).toHaveBeenNthCalledWith(1, {
      vesselName: "Kerbal X",
      ut: 100,
    });
    expect(onCrash).toHaveBeenNthCalledWith(2, {
      vesselName: "Kerbal Y",
      ut: 200,
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
    // Its handler must NOT fire for that replayed value — the crash already
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
    expect(second).toHaveBeenCalledWith({ vesselName: "Kerbal B", ut: 2 });
    expect(first).toHaveBeenCalledTimes(2);
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

    // Last subscriber gone: the client sends `unsubscribe`, so the transport
    // no longer delivers this topic and the handler never fires again.
    act(() => {
      transport.emit("crash.lastCrash", { vesselName: "Kerbal B", ut: 2 });
    });
    expect(onCrash).toHaveBeenCalledTimes(1);
  });
});
