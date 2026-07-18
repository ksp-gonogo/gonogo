/**
 * Integration tests for the kOS compute pipeline, growing scenario-by-
 * scenario as each task lands.
 *
 * `executeScript` dispatches over the `kos.run` Uplink (see
 * `../dataSources/kosUplinkExecutor.ts`) — every scenario below runs against
 * `FakeKosUplink`, a fake `kos.run` + `kos.processors` responder. There is
 * no telnet path anymore; the old `MockKosTelnet` menu-peek fixture and the
 * telnet-only `parseKosError` scenarios (#7, #8) were removed with the
 * telnet-proxy. CPU discovery now rides `kos.processors` off the same stream
 * (see the discovery scenarios below).
 */

import { clearRegistry, registerDataSource } from "@ksp-gonogo/core";
import { isKosScriptError, useKosWidget } from "@ksp-gonogo/kos";
import { act, renderHook, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KosDataSource } from "../dataSources/kos";
import { FakeKosUplink } from "./fixtures/FakeKosUplink";

function makeSource(opts: { callTimeoutMs?: number } = {}) {
  return new KosDataSource(
    { activeCpu: "datastream" },
    {
      callTimeoutMs: opts.callTimeoutMs ?? 2_000,
      postAttachDrainDelayMs: 0,
    },
  );
}

