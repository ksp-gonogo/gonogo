import type { LogEntry } from "./types.js";

/**
 * Fixed-size ring buffer for log entries. Captures every emitted entry
 * — including tag-gated entries the console suppresses — so operators can
 * download a rich trail even when they didn't pre-enable the relevant tag.
 *
 * Eviction: oldest-first, soft-capped via shift() rather than a circular
 * index. At the default capacity (5000) and roughly one push per ms under
 * heavy peer traffic, the shift cost stays negligible against the work
 * those logs were already doing.
 *
 * Persistence (opt-in): with a `persist` config the buffer mirrors itself
 * to sessionStorage on a 2 s interval and on `pagehide` so a hard refresh
 * preserves the trail. sessionStorage (not localStorage) is the right
 * scope — survives refresh in the same tab, doesn't bleed between tabs.
 */
export interface PersistConfig {
  /** Storage key. */
  key: string;
  /** Storage to use. Defaults to globalThis.sessionStorage when present. */
  storage?: Storage;
  /** Flush cadence in ms. Defaults to 2000. */
  flushIntervalMs?: number;
}

const DEFAULT_FLUSH_MS = 2000;

export class LogRingBuffer {
  private readonly capacity: number;
  private entries: LogEntry[] = [];
  private dirty = false;
  private readonly persist: { storage: Storage; key: string } | null;

  constructor(capacity = 5000, persist?: PersistConfig) {
    this.capacity = capacity;
    const storage = persist?.storage ?? defaultStorage();
    this.persist = persist && storage ? { storage, key: persist.key } : null;
    if (this.persist) {
      this.restore();
      const interval = persist?.flushIntervalMs ?? DEFAULT_FLUSH_MS;
      // Lifetime-of-page interval — the ring buffer is owned by the
      // ConsoleLogger singleton, so there's no dispose path; letting it
      // run for the page is fine.
      setInterval(() => this.flush(), interval);
      // pagehide is the most reliable "tab going away" event in browsers
      // (fires for refresh, navigation away, and tab close — beforeunload
      // doesn't always fire on mobile). Best-effort: skip wiring if we're
      // not in a browser-like global.
      const target = (
        globalThis as { addEventListener?: typeof addEventListener }
      ).addEventListener;
      if (typeof target === "function") {
        globalThis.addEventListener("pagehide", () => this.flush());
      }
    }
  }

  push(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.capacity) this.entries.shift();
    if (this.persist) this.dirty = true;
  }

  snapshot(): LogEntry[] {
    return this.entries.slice();
  }

  clear(): void {
    this.entries = [];
    if (this.persist) {
      try {
        this.persist.storage.removeItem(this.persist.key);
      } catch {
        // ignore
      }
      this.dirty = false;
    }
  }

  size(): number {
    return this.entries.length;
  }

  /**
   * Write the in-memory entries to the persistent store immediately. Called
   * automatically every flush interval and on `pagehide`; exposed for tests
   * and any caller that wants a synchronous drain.
   */
  flush(): void {
    if (!this.persist || !this.dirty) return;
    const { storage, key } = this.persist;
    try {
      storage.setItem(key, JSON.stringify(this.entries));
      this.dirty = false;
    } catch {
      // Quota exceeded is the only realistic failure here. Drop the older
      // half and try once more — losing some history beats the buffer
      // never persisting again for the rest of the session.
      this.entries = this.entries.slice(Math.floor(this.entries.length / 2));
      try {
        storage.setItem(key, JSON.stringify(this.entries));
        this.dirty = false;
      } catch {
        // Give up; stay marked dirty so the next push triggers another
        // attempt after natural eviction.
      }
    }
  }

  private restore(): void {
    if (!this.persist) return;
    try {
      const raw = this.persist.storage.getItem(this.persist.key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      // Trust the shape loosely — restore is best-effort; a malformed entry
      // still serialises back out fine because we never read fields here.
      this.entries = (parsed as LogEntry[]).slice(-this.capacity);
    } catch {
      // Corrupt cache — drop it.
      try {
        this.persist.storage.removeItem(this.persist.key);
      } catch {
        // ignore
      }
    }
  }
}

function defaultStorage(): Storage | undefined {
  try {
    return (globalThis as { sessionStorage?: Storage }).sessionStorage;
  } catch {
    return undefined;
  }
}
