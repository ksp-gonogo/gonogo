import { useCallback } from "react";
import { getDataSource } from "../api/registry";
import {
  useCarriedChannelsOptional,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "./context";
import { mapCommand } from "./map-command";

/**
 * @deprecated LEGACY command bridge, on death row. Retained ONLY for the two
 * widgets whose migration to the delay-aware `useCommand(topic)` is deferred:
 * `Navball` (axis/translation, mod-contract-blocked) and `LaunchDirector`'s
 * launch command (T12, which turns launch into a genuinely DELAYED pad
 * command). It is slated for deletion the instant those two migrate in the
 * per-widget hard pass, so do NOT add new callers. Every other command
 * dispatches through the delay-aware `useCommand(topic)`
 * (`@ksp-gonogo/sitrep-client` / the sitrep-sdk facade), which carries the
 * signal-delay UX. This hook returns only `Promise<void>` (no delay UX), which
 * is exactly why it is being retired: a command sent through it can ship with
 * no visible delay.
 *
 * The legacy `useCommand` alias this file used to re-export is gone: `useCommand`
 * now unambiguously means the delay-aware per-topic hook.
 *
 * Fires an action (the legacy `execute(action: string)`) or, when the
 * action maps onto a typed stream command AND that command topic is carried, a
 * `TelemetryClient.dispatch`. The carried-channels check below is a dev-time
 * PROMOTION gate (which topics the app has wired onto the stream), NOT an
 * authorization/allowlist control. Command authority is not gated here and, by
 * design, is not gated anywhere (any screen may fire any command; the trust
 * boundary is the widget, not the transport):
 *
 * - **Mapped action** (`mapCommand(dataSourceId, action)` resolves) **+ a
 *   `TelemetryProvider` is mounted + the command topic is CARRIED**
 *   (`useCarriedChannelsOptional`'s carried-channels set: the SAME set a
 *   `TelemetryProvider`'s `carriedChannels` prop grows for read topics;
 *   commands are promoted into the identical set) -> dispatches via
 *   `TelemetryClient.dispatch(command, args)`.
 * - **Everything else** (unmapped action: most of them; no provider
 *   mounted; mapped but not yet carried) -> the unchanged legacy
 *   `DataSource.execute(action)` path.
 *
 * **Why this doesn't literally call the sitrep-client `useCommand` hook.**
 * `useCommand(command: string)` (`@ksp-gonogo/sitrep-client`) is bound to ONE
 * fixed command topic for the hook's whole lifetime, the natural shape for a
 * widget that always fires the same command. This hook, by contrast, returns a
 * single callback that receives an arbitrary legacy ACTION STRING at CALL
 * time (`Navball` alone fires several: through the one `execute()` this hook
 * returns), so which command (if any) applies can't be known until the
 * callback runs, long after this hook's own render. Calling the sitrep-client
 * `useCommand` conditionally per action would violate React's
 * hooks-are-unconditional rule. This hook instead calls the same underlying
 * primitive that `useCommand.send` is built on (`TelemetryClient.dispatch`)
 * directly.
 *
 * **The toggle -> absolute arg-shape bridge** (`map-command.ts`'s own doc
 * comment, bridge 1): several mapped actions (`f.sas`/`f.rcs`/`f.gear`/
 * `f.brake`/`f.light`/`f.ag1`..`f.ag10`) are legacy TOGGLES with no state
 * encoded in the action string, but every new actuation command is
 * absolute-set-only: `mapCommand`'s `buildArgs` needs to read the CURRENT
 * value to invert it. `getCurrentValue` below samples the mounted
 * `TimelineStore` at its current frame (the same read a migrated
 * `useTelemetry` call would perform), `undefined` when no store is mounted
 * or nothing has arrived on that topic yet, which `mapCommand` correctly
 * treats as "can't safely build this command" and falls back to legacy.
 *
 * **Never rejects**: matches the legacy `execute()`'s fire-and-forget
 * contract (every existing call site does `void execute(...)`, uncaught).
 */
export function useExecuteAction(dataSourceId: string) {
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