describe("kOS compute integration", () => {
  afterEach(() => {
    FakeKosUplink.uninstall();
    clearRegistry();
  });

  it("scenario #1: happy path — selects CPU by tagname, runs script, resolves parsed data", async () => {
    const mock = FakeKosUplink.install();
    mock.setCpus([{ number: 1, tagname: "datastream" }]);
    mock.registerScript("deltav", (inv) => {
      const stage = Number(inv.args[0]);
      return `[KOSDATA] stage=${stage};dv=${stage * 1000};available=true [/KOSDATA]`;
    });

    const source = makeSource();
    const result = await source.executeScript("datastream", "deltav", [2]);

    expect(result).toEqual({ stage: 2, dv: 2000, available: true });

    // The session really did auto-select by tagname, not by position.
    expect(mock.invocations()).toHaveLength(1);
    expect(mock.invocations()[0]).toMatchObject({
      script: "deltav",
      args: ["2"],
      cpu: { tagname: "datastream" },
    });

    source.disconnect();
  });

  it("scenario #2: same-CPU calls serialise — second RUN waits for first [KOSDATA]", async () => {
    const mock = FakeKosUplink.install();

    // Boxed resolvers — TS's control-flow narrowing doesn't track
    // reassignment from inside closures, so a plain `let x: Fn | null`
    // would stay narrowed to `null` at the call sites below.
    const slots: { first?: (s: string) => void; second?: (s: string) => void } =
      {};
    mock.registerScript("slow", () => {
      return new Promise<string>((resolve) => {
        if (!slots.first) slots.first = resolve;
        else if (!slots.second) slots.second = resolve;
      });
    });

    const source = makeSource();
    const p1 = source.executeScript("datastream", "slow", [1]);
    const p2 = source.executeScript("datastream", "slow", [2]);

    // Give the session time to attach + dispatch the first RUN.
    for (let i = 0; i < 10; i++) await Promise.resolve();

    // Only the first invocation should be in flight — second is queued.
    expect(mock.invocations()).toHaveLength(1);
    expect(mock.invocations()[0].args).toEqual(["1"]);

    // Resolve the first → second dispatches.
    slots.first?.("[KOSDATA] step=1 [/KOSDATA]");
    await expect(p1).resolves.toEqual({ step: 1 });

    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(mock.invocations()).toHaveLength(2);
    expect(mock.invocations()[1].args).toEqual(["2"]);

    slots.second?.("[KOSDATA] step=2 [/KOSDATA]");
    await expect(p2).resolves.toEqual({ step: 2 });

    source.disconnect();
  });

  it("scenario #3: different-CPU calls run in parallel across independent sessions", async () => {
    const mock = FakeKosUplink.install();
    mock.setCpus([
      { number: 1, tagname: "alpha" },
      { number: 2, tagname: "beta" },
    ]);

    const resolvers = new Map<string, (s: string) => void>();
    mock.registerScript("work", (inv) => {
      return new Promise<string>((resolve) => {
        resolvers.set(inv.cpu.tagname, resolve);
      });
    });

    const source = makeSource();
    const pAlpha = source.executeScript("alpha", "work", []);
    const pBeta = source.executeScript("beta", "work", []);

    // Both sessions should attach + fire their RUNs in parallel.
    for (let i = 0; i < 15; i++) await Promise.resolve();
    expect(mock.invocations()).toHaveLength(2);
    expect(resolvers.has("alpha")).toBe(true);
    expect(resolvers.has("beta")).toBe(true);

    // Resolve beta first — proves the two aren't serialised.
    resolvers.get("beta")?.("[KOSDATA] cpu=beta [/KOSDATA]");
    await expect(pBeta).resolves.toEqual({ cpu: "beta" });

    resolvers.get("alpha")?.("[KOSDATA] cpu=alpha [/KOSDATA]");
    await expect(pAlpha).resolves.toEqual({ cpu: "alpha" });

    source.disconnect();
  });

  it("scenario #4: useKosWidget (command mode) — dispatch runs the script and surfaces parsed data", async () => {
    const mock = FakeKosUplink.install();
    mock.registerScript("add", (inv) => {
      const [a, b] = inv.args.map(Number);
      return `[KOSDATA] sum=${a + b} [/KOSDATA]`;
    });

    // Register the data source under its real id so the hook can find it
    // via getDataSource("kos").
    const source = makeSource();
    registerDataSource(source);

    const { result } = renderHook(() =>
      useKosWidget({
        cpu: "datastream",
        script: "add",
        args: [
          { type: "number", value: 2 },
          { type: "number", value: 3 },
        ],
        mode: "command",
      }),
    );

    // Initial state: no data, not running, no error.
    expect(result.current.data).toBeNull();
    expect(result.current.running).toBe(false);
    expect(result.current.error).toBeNull();

    act(() => {
      result.current.dispatch();
    });
    expect(result.current.running).toBe(true);

    await waitFor(() => {
      expect(result.current.data).toEqual({ sum: 5 });
    });
    expect(result.current.running).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.lastGoodAt).not.toBeNull();

    source.disconnect();
  });

  it("scenario #5: interval mode — overlapping ticks are skipped, resumes once the current call resolves", async () => {
    const mock = FakeKosUplink.install();
    const slot: { resolve?: (s: string) => void } = {};
    mock.registerScript("poll", () => {
      return new Promise<string>((resolve) => {
        slot.resolve = resolve;
      });
    });

    const source = makeSource();
    registerDataSource(source);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { result, unmount } = renderHook(() =>
        useKosWidget({
          cpu: "datastream",
          script: "poll",
          args: [],
          mode: "interval",
          intervalMs: 100,
        }),
      );

      // The initial tick fires on mount; give microtasks time to propagate
      // through the mock (open → menu → attach → RUN).
      await vi.advanceTimersByTimeAsync(20);
      expect(mock.invocations()).toHaveLength(1);

      // Several interval ticks pass while the first script is still pending.
      // Each should be a no-op because pendingRef is still true.
      await vi.advanceTimersByTimeAsync(350);
      expect(mock.invocations()).toHaveLength(1);

      // Resolve → hook state updates → next tick should dispatch again.
      slot.resolve?.("[KOSDATA] tick=1 [/KOSDATA]");
      await waitFor(() => {
        expect(result.current.data).toEqual({ tick: 1 });
      });

      await vi.advanceTimersByTimeAsync(120);
      expect(mock.invocations()).toHaveLength(2);

      // Unmount stops the interval — no more invocations even after time passes.
      unmount();
      slot.resolve?.("[KOSDATA] tick=2 [/KOSDATA]");
      await vi.advanceTimersByTimeAsync(500);
      expect(mock.invocations()).toHaveLength(2);

      source.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  it("scenario #6: telemetry-type args resolve to the current Telemachus value at dispatch time", async () => {
    const mock = FakeKosUplink.install();
    mock.registerScript("snapshot", (inv) => {
      return `[KOSDATA] echoed=${inv.args[0]} [/KOSDATA]`;
    });

    // Fake telemetry source with a mutable latest value. Satisfies the
    // TelemetryReader duck type used by the hook.
    let altitude: unknown = 1000;
    const fakeTelemetry = {
      id: "data",
      name: "Data",
      status: "connected" as const,
      affectedBySignalLoss: false,
      async connect() {},
      disconnect() {},
      schema: () => [],
      subscribe: () => () => {},
      onStatusChange: () => () => {},
      async execute() {},
      configSchema: () => [],
      configure: () => {},
      getConfig: () => ({}),
      getLatestValue: (_key: string) => altitude,
    };
    registerDataSource(fakeTelemetry);

    const source = makeSource();
    registerDataSource(source);

    const { result } = renderHook(() =>
      useKosWidget({
        cpu: "datastream",
        script: "snapshot",
        args: [{ type: "telemetry", key: "v.altitude" }],
        mode: "command",
      }),
    );

    act(() => {
      result.current.dispatch();
    });
    await waitFor(() => {
      expect(result.current.data).toEqual({ echoed: 1000 });
    });
    expect(mock.invocations()[0].args).toEqual(["1000"]);

    // Mutate the telemetry snapshot — next dispatch must pick up the new value.
    altitude = 2500;
    act(() => {
      result.current.dispatch();
    });
    await waitFor(() => {
      expect(result.current.data).toEqual({ echoed: 2500 });
    });
    expect(mock.invocations()[1].args).toEqual(["2500"]);

    source.disconnect();
  });

  it("scenario #9: rejects with the [KOSERROR] message verbatim (no prefix — the script author owns the wording)", async () => {
    const mock = FakeKosUplink.install();
    mock.registerScript(
      "abortburn",
      () => "[KOSERROR] engine flameout, abort burn [/KOSERROR]",
    );

    const source = makeSource();
    const promise = source.executeScript("datastream", "abortburn", []);
    await expect(promise).rejects.toThrow("engine flameout, abort burn");
    // No "kOS error:" prefix — explicit failures use the author's exact text.
    await expect(promise).rejects.not.toThrow(/^kOS error:/);

    source.disconnect();
  });

  it("scenario #9b: KOSUndefinedIdentifierException-shaped runtime error rejects with KosScriptError so the breaker can catch it", async () => {
    // The exact shape that motivated the breaker: gonogo's wrapper
    // bootstrap referenced `needswrite` before declaration. On the kos.run
    // Uplink the mod already extracts the clean headline server-side
    // (KosRunManager.Complete / KosComputeBlock — see the file header for
    // why the raw-dump-parsing version of this scenario was retired), so
    // the fake responder here hands back that same clean message directly.
    // What this scenario still proves: KosDataSource wraps ANY kos.run
    // error into KosScriptError, and useKosWidget's interval-mode breaker
    // counts it.
    const mock = FakeKosUplink.install();
    mock.registerScript("undef", () => "Undefined Variable Name 'needswrite'.");

    const source = makeSource();
    let caught: unknown;
    try {
      await source.executeScript("datastream", "undef", []);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(isKosScriptError(caught)).toBe(true);
    expect((caught as Error).message).toMatch(/needswrite/);

    source.disconnect();
  });

  it("scenario #10: [KOSERROR] wins over [KOSDATA] when both appear", async () => {
    const mock = FakeKosUplink.install();
    mock.registerScript(
      "partial",
      () =>
        "[KOSDATA] altitude=12345 [/KOSDATA] [KOSERROR] aborted before full snapshot [/KOSERROR]",
    );

    const source = makeSource();
    await expect(
      source.executeScript("datastream", "partial", []),
    ).rejects.toThrow("aborted before full snapshot");

    source.disconnect();
  });

  it("scenario #11: onProcessorsChanged fires with every CPU on the active vessel — including ones no script ever targets", async () => {
    // Discovery rides the mod's native kos.processors push channel now — no
    // widget or executeScript needed; adopting the active stream client
    // (via connect()) stands up the standing subscription.
    const mock = FakeKosUplink.install();
    mock.setCpus([
      { number: 1, tagname: "datastream" },
      { number: 2, tagname: "lander" },
      { number: 3, tagname: "probe" },
    ]);

    const source = makeSource();
    const seen = vi.fn();
    source.onProcessorsChanged(seen);

    await source.connect();

    await waitFor(() => expect(seen).toHaveBeenCalled());
    const procs = seen.mock.calls.at(-1)?.[0];
    expect(procs.map((p: { tag: string }) => p.tag)).toEqual([
      "datastream",
      "lander",
      "probe",
    ]);
    // Discovery came purely from kos.processors — no script was dispatched.
    expect(mock.invocations()).toHaveLength(0);

    source.disconnect();
  });

  it("scenario #11c: kos.processors feeds discovery on connect — no widget needed", async () => {
    const mock = FakeKosUplink.install();
    mock.setCpus([
      { number: 1, tagname: "datastream" },
      { number: 2, tagname: "lander" },
    ]);

    const source = makeSource();
    const seen = vi.fn();
    source.onProcessorsChanged(seen);

    await source.connect();
    await waitFor(() => expect(seen).toHaveBeenCalled());

    const procs = seen.mock.calls.at(-1)?.[0];
    expect(procs.map((p: { tag: string }) => p.tag)).toEqual([
      "datastream",
      "lander",
    ]);
    expect(mock.invocations()).toHaveLength(0);

    source.disconnect();
  });

  it("scenario #11d: discovery refreshes when the CPU list changes", async () => {
    const mock = FakeKosUplink.install();
    mock.setCpus([{ number: 1, tagname: "datastream" }]);

    const source = makeSource();
    const seen = vi.fn();
    source.onProcessorsChanged(seen);

    await source.connect();
    await waitFor(() => expect(seen).toHaveBeenCalled());

    // Simulate a vessel switch that changes the CPU set.
    mock.setCpus([
      { number: 1, tagname: "lander" },
      { number: 2, tagname: "probe" },
    ]);

    await waitFor(() => {
      const last = seen.mock.calls.at(-1)?.[0];
      expect(last.map((p: { tag: string }) => p.tag)).toEqual([
        "lander",
        "probe",
      ]);
    });

    source.disconnect();
  });

  it("scenario #11b: onProcessorsChanged unsubscribe stops further callbacks", async () => {
    const mock = FakeKosUplink.install();
    mock.setCpus([{ number: 1, tagname: "datastream" }]);

    const source = makeSource();
    const seen = vi.fn();
    const unsub = source.onProcessorsChanged(seen);
    unsub();

    // Adopt the stream (the discovery source now) and give it every chance
    // to fire before asserting it didn't.
    await source.connect();
    mock.setCpus([{ number: 2, tagname: "lander" }]);
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).not.toHaveBeenCalled();
    source.disconnect();
  });

  it("scenario #4b: widget dispatch with the data source missing surfaces an error", () => {
    // No data source registered — the hook must not crash, just error.
    const { result } = renderHook(() =>
      useKosWidget({
        cpu: "datastream",
        script: "noop",
        args: [],
        mode: "command",
      }),
    );
    act(() => {
      result.current.dispatch();
    });
    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.message).toMatch(/not registered/);
  });
});
