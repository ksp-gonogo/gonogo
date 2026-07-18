/**
 * In-memory cache of fog-of-war masks, backed by `FogMaskStore`.
 *
 * Masks are allocated lazily — a (body, layerId) pair only consumes memory
 * once it actually gets data. First-view loads from IndexedDB are async;
 * callers subscribe via `onChange` and redraw when the mask arrives.
 *
 * Mutations are cheap (direct byte writes on the caller's side); persistence
 * is debounced so rapid consecutive paints coalesce into a single IDB write.
 *
 * One mask per (bodyId, layerId). The MapView reads each scan type's mask
 * independently and composes them with precedence rules at paint time.
 */

import { safeRandomUuid } from "@ksp-gonogo/core";
import type { FogMaskStore } from "./FogMaskStore";

export interface BodyMask {
  readonly bodyId: string;
  readonly layerId: string;
  readonly width: number;
  readonly height: number;
  /** Alpha bytes, row-major. Mutable — caller writes directly. */
  data: Uint8Array;
}

interface CacheEntry {
  mask: BodyMask;
  dirty: boolean;
  loading: boolean;
  listeners: Set<(mask: BodyMask) => void>;
}

interface CacheOptions {
  /** Debounce in ms between the first mutation and the next flush. */
  flushDebounceMs?: number;
  /** Default mask dimensions when allocating a fresh mask. */
  width?: number;
  height?: number;
}

export const DEFAULT_MASK_WIDTH = 2048;
export const DEFAULT_MASK_HEIGHT = 1024;
const DEFAULT_DEBOUNCE_MS = 10_000;

function makeCacheKey(bodyId: string, layerId: string): string {
  return `${bodyId}:${layerId}`;
}

export class FogMaskCache {
  private entries = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<BodyMask>>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private storeUnsub: (() => void) | null = null;
  // Origin tag this cache stamps onto its own writes, so the change
  // listener below can short-circuit when the change came from us.
  // Without it the cache would race-reload its own bytes over a fresh
  // in-memory mutation and clear() would lose to a flush still in
  // flight from earlier markDirty.
  private readonly originTag = `cache-${safeRandomUuid()}`;

  private readonly width: number;
  private readonly height: number;
  private readonly debounceMs: number;

  constructor(
    private store: FogMaskStore,
    private profileId: string,
    opts: CacheOptions = {},
  ) {
    this.width = opts.width ?? DEFAULT_MASK_WIDTH;
    this.height = opts.height ?? DEFAULT_MASK_HEIGHT;
    this.debounceMs = opts.flushDebounceMs ?? DEFAULT_DEBOUNCE_MS;
    // Watch for external writes to the store (e.g. fog-snapshot from
    // the host arriving via PeerJS, written straight to the store and
    // bypassing this cache's own mutate/flush path). Without this hook
    // the in-memory mask stays empty after the snapshot lands and
    // every UI subscriber misses it until a refresh.
    this.storeUnsub = store.onChange((pid, bodyId, layerId, origin) => {
      if (origin === this.originTag) return;
      if (pid !== this.profileId) return;
      void this.reloadFromStore(bodyId, layerId);
    });
  }

  /**
   * Load a mask for the given (body, layerId) pair. First call per pair
   * hits IDB; subsequent calls return the cached instance synchronously
   * (via a resolved promise). Concurrent first-calls dedupe via an
   * in-flight promise map.
   *
   * Note: a zeroed stub entry may already exist if `onChange` was called
   * first (e.g. from `useBodyFogMask` subscribing before kicking off the
   * async load). We must still hit IDB in that case — check `loading`, not
   * just presence.
   */
  async acquire(bodyId: string, layerId: string): Promise<BodyMask> {
    const key = makeCacheKey(bodyId, layerId);
    const existing = this.entries.get(key);
    if (existing && !existing.loading) return existing.mask;
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const load = this.loadOrAllocate(bodyId, layerId);
    this.inflight.set(key, load);
    try {
      return await load;
    } finally {
      this.inflight.delete(key);
    }
  }

  /** Synchronous accessor — returns undefined if not yet acquired. */
  get(bodyId: string, layerId: string): BodyMask | undefined {
    return this.entries.get(makeCacheKey(bodyId, layerId))?.mask;
  }

  /**
   * Mark the (body, layerId) mask as dirty and notify subscribers. Also
   * schedules a debounced flush.
   */
  markDirty(bodyId: string, layerId: string): void {
    const entry = this.entries.get(makeCacheKey(bodyId, layerId));
    if (!entry) return;
    entry.dirty = true;
    for (const listener of entry.listeners) listener(entry.mask);
    this.scheduleFlush();
  }

