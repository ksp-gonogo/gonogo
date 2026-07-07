import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@gonogo/sitrep-client";
import { act, renderHook } from "@testing-library/react";
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
