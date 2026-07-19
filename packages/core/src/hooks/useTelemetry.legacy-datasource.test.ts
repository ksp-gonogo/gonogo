import { act, renderHook } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { clearRegistry, registerDataSource } from "../registry";
import type { DataSource, DataSourceStatus } from "../types";
import { useTelemetry } from "./useTelemetry";

// Minimal in-memory data source that lets tests push values and status changes.
function makeSource(id = "test-source") {
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

describe("useTelemetry", () => {
  it("returns undefined when the data source is not registered", () => {
    const { result } = renderHook(() => useTelemetry("missing", "v.altitude"));
    expect(result.current).toBeUndefined();
  });

  it("returns undefined before any value is emitted", () => {
    const source = makeSource();
    registerDataSource(source);
    const { result } = renderHook(() =>
      useTelemetry("test-source", "v.altitude"),
    );
    expect(result.current).toBeUndefined();
  });

  it("returns the latest emitted value", () => {
    const source = makeSource();
    registerDataSource(source);

    const { result } = renderHook(() =>
      useTelemetry("test-source", "v.altitude"),
    );

    act(() => source.emit("v.altitude", 80_000));

    expect(result.current).toBe(80_000);
  });

  it("re-renders with each new value", () => {
    const source = makeSource();
    registerDataSource(source);

    const { result } = renderHook(() =>
      useTelemetry("test-source", "v.altitude"),
    );

    act(() => source.emit("v.altitude", 100_000));
    expect(result.current).toBe(100_000);

    act(() => source.emit("v.altitude", 150_000));
    expect(result.current).toBe(150_000);
  });

  it("clears to undefined when source status leaves connected", () => {
    const source = makeSource();
    registerDataSource(source);

    const { result } = renderHook(() =>
      useTelemetry("test-source", "v.altitude"),
    );

    act(() => source.emit("v.altitude", 80_000));
    expect(result.current).toBe(80_000);

    act(() => source.setStatus("disconnected"));
    expect(result.current).toBeUndefined();
  });

  it("clears to undefined on error status", () => {
    const source = makeSource();
    registerDataSource(source);

    const { result } = renderHook(() =>
      useTelemetry("test-source", "v.altitude"),
    );

    act(() => source.emit("v.altitude", 80_000));
    act(() => source.setStatus("error"));

    expect(result.current).toBeUndefined();
  });

  it("does not clear when status transitions to connected", () => {
    const source = makeSource();
    registerDataSource(source);

    const { result } = renderHook(() =>
      useTelemetry("test-source", "v.altitude"),
    );

    act(() => source.emit("v.altitude", 80_000));
    act(() => source.setStatus("connected"));

    expect(result.current).toBe(80_000);
  });

  it("isolates subscriptions — different keys do not interfere", () => {
    const source = makeSource();
    registerDataSource(source);

    const { result: altResult } = renderHook(() =>
      useTelemetry("test-source", "v.altitude"),
    );
    const { result: speedResult } = renderHook(() =>
      useTelemetry("test-source", "v.surfaceSpeed"),
    );

    act(() => source.emit("v.altitude", 250));
    act(() => source.emit("v.surfaceSpeed", 2_200));

    expect(altResult.current).toBe(250);
    expect(speedResult.current).toBe(2_200);
  });

  it("unsubscribes cleanly on unmount", () => {
    const source = makeSource();
    registerDataSource(source);

    const { result, unmount } = renderHook(() =>
      useTelemetry("test-source", "v.altitude"),
    );

    act(() => source.emit("v.altitude", 100));
    unmount();

    // Emitting after unmount must not throw or update the (now gone) hook
    expect(() => act(() => source.emit("v.altitude", 999))).not.toThrow();
    expect(result.current).toBe(100);
  });
});
