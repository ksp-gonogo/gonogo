import type { ActionInputPayload } from "./types";

/**
 * The action-handler registry: `instanceId` -> `actionId` -> handler.
 *
 * Lives here rather than in `@ksp-gonogo/core` because an Uplink widget is what
 * registers into it (`useActionInput` inside the component body) and an Uplink
 * test is what fires it: `dispatchAction` is how a test drives a widget's action
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

/**
 * The function that runs when an input bound to one action of one placed widget
 * fires, and what it returns is written back to the device that fired it.
 * Useful for letting the operator drive a widget from a serial device or
 * keyboard key. Taken by {@link registerActionHandler}.
 *
 * @category Actions
 */
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

/**
 * Sets the function that runs when an input bound to one action of one placed
 * widget fires, replacing any set before it. Useful for letting the operator
 * drive a widget from a serial device or keyboard key. `instanceId` is the id
 * the dashboard gave that one placed copy of the widget, so two copies of one
 * widget keep separate bindings. Used by `useActionInput`, which a widget calls
 * instead of calling this directly.
 *
 * @category Actions
 */
export function registerActionHandler(
  instanceId: string,
  actionId: string,
  handler: ActionHandler,
): void {
  bucketFor(instanceId).set(actionId, handler);
}

/**
 * Removes the function set for one action of one placed widget, so a bound
 * input no longer reaches it. Useful for cleaning up when the widget leaves the
 * dashboard. Used by `useActionInput` when its widget unmounts.
 *
 * @category Actions
 */
export function unregisterActionHandler(
  instanceId: string,
  actionId: string,
): void {
  const all = handlers();
  const bucket = all.get(instanceId);
  if (!bucket) return;
  bucket.delete(actionId);
  // Drop the empty bucket too, so an unmounted widget leaves nothing behind: the registry is keyed by instance id and those are generated per dashboard item.
  if (bucket.size === 0) all.delete(instanceId);
}

/**
 * Runs the function set for one action of one placed widget, and returns what
 * it returns, which is sent back to the device that fired the input. Returns
 * `undefined` when none is set. Useful for sending a serial or keyboard input
 * to the widget the operator bound it to. Used by the app's input dispatcher,
 * which receives each event from a connected device or keyboard and calls this
 * for the widget its binding names.
 *
 * @category Actions
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

/**
 * Removes every action handler of every placed widget, so a test starts with
 * none bound. Useful between test cases that share an instance id, the id the
 * dashboard gave one placed copy of a widget (see {@link registerActionHandler}).
 *
 * @category Actions
 */
export function clearActionHandlers(): void {
  handlers().clear();
}
