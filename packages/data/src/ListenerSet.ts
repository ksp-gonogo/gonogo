/**
 * Tiny helper for the "Set of callbacks + add returning a cleanup" pattern that
 * shows up in every DataSource wrapper (per-key subscribers, status listeners,
 * sample subscribers, etc.). Owning this in one place removes a fistful of
 * near-identical boilerplate from each call site.
 *
 * Standalone (not tied to DataSourceWrapper) so PeerClientDataSource — which
 * doesn't wrap an upstream `real` source and so doesn't extend the wrapper
 * base — can use it too.
 */
export class ListenerSet<TArgs extends readonly unknown[] = []> {
  private readonly listeners = new Set<(...args: TArgs) => void>();

  add(cb: (...args: TArgs) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  fire(...args: TArgs): void {
    this.listeners.forEach((cb) => {
      cb(...args);
    });
  }

  get size(): number {
    return this.listeners.size;
  }

  clear(): void {
    this.listeners.clear();
  }
}

/**
 * Keyed variant — a Map<key, Set<cb>> with the same add/fire ergonomics. Used
 * for the per-key subscriber bookkeeping inside BufferedDataSource and
 * PeerClientDataSource. The bucket Set is created lazily and removed when its
 * last subscriber leaves so an empty Map entry never lingers.
 */
export class KeyedListenerSet<TArgs extends readonly unknown[] = []> {
  private readonly buckets = new Map<string, Set<(...args: TArgs) => void>>();

  add(key: string, cb: (...args: TArgs) => void): () => void {
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

  fire(key: string, ...args: TArgs): void {
    this.buckets.get(key)?.forEach((cb) => {
      cb(...args);
    });
  }

  has(key: string): boolean {
    return this.buckets.has(key);
  }

  size(key: string): number {
    return this.buckets.get(key)?.size ?? 0;
  }

  clear(): void {
    this.buckets.clear();
  }
}
