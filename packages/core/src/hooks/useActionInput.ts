import { useEffect, useRef } from "react";
import {
  type ActionHandler,
  registerActionHandler,
  unregisterActionHandler,
} from "../actions/dispatcher";
import { useDashboardItemId } from "../contexts/DashboardItemContext";
import { PerfBudget } from "../perf/PerfBudget";
import type { ActionDefinition, ActionHandlers } from "../types";

/**
 * Wire up a component's declared actions to real handlers. The component's
 * instance ID comes from the enclosing `DashboardItemContext`, so call sites
 * don't pass it explicitly:
 *
 *     const actions = [
 *       { id: "toggle", label: "Toggle", accepts: ["button"] },
 *     ] as const satisfies readonly ActionDefinition[];
 *
 *     useActionInput<typeof actions>({
 *       toggle: () => { handleToggle(); return { on: isOn }; },
 *     });
 *
 * Call sites pass an inline object literal; that object's identity changes
 * on every render. The hook stores the latest version in a ref and registers
 * stable proxy handlers ONCE on mount, so:
 *
 *   - Closures inside handlers always see the latest state (the ref reads
 *     the current render's object).
 *   - `registerActionHandler` / `unregisterActionHandler` aren't called on
 *     every parent re-render — important for widgets that re-render at
 *     Telemachus rate (~4 Hz).
 *
 * Action ids are read from the *initial* `handlers` object on mount; if a
 * component changes the *set* of action ids across renders the new ones
 * won't register. In practice action sets are static per component (declared
 * via `registerComponent({ actions: [...] })`), so this is safe.
 */

/**
 * Soft cap on action-handler register operations. Should be near-zero in
 * steady state — every widget mounts once and registers once. A spike
 * means a widget is re-mounting (likely a key/identity bug) or
 * re-running its useActionInput effect on every parent render (the
 * regression this hook was rewritten to prevent).
 */
const ACTION_REGISTER_BUDGET = new PerfBudget({
  name: "useActionInput register/sec",
  threshold: 50,
  windowMs: 1000,
  unit: "registrations",
});

export function useActionInput<TActions extends readonly ActionDefinition[]>(
  handlers: ActionHandlers<TActions>,
): void {
  const instanceId = useDashboardItemId();

  // Keep the latest handlers in a ref so the proxy below always sees the
  // current closure. Updating the ref every render is free — assignment,
  // no re-render, no effect trigger.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // Register stable proxy handlers ONCE on mount. The proxy reads
  // `handlersRef.current` at dispatch time so closure freshness is
  // preserved. Action ids come from the first render — see the doc
  // comment for the static-action-set assumption.
  useEffect(() => {
    const actionIds = Object.keys(handlersRef.current as Record<string, unknown>);
    for (const actionId of actionIds) {
      const proxy: ActionHandler = (payload) => {
        const fn = (
          handlersRef.current as unknown as Record<string, ActionHandler>
        )[actionId];
        return fn?.(payload);
      };
      registerActionHandler(instanceId, actionId, proxy);
      ACTION_REGISTER_BUDGET.record();
    }
    return () => {
      for (const actionId of actionIds) {
        unregisterActionHandler(instanceId, actionId);
      }
    };
  }, [instanceId]);
}
