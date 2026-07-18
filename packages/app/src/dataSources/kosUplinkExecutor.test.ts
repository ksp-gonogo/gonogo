import { isKosScriptError } from "@ksp-gonogo/kos";
import { StubTransport, TelemetryClient } from "@ksp-gonogo/sitrep-client";
import type { KosProcessorInfo, KosRunResult } from "@ksp-gonogo/sitrep-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KosUplinkExecutor } from "./kosUplinkExecutor";
import { buildKosWrapper } from "./kosWrapper";

/**
 * Unit tests for the `kos.run` Uplink executor that now backs
 * `KosDataSource.executeScript` end to end (see
 * `../__tests__/kos-execute-uplink.test.ts` for that KosDataSource-level
 * wiring). Uses a real `StubTransport` + `TelemetryClient` — no mocked
 * internals — so dispatch, subscribe, and correlation all run through the
 * real client machinery; only the wire is stubbed.
 *
 * `kos.processors` is a plain push channel: nothing delivers it until
 * SOMETHING subscribes (there is no proactive auto-subscribe). The
 * executor's own `run()` is what subscribes, lazily, on first call — so a
 * cold `run()` against a client that has never seen kos.processors data
 * always rejects with "no known CPU" (this is exactly the "reject
 * immediately" contract `run()` promises). Every test below therefore
 * primes the subscription with a throwaway first call before publishing
 * the CPU list and driving the call under test — the same two-step
 * sequence a real widget hits after a fresh reconnect.
 */

interface DispatchedCommand {
  command: string;
  args: { coreId: number; requestId: string; command: string };
}

function makeClient() {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  return { transport, client };
}

/** Records every dispatched command; command handler defaults to a success ack. */
function captureDispatches(transport: StubTransport): DispatchedCommand[] {
  const commands: DispatchedCommand[] = [];
  transport.setCommandHandler((command, args) => {
    commands.push({ command, args: args as DispatchedCommand["args"] });
    return { success: true, errorCode: 0 };
  });
  return commands;
}

/**
 * Subscribes `executor` to `client`'s `kos.processors` via a throwaway
 * `run()` call (swallowed — it always rejects, nothing is known yet), then
 * publishes `processors`. After this, any `run()` against a tagname in
 * `processors` resolves its coreId synchronously.
 */
function primeProcessors(
  executor: KosUplinkExecutor,
  client: TelemetryClient,
  transport: StubTransport,
  processors: KosProcessorInfo[],
): void {
  executor.run(client, "__priming__", "", [], null).catch(() => {});
  transport.emit("kos.processors", processors);
}

/** Poll a microtask at a time until predicate is true or timeoutMs elapses. */
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

