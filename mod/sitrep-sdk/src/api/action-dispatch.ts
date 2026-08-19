import type { ActionInputPayload } from "./types";

/**
 * The action-handler registry: `instanceId` -> `actionId` -> handler.
 *
 * Lives here rather than in `@ksp-gonogo/core` because an Uplink WIDGET is what
 * registers into it (`useActionInput` inside the component body) and an Uplink
 * TEST is what fires it: `dispatchAction` is how a test drives a widget's action
 * without a serial device attached, and `clearActionHandlers` is how it stops
 * handlers leaking between cases that share one instance id.
 *
 * Instance-scoped rather than component-scoped, because two copies of the same
 * widget on one dashboard are two independent handler sets: a serial input bound
 * to the left copy must not fire the right one's handler.
 */

/**
 * The single global slot the handlers live in, keyed by a string rather than a
 * symbol so two different builds of this package still find the same Map. See
 * `map-poi.ts` for why a module static is not safe once this can be bundled.
 */
const ACTION_HANDLERS_KEY = "__GONOGO_ACTION_HANDLERS__" as const;

export type ActionHandler = (payload: ActionInputPayload) => unknown;

function handlers(): Map<string, Map<string, ActionHandler>> {
  const slot = globalThis as typeof globalThis & {
    [ACTION_HANDLERS_KEY]?: Map<string, Map<string, ActionHandler>>;
  };
  slot[ACTION_HANDLERS_KEY] ??= new Map();
  return slot[ACTION_HANDLERS_KEY];
}

function bucketFor(instanceId: string): Map<string, ActionHandler> {
  const all = handlers();
  let bucket = all.get(instanceId);
  if (!bucket) {
    bucket = new Map();
    all.set(instanceId, bucket);
  }
  return bucket;
}

export function registerActionHandler(
  instanceId: string,
  actionId: string,
  handler: ActionHandler,
): void {
  bucketFor(instanceId).set(actionId, handler);
}

export function unregisterActionHandler(
  instanceId: string,
  actionId: string,
): void {
  const all = handlers();
  const bucket = all.get(instanceId);
  if (!bucket) return;
  bucket.delete(actionId);
  // Drop the empty bucket too, so an unmounted widget leaves nothing behind: the
  // registry is keyed by instance id and those are generated per dashboard item.
  if (bucket.size === 0) all.delete(instanceId);
}

/**
 * Fires the handler registered for `instanceId`/`actionId` if one exists and
 * returns its value (for the render-output path). Unknown actions are a no-op
 * and return `undefined`.
 */
export function dispatchAction(
  instanceId: string,
  actionId: string,
  payload: ActionInputPayload,
): unknown {
  const handler = handlers().get(instanceId)?.get(actionId);
  if (!handler) return undefined;
  return handler(payload);
}

/** Test-only: wipe all registered handlers. */
export function clearActionHandlers(): void {
  handlers().clear();
}
