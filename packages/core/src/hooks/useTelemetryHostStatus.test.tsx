import { renderHook } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { clearRegistry, registerDataSource } from "../registry";
import type { DataSource, DataSourceStatus } from "../types";
import { useTelemetryHostDown } from "./useTelemetryHostStatus";

function makeSitrepFixture(status: DataSourceStatus): DataSource {
  return {
    id: "sitrep",
    name: "Sitrep Stream",
    status,
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    subscribe: () => () => {},
    execute: async () => {},
    configSchema: () => [],
    getConfig: () => ({}),
    configure: () => {},
    onStatusChange: () => () => {},
  };
}

beforeEach(() => clearRegistry());

describe("useTelemetryHostDown", () => {
  it("reports down when no sitrep DataSource is registered at all", () => {
    const { result } = renderHook(() => useTelemetryHostDown());
    expect(result.current).toBe(true);
  });

  it("reports down when the sitrep DataSource is disconnected", () => {
    registerDataSource(makeSitrepFixture("disconnected"));
    const { result } = renderHook(() => useTelemetryHostDown());
    expect(result.current).toBe(true);
  });

  it("reports down when the sitrep DataSource is in error", () => {
    registerDataSource(makeSitrepFixture("error"));
    const { result } = renderHook(() => useTelemetryHostDown());
    expect(result.current).toBe(true);
  });

  it("reports NOT down when the sitrep DataSource is connected", () => {
    registerDataSource(makeSitrepFixture("connected"));
    const { result } = renderHook(() => useTelemetryHostDown());
    expect(result.current).toBe(false);
  });

  it("reports NOT down while reconnecting — a transient blip, not a confirmed loss", () => {
    registerDataSource(makeSitrepFixture("reconnecting"));
    const { result } = renderHook(() => useTelemetryHostDown());
    expect(result.current).toBe(false);
  });
});
