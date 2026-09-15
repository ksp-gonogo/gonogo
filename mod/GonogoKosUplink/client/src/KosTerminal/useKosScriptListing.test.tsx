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
import { KOS_FILES_SCRIPT } from "./scriptListingScript";
import { useKosScriptListing } from "./useKosScriptListing";

const CORE_ID = 11;
const CPU_TAG = "lister";

interface Dispatched {
  coreId: number;
  requestId: string;
  command: string;
}

/**
 * A command handler is handed `unknown`, and a test that asserts its way out of
 * that would stop noticing the day the wire shape changes underneath it. The
 * `in` operator narrows without an assertion, so a frame missing any of the
 * three is dropped rather than pushed as a `Dispatched` it is not.
 */
function isDispatched(value: unknown): value is Dispatched {
  return (
    typeof value === "object" &&
    value !== null &&
    "coreId" in value &&
    "requestId" in value &&
    "command" in value
  );
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
    if (isDispatched(args)) dispatches.push(args);
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

  /*
   * The per-entry twin of the unreadable-listing case above. A volume with no
   * ISFILE suffix reports no kind at all, which is not evidence the entry is a
   * file: offering a DIRECTORY called `lib.ks` composes RUNPATH("0:/lib.ks")
   * and the CPU errors out of it.
   */
  it("does not offer an entry whose kind the volume never reported", async () => {
    const { answer } = harness();
    const { result } = renderHook(() =>
      useKosScriptListing(CORE_ID, CPU_TAG, true),
    );

    await answer([
      listingOf([
        { name: "lib.ks", size: 0, isDir: null },
        { name: "boot.ks", size: 10, isDir: false },
      ]),
      listingOf([{ name: "backup.ks", size: 4 }]),
    ]);

    await waitFor(() => expect(result.current.loading).toBe(false));
    // Only the entry that positively reported ISFILE is runnable. An absent
    // key is the same absence as an explicit null.
    expect(result.current.paths).toEqual(["0:/boot.ks"]);
  });

  it("names the missing kind rather than reporting an empty drive when NOTHING reported one", async () => {
    // Everything on both volumes is script-named and kind-less: an older kOS
    // across the board. "No scripts found" would be a claim about the drive
    // made on the strength of a field it never sent.
    const { answer } = harness();
    const { result } = renderHook(() =>
      useKosScriptListing(CORE_ID, CPU_TAG, true),
    );

    await answer([
      listingOf([{ name: "lib.ks", size: 0, isDir: null }]),
      listingOf([{ name: "backup.ks", size: 4, isDir: null }]),
    ]);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.paths).toEqual([]);
    expect(result.current.hint).toMatch(/did not say which are files/i);
  });

  it("emits an ABSENT kind from the kerboscript, never a definite false", () => {
    // The wire half of the same fix. There is no kOS interpreter here, so the
    // default is read off the script source: what the volume could not tell
    // us has to reach the caller as the JSON null literal. A FALSE there is a
    // claim that the entry is a file, and it is the claim that put a
    // directory in the picker.
    const fallback = /LOCAL isDir IS (.+)\./.exec(KOS_FILES_SCRIPT)?.[1];
    expect(fallback).toBe('"null"');
  });

  it("keeps quiet about a kind-less entry that was never a candidate anyway", async () => {
    /*
     * A `.txt` with no reported kind was not runnable whatever it is, so it
     * earns no hint: the empty state must not cry absence over an entry the
     * extension filter would have dropped regardless.
     */
    const { answer } = harness();
    const { result } = renderHook(() =>
      useKosScriptListing(CORE_ID, CPU_TAG, true),
    );

    await answer([
      listingOf([{ name: "notes.txt", size: 2, isDir: null }]),
      listingOf([]),
    ]);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.paths).toEqual([]);
    expect(result.current.hint).toBeNull();
  });
});
