import { clearRegistry, registerDataSource } from "@gonogo/core";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KosProcessorsComponent } from "./index";
import "./processorsScript"; // self-registers the kOS script
import { KOS_PROCESSORS_TOPIC_ID } from "./processorsScript";

const TOPIC_KEY = `kos.compute.${KOS_PROCESSORS_TOPIC_ID}.processors`;

/**
 * Fake `kos` data source that speaks just enough of the centralised compute
 * surface for KosProcessors to render. Mirrors the slice of KosDataSource
 * the widget actually touches: subscribe, getTopicStatus, onTopicStatusChange,
 * execute. Lets us exercise the real component path without spinning up
 * MockKosTelnet.
 */
function registerFakeKos(initialPayload?: unknown) {
  const subs = new Set<(value: unknown) => void>();
  const statusListeners = new Set<() => void>();
  let lastValue: unknown = initialPayload;

  const fake = {
    id: "kos",
    name: "kOS",
    status: "connected" as const,
    affectedBySignalLoss: false,
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    subscribe(key: string, cb: (value: unknown) => void): () => void {
      if (key !== TOPIC_KEY) return () => {};
      subs.add(cb);
      if (lastValue !== undefined) {
        queueMicrotask(() => cb(lastValue));
      }
      return () => subs.delete(cb);
    },
    onStatusChange: () => () => {},
    async execute() {},
    configSchema: () => [],
    configure: () => {},
    getConfig: () => ({}),
    getTopicStatus: (id: string) => {
      if (id !== KOS_PROCESSORS_TOPIC_ID) return null;
      return {
        lastGoodAt: lastValue !== undefined ? Date.now() : null,
        scriptError: null,
        parseError: null,
        paused: false,
        running: false,
      };
    },
    onTopicStatusChange: (id: string, cb: () => void) => {
      if (id !== KOS_PROCESSORS_TOPIC_ID) return () => {};
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    push(value: unknown) {
      lastValue = value;
      for (const cb of subs) cb(value);
      for (const cb of statusListeners) cb();
    },
  };

  registerDataSource(
    fake as unknown as Parameters<typeof registerDataSource>[0],
  );
  return fake;
}

describe("KosProcessorsComponent", () => {
  beforeEach(() => {
    clearRegistry();
    // Re-import the script so it re-registers (clearRegistry wipes the
    // kos-script registry too).
    void import("./processorsScript");
  });

  afterEach(() => {
    cleanup();
    clearRegistry();
  });

  it("shows the run-prompt placeholder before any payload arrives", () => {
    registerFakeKos();
    render(<KosProcessorsComponent config={{}} />);
    expect(screen.getByText(/Press Run/i)).toBeInTheDocument();
  });

  it("renders a row per processor when the centralised feed delivers data", async () => {
    const fake = registerFakeKos();
    render(<KosProcessorsComponent config={{}} />);

    act(() => {
      fake.push([
        {
          tag: "MainCPU",
          mode: "READY",
          volume: "boot",
          bootFile: "boot/main.ks",
          partTitle: "KAL9000 Scriptable Control System",
          partUid: "uid-1",
        },
        {
          tag: "",
          mode: "OFF",
          volume: "",
          bootFile: "",
          partTitle: "kOS CPU",
          partUid: "uid-2",
        },
      ]);
    });

    expect(await screen.findByText("MainCPU")).toBeInTheDocument();
    expect(screen.getByText(/KAL9000/)).toBeInTheDocument();
    expect(screen.getByText(/vol · boot/)).toBeInTheDocument();
    expect(screen.getByText(/boot · boot\/main\.ks/)).toBeInTheDocument();

    expect(screen.getByText(/untagged/i)).toBeInTheDocument();
    expect(screen.getByText("OFF")).toBeInTheDocument();
  });
});
