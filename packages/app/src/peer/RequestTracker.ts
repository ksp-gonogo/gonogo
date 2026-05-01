/**
 * Tracks pending request/response pairs keyed by `requestId`. Used by
 * `PeerClientService` for both `queryRange` and `kosExecute` round-trips:
 * each call generates a fresh `requestId`, registers a pending entry with
 * a timeout, and resolves/rejects when the matching response arrives or
 * the connection drops.
 *
 * The tracker is generic over the resolved value `T` so each kind of
 * request keeps its own typed map (different responses carry different
 * payload shapes — e.g. `{t, v}` vs `KosData`).
 */
export class RequestTracker<T> {
  private readonly pending = new Map<
    string,
    {
      resolve: (value: T) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  /**
   * Register a pending call. Returns a Promise that resolves/rejects when
   * `resolve(id, ...)` / `reject(id, ...)` is invoked, or when the
   * timeout fires (whichever comes first). If the timer fires the entry
   * is removed automatically.
   */
  track(
    requestId: string,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(requestId)) {
          reject(new Error(timeoutMessage));
        }
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
    });
  }

  /** Resolve the pending entry for `requestId`, if any. */
  resolve(requestId: string, value: T): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.resolve(value);
  }

  /** Reject the pending entry for `requestId`, if any. */
  reject(requestId: string, err: Error): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.reject(err);
  }

  /** Reject *all* pending entries — used when the underlying connection drops. */
  rejectAll(reason: string): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
      this.pending.delete(id);
    }
  }
}
