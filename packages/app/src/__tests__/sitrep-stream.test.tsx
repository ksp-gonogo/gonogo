import type { DataSource, DataSourceStatus } from "@gonogo/core";
import { clearRegistry, registerDataSource, useDataValue } from "@gonogo/core";
import { StubTransport } from "@gonogo/sitrep-client";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SitrepTelemetryProvider } from "../telemetry/SitrepTelemetryProvider";

/**
 * End-to-end proof of the browser-transport brief's validation requirement
 * (b): mounting `<SitrepTelemetryProvider enabled>` on the main screen makes a
 * CARRIED, MAPPED topic read from the streaming pipeline instead of the legacy
 * Telemachus `DataSource`.
 *
 * Nothing internal is mocked — the REAL `SitrepTelemetryProvider`, a REAL
 * `TelemetryClient`/`TimelineStore`, the REAL `useDataValue` shim and a REAL
 * registered legacy source all run. The transport injected here is a REAL
 * `StubTransport` (the SDK's scriptable in-memory `Transport`, not a spy).
 *
 * The LIVE `WebSocketTransport` is exercised two ways: over the MSW WebSocket
 * boundary in `packages/sitrep-client/src/websocket-transport.test.ts`, and —
 * end-to-end inside this very provider — in `sitrep-stream-wire.test.tsx`,
 * where the provider builds its own real `WebSocketTransport` and MSW's `ws`
 * interceptor (installed in `server.listen()`, after the app's
 * `installDomStubs` no-op WebSocket) carries a frame all the way to a widget
 * re-render. This file keeps the `StubTransport` variant because it's the
 * cleaner way to assert the carried-vs-legacy routing without wire timing.
 */

beforeEach(() => clearRegistry());
afterEach(() => cleanup());

/** Minimal in-memory legacy "data" source, same shape as the core shim tests use. */
function makeLegacySource(id = "data") {
  const dataListeners = new Map<string, Set<(v: unknown) => void>>();
  const statusListeners = new Set<(s: DataSourceStatus) => void>();
  const source: DataSource & { emit: (key: string, value: unknown) => void } = {
    id,
    name: id,
    status: "connected",
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
  };
  return source;
}

function Throttle() {
  const throttle = useDataValue("data", "f.throttle");
  return <div>throttle:{throttle === undefined ? "—" : String(throttle)}</div>;
}

describe("SitrepTelemetryProvider — dev-flag stream mount", () => {
  it("a carried topic reads from the stream pipeline, not the legacy DataSource", async () => {
    const transport = new StubTransport();
    const legacy = makeLegacySource();
    registerDataSource(legacy);

    // "f.throttle" maps to the raw-field subtopic "vessel.control.throttle",
    // which resolves down to the real wire topic "vessel.control".
    render(
      <SitrepTelemetryProvider
        enabled
        transport={transport}
        carriedChannels={["vessel.control"]}
      >
        <Throttle />
      </SitrepTelemetryProvider>,
    );

    expect(screen.getByText("throttle:—")).toBeTruthy();

    // A legacy emit must NOT surface — the topic is carried, so it routes to
    // the stream and bypasses legacy entirely.
    act(() => legacy.emit("f.throttle", 0.4));
    expect(screen.getByText("throttle:—")).toBeTruthy();

    // The value that DOES surface comes off the stream.
    act(() => transport.emit("vessel.control", { throttle: 0.75 }));
    await waitFor(() => expect(screen.getByText("throttle:0.75")).toBeTruthy());
  });

  it("when disabled, renders children untouched and the legacy DataSource drives the read", () => {
    const legacy = makeLegacySource();
    registerDataSource(legacy);

    render(
      <SitrepTelemetryProvider enabled={false}>
        <Throttle />
      </SitrepTelemetryProvider>,
    );

    expect(screen.getByText("throttle:—")).toBeTruthy();
    act(() => legacy.emit("f.throttle", 0.4));
    expect(screen.getByText("throttle:0.4")).toBeTruthy();
  });
});
