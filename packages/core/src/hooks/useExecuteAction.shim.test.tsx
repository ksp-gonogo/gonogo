import {
  createFakeWallClock,
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { act, renderHook } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegistry, registerDataSource } from "../registry";
import type { DataSource } from "../types";
import { useExecuteAction } from "./useExecuteAction";

function makeSource(id = "data") {
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

/**
 * The M3 command-shim mechanism (`m3-migration-plan.md` §4-commands, §Build
 * 1) — `useExecuteAction`'s write-half analog of `useDataValue.shim.test
 * .tsx`'s read-shim proof. Same allowlist-gated, legacy-fallback contract as
 * the read shim: a mapped action only dispatches via the new
 * `TelemetryClient.dispatch` (the mechanism `useCommand` itself is built on
 * — see `useExecuteAction.ts`'s own doc comment for why this hook can't
 * literally call the `useCommand` hook) once its command topic is CARRIED;
 * every other case (unmapped action, no provider, mapped-but-not-carried)
 * keeps calling the legacy `DataSource.execute(action)` unchanged.
 */
describe("useExecuteAction shim — mapped+carried action dispatches via the new command pipeline", () => {
  it("a carried warp-index action calls client.dispatch, never the legacy execute()", async () => {
    const transport = new StubTransport();
    const commandHandler = vi.fn(() => ({ ok: true }));
    transport.setCommandHandler(commandHandler);
    const client = new TelemetryClient(transport);
    const { source, executeSpy } = makeSource();
    registerDataSource(source);

    const { result } = renderHook(() => useExecuteAction("data"), {
      wrapper: ({ children }) => (
        <TelemetryProvider
          client={client}
          carriedChannels={["time.setWarpIndex"]}
        >
          {children}
        </TelemetryProvider>
      ),
    });

    await act(async () => {
      await result.current("t.timeWarp[4]");
    });

    expect(commandHandler).toHaveBeenCalledWith("time.setWarpIndex", {
      index: 4,
    });
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("carried pause/unpause actions dispatch the absolute setPaused command", async () => {
    const transport = new StubTransport();
    const commandHandler = vi.fn(() => ({ ok: true }));
    transport.setCommandHandler(commandHandler);
    const client = new TelemetryClient(transport);
    const { source, executeSpy } = makeSource();
    registerDataSource(source);

    const { result } = renderHook(() => useExecuteAction("data"), {
      wrapper: ({ children }) => (
        <TelemetryProvider client={client} carriedChannels={["time.setPaused"]}>
          {children}
        </TelemetryProvider>
      ),
    });

    await act(async () => {
      await result.current("t.pause");
    });
    expect(commandHandler).toHaveBeenCalledWith("time.setPaused", {
      paused: true,
    });

    await act(async () => {
      await result.current("t.unpause");
    });
    expect(commandHandler).toHaveBeenCalledWith("time.setPaused", {
      paused: false,
    });
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("never rejects even when the dispatched command fails — matches the legacy fire-and-forget contract", async () => {
    const transport = new StubTransport();
    transport.setCommandHandler(() => {
      throw { code: "E_RANGE", message: "bad index" };
    });
    const client = new TelemetryClient(transport);
    const { source } = makeSource();
    registerDataSource(source);

    const { result } = renderHook(() => useExecuteAction("data"), {
      wrapper: ({ children }) => (
        <TelemetryProvider
          client={client}
          carriedChannels={["time.setWarpIndex"]}
        >
          {children}
        </TelemetryProvider>
      ),
    });

    await expect(
      act(async () => result.current("t.timeWarp[-1]")),
    ).resolves.toBeUndefined();
  });
});

describe("useExecuteAction shim — falls back to legacy execute() unless mapped AND carried", () => {
  it("a mapped action NOT in carriedChannels still calls the legacy execute()", async () => {
    const transport = new StubTransport();
    const commandHandler = vi.fn(() => ({ ok: true }));
    transport.setCommandHandler(commandHandler);
    const client = new TelemetryClient(transport);
    const { source, executeSpy } = makeSource();
    registerDataSource(source);

    const { result } = renderHook(() => useExecuteAction("data"), {
      wrapper: ({ children }) => (
        <TelemetryProvider client={client}>{children}</TelemetryProvider>
      ),
    });

    await act(async () => {
      await result.current("t.timeWarp[4]");
    });

    expect(commandHandler).not.toHaveBeenCalled();
    expect(executeSpy).toHaveBeenCalledWith("t.timeWarp[4]");
  });

  it("an unmapped action still calls legacy execute() even with a provider mounted and the source carried", async () => {
    const transport = new StubTransport();
    const commandHandler = vi.fn(() => ({ ok: true }));
    transport.setCommandHandler(commandHandler);
    const client = new TelemetryClient(transport);
    const { source, executeSpy } = makeSource();
    registerDataSource(source);

    const { result } = renderHook(() => useExecuteAction("data"), {
      wrapper: ({ children }) => (
        <TelemetryProvider
          client={client}
          carriedChannels={["time.setWarpIndex", "time.setPaused"]}
        >
          {children}
        </TelemetryProvider>
      ),
    });

    await act(async () => {
      await result.current("f.sas");
    });

    expect(commandHandler).not.toHaveBeenCalled();
    expect(executeSpy).toHaveBeenCalledWith("f.sas");
  });

  it("no TelemetryProvider mounted behaves exactly like the pre-shim hook", async () => {
    const { source, executeSpy } = makeSource();
    registerDataSource(source);

    const { result } = renderHook(() => useExecuteAction("data"));

    await result.current("t.timeWarp[4]");
    expect(executeSpy).toHaveBeenCalledWith("t.timeWarp[4]");
  });
});

/** Builds a `TelemetryProvider` wrapper with an explicit `TimelineStore` this
 * test can prime directly — the toggle -> absolute bridge (`map-command.ts`'s
 * `toggleHome`) reads the CURRENT value off exactly this store via
 * `useTelemetryStoreOptional()`/`sample()`, so these tests need a store
 * reference to seed, unlike the plain command-dispatch tests above. */
function buildStreamWrapper(carriedChannels: string[]) {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const commandHandler = vi.fn(() => ({ ok: true }));
  transport.setCommandHandler(commandHandler);
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  // Pin the view clock (mirrors setupStreamFixture's `pinnedUt` pattern) —
  // without a scrub target, `viewUt()` tracks `confirmedEdgeUt()`, which
  // starts undefined until something has advanced it; a hold-last `sample()`
  // read against an unpinned/undefined viewUt never resolves.
  clock.scrubTo(0);
  const store = new TimelineStore(clock);

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider
        client={client}
        store={store}
        carriedChannels={carriedChannels}
      >
        {children}
      </TelemetryProvider>
    );
  }

  return { Wrapper, transport, client, store, commandHandler };
}

describe("useExecuteAction shim — toggle -> absolute bridge (map-command.ts bridge 1)", () => {
  it("f.sas inverts the live vessel.control.sas value and dispatches the absolute setSas command", async () => {
    const { Wrapper, transport, client, commandHandler } = buildStreamWrapper([
      "vessel.control",
      "vessel.control.setSas",
    ]);
    const { source, executeSpy } = makeSource();
    registerDataSource(source);

    const { result } = renderHook(() => useExecuteAction("data"), {
      wrapper: Wrapper,
    });

    // Prime the store: a subscription must exist first — StubTransport.emit
    // is subscription-gated, exactly like production.
    act(() => {
      client.subscribe("vessel.control", () => {});
    });
    await act(async () => {
      transport.emit("vessel.control", {
        sas: true,
        sasMode: 0,
        rcs: false,
        gear: false,
        brakes: false,
        lights: false,
        throttle: 0,
        actionGroups: Array(10).fill(false),
      });
      // TelemetryProvider coalesces ingest -> store.beginFrame() onto the
      // next animation frame, falling back to a queued microtask in jsdom
      // (`context.tsx`'s `scheduleFrame`) — flush it before sampling.
      await Promise.resolve();
    });

    await act(async () => {
      await result.current("f.sas");
    });

    expect(commandHandler).toHaveBeenCalledWith("vessel.control.setSas", {
      enabled: false,
    });
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("f.sas falls back to legacy execute() when the current value hasn't arrived yet — never dispatches a guessed toggle", async () => {
    const { Wrapper, commandHandler } = buildStreamWrapper([
      "vessel.control",
      "vessel.control.setSas",
    ]);
    const { source, executeSpy } = makeSource();
    registerDataSource(source);

    const { result } = renderHook(() => useExecuteAction("data"), {
      wrapper: Wrapper,
    });

    // Nothing emitted at all — the store has no cached value for
    // vessel.control.sas yet.
    await act(async () => {
      await result.current("f.sas");
    });

    expect(commandHandler).not.toHaveBeenCalled();
    expect(executeSpy).toHaveBeenCalledWith("f.sas");
  });
});
