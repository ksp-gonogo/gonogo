import { useEffect, useRef } from "react";
import {
  type ActionHandler,
  registerActionHandler,
  unregisterActionHandler,
} from "../api/action-dispatch";
import type { ActionDefinition, ActionHandlers } from "../api/types";
import { PerfBudget } from "../perf/PerfBudget";
import { useDashboardItemId } from "./dashboard-item";

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
 * stable proxy handlers once on mount, so:
 *
 *   - Closures inside handlers always see the latest state (the ref reads
 *     the current render's object).
 *   - `registerActionHandler` / `unregisterActionHandler` aren't called on
 *     every parent re-render, important for widgets that re-render at
 *     stream rate (~4 Hz).
 *
 * Action ids are read from the *initial* `handlers` object on mount; if a
 * component changes the *set* of action ids across renders the new ones
 * won't register. In practice action sets are static per component (declared
 * via `registerComponent({ actions: [...] })`), so this is safe.
 */

/*
 * Counts only a hook registering the same actions for the same instance id again
 * while it stays mounted, which is what a re-register loop (an instance id that
 * flaps between renders) produces. First registrations at mount are not
 * counted: a page load registers every action of every widget at once, and
 * that is not a fault. StrictMode re-runs each effect once on mount, so the
 * first re-run of a hook is free and only a third run onward is counted.
 */
const ACTION_REREGISTER_BUDGET = new PerfBudget({
  name: "useActionInput re-registrations/sec",
  threshold: 50,
  windowMs: 1000,
  unit: "registrations",
});

export function useActionInput<Actions extends readonly ActionDefinition[]>(
  handlers: ActionHandlers<Actions>,
): void {
  const instanceId = useDashboardItemId();

  // Keep the latest handlers in a ref so the proxy below always sees the
  // current closure. Updating the ref every render is free, assignment,
  // no re-render, no effect trigger.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const runsRef = useRef(new Map<string, number>());

  // Register stable proxy handlers ONCE on mount. The proxy reads
  // `handlersRef.current` at dispatch time so closure freshness is
  // preserved. Action ids come from the first render; see the doc
  // comment for the static-action-set assumption.
  useEffect(() => {
    const actionIds = Object.keys(handlersRef.current);
    const runs = (runsRef.current.get(instanceId) ?? 0) + 1;
    runsRef.current.set(instanceId, runs);
    for (const actionId of actionIds) {
      const proxy: ActionHandler = (payload) => {
        const fn: unknown = Reflect.get(handlersRef.current, actionId);
        return typeof fn === "function"
          ? (fn as ActionHandler)(payload)
          : undefined;
      };
      registerActionHandler(instanceId, actionId, proxy);
      if (runs > 2) ACTION_REREGISTER_BUDGET.record();
    }
    return () => {
      for (const actionId of actionIds) {
        unregisterActionHandler(instanceId, actionId);
      }
    };
  }, [instanceId]);
}
