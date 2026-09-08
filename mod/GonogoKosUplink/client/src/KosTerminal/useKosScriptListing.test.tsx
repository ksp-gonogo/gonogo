/**
 * The `/`-picker's live drive listing, driven end to end over a real
 * `StubTransport` + `TelemetryClient` through the real `kosSource`
 * singleton the hook imports. Nothing internal is mocked: the `kos.run`
 * dispatch, the per-CPU FIFO and the `kos.run.<coreId>` correlation all run.
 *
 * What these cover is the gap between "the RPC resolved" and "we got a
 * listing we could read". Both volumes in `LISTED_VOLUMES` are probed, so a
 * reply arrives per volume and each one can be readable, unreadable, or
 * absent independently.
 */

import {
  createTestTelemetryClient,
  renderHook,
  StubTransport,
  setActiveTelemetryClientForTests,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import type { KosProcessorInfo, KosRunResult } from "../__generated__/contract";
import { kosSource } from "../dataSource/kos";
import { useKosScriptListing } from "./useKosScriptListing";

const CORE_ID = 11;
const CPU_TAG = "lister";

interface Dispatched {
  coreId: number;
  requestId: string;
  command: string;
}

/**
 * Stands up a live client, primes `kos.processors` (a push channel delivers
 * nothing until something subscribes, and `kosSource` is what subscribes),
 * and answers each `kos.run` dispatch in turn with `reply(index)`. Returns
 * once every expected dispatch has been answered.
 */
function harness() {
  const transport = new StubTransport();
  const client = createTestTelemetryClient(transport);
  const dispatches: Dispatched[] = [];
  transport.setCommandHandler((_command, args) => {
    dispatches.push(args as Dispatched);
    return { success: true, errorCode: 0 };
  });
  setActiveTelemetryClientForTests(client);
  kosSource.attachTelemetryClient(client);
  transport.emit("kos.processors", [
    {
      coreId: CORE_ID,
      tag: CPU_TAG,
      hasBooted: true,
      processorMode: "READY",
    },
  ] satisfies KosProcessorInfo[]);

  /**
   * The per-CPU FIFO serialises both volume probes onto one core, so the
   * second dispatch does not leave until the first is settled. Answer them
   * one at a time, in order.
   */
  async function answer(replies: ReadonlyArray<Partial<KosRunResult>>) {
    for (let i = 0; i < replies.length; i++) {
      await waitFor(() => expect(dispatches.length).toBe(i + 1));
      transport.emit(`kos.run.${CORE_ID}`, {
        coreId: CORE_ID,
        requestId: dispatches[i].requestId,
        ...replies[i],
      } as KosRunResult);
    }
  }

  return { transport, answer };
}

function listingOf(entries: ReadonlyArray<Record<string, unknown>>) {
  return { fields: { listing: JSON.stringify(entries) } };
}

describe("useKosScriptListing", () => {
  afterEach(() => {
    kosSource.disconnect();
    setActiveTelemetryClientForTests(undefined);
  });

  it("lists the RUNPATH-able files each volume reported", async () => {
    const { answer } = harness();
    const { result } = renderHook(() =>
      useKosScriptListing(CORE_ID, CPU_TAG, true),
    );

    await answer([
      listingOf([
        { name: "boot.ks", size: 10, isDir: false },
        { name: "notes.txt", size: 2, isDir: false },
        { name: "subdir", size: 0, isDir: true },
      ]),
      listingOf([{ name: "backup.ks", size: 4, isDir: false }]),
    ]);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.paths).toEqual(["0:/boot.ks", "1:/backup.ks"]);
    expect(result.current.hint).toBeNull();
  });

  it("reports NO hint for a volume that is genuinely empty", async () => {
    // The load-bearing control. An empty JSON array is a real answer: the
    // drive has no scripts on it. That must keep reading as an empty
    // listing, not as a failure, or the fix below just moves the lie.
    const { answer } = harness();
    const { result } = renderHook(() =>
      useKosScriptListing(CORE_ID, CPU_TAG, true),
    );

    await answer([listingOf([]), listingOf([])]);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.paths).toEqual([]);
    expect(result.current.hint).toBeNull();
  });

  it("hints rather than reporting an empty drive when a listing will not parse", async () => {
    // `scriptListingScript.ts` interpolates `f:NAME` raw into its JSON, so
    // one Archive filename containing a quote or a backslash makes the whole
    // reply unparseable. That is a reply we could not read, and the picker
    // used to draw "No scripts found" over it.
    const { answer } = harness();
    const { result } = renderHook(() =>
      useKosScriptListing(CORE_ID, CPU_TAG, true),
    );

    await answer([
      { fields: { listing: '[{"name":"ha"te.ks"}]' } },
      { fields: { listing: '[{"name":"ha"te.ks"}]' } },
    ]);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.paths).toEqual([]);
    expect(result.current.hint).not.toBeNull();
    expect(result.current.hint).toMatch(/could not be read/i);
  });

  it("hints rather than reporting an empty drive when the reply carries no listing field", async () => {
    const { answer } = harness();
    const { result } = renderHook(() =>
      useKosScriptListing(CORE_ID, CPU_TAG, true),
    );

    await answer([{ fields: { op: "list" } }, { fields: { op: "list" } }]);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.paths).toEqual([]);
    expect(result.current.hint).not.toBeNull();
  });

  it("keeps the readable volume's listing when only the OTHER volume is unreadable", async () => {
    // A partial failure must not sink the volume that answered: same
    // posture as the existing "a CPU with no local drive rejects 1:" case.
    const { answer } = harness();
    const { result } = renderHook(() =>
      useKosScriptListing(CORE_ID, CPU_TAG, true),
    );

    await answer([
      listingOf([{ name: "boot.ks", size: 10, isDir: false }]),
      { fields: { listing: "not json at all" } },
    ]);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.paths).toEqual(["0:/boot.ks"]);
    expect(result.current.hint).toBeNull();
  });

  it("hints without dispatching at all when the CPU has no tagname", async () => {
    harness();
    const { result } = renderHook(() =>
      useKosScriptListing(CORE_ID, undefined, true),
    );

    await waitFor(() => expect(result.current.hint).not.toBeNull());
    expect(result.current.hint).toMatch(/no tagname/i);
  });
});
