import {
  mapCommand,
  useCarriedChannelsOptional,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "@ksp-gonogo/sitrep-client";
import { useCallback } from "react";
import { getDataSource } from "../registry";

/**
 * Fire a command. The **canonical** command hook of the Uplink architecture
 * (spec §3.3) — the write-half twin of `useTelemetry`, renamed from the
 * historical `useExecuteAction` (which now re-exports this as a deprecated
 * alias). Telemetry in, command out.
 *
 * Fires an action (legacy Telemachus `execute(action: string)`) or, once M3
 * has migrated it, a typed stream command (`m3-migration-plan.md`
 * §4-commands, §Build 1 "command shim"). Same allowlist-gated, legacy-fallback
 * contract as the `useTelemetry` read shim:
 *
 * - **Mapped action** (`mapCommand(dataSourceId, action)` resolves) **+ a
 *   `TelemetryProvider` is mounted + the command topic is CARRIED**
 *   (`useCarriedChannelsOptional`'s allowlist — the SAME allowlist a
 *   `TelemetryProvider`'s `carriedChannels` prop grows for read topics;
 *   commands are promoted into the identical set) -> dispatches via
 *   `TelemetryClient.dispatch(command, args)`.
 * - **Everything else** (unmapped action — most of them; no provider
 *   mounted; mapped but not yet carried) -> the unchanged legacy
 *   `DataSource.execute(action)` path.
 *
 * **Why this doesn't literally call the sitrep-client `useCommand` hook.**
 * `useCommand(command: string)` (`@ksp-gonogo/sitrep-client`) is bound to ONE
 * fixed command topic for the hook's whole lifetime — the natural shape for a
 * widget that always fires the same command. This hook, by contrast, returns a
 * single callback that receives an arbitrary legacy ACTION STRING at CALL
 * time (`WarpControl` alone fires three different ones — `t.timeWarp[N]`,
 * `t.pause`, `t.unpause` — through the one `execute()` this hook returns),
 * so which command (if any) applies can't be known until the callback runs,
 * long after this hook's own render. Calling the sitrep-client `useCommand`
 * conditionally per action would violate React's hooks-are-unconditional rule.
 * Exactly the same "dynamic topic determined at call time" reason
 * `useTelemetry`'s doc comment gives for mirroring `useStream` instead of
 * calling it — see that file for the precedent. This hook instead calls the
 * same underlying primitive that `useCommand.send` is built on
 * (`TelemetryClient.dispatch`) directly.
 *
 * **The toggle -> absolute arg-shape bridge** (`map-command.ts`'s own doc
 * comment, bridge 1): several mapped actions (`f.sas`/`f.rcs`/`f.gear`/
 * `f.brake`/`f.light`/`f.ag1`..`f.ag10`) are legacy TOGGLES with no state
 * encoded in the action string, but every new actuation command is
 * absolute-set-only — `mapCommand`'s `buildArgs` needs to read the CURRENT
 * value to invert it. `getCurrentValue` below samples the mounted
 * `TimelineStore` at its current frame (the same read a migrated
 * `useTelemetry` call would perform) — `undefined` when no store is mounted
 * or nothing has arrived on that topic yet, which `mapCommand` correctly
 * treats as "can't safely build this command" and falls back to legacy.
 *
 * **Never rejects** — matches the legacy `execute()`'s fire-and-forget
 * contract (every existing call site does `void execute(...)`, uncaught).
 * A command's eventual outcome (confirmed/failed/lost) is future
 * status work for a widget that wants to observe it, not this hook's return
 * value.
 */
export function useCommand(dataSourceId: string) {
  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();
  const carriedChannels = useCarriedChannelsOptional();

  return useCallback(
    (action: string): Promise<void> => {
      const getCurrentValue = (topic: string): unknown =>
        store?.sample(topic, store.currentFrame())?.payload;
      const mapped = mapCommand(dataSourceId, action, getCurrentValue);
      const carried =
        mapped !== undefined &&
        client !== undefined &&
        carriedChannels?.has(mapped.command) === true;

      if (carried && client && mapped) {
        const { result } = client.dispatch(mapped.command, mapped.args);
        return result.then(
          () => undefined,
          () => undefined,
        );
      }

      const source = getDataSource(dataSourceId);
      if (!source) return Promise.resolve();
      return source.execute(action);
    },
    [dataSourceId, client, store, carriedChannels],
  );
}
