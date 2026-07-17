import { act, renderHook } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { clearRegistry, registerDataSource } from "../registry";
import type { DataSource, DataSourceStatus } from "../types";
import { useDataSources } from "./useDataSources";

function makeMockSource(
  id: string,
  name: string,
): DataSource & { simulateStatusChange: (s: DataSourceStatus) => void } {
  const listeners = new Set<(s: DataSourceStatus) => void>();
  return {
    id,
    name,
    status: "disconnected" as DataSourceStatus,
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    subscribe: () => () => {},
    onStatusChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    simulateStatusChange(s: DataSourceStatus) {
      this.status = s;
      listeners.forEach((cb) => {
        cb(s);
      });
    },
  };
}

beforeEach(() => {
  clearRegistry();
});

describe("useDataSources", () => {
  it("returns empty array when no sources are registered", () => {
    const { result } = renderHook(() => useDataSources());
    expect(result.current).toHaveLength(0);
  });

  it("returns registered data sources with their current status", () => {
    const source = makeMockSource("src-1", "Source One");
    registerDataSource(source);

    const { result } = renderHook(() => useDataSources());
    expect(result.current).toHaveLength(1);
    expect(result.current[0].id).toBe("src-1");
    expect(result.current[0].name).toBe("Source One");
    expect(result.current[0].status).toBe("disconnected");
  });

  it("updates status when onStatusChange fires", () => {
    const source = makeMockSource("src-1", "Source One");
    registerDataSource(source);

    const { result } = renderHook(() => useDataSources());
    expect(result.current[0].status).toBe("disconnected");

    act(() => {
      source.simulateStatusChange("connected");
    });

    expect(result.current[0].status).toBe("connected");
  });

  it("reflects error status", () => {
    const source = makeMockSource("src-1", "Source One");
    registerDataSource(source);

    const { result } = renderHook(() => useDataSources());

    act(() => {
      source.simulateStatusChange("error");
    });

    expect(result.current[0].status).toBe("error");
  });

  it("handles multiple sources independently", () => {
    const s1 = makeMockSource("s1", "Source 1");
    const s2 = makeMockSource("s2", "Source 2");
    registerDataSource(s1);
    registerDataSource(s2);

    const { result } = renderHook(() => useDataSources());
    expect(result.current).toHaveLength(2);

    act(() => {
      s1.simulateStatusChange("connected");
    });

    expect(result.current.find((s) => s.id === "s1")?.status).toBe("connected");
    expect(result.current.find((s) => s.id === "s2")?.status).toBe(
      "disconnected",
    );
  });
});
