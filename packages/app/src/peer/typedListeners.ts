import { ListenerSet } from "@ksp-gonogo/data";

/**
 * A small typed event registry that collapses the "one `ListenerSet` field
 * + `on<Name>` method + emit site" boilerplate that both `PeerHostService`
 * and `PeerClientService` were hand-rolling ~20 times each.
 *
 * `TMap` maps an event key to the *argument tuple* fired for that event —
 * mirroring the existing `ListenerSet<[...]>` generics. It is NOT a
 * message-type → payload map: the services derive listener args inside their
 * dispatcher handlers (e.g. `gonogoVote` fires `(conn.peer, msg.status)`),
 * and several events (`peerConnect`, `peerId`, `connStatus`, …) aren't wire
 * messages at all.
 *
 * Backed by a lazily-created `Map<key, ListenerSet>` so iteration order and
 * dedup semantics are byte-for-byte identical to the old per-field
 * `ListenerSet` — `emit` is a thin pass-through to `ListenerSet.fire`, so
 * there's no behavioural drift from the previous code.
 */
export class TypedListeners<TMap extends Record<string, readonly unknown[]>> {
  // The per-key sets store heterogeneous tuple types; we keep them as
  // `ListenerSet<readonly unknown[]>` internally and re-narrow at the typed
  // `on` / `emit` boundary so callers stay fully type-checked.
  private readonly sets = new Map<
    keyof TMap,
    ListenerSet<readonly unknown[]>
  >();

  private setFor<K extends keyof TMap>(
    type: K,
  ): ListenerSet<readonly unknown[]> {
    let set = this.sets.get(type);
    if (!set) {
      set = new ListenerSet<readonly unknown[]>();
      this.sets.set(type, set);
    }
    return set;
  }

  on<K extends keyof TMap>(
    type: K,
    cb: (...args: TMap[K]) => void,
  ): () => void {
    return this.setFor(type).add(cb as (...args: readonly unknown[]) => void);
  }

  emit<K extends keyof TMap>(type: K, ...args: TMap[K]): void {
    this.sets.get(type)?.fire(...args);
  }

  /** Number of listeners registered for a single event key. */
  size<K extends keyof TMap>(type: K): number {
    return this.sets.get(type)?.size ?? 0;
  }
}
