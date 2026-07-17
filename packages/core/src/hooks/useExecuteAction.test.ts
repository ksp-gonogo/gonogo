import { renderHook } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegistry, registerDataSource } from "../registry";
import type { DataSource } from "../types";
import { useExecuteAction } from "./useExecuteAction";

function makeSource(id = "test-source") {
  const executeSpy = vi.fn().mockResolvedValue(undefined);
  const source: DataSource = {
    id,
    name: id,
    status: "connected",
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    subscribe: () => () => {},
    execute: executeSpy,
    configSchema: () => [],
    configure: () => {},
    getConfig: () => ({}),
    onStatusChange: () => () => {},
  };
  return { source, executeSpy };
}

beforeEach(() => clearRegistry());

describe("useExecuteAction", () => {
  it("calls execute() on the registered source with the action key", async () => {
    const { source, executeSpy } = makeSource();
    registerDataSource(source);

    const { result } = renderHook(() => useExecuteAction("test-source"));
    await result.current("f.sas");

    expect(executeSpy).toHaveBeenCalledWith("f.sas");
  });

  it("resolves immediately without throwing when the source is not registered", async () => {
    const { result } = renderHook(() => useExecuteAction("missing-source"));
    await expect(result.current("f.sas")).resolves.toBeUndefined();
  });

  it("returns a stable function reference when the source id does not change", () => {
    const { source } = makeSource();
    registerDataSource(source);

    const { result, rerender } = renderHook(() =>
      useExecuteAction("test-source"),
    );
    const first = result.current;
    rerender();

    expect(result.current).toBe(first);
  });
});
