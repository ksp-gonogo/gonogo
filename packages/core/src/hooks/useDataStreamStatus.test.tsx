import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@gonogo/sitrep-client";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { clearRegistry, registerDataSource } from "../registry";
import type { DataSource, DataSourceStatus } from "../types";
import { useDataStreamStatus } from "./useDataStreamStatus";

function makeLegacySource(id = "data") {
  const statusListeners = new Set<(s: DataSourceStatus) => void>();
  const source: DataSource & { setStatus: (s: DataSourceStatus) => void } = {
    id,
    name: id,
    status: "connected",
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    subscribe: () => () => {},
    execute: async () => {},
    configSchema: () => [],
    configure: () => {},
    getConfig: () => ({}),
    onStatusChange(cb) {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    setStatus(s) {
      source.status = s;
      for (const cb of statusListeners) cb(s);
    },
  };
  return source;
}

beforeEach(() => clearRegistry());

/**
 * `useDataStreamStatus` — the M3 "adopt staleness/certainty" shim
 * (`m3-migration-plan.md` §2 item 3, the "convert cleared-assertions into
 * held-stale-assertions" step) — the third leg alongside `useDataValue`
 * (read) / `useExecuteAction` (write). Same dual-path contract: no provider
 * (or an uncarried/unmapped key) reads a legacy-DataSource-status-derived
 * value; a carried, mapped key reads the real `StreamStatusValue` off the
 * `TimelineStore`.
 */
describe("useDataStreamStatus — no TelemetryProvider mounted", () => {
  it("maps the legacy DataSource status onto a StreamStatusValue", () => {
    const source = makeLegacySource();
    registerDataSource(source);

    const { result } = renderHook(() =>
      useDataStreamStatus("data", "t.timeWarp"),
    );
    expect(result.current).toBe("live");

    act(() => source.setStatus("disconnected"));
    expect(result.current).toBe("disconnected");

    act(() => source.setStatus("reconnecting"));
    expect(result.current).toBe("held-stale");

    act(() => source.setStatus("error"));
    expect(result.current).toBe("disconnected");
  });

  it("defaults to disconnected when the source isn't registered", () => {
    const { result } = renderHook(() =>
      useDataStreamStatus("data", "t.timeWarp"),
    );
    expect(result.current).toBe("disconnected");
  });
});

describe("useDataStreamStatus — mapped + carried key reads the real stream status", () => {
  it("resyncing before any data, live once the raw topic arrives", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const legacySource = makeLegacySource();
    registerDataSource(legacySource);

    function Status() {
      const status = useDataStreamStatus("data", "t.timeWarp");
      return <div>status:{status}</div>;
    }

    render(
      <TelemetryProvider client={client} carriedChannels={["time.warp"]}>
        <Status />
      </TelemetryProvider>,
    );

    expect(screen.getByText("status:resyncing")).toBeTruthy();

    act(() => {
      transport.emit("time.warp", {
        warpRate: 1,
        warpRateIndex: 0,
        warpMode: 0,
        paused: false,
      });
    });
    await waitFor(() => expect(screen.getByText("status:live")).toBeTruthy());

    // Legacy status changes must not surface once the key is carried.
    act(() => legacySource.setStatus("disconnected"));
    expect(screen.getByText("status:live")).toBeTruthy();
  });
});

describe("useDataStreamStatus — mapped but NOT carried falls back to legacy status", () => {
  it("reads the legacy status when the provider hasn't carried the topic yet", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const legacySource = makeLegacySource();
    registerDataSource(legacySource);

    const { result } = renderHook(
      () => useDataStreamStatus("data", "t.timeWarp"),
      {
        wrapper: ({ children }) => (
          <TelemetryProvider client={client}>{children}</TelemetryProvider>
        ),
      },
    );

    expect(result.current).toBe("live");
    act(() => legacySource.setStatus("disconnected"));
    expect(result.current).toBe("disconnected");
  });
});
