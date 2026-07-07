import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@gonogo/sitrep-client";
import { act, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { clearRegistry, registerDataSource } from "../registry";
import type { DataSource, DataSourceStatus } from "../types";
import { useDataValue } from "./useDataValue";

// Minimal in-memory legacy DataSource — same shape as useDataValue.test.ts's
// fixture, reused here to drive the "falls back to the legacy path" side of
// the shim.
function makeLegacySource(id = "data") {
  const dataListeners = new Map<string, Set<(v: unknown) => void>>();
  const statusListeners = new Set<(s: DataSourceStatus) => void>();

  const source: DataSource & {
    emit: (key: string, value: unknown) => void;
    setStatus: (s: DataSourceStatus) => void;
  } = {
    id,
    name: id,
    status: "connected" as DataSourceStatus,
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    execute: async () => {},
    configSchema: () => [],
    configure: () => {},
    getConfig: () => ({}),
    subscribe(key, cb) {
      if (!dataListeners.has(key)) dataListeners.set(key, new Set());
      dataListeners.get(key)?.add(cb);
      return () => dataListeners.get(key)?.delete(cb);
    },
    onStatusChange(cb) {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    emit(key, value) {
      dataListeners.get(key)?.forEach((cb) => {
        cb(value);
      });
    },
    setStatus(s) {
      source.status = s;
      statusListeners.forEach((cb) => {
        cb(s);
      });
    },
  };
  return source;
}

beforeEach(() => clearRegistry());

describe("useDataValue shim — mapped key routes to useStream when a TelemetryProvider is mounted", () => {
  it("reads a mapped key ('v.altitude' -> vessel.state.altitudeAsl) from the TelemetryClient, not the legacy DataSource", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const legacySource = makeLegacySource();
    registerDataSource(legacySource);

    function Alt() {
      const alt = useDataValue("data", "v.altitude");
      return <div>alt:{alt === undefined ? "—" : String(alt)}</div>;
    }

    render(
      <TelemetryProvider client={client}>
        <Alt />
      </TelemetryProvider>,
    );

    // Undefined-while-loading — the same contract widgets already rely on.
    expect(screen.getByText("alt:—")).toBeTruthy();

    // Feeding the legacy DataSource must NOT surface — the mapped key is
    // routed to the stream, so the old path is bypassed entirely.
    act(() => legacySource.emit("v.altitude", 999));
    expect(screen.getByText("alt:—")).toBeTruthy();

    // Feeding the new topic on the TelemetryClient is what updates it.
    act(() => transport.emit("vessel.state.altitudeAsl", 12_345));
    expect(screen.getByText("alt:12345")).toBeTruthy();
  });
});

describe("useDataValue shim — unmapped key falls back to the legacy DataSource path even with a provider mounted", () => {
  it("a known-gap key ('career.funds') ignores the TelemetryClient and reads the legacy DataSource", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const legacySource = makeLegacySource();
    registerDataSource(legacySource);

    function Funds() {
      const funds = useDataValue("data", "career.funds");
      return <div>funds:{funds === undefined ? "—" : String(funds)}</div>;
    }

    render(
      <TelemetryProvider client={client}>
        <Funds />
      </TelemetryProvider>,
    );

    expect(screen.getByText("funds:—")).toBeTruthy();

    // A sample on the new SDK for an unmapped key must have no effect.
    act(() => transport.emit("career.funds", 500));
    expect(screen.getByText("funds:—")).toBeTruthy();

    // The legacy DataSource is what still drives it.
    act(() => legacySource.emit("career.funds", 289_848));
    expect(screen.getByText("funds:289848")).toBeTruthy();
  });
});

describe("useDataValue shim — no TelemetryProvider mounted behaves exactly like the pre-shim hook", () => {
  it("a mapped key with no provider in the tree still reads the legacy DataSource (unmigrated screens keep working)", () => {
    const source = makeLegacySource();
    registerDataSource(source);

    // No <TelemetryProvider> wrapper at all — this is every screen today.
    const { result } = renderHook(() => useDataValue("data", "v.altitude"));

    expect(result.current).toBeUndefined();
    act(() => source.emit("v.altitude", 80_000));
    expect(result.current).toBe(80_000);
  });

  it("clears to undefined on disconnect — the legacy-path contract is untouched by the shim", () => {
    const source = makeLegacySource();
    registerDataSource(source);

    const { result } = renderHook(() => useDataValue("data", "v.altitude"));
    act(() => source.emit("v.altitude", 80_000));
    expect(result.current).toBe(80_000);

    act(() => source.setStatus("disconnected"));
    expect(result.current).toBeUndefined();
  });
});
