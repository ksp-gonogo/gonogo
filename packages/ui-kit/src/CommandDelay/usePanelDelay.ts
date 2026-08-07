import { useEffect, useId } from "react";
import type { CommandDelayHandle } from "./CommandDelay";
import { useDelayRailStore } from "./DelayRailContext";

/**
 * Publish a command's delay handle into the nearest `DelayRailStore` for the
 * life of the calling component, so `Panel.Delay` can render its in-flight /
 * stream UX in the panel's rail. The command-widget twin of
 * `useStatusContribution`: a widget calls `useCommand(...)` and hands the result
 * to `usePanelDelay(cmd)`, exactly as a `Badge` hands a contribution to
 * `useStatusContribution`.
 *
 * - registers on mount, deregisters on unmount, `update`s in place on a value
 *   change, all against the store from context
 * - a no-op when there is no store in the tree (a bare command widget outside a
 *   dashboard), the same backward-compatible degradation `useCommand` takes when
 *   there is no `TelemetryProvider`
 * - the registry `id` is minted here with `useId` (stable for the hook's whole
 *   mounted life), NOT supplied by the widget: unlike a status contribution, a
 *   command handle carries no natural id, and a hook-scoped one keys register /
 *   update / deregister without leaning on the handle's object identity (fresh
 *   on most renders)
 * - `null` contributes nothing, so a widget can pass the handle conditionally
 *   (an instant command, a control not yet armed) without branching around the
 *   hook
 * - consumes the command's dev-only must-consume token, the check the inline
 *   `<CommandDelay>` used to satisfy, so a delayed command still can never
 *   dispatch without its delay UX wired (see `useCommand`'s assertion)
 *
 * The handle shape is the structural `CommandDelayHandle` declared in this
 * package, NOT imported from `@ksp-gonogo/sitrep-client`: ui-kit stays the
 * vanilla design system, and `useCommand`'s real return value satisfies this
 * shape at the call site.
 */
export function usePanelDelay(handle: CommandDelayHandle | null): void {
  const store = useDelayRailStore();
  const id = useId();
  const present = handle !== null;

  // Register / deregister keyed on identity only (store, the minted id, and
  // whether a handle is present), so a value change does not tear down and
  // rebuild the entry. The handle's fields are intentionally omitted from the
  // deps: the update effect below applies their changes in place, and
  // re-registering on every value change is exactly the churn this split avoids.
  // biome-ignore lint/correctness/useExhaustiveDependencies: value changes are applied by the update effect, not by re-registering
  useEffect(() => {
    if (!store || !handle) return;
    return store.register({ id, ...handle });
  }, [store, id, present]);

  // Apply value changes in place against the current registration. Runs on
  // every render the handle identity changes (most of them, since a command
  // handle is a fresh literal), but the store's own shallow-equal guard means a
  // handle that did not actually move notifies nobody.
  useEffect(() => {
    if (!store || !handle) return;
    store.update(id, handle);
  }, [store, id, handle]);

  // Consume the command's dev-only must-consume token (absent in production),
  // SYNCHRONOUSLY during render rather than in an effect. This is the contract
  // the inline `<CommandDelay>` fulfilled before the widget moved its delay UX to
  // the panel rail: calling `usePanelDelay` IS wiring that UX, so `useCommand`'s
  // dispatch-time assertion passes whether or not a delay store is present (a
  // headerless / no-store command widget still counts as wired).
  //
  // It must be render-phase, not an effect: `usePanelDelay` is called AFTER
  // `useCommand` in the same component, so a marking effect here would run after
  // `useCommand`'s own dispatch-check effect (sibling effects fire in declaration
  // order), and a command dispatched on mount would trip the assertion before the
  // token was marked. `<CommandDelay>` avoided this by being a CHILD (child
  // effects run before parent effects); the in-body hook has no such ordering, so
  // it marks in render, which precedes every effect. Idempotent + dev-only.
  if (process.env.NODE_ENV !== "production" && handle?._output) {
    handle._output.consumed = true;
  }
}