  onChange(
    bodyId: string,
    layerId: string,
    listener: (mask: BodyMask) => void,
  ): () => void {
    const entry = this.ensureEntryShell(bodyId, layerId);
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
  }

  /** Flush all dirty masks synchronously (awaitable). */
  async flush(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const writes: Array<Promise<void>> = [];
    for (const entry of this.entries.values()) {
      if (!entry.dirty) continue;
      entry.dirty = false;
      writes.push(
        this.store.save(
          this.profileId,
          entry.mask.bodyId,
          entry.mask.layerId,
          entry.mask.data,
          entry.mask.width,
          entry.mask.height,
          this.originTag,
        ),
      );
    }
    await Promise.all(writes);
  }

  /** Zero the mask in memory and remove it from IDB. */
  async clear(bodyId: string, layerId: string): Promise<void> {
    const entry = this.entries.get(makeCacheKey(bodyId, layerId));
    if (entry) {
      entry.mask.data.fill(0);
      entry.dirty = false;
      for (const listener of entry.listeners) listener(entry.mask);
    }
    await this.store.clear(this.profileId, bodyId, layerId, this.originTag);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.storeUnsub?.();
    this.storeUnsub = null;
    await this.flush();
  }

  /**
   * Re-read a (body, layerId) mask from the store and notify subscribers.
   * Called automatically on `store.onChange` for external writes (snapshots,
   * direct saves from peer protocols) — not part of the public API.
   *
   * Skips when no entry exists yet (no UI subscribers, so nothing to
   * notify) and when the entry's flush is mid-flight (the cache is
   * about to write the same data back, so a re-load would race).
   */
  private async reloadFromStore(
    bodyId: string,
    layerId: string,
  ): Promise<void> {
    const entry = this.entries.get(makeCacheKey(bodyId, layerId));
    if (!entry) return;
    // Avoid clobbering local mutations that haven't hit the store yet.
    // The local writer already owns the canonical bytes; an external
    // write is presumed older.
    if (entry.dirty) return;
    const stored = await this.store.load(this.profileId, bodyId, layerId);
    if (!stored) return;
    if (
      stored.width === entry.mask.width &&
      stored.height === entry.mask.height
    ) {
      // Preserve the existing mask reference so any caller holding it
      // (canvas paint loops, refs) sees the new bytes in place.
      entry.mask.data.set(stored.data);
    } else {
      // Dimension mismatch is rare in practice (host + station default
      // to the same constants), but if it happens we have to swap the
      // mask object. Subscribers re-key off the new reference.
      entry.mask = {
        bodyId,
        layerId,
        width: stored.width,
        height: stored.height,
        data: new Uint8Array(stored.data),
      };
    }
    entry.loading = false;
    for (const listener of entry.listeners) listener(entry.mask);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Ensure an entry shell exists so subscribers can attach before the async
   * load finishes. The shell is replaced in place by `loadOrAllocate`.
   */
  private ensureEntryShell(bodyId: string, layerId: string): CacheEntry {
    const key = makeCacheKey(bodyId, layerId);
    let entry = this.entries.get(key);
    if (entry) return entry;
    entry = {
      mask: {
        bodyId,
        layerId,
        width: this.width,
        height: this.height,
        data: new Uint8Array(this.width * this.height),
      },
      dirty: false,
      loading: true,
      listeners: new Set(),
    };
    this.entries.set(key, entry);
    return entry;
  }

  private async loadOrAllocate(
    bodyId: string,
    layerId: string,
  ): Promise<BodyMask> {
    const entry = this.ensureEntryShell(bodyId, layerId);
    const stored = await this.store.load(this.profileId, bodyId, layerId);
    if (
      stored &&
      stored.width === this.width &&
      stored.height === this.height
    ) {
      // Preserve the existing mask reference (callers may already hold it)
      // by copying bytes in place.
      entry.mask.data.set(stored.data);
    }
    // Mismatched dimensions: treat as a fresh start. The already-zeroed
    // buffer from the shell stands in.
    entry.loading = false;
    for (const listener of entry.listeners) listener(entry.mask);
    return entry.mask;
  }

  private scheduleFlush(): void {
    if (this.disposed) return;
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush().catch(() => {
        // Swallow — next dirty mark will reschedule. Persistent failures
        // would need an observable error path, but worth adding only once
        // we have a case where it matters.
      });
    }, this.debounceMs);
  }
}
