import { safeRandomUuid } from "@ksp-gonogo/core";
import { useCommand, useStreamEvent } from "@ksp-gonogo/sitrep-client";
import type {
  CommandResult,
  KosRunArgs,
  KosRunResult,
} from "@ksp-gonogo/sitrep-sdk";
import { useCallback, useEffect, useRef } from "react";

/**
 * Proof-of-wiring for the `kos.run` command + `kos.run.<coreId>` output
 * channel (see `docs/superpowers/plans/2026-07-12-kos-uplink-full-
 * migration.md`) — dispatches an arbitrary REPL command line to a kOS CPU
 * over the Uplink and resolves with its correlated result, exactly the
 * shape `ScriptableDataSource.executeScript` needs.
 *
 * **Not yet the production path.** `KosDataSource.executeScript`
 * (`packages/app/src/dataSources/kos.ts`) still runs everything over the
 * telnet proxy; this hook exists to prove the `kos.run` wire pattern works
 * end to end (dispatch → correlate → resolve/reject) with tests, ahead of
 * the eventual cutover. The real cutover needs a non-hook path to the
 * `TelemetryClient` (this hook can only be called from a React component,
 * `KosDataSource` is a plain class) — an open design question the
 * migration plan defers to the main-tree pass. Not wired into
 * `useKosWidget`/`KosScriptRunner`/`KosWidget`/`KosFiles` — none of those
 * change until that cutover lands.
 *
 * A kOS CPU's REPL is single-threaded (only one command in flight at a
 * time), so calls to the SAME `coreId` must be serialized by the caller —
 * this hook does not queue; a second `run()` before the first resolves
 * will race the mod's own `KosRunManager.TryArm` rejection (surfaces as a
 * `success: false` ack, rejecting the second call's promise immediately).
 */

export interface KosRunOutcome {
  /** Parsed `[KOSDATA]` field map — null on an error outcome. */
  fields: Record<string, unknown> | null;
  /** Explicit `[KOSERROR]` message — null on a data outcome. */
  error: string | null;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export interface UseKosRunOptions {
  /** Milliseconds to wait for a correlated `kos.run.<coreId>` result before rejecting. */
  timeoutMs?: number;
}

export interface UseKosRunResult {
  /** Dispatch `command` (a full REPL command line) to `coreId` and resolve with its correlated result. */
  run: (command: string) => Promise<KosRunOutcome>;
}

interface PendingRun {
  resolve: (outcome: KosRunOutcome) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function useKosRun(
  coreId: number,
  opts: UseKosRunOptions = {},
): UseKosRunResult {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { send } = useCommand("kos.run");

  // requestId -> the outer promise's settle functions. A ref (not state) —
  // settling a pending run must never trigger a re-render.
  const pendingRef = useRef(new Map<string, PendingRun>());

  // Reject every still-pending run on unmount so a caller awaiting run()
  // doesn't hang forever past teardown.
  useEffect(() => {
    const pending = pendingRef.current;
    return () => {
      for (const [requestId, p] of pending) {
        clearTimeout(p.timer);
        p.reject(
          new Error(`kos.run: unmounted before CPU ${coreId} responded`),
        );
        pending.delete(requestId);
      }
    };
  }, [coreId]);

  const settle = useCallback(
    (requestId: string, apply: (p: PendingRun) => void) => {
      const pending = pendingRef.current.get(requestId);
      if (!pending) return; // already settled (timeout / unmount) or a foreign id
      pendingRef.current.delete(requestId);
      clearTimeout(pending.timer);
      apply(pending);
    },
    [],
  );

  useStreamEvent<KosRunResult>(`kos.run.${coreId}`, (result) => {
    settle(result.requestId, (p) =>
      p.resolve({ fields: result.fields ?? null, error: result.error ?? null }),
    );
  });

  const run = useCallback(
    (command: string): Promise<KosRunOutcome> => {
      const requestId = safeRandomUuid();
      return new Promise<KosRunOutcome>((resolve, reject) => {
        const timer = setTimeout(() => {
          settle(requestId, (p) =>
            p.reject(
              new Error(
                `kos.run: no response from CPU ${coreId} within ${timeoutMs}ms`,
              ),
            ),
          );
        }, timeoutMs);
        pendingRef.current.set(requestId, { resolve, reject, timer });

        void send({
          coreId,
          requestId,
          command,
        } satisfies KosRunArgs)
          .then((ack) => {
            const result = ack as CommandResult | undefined;
            if (result && result.success === false) {
              settle(requestId, (p) =>
                p.reject(
                  new Error(
                    `kos.run: command rejected for CPU ${coreId} (errorCode ${result.errorCode})`,
                  ),
                ),
              );
            }
            // success: true carries no payload of its own — the real result
            // arrives asynchronously on kos.run.<coreId>, handled above.
          })
          .catch((err: unknown) => {
            settle(requestId, (p) =>
              p.reject(err instanceof Error ? err : new Error(String(err))),
            );
          });
      });
    },
    [coreId, send, timeoutMs, settle],
  );

  return { run };
}
