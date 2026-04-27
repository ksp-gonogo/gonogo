import { PerfBudget } from "@gonogo/core";

/**
 * Thin key/value store for app-wide user preferences. Values are JSON-
 * serialised into a single localStorage slot and fanned out to per-key
 * subscribers so React consumers can `useSyncExternalStore` cheaply.
 *
 * Settings themselves are registered via `registerSetting()` (see registry.ts);
 * this service is just the persistence + subscription layer.
 *
 * Writes are coalesced through a short debounce (`SAVE_DEBOUNCE_MS`).
 * Burst-sets (e.g. loading a mission profile that touches many keys) hit
 * localStorage once instead of once per key. A `beforeunload` handler
 * flushes synchronously so unsaved changes survive a tab close.
 */

const STORAGE_KEY = "gonogo.settings";
const SAVE_DEBOUNCE_MS = 100;

/**
 * Steady-state localStorage write rate from settings. The debounce caps
 * us at ~10/sec in the worst case (every 100 ms a different key
 * changes); typical use is well under 1/sec. Threshold at 20/sec gives
 * headroom for a chatty feature without hiding a real regression that
 * defeats the debounce.
 */
const SETTINGS_WRITE_BUDGET = new PerfBudget({
  name: "SettingsService.save() writes/sec",
  threshold: 20,
  windowMs: 1000,
  unit: "writes",
});

type Listener<T = unknown> = (value: T) => void;

export class SettingsService {
  private values = new Map<string, unknown>();
  private listeners = new Map<string, Set<Listener>>();
  private storage: Storage;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private beforeUnloadHandler: (() => void) | null = null;

  constructor(storage: Storage = globalThis.localStorage) {
    this.storage = storage;
    this.load();
    // Flush on tab close so debounced writes don't get dropped. Only
    // attach in browser-like environments — Node / vitest runs without
    // window are no-ops.
    if (typeof window !== "undefined") {
      this.beforeUnloadHandler = () => this.flush();
      window.addEventListener("beforeunload", this.beforeUnloadHandler);
    }
  }

  get<T>(key: string, fallback: T): T {
    if (!this.values.has(key)) return fallback;
    return this.values.get(key) as T;
  }

  set<T>(key: string, value: T): void {
    // Cheap dedupe — structural compare via JSON since settings are always
    // JSON-serialisable by contract.
    const prev = this.values.get(key);
    if (JSON.stringify(prev) === JSON.stringify(value)) return;
    this.values.set(key, value);
    this.scheduleSave();
    const bucket = this.listeners.get(key);
    if (bucket) for (const l of bucket) (l as Listener<T>)(value);
  }

  subscribe<T>(key: string, cb: Listener<T>): () => void {
    let bucket = this.listeners.get(key);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(key, bucket);
    }
    bucket.add(cb as Listener);
    return () => bucket.delete(cb as Listener);
  }

  /**
   * Force any pending debounced write to localStorage immediately. Tests
   * call this between `set()` and constructing a second instance from
   * the same storage; the beforeunload handler also calls it on tab
   * close so users don't lose recent edits.
   */
  flush(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty) this.save();
  }

  /** Detach the beforeunload listener. Call before discarding the
   *  service — primarily relevant in tests that mount/unmount many
   *  instances. */
  dispose(): void {
    this.flush();
    if (this.beforeUnloadHandler && typeof window !== "undefined") {
      window.removeEventListener("beforeunload", this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer !== null) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, SAVE_DEBOUNCE_MS);
  }

  private load(): void {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) this.values.set(k, v);
    } catch {
      // Corrupt value — wipe and start clean.
      this.storage.removeItem(STORAGE_KEY);
    }
  }

  private save(): void {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of this.values) obj[k] = v;
    this.storage.setItem(STORAGE_KEY, JSON.stringify(obj));
    this.dirty = false;
    SETTINGS_WRITE_BUDGET.record();
  }
}
