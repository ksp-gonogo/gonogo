import { act, renderHook } from "@ksp-gonogo/test-utils";
import { useCallback } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegistry, registerDataSource } from "../registry";
import type { DataSource } from "../types";
import { useDataSourceSubscription } from "./useDataSourceSubscription";

function makeSource(id = "test-source"): DataSource {
  return {
    id,
    name: id,
    status: "connected",
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    subscribe: () => () => {},
    onStatusChange: () => () => {},
    execute: async () => {},
    configSchema: () => [],
    configure: () => {},
    getConfig: () => ({}),
  };
}

beforeEach(() => clearRegistry());

describe("useDataSourceSubscription", () => {
  it("returns the initial snapshot when the source is missing", () => {
    const setup = vi.fn(() => () => {});
    const { result } = renderHook(() =>
      useDataSourceSubscription<string>("missing", setup, "initial"),
    );
    expect(result.current).toBe("initial");
    expect(setup).not.toHaveBeenCalled();
  });

  it("invokes setup once mounted and runs cleanup on unmount", () => {
    const source = makeSource();
    registerDataSource(source);

    const cleanup = vi.fn();
    const setup = vi.fn(() => cleanup);

    const { unmount } = renderHook(() =>
      useDataSourceSubscription<number>("test-source", setup, 0),
    );

    expect(setup).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveBeenCalled();

    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("re-renders when the setup invokes notify", () => {
    const source = makeSource();
    registerDataSource(source);

    let externalNotify: (() => void) | undefined;
    const ref = { value: 0 };

    const { result } = renderHook(() => {
      const setup = useCallback(
        (
          _source: DataSource,
          notify: () => void,
          snapshotRef: { current: number },
        ) => {
          externalNotify = () => {
            snapshotRef.current = ref.value;
            notify();
          };
          return () => {
            externalNotify = undefined;
          };
        },
        [],
      );
      return useDataSourceSubscription<number>("test-source", setup, 0);
    });

    expect(result.current).toBe(0);

    act(() => {
      ref.value = 42;
      externalNotify?.();
    });
    expect(result.current).toBe(42);

    act(() => {
      ref.value = 99;
      externalNotify?.();
    });
    expect(result.current).toBe(99);
  });

  it("reflects mutations to the snapshot ref made inside setup", () => {
    const source = makeSource();
    registerDataSource(source);

    const setup = (
      _source: DataSource,
      notify: () => void,
      snapshotRef: { current: { count: number } },
    ) => {
      snapshotRef.current = { count: 1 };
      notify();
      return () => {};
    };

    const { result } = renderHook(() =>
      useDataSourceSubscription<{ count: number }>("test-source", setup, {
        count: 0,
      }),
    );

    expect(result.current.count).toBe(1);
  });
});
