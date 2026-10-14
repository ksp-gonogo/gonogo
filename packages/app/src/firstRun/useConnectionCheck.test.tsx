import type {
  ConfigField,
  DataSource,
  DataSourceStatus,
} from "@ksp-gonogo/core";
import { clearRegistry, registerDataSource } from "@ksp-gonogo/core";
import { act, renderHook } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONNECT_GRACE_MS } from "./checks";
import { say } from "./copy";
import {
  __resetConnectionClock,
  useConnectionCheck,
} from "./useConnectionCheck";

/** A sitrep source whose status the test moves, the way the stream's own transitions do. */
function makeSource(initial: DataSourceStatus) {
  let status = initial;
  const listeners = new Set<(s: DataSourceStatus) => void>();
  const source: DataSource = {
    id: "sitrep",
    name: "Sitrep Stream",
    get status() {
      return status;
    },
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    subscribe: () => () => {},
    configSchema: (): ConfigField[] => [],
    getConfig: () => ({ host: "localhost", port: 8090 }),
    configure: () => {},
    onStatusChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return {
    source,
    set(next: DataSourceStatus) {
      status = next;
      for (const cb of listeners) cb(next);
    },
  };
}

const ADDRESS = "localhost:8090";

describe("useConnectionCheck: a connection that does not answer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetConnectionClock();
    clearRegistry();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads as trying for the grace period, then as a failure that is still retrying (a refused or silent port)", () => {
    const world = makeSource("reconnecting");
    registerDataSource(world.source);
    const { result } = renderHook(() => useConnectionCheck());

    expect(result.current).toEqual({
      state: "checking",
      text: say("connect.check.checking", { address: ADDRESS }),
    });

    act(() => {
      vi.advanceTimersByTime(CONNECT_GRACE_MS - 1);
    });
    expect(result.current.state).toBe("checking");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toEqual({
      state: "fail",
      text: say("connect.check.retrying", { address: ADDRESS }),
    });
  });

  it("turns to pass by itself when the stream connects after the failure showed", () => {
    const world = makeSource("reconnecting");
    registerDataSource(world.source);
    const { result } = renderHook(() => useConnectionCheck());
    act(() => {
      vi.advanceTimersByTime(CONNECT_GRACE_MS);
    });
    expect(result.current.state).toBe("fail");

    act(() => world.set("connected"));
    expect(result.current).toEqual({
      state: "pass",
      text: say("connect.check.pass", { address: ADDRESS }),
    });
  });

  it("never fails a connection that opens inside the grace period", () => {
    const world = makeSource("reconnecting");
    registerDataSource(world.source);
    const { result } = renderHook(() => useConnectionCheck());
    act(() => {
      vi.advanceTimersByTime(CONNECT_GRACE_MS - 1000);
      world.set("connected");
    });
    act(() => {
      vi.advanceTimersByTime(CONNECT_GRACE_MS * 2);
    });
    expect(result.current.state).toBe("pass");
  });

  it("counts from the first unanswered moment across mounts, so the health step agrees with the connect step", () => {
    const world = makeSource("reconnecting");
    registerDataSource(world.source);
    const first = renderHook(() => useConnectionCheck());
    act(() => {
      vi.advanceTimersByTime(CONNECT_GRACE_MS);
    });
    expect(first.result.current.state).toBe("fail");
    first.unmount();

    const later = renderHook(() => useConnectionCheck());
    expect(later.result.current.state).toBe("fail");
  });

  it("starts the count again after a connection that then drops", () => {
    const world = makeSource("reconnecting");
    registerDataSource(world.source);
    const { result } = renderHook(() => useConnectionCheck());
    act(() => {
      vi.advanceTimersByTime(CONNECT_GRACE_MS);
    });
    act(() => world.set("connected"));
    act(() => world.set("reconnecting"));
    expect(result.current.state).toBe("checking");
  });
});
