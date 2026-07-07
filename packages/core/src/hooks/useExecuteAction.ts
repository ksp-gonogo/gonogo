import {
  mapCommand,
  useCarriedChannelsOptional,
  useTelemetryClientOptional,
} from "@gonogo/sitrep-client";
import { useCallback } from "react";
import { getDataSource } from "../registry";

/**
 * Fire an action (legacy Telemachus `execute(action: string)`) or, once M3
 * has migrated it, a typed stream command — the write-half twin of
 * `useDataValue`'s read shim (`m3-migration-plan.md` §4-commands, §Build 1
 * "command shim"). Same allowlist-gated, legacy-fallback contract as the
 * read shim:
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
 * **Why this doesn't literally call the `useCommand` hook.** `useCommand
 * (command: string)` (`@gonogo/sitrep-client`) is bound to ONE fixed command
 * topic for the hook's whole lifetime — the natural shape for a widget that
 * always fires the same command. `useExecuteAction`, by contrast, returns a
 * single callback that receives an arbitrary legacy ACTION STRING at CALL
 * time (`WarpControl` alone fires three different ones — `t.timeWarp[N]`,
 * `t.pause`, `t.unpause` — through the one `execute()` this hook returns),
 * so which command (if any) applies can't be known until the callback runs,
 * long after this hook's own render. Calling `useCommand` conditionally per
 * action would violate React's hooks-are-unconditional rule. Exactly the
 * same "dynamic topic determined at call time" reason `useDataValue`'s doc
 * comment gives for mirroring `useStream` instead of calling it — see that
 * file for the precedent. This hook instead calls the same underlying
 * primitive `useCommand.send` is built on (`TelemetryClient.dispatch`)
 * directly.
 *
 * **Never rejects** — matches the legacy `execute()`'s fire-and-forget
 * contract (every existing call site does `void execute(...)`, uncaught).
 * A command's eventual outcome (confirmed/failed/lost) is future
 * `useCommand`-status work for a widget that wants to observe it, not this
 * hook's return value.
 */
export function useExecuteAction(dataSourceId: string) {
  const client = useTelemetryClientOptional();
  const carriedChannels = useCarriedChannelsOptional();

  return useCallback(
    (action: string): Promise<void> => {
      const mapped = mapCommand(dataSourceId, action);
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
    [dataSourceId, client, carriedChannels],
  );
}
