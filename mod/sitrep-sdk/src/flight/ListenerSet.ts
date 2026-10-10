/**
 * A set of callbacks: `add` returns the function that removes one, and `fire`
 * calls them all.
 *
 * @category Flight recording
 */
export class ListenerSet<Args extends readonly unknown[] = []> {
  private readonly listeners = new Set<(...args: Args) => void>();

  /** Adds a listener and returns a function that removes it. */
  add(cb: (...args: Args) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Calls every listener with the given arguments. */
  fire(...args: Args): void {
    this.listeners.forEach((cb) => {
      cb(...args);
    });
  }

  /** How many listeners there are. */
  get size(): number {
    return this.listeners.size;
  }

  /** Removes every listener. */
  clear(): void {
    this.listeners.clear();
  }
}

/**
 * A {@link ListenerSet} per key. A key's set is created when its first callback
 * is added and removed when its last one goes.
 *
 * @category Flight recording
 */
export class KeyedListenerSet<Args extends readonly unknown[] = []> {
  private readonly buckets = new Map<string, Set<(...args: Args) => void>>();

  /** Adds a listener under a key and returns a function that removes it. */
  add(key: string, cb: (...args: Args) => void): () => void {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new Set();
      this.buckets.set(key, bucket);
    }
    bucket.add(cb);
    return () => {
      const b = this.buckets.get(key);
      if (!b) return;
      b.delete(cb);
      if (b.size === 0) this.buckets.delete(key);
    };
  }

  /** Calls every listener under a key with the given arguments. */
  fire(key: string, ...args: Args): void {
    this.buckets.get(key)?.forEach((cb) => {
      cb(...args);
    });
  }

  /** Whether a key has any listener. */
  has(key: string): boolean {
    return this.buckets.has(key);
  }

  /** How many listeners a key has. */
  size(key: string): number {
    return this.buckets.get(key)?.size ?? 0;
  }

  /** Removes every listener. */
  clear(): void {
    this.buckets.clear();
  }
}
