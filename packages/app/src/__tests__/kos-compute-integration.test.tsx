/**
 * Integration tests for the kOS compute pipeline, growing scenario-by-
 * scenario as each task lands. Everything below the hook boundary (data
 * source, per-CPU session, menu selection, queueing, [KOSDATA] parsing) is
 * exercised against MockKosTelnet — no PeerJS or xterm in the loop.
 */

import { clearRegistry, registerDataSource } from "@gonogo/core";
import { useKosWidget } from "@gonogo/data";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KosDataSource } from "../dataSources/kos";
import { MockKosTelnet } from "./fixtures/MockKosTelnet";

function makeSource(opts: { callTimeoutMs?: number } = {}) {
  return new KosDataSource(
    {
      host: "localhost",
      port: 3001,
      kosHost: "localhost",
      kosPort: 5410,
    },
    {
      callTimeoutMs: opts.callTimeoutMs ?? 2_000,
      // MockKosTelnet doesn't simulate kOS's welcomeMenu detach race, so
      // skip the post-attach settle delay — otherwise every test eats 300ms.
      postAttachDrainDelayMs: 0,
    },
  );
}

describe("kOS compute integration", () => {
  afterEach(() => {
    cleanup();
    MockKosTelnet.uninstall();
    clearRegistry();
  });

  it("scenario #1: happy path — selects CPU by tagname, runs script, resolves parsed data", async () => {
    const mock = MockKosTelnet.install();
    mock.setCpus([
      {
        number: 1,
        vesselName: "Test Ship",
        partType: "KAL9000",
        tagname: "datastream",
      },
    ]);
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
    const mock = MockKosTelnet.install();

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
    const mock = MockKosTelnet.install();
    mock.setCpus([
      { number: 1, vesselName: "S", partType: "K", tagname: "alpha" },
      { number: 2, vesselName: "S", partType: "K", tagname: "beta" },
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
    const mock = MockKosTelnet.install();
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
    const mock = MockKosTelnet.install();
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
    const mock = MockKosTelnet.install();
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

  it("scenario #7: rejects with the kOS error message when a runtime error fires (no Message: line)", async () => {
    const mock = MockKosTelnet.install();
    const DIVIDER = "_".repeat(42);
    mock.registerScript("badsuffix", () =>
      [
        // Inline headline kOS prints at the top of an error block.
        `GET Suffix 'VALUEX' not found on object VESSEL("Hopper")`,
        DIVIDER,
        "           VERBOSE DESCRIPTION",
        // Runtime errors restate the headline on the first verbose line.
        `GET Suffix 'VALUEX' not found on object VESSEL("Hopper")`,
        "An attempt was made to get a suffix called:",
        "    valuex",
        "from an object of type:",
        "    VesselTarget",
        DIVIDER,
        DIVIDER,
        "At interpreter, line 13",
        "print ship:valuex.",
        "      ^",
      ].join("\n"),
    );

    const source = makeSource();
    await expect(
      source.executeScript("datastream", "badsuffix", []),
    ).rejects.toThrow(/kOS error: GET Suffix 'VALUEX' not found/);

    source.disconnect();
  });

  it("scenario #8: prefers the explicit Message: line for TinyPG-style syntax errors", async () => {
    const mock = MockKosTelnet.install();
    const DIVIDER = "_".repeat(42);
    mock.registerScript("badsyntax", () =>
      [
        // Inline echo + headline (real kOS prints both).
        `print "hello!"`,
        `Syntax: Unexpected token 'EOF' found. Expected EOI at line 1`,
        `print "hello!"`,
        `              ^`,
        DIVIDER,
        "           VERBOSE DESCRIPTION",
        "The parser used by kOS is complaining about a",
        "part of the script it can't understand.",
        "Error   Line: 1",
        "Error Column: 0",
        // Test asserts on this exact text — the parser should pull it out
        // in preference to the verbose prose above.
        "Message: Unexpected token 'EOF' found. Expected EOI",
        DIVIDER,
        `print "hello!"`,
        DIVIDER,
        DIVIDER,
        "At interpreter",
        "<<--EOF",
        "^",
      ].join("\n"),
    );

    const source = makeSource();
    await expect(
      source.executeScript("datastream", "badsyntax", []),
    ).rejects.toThrow(/kOS error: Unexpected token 'EOF' found\. Expected EOI/);

    source.disconnect();
  });

  it("scenario #9: rejects with the [KOSERROR] message verbatim (no prefix — the script author owns the wording)", async () => {
    const mock = MockKosTelnet.install();
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

  it("scenario #10: [KOSERROR] wins over [KOSDATA] when both appear", async () => {
    const mock = MockKosTelnet.install();
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

  it("scenario #11: onCpusDiscovered fires with every CPU on the active vessel — even ones the session isn't targeting", async () => {
    const mock = MockKosTelnet.install();
    mock.setCpus([
      {
        number: 1,
        vesselName: "Test Ship",
        partType: "KAL9000",
        tagname: "datastream",
      },
      {
        number: 2,
        vesselName: "Test Ship",
        partType: "KAL9000",
        tagname: "lander",
      },
      {
        number: 3,
        vesselName: "Test Ship",
        partType: "KAL9000",
        tagname: "probe",
      },
    ]);
    mock.registerScript("noop", () => "[KOSDATA] ok=true [/KOSDATA]");

    const source = makeSource();
    const seen = vi.fn();
    source.onCpusDiscovered(seen);

    // Trigger a session — the menu read happens during attach, before
    // executeScript resolves.
    await source.executeScript("datastream", "noop", []);

    // The menu fires once on attach, possibly more if the session re-parses;
    // we just need to assert at least one call delivered the full list.
    expect(seen).toHaveBeenCalled();
    const cpus = seen.mock.calls[0][0];
    expect(cpus.map((c: { tagname: string }) => c.tagname)).toEqual([
      "datastream",
      "lander",
      "probe",
    ]);

    source.disconnect();
  });

  it("scenario #11c: menu-peek session feeds discovery on connect — no widget needed", async () => {
    const mock = MockKosTelnet.install();
    mock.setCpus([
      {
        number: 1,
        vesselName: "Test Ship",
        partType: "KAL9000",
        tagname: "datastream",
      },
      {
        number: 2,
        vesselName: "Test Ship",
        partType: "KAL9000",
        tagname: "lander",
      },
    ]);

    const source = makeSource();
    const seen = vi.fn();
    source.onCpusDiscovered(seen);

    await source.connect();
    // Mock opens + emits the menu on the next microtask.
    await waitFor(() => expect(seen).toHaveBeenCalled());

    const cpus = seen.mock.calls[0][0];
    expect(cpus.map((c: { tagname: string }) => c.tagname)).toEqual([
      "datastream",
      "lander",
    ]);
    // We never called executeScript, so no per-CPU sessions exist — the
    // discovery came purely from the menu peek.
    expect(mock.invocations()).toHaveLength(0);

    source.disconnect();
  });

  it("scenario #11d: menu-peek refreshes discovery when the CPU list changes", async () => {
    const mock = MockKosTelnet.install();
    mock.setCpus([
      {
        number: 1,
        vesselName: "Old Ship",
        partType: "KAL9000",
        tagname: "datastream",
      },
    ]);

    const source = makeSource();
    const seen = vi.fn();
    source.onCpusDiscovered(seen);

    await source.connect();
    await waitFor(() => expect(seen).toHaveBeenCalled());

    // Simulate a vessel switch that changes the CPU set.
    mock.setCpus([
      {
        number: 1,
        vesselName: "New Ship",
        partType: "KAL9000",
        tagname: "lander",
      },
      {
        number: 2,
        vesselName: "New Ship",
        partType: "KAL9000",
        tagname: "probe",
      },
    ]);
    mock.emitListChanged();

    await waitFor(() => {
      const last = seen.mock.calls[seen.mock.calls.length - 1][0];
      expect(last.map((c: { tagname: string }) => c.tagname)).toEqual([
        "lander",
        "probe",
      ]);
    });

    source.disconnect();
  });

  it("scenario #11b: onCpusDiscovered unsubscribe stops further callbacks", async () => {
    const mock = MockKosTelnet.install();
    mock.setCpus([
      {
        number: 1,
        vesselName: "Test Ship",
        partType: "KAL9000",
        tagname: "datastream",
      },
    ]);
    mock.registerScript("noop", () => "[KOSDATA] ok=true [/KOSDATA]");

    const source = makeSource();
    const seen = vi.fn();
    const unsub = source.onCpusDiscovered(seen);
    unsub();
    await source.executeScript("datastream", "noop", []);
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
