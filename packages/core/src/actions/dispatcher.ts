/**
 * The action-handler registry moved to `@ksp-gonogo/sitrep-sdk`.
 *
 * Both ends of it belong to an Uplink: a widget registers a handler through
 * `useActionInput` in its own component body, and the widget's TEST fires it with
 * `dispatchAction` (the only way to exercise an action without a serial device
 * attached) and wipes it with `clearActionHandlers` between cases that share an
 * instance id. Seven Uplink test files call the clear; reaching either meant
 * importing this package, which is `private: true`.
 *
 * It named one TYPE and nothing else, so it moves rather than staying a host
 * shim, and its state moved to a `globalThis` slot in the same change.
 *
 * Re-exported so this package's importers, `useActionInput` included, keep their
 * import site.
 */
export {
  type ActionHandler,
  clearActionHandlers,
  dispatchAction,
  registerActionHandler,
  unregisterActionHandler,
} from "@ksp-gonogo/sitrep-sdk";
