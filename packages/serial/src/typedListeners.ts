/**
 * A tiny typed event registry. `TMap` maps an event name to the argument
 * tuple its listeners receive, e.g.:
 *
 * ```ts
 * type Events = {
 *   change: [];
 *   input: [deviceId: string, event: InputEvent];
 * };
 * const events = new TypedListeners<Events>();
 * const off = events.on("input", (id, ev) => {});
 * events.emit("input", "dev-1", someEvent);
 * off();
 * ```
 *
 * Backed by a `Set` per event key, so re-adding the same callback is a no-op
 * (dedup), and `emit` iterates the live Set in insertion order — matching the
 * hand-rolled `Set`-based listener fields it replaces.
 */
/**
 * Internal storage type — listeners are stored type-erased and re-narrowed at
 * the `on`/`emit` boundary, where the public generics enforce correctness.
 */
type AnyListener = (...args: unknown[]) => void;

export class TypedListeners<TMap extends Record<string, unknown[]>> {
  private listeners = new Map<keyof TMap, Set<AnyListener>>();

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof TMap>(
    type: K,
    cb: (...args: TMap[K]) => void,
  ): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    const stored = cb as unknown as AnyListener;
    set.add(stored);
    return () => {
      set?.delete(stored);
    };
  }

  /** Fire an event, invoking every current listener in insertion order. */
  emit<K extends keyof TMap>(type: K, ...args: TMap[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    set.forEach((cb) => {
      (cb as unknown as (...a: TMap[K]) => void)(...args);
    });
  }
}
