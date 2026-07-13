import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { useKosRun } from "./useKosRun";

/**
 * Proves the `kos.run` round trip end to end at the client boundary:
 * dispatch -> ack -> correlated `kos.run.<coreId>` result -> resolved
 * promise — see `docs/superpowers/plans/2026-07-12-kos-uplink-full-
 * migration.md`. Uses the same `setupStreamFixture` harness as
 * `KosTerminal`'s tests: a real `TelemetryClient`/`TimelineStore` pipeline
 * with a `StubTransport`, so the real hook, the real command dispatch, and
 * the real stream subscription all run — only the wire is stubbed.
 */

function fixtureFor(coreId: number) {
  const fixture = setupStreamFixture({
    carriedChannels: [`kos.run.${coreId}`],
    pinnedUt: 10,
  });
  return { ...fixture, coreId };
}

describe("useKosRun — kos.run command + kos.run.<coreId> channel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dispatches kos.run with a fresh requestId and the given command text", async () => {
    const f = fixtureFor(7);
    const commands: Array<{ command: string; args: unknown }> = [];
    f.transport.setCommandHandler((command, args) => {
      commands.push({ command, args });
      return { success: true, errorCode: 0 };
    });

    const { result } = renderHook(() => useKosRun(7), { wrapper: f.Provider });
    act(() => {
      // Never answered on kos.run.7 in this test — swallow the eventual
      // unmount-teardown rejection so it doesn't surface as unhandled.
      void result.current.run('RUNPATH("0:/foo.ks").\n').catch(() => {});
    });

    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0].command).toBe("kos.run");
    const args = commands[0].args as {
      coreId: number;
      requestId: string;
      command: string;
    };
    expect(args.coreId).toBe(7);
    expect(args.command).toBe('RUNPATH("0:/foo.ks").\n');
    expect(args.requestId).toBeTruthy();
  });

  it("resolves the call's own outcome when its own requestId is answered", async () => {
    const f = fixtureFor(7);
    let capturedRequestId = "";
    f.transport.setCommandHandler((_command, args) => {
      capturedRequestId = (args as { requestId: string }).requestId;
      return { success: true, errorCode: 0 };
    });

    const { result } = renderHook(() => useKosRun(7), { wrapper: f.Provider });
    let outcome:
      | { fields: Record<string, unknown> | null; error: string | null }
      | undefined;
    act(() => {
      void result.current.run('RUNPATH("0:/foo.ks").\n').then((o) => {
        outcome = o;
      });
    });

    await waitFor(() => expect(capturedRequestId).toBeTruthy());

    act(() =>
      f.emit(`kos.run.${f.coreId}`, {
        coreId: 7,
        requestId: capturedRequestId,
        fields: { v: 1, ok: true },
        error: null,
      }),
    );

    await waitFor(() => expect(outcome).toBeDefined());
    expect(outcome).toEqual({ fields: { v: 1, ok: true }, error: null });
  });

  it("resolves with a non-null error and null fields on a [KOSERROR] result", async () => {
    const f = fixtureFor(7);
    let requestId = "";
    f.transport.setCommandHandler((_command, args) => {
      requestId = (args as { requestId: string }).requestId;
      return { success: true, errorCode: 0 };
    });

    const { result } = renderHook(() => useKosRun(7), { wrapper: f.Provider });
    let outcome:
      | { fields: Record<string, unknown> | null; error: string | null }
      | undefined;
    act(() => {
      void result.current.run("bad script").then((o) => {
        outcome = o;
      });
    });
    await waitFor(() => expect(requestId).toBeTruthy());

    act(() =>
      f.emit(`kos.run.${f.coreId}`, {
        coreId: 7,
        requestId,
        fields: null,
        error: "engine flameout",
      }),
    );

    await waitFor(() => expect(outcome).toBeDefined());
    expect(outcome).toEqual({ fields: null, error: "engine flameout" });
  });

  it("rejects when the mod acks the command as a failure", async () => {
    const f = fixtureFor(7);
    f.transport.setCommandHandler(() => ({ success: false, errorCode: 4 }));

    const { result } = renderHook(() => useKosRun(7), { wrapper: f.Provider });
    let error: Error | undefined;
    act(() => {
      void result.current.run("cmd").catch((e: Error) => {
        error = e;
      });
    });

    await waitFor(() => expect(error).toBeDefined());
    expect(error?.message).toMatch(/command rejected/i);
  });

  it("rejects after timeoutMs when no result ever arrives", async () => {
    vi.useFakeTimers();
    const f = fixtureFor(7);
    f.transport.setCommandHandler(() => ({ success: true, errorCode: 0 }));

    const { result } = renderHook(() => useKosRun(7, { timeoutMs: 1000 }), {
      wrapper: f.Provider,
    });
    let error: Error | undefined;
    act(() => {
      void result.current.run("cmd").catch((e: Error) => {
        error = e;
      });
    });

    // Fake timers also fake queueMicrotask (the ack's StubTransport delivery
    // path) — advanceTimersByTimeAsync pumps both micro- and macro-tasks, so
    // the ack lands before the timeout fires at exactly 1000ms.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(error?.message).toMatch(/no response/i);
  });

  it("a foreign requestId on the channel does not resolve an unrelated pending run", async () => {
    const f = fixtureFor(7);
    f.transport.setCommandHandler(() => ({ success: true, errorCode: 0 }));

    const { result } = renderHook(() => useKosRun(7), { wrapper: f.Provider });
    let settled = false;
    act(() => {
      // Settles (either way) only when unmount teardown rejects it — this
      // test unmounts nothing, so it stays pending; .then's two callbacks
      // (not .finally) both mark settled AND consume the rejection so an
      // eventual unmount-teardown reject doesn't surface as unhandled.
      void result.current.run("cmd").then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
    });

    act(() =>
      f.emit(`kos.run.${f.coreId}`, {
        coreId: 7,
        requestId: "some-other-requestId-nobody-is-waiting-on",
        fields: { v: 1 },
        error: null,
      }),
    );

    // Give any (incorrect) resolution a tick to land, then assert it didn't.
    await act(async () => {
      await Promise.resolve();
    });
    expect(settled).toBe(false);
  });
});
