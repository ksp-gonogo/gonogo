/**
 * `KosDataSource.executeScript`'s Uplink cutover, exercised at the
 * `KosDataSource` boundary (not just the underlying `KosUplinkExecutor` —
 * see `dataSources/kosUplinkExecutor.test.ts` for that unit-level coverage).
 * Proves the wiring: `getActiveTelemetryClient()` availability is the
 * ONLY thing that gates dispatch, and there is no telnet fallback when a
 * client is present but the CPU can't be resolved or times out — those
 * still surface as Uplink errors, never a silent drop to telnet.
 */

import { getUplinkHandle } from "@ksp-gonogo/core";
import {
  StubTransport,
  setActiveTelemetryClientForTests,
  TelemetryClient,
} from "@ksp-gonogo/sitrep-client";
import type { KosProcessorInfo, KosRunResult } from "@ksp-gonogo/sitrep-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { KosDataSource, kosSource } from "./kos";

function makeSource() {
  return new KosDataSource(
    { activeCpu: "" },
    { callTimeoutMs: 500, postAttachDrainDelayMs: 0 },
  );
}

async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 1000 } = {},
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor: predicate never became true");
    }
    await new Promise((r) => setTimeout(r, 1));
  }
}

describe("KosDataSource.executeScript — Uplink cutover", () => {
  afterEach(() => {
    setActiveTelemetryClientForTests(undefined);
  });

  it("rejects with a clear 'kOS Uplink not connected' error when no TelemetryClient is active — no telnet fallback", async () => {
    const source = makeSource();
    await expect(
      source.executeScript("datastream", "0:/foo.ks", []),
    ).rejects.toThrow(/kOS Uplink not connected/);
  });

  it("dispatches over kos.run end to end when a TelemetryClient is active", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const commands: Array<{
      coreId: number;
      requestId: string;
      command: string;
    }> = [];
    transport.setCommandHandler((_command, args) => {
      commands.push(
        args as { coreId: number; requestId: string; command: string },
      );
      return { success: true, errorCode: 0 };
    });
    setActiveTelemetryClientForTests(client);

    const source = makeSource();
    // kos.processors delivers nothing until something subscribes, and
    // executeScript() is what lazily subscribes (via the shared
    // KosUplinkExecutor) — so a cold first call always rejects with "no
    // known CPU". Prime it (swallowed), then publish the CPU list, then
    // issue the real call under test — the same two-step sequence a
    // widget hits right after a fresh reconnect.
    source.executeScript("datastream", "0:/priming.ks", []).catch(() => {});
    transport.emit("kos.processors", [
      {
        coreId: 4,
        tag: "datastream",
        hasBooted: true,
        processorMode: "READY",
      },
    ] satisfies KosProcessorInfo[]);

    const pending = source.executeScript("datastream", "0:/foo.ks", [1, "hi"]);

    await waitFor(() => commands.length === 1);
    expect(commands[0].coreId).toBe(4);
    expect(commands[0].command).toBe('RUNPATH("0:/foo.ks", 1, "hi").\n');

    transport.emit("kos.run.4", {
      coreId: 4,
      requestId: commands[0].requestId,
      fields: { ok: true },
    } satisfies KosRunResult);

    await expect(pending).resolves.toEqual({ ok: true });
  });

  it("still rejects (never falls back to telnet) when the CPU tagname doesn't resolve, even with an active client", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    setActiveTelemetryClientForTests(client);

    const source = makeSource();
    await expect(
      source.executeScript("unknown-cpu", "0:/foo.ks", []),
    ).rejects.toThrow(/no known CPU with tagname "unknown-cpu"/);
  });
});

describe("kos.ts module — registerUplinkHandle('kos', ...) registration", () => {
  afterEach(() => {
    setActiveTelemetryClientForTests(undefined);
  });

  it("registers the full kosSource instance, not a narrower relay-only object", () => {
    const handle = getUplinkHandle<KosDataSource>("kos");
    expect(handle).toBe(kosSource);
    expect(typeof handle?.executeScript).toBe("function");
  });

  it("delegates the 'executeScript' relay method to the kosSource singleton", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const commands: Array<{ coreId: number; requestId: string }> = [];
    transport.setCommandHandler((_command, args) => {
      commands.push(args as { coreId: number; requestId: string });
      return { success: true, errorCode: 0 };
    });
    setActiveTelemetryClientForTests(client);
    kosSource.attachTelemetryClient(client);

    const handle = getUplinkHandle<{
      relay: (method: string, args: unknown) => Promise<unknown>;
    }>("kos");
    expect(handle).toBeDefined();

    // Prime the CPU list the same way the executeScript-level test above does.
    handle
      ?.relay("executeScript", {
        cpu: "datastream",
        script: "0:/priming.ks",
        args: [],
      })
      .catch(() => {});
    transport.emit("kos.processors", [
      {
        coreId: 7,
        tag: "datastream",
        hasBooted: true,
        processorMode: "READY",
      },
    ] satisfies KosProcessorInfo[]);

    const pending = handle?.relay("executeScript", {
      cpu: "datastream",
      script: "0:/foo.ks",
      args: [],
    });

    await new Promise((r) => setTimeout(r, 1));
    expect(commands.length).toBeGreaterThan(0);
    const last = commands[commands.length - 1];
    if (!last) throw new Error("expected a dispatched command");
    transport.emit(`kos.run.${last.coreId}`, {
      coreId: last.coreId,
      requestId: last.requestId,
      fields: { ok: true },
    } satisfies KosRunResult);

    await expect(pending).resolves.toEqual({ ok: true });
  });

  it("rejects an unknown relay method", async () => {
    const handle = getUplinkHandle<{
      relay: (method: string, args: unknown) => Promise<unknown>;
    }>("kos");
    await expect(handle?.relay("bogus", {})).rejects.toThrow(
      /unknown method "bogus"/,
    );
  });
});