describe("KosUplinkExecutor", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves tagname -> coreId via kos.processors, then dispatches kos.run with a fresh requestId", async () => {
    const { transport, client } = makeClient();
    const commands = captureDispatches(transport);
    const executor = new KosUplinkExecutor();

    primeProcessors(executor, client, transport, [
      { coreId: 7, tag: "datastream", hasBooted: true, processorMode: "READY" },
    ]);
    const pending = executor.run(client, "datastream", "0:/foo.ks", [], null);

    await waitFor(() => commands.length === 1);
    expect(commands[0].command).toBe("kos.run");
    expect(commands[0].args.coreId).toBe(7);
    expect(commands[0].args.command).toBe('RUNPATH("0:/foo.ks").\n');
    expect(commands[0].args.requestId).toBeTruthy();

    transport.emit("kos.run.7", {
      coreId: 7,
      requestId: commands[0].args.requestId,
      fields: { v: 1, ok: true },
    } satisfies KosRunResult);

    await expect(pending).resolves.toEqual({ v: 1, ok: true });
  });

  it("reuses buildKosWrapper's managed-wrapper text verbatim for a managed dispatch", async () => {
    const { transport, client } = makeClient();
    const commands = captureDispatches(transport);
    const executor = new KosUplinkExecutor();

    primeProcessors(executor, client, transport, [
      { coreId: 3, tag: "datastream", hasBooted: true, processorMode: "READY" },
    ]);
    const pending = executor.run(
      client,
      "datastream",
      "0:/widget_scripts/x.ks",
      [],
      { body: "PRINT 1.", version: "v1" },
    );

    await waitFor(() => commands.length === 1);
    expect(commands[0].args.command).toBe(
      buildKosWrapper({
        path: "0:/widget_scripts/x.ks",
        body: "PRINT 1.",
        version: "v1",
        args: [],
      }),
    );

    transport.emit("kos.run.3", {
      coreId: 3,
      requestId: commands[0].args.requestId,
      fields: {},
    } satisfies KosRunResult);
    await pending;
  });

  it("rejects immediately with a clear error when the tagname doesn't resolve to a known coreId", async () => {
    const { client } = makeClient();
    const executor = new KosUplinkExecutor();

    await expect(
      executor.run(client, "no-such-cpu", "0:/foo.ks", [], null),
    ).rejects.toThrow(/no known CPU with tagname "no-such-cpu"/);
  });

  it("serialises calls to the SAME coreId — the second call doesn't dispatch until the first resolves", async () => {
    const { transport, client } = makeClient();
    const commands = captureDispatches(transport);
    const executor = new KosUplinkExecutor();

    primeProcessors(executor, client, transport, [
      { coreId: 1, tag: "cpu-a", hasBooted: true, processorMode: "READY" },
    ]);
    const first = executor.run(client, "cpu-a", "0:/a.ks", [], null);
    await waitFor(() => commands.length === 1);

    const second = executor.run(client, "cpu-a", "0:/b.ks", [], null);
    // Give the second call every chance to (incorrectly) dispatch early.
    await new Promise((r) => setTimeout(r, 20));
    expect(commands).toHaveLength(1);

    transport.emit("kos.run.1", {
      coreId: 1,
      requestId: commands[0].args.requestId,
      fields: { step: 1 },
    } satisfies KosRunResult);
    await first;

    await waitFor(() => commands.length === 2);
    expect(commands[1].args.command).toBe('RUNPATH("0:/b.ks").\n');

    transport.emit("kos.run.1", {
      coreId: 1,
      requestId: commands[1].args.requestId,
      fields: { step: 2 },
    } satisfies KosRunResult);
    await second;
  });

  it("runs calls to DIFFERENT coreIds in parallel", async () => {
    const { transport, client } = makeClient();
    const commands = captureDispatches(transport);
    const executor = new KosUplinkExecutor();

    primeProcessors(executor, client, transport, [
      { coreId: 1, tag: "cpu-a", hasBooted: true, processorMode: "READY" },
      { coreId: 2, tag: "cpu-b", hasBooted: true, processorMode: "READY" },
    ]);
    const a = executor.run(client, "cpu-a", "0:/a.ks", [], null);
    const b = executor.run(client, "cpu-b", "0:/b.ks", [], null);

    await waitFor(() => commands.length === 2);
    const forA = commands.find((c) => c.args.coreId === 1);
    const forB = commands.find((c) => c.args.coreId === 2);
    expect(forA).toBeDefined();
    expect(forB).toBeDefined();

    transport.emit("kos.run.1", {
      coreId: 1,
      requestId: forA?.args.requestId ?? "",
      fields: {},
    } satisfies KosRunResult);
    transport.emit("kos.run.2", {
      coreId: 2,
      requestId: forB?.args.requestId ?? "",
      fields: {},
    } satisfies KosRunResult);
    await Promise.all([a, b]);
  });

  it("rejects when the mod acks the command as a failure (success: false)", async () => {
    const { transport, client } = makeClient();
    const executor = new KosUplinkExecutor();
    primeProcessors(executor, client, transport, [
      { coreId: 1, tag: "cpu-a", hasBooted: true, processorMode: "READY" },
    ]);
    transport.setCommandHandler(() => ({ success: false, errorCode: 4 }));

    const pending = executor.run(client, "cpu-a", "0:/a.ks", [], null);

    await expect(pending).rejects.toThrow(/command rejected/i);
  });

  it("rejects with a KosScriptError when kos.run.<coreId> carries an error", async () => {
    const { transport, client } = makeClient();
    const commands = captureDispatches(transport);
    const executor = new KosUplinkExecutor();
    primeProcessors(executor, client, transport, [
      { coreId: 1, tag: "cpu-a", hasBooted: true, processorMode: "READY" },
    ]);

    const pending = executor.run(client, "cpu-a", "0:/a.ks", [], null);
    await waitFor(() => commands.length === 1);

    transport.emit("kos.run.1", {
      coreId: 1,
      requestId: commands[0].args.requestId,
      error: "engine flameout",
    } satisfies KosRunResult);

    let caught: unknown;
    try {
      await pending;
    } catch (err) {
      caught = err;
    }
    expect(isKosScriptError(caught)).toBe(true);
    expect((caught as Error).message).toBe("engine flameout");
  });

  it("rejects after timeoutMs when no kos.run.<coreId> result ever arrives", async () => {
    vi.useFakeTimers();
    const { transport, client } = makeClient();
    const executor = new KosUplinkExecutor({ timeoutMs: 1000 });
    primeProcessors(executor, client, transport, [
      { coreId: 1, tag: "cpu-a", hasBooted: true, processorMode: "READY" },
    ]);

    const pending = executor.run(client, "cpu-a", "0:/a.ks", [], null);

    const assertion = expect(pending).rejects.toThrow(/did not respond/i);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("a foreign requestId on the channel does not settle an unrelated in-flight call", async () => {
    const { transport, client } = makeClient();
    const commands = captureDispatches(transport);
    const executor = new KosUplinkExecutor();
    primeProcessors(executor, client, transport, [
      { coreId: 1, tag: "cpu-a", hasBooted: true, processorMode: "READY" },
    ]);

    const pending = executor.run(client, "cpu-a", "0:/a.ks", [], null);
    await waitFor(() => commands.length === 1);

    transport.emit("kos.run.1", {
      coreId: 1,
      requestId: "some-other-requestId",
      fields: { v: 1 },
    } satisfies KosRunResult);

    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);

    // Clean up the still-pending promise so it doesn't leak into other tests.
    transport.emit("kos.run.1", {
      coreId: 1,
      requestId: commands[0].args.requestId,
      fields: {},
    } satisfies KosRunResult);
    await pending;
  });

  it("dispose() rejects every queued/in-flight call and drops subscriptions", async () => {
    const { transport, client } = makeClient();
    const commands = captureDispatches(transport);
    const executor = new KosUplinkExecutor();
    primeProcessors(executor, client, transport, [
      { coreId: 1, tag: "cpu-a", hasBooted: true, processorMode: "READY" },
    ]);

    const first = executor.run(client, "cpu-a", "0:/a.ks", [], null);
    await waitFor(() => commands.length === 1);
    const second = executor.run(client, "cpu-a", "0:/b.ks", [], null); // queued behind first

    executor.dispose();

    await expect(first).rejects.toThrow();
    await expect(second).rejects.toThrow();
  });

  it("re-adopting a different TelemetryClient tears down the old subscriptions/queues", async () => {
    const { transport: t1, client: c1 } = makeClient();
    const commands1 = captureDispatches(t1);
    const executor = new KosUplinkExecutor();
    primeProcessors(executor, c1, t1, [
      { coreId: 1, tag: "cpu-a", hasBooted: true, processorMode: "READY" },
    ]);

    const stale = executor.run(c1, "cpu-a", "0:/a.ks", [], null);
    await waitFor(() => commands1.length === 1);
    expect(t1.isSubscribed("kos.processors")).toBe(true);
    expect(t1.isSubscribed("kos.run.1")).toBe(true);

    const { transport: t2, client: c2 } = makeClient();
    const commands2 = captureDispatches(t2);
    // First call against the new client switches adoption — it tears down
    // every c1 subscription/queue (rejecting `stale`) AND subscribes to
    // c2's kos.processors, but rejects itself: c2's processors haven't
    // reported "cpu-a" yet.
    await expect(
      executor.run(c2, "cpu-a", "0:/x.ks", [], null),
    ).rejects.toThrow(/no known CPU/);

    await expect(stale).rejects.toThrow();
    expect(t1.isSubscribed("kos.processors")).toBe(false);
    expect(t1.isSubscribed("kos.run.1")).toBe(false);

    // Now that c2 is adopted and its kos.processors is subscribed, publish
    // the CPU list and retry — this is the realistic case (a caller races
    // the processors channel right after a reconnect, then succeeds).
    t2.emit("kos.processors", [
      { coreId: 9, tag: "cpu-a", hasBooted: true, processorMode: "READY" },
    ] satisfies KosProcessorInfo[]);
    const fresh = executor.run(c2, "cpu-a", "0:/c.ks", [], null);
    await waitFor(() => commands2.length === 1);
    expect(commands2[0].args.coreId).toBe(9);

    t2.emit("kos.run.9", {
      coreId: 9,
      requestId: commands2[0].args.requestId,
      fields: {},
    } satisfies KosRunResult);
    await fresh;
  });
});
