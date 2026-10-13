/**
 * In-memory coverage masks, one per (bodyId, layerId), allocated on first use.
 *
 * Nothing here is persisted, because nothing here is the game's only copy: the
 * mod that sources a layer holds the full coverage in the save and re-sends a
 * body's whole bitmap when it is subscribed, so a reload repaints from the
 * stream. The MapView reads each layer's mask independently and composes them
 * at paint time.
 */

import type { BodyMask } from "../types";

interface CacheEntry {
  mask: BodyMask;
  listeners: Set<(mask: BodyMask) => void>;
}

interface CacheOptions {
  /** Dimensions of a freshly allocated mask. */
  width?: number;
  height?: number;
}

/**
 * The width, in cells, of a new coverage mask: the cells across a body's 360
 * degrees of longitude.
 * Useful for sizing a coverage mask to the map's resolution. Used by {@link
 * CoverageMaskCache} when it is created without a width.
 *
 * @category Maps and coverage
 */
export const DEFAULT_MASK_WIDTH = 2048;

/**
 * The height, in cells, of a new coverage mask: the cells from pole to pole.
 * Useful for sizing a coverage mask to the map's resolution. Used by {@link
 * CoverageMaskCache} when it is created without a height.
 *
 * @category Maps and coverage
 */
export const DEFAULT_MASK_HEIGHT = 1024;

function makeCacheKey(bodyId: string, layerId: string): string {
  return `${bodyId}:${layerId}`;
}

/**
 * Holds in memory one coverage mask per body and layer, each a grid of cells
 * that are hidden or revealed on the body's map. Useful for keeping the ground
 * a scanner has covered so the map can draw it. Reach the app's instance with
 * {@link useCoverageMaskCache}.
 *
 * @category Maps and coverage
 */
export class CoverageMaskCache {
  private entries = new Map<string, CacheEntry>();

  private readonly width: number;
  private readonly height: number;

  constructor(opts: CacheOptions = {}) {
    this.width = opts.width ?? DEFAULT_MASK_WIDTH;
    this.height = opts.height ?? DEFAULT_MASK_HEIGHT;
  }

  /** The mask for a body and layer, created with every cell hidden on first use. */
  acquire(bodyId: string, layerId: string): BodyMask {
    return this.entry(bodyId, layerId).mask;
  }

  /** The mask for a body and layer, or `undefined` if it has not been created. */
  get(bodyId: string, layerId: string): BodyMask | undefined {
    return this.entries.get(makeCacheKey(bodyId, layerId))?.mask;
  }

  /** Tells the mask's listeners its bytes changed. Call it after writing into `data`. */
  markDirty(bodyId: string, layerId: string): void {
    const entry = this.entries.get(makeCacheKey(bodyId, layerId));
    if (!entry) return;
    for (const listener of entry.listeners) listener(entry.mask);
  }

  /** Calls `listener` whenever the mask changes. Returns the function that stops it. */
  onChange(
    bodyId: string,
    layerId: string,
    listener: (mask: BodyMask) => void,
  ): () => void {
    const entry = this.entry(bodyId, layerId);
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
  }

  /** Hides every cell of the mask and tells its listeners. */
  clear(bodyId: string, layerId: string): void {
    const entry = this.entries.get(makeCacheKey(bodyId, layerId));
    if (!entry) return;
    entry.mask.data.fill(0);
    for (const listener of entry.listeners) listener(entry.mask);
  }

  private entry(bodyId: string, layerId: string): CacheEntry {
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
      listeners: new Set(),
    };
    this.entries.set(key, entry);
    return entry;
  }
}
