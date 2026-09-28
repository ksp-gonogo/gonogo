import { logger } from "../../api/logger";

/**
 * Where a `LocalStorageStore` keeps its value and what it holds before anything
 * is saved.
 *
 * @category Flight recording
 */
export interface LocalStorageStoreOptions<Stored> {
  /** localStorage key */
  key: string;
  /** default value used when key is missing or corrupt */
  defaults: Stored;
  /** Optional: if provided, this Storage shim is used instead of
   *  `globalThis.localStorage`. Useful for tests. */
  storage?: Storage;
  /** Optional callback fired when a stored value can't be parsed.
   *  Receives the offending raw string. Default: logs a warning via
   *  the central logger under the `storage` tag. Pass an explicit
   *  callback (e.g. `() => {}`) to silence. */
  onCorruption?: (raw: string, error: unknown) => void;
}

/**
 * A small typed wrapper around `localStorage`. Resilient to:
 *   - missing key  → defaults
 *   - JSON parse error → defaults (and onCorruption called)
 *   - localStorage throwing on get/set (e.g. private mode quota) → swallowed
 *
 * Reads return a fresh value each time (no in-memory cache).
 *
 * For an object `Stored`, `get()` returns `{ ...defaults, ...parsed }` so adding new
 * fields to `Stored` defaults to `defaults[newField]` rather than `undefined`.
 * Non-object stored values (string, number, boolean, array, null) are
 * returned as-is, TypeScript can't enforce that at runtime, so the caller's
 * type parameter is trusted.
 *
 * @category Flight recording
 */
export class LocalStorageStore<Stored> {
  private readonly key: string;
  private readonly defaults: Stored;
  private readonly storage: Storage | undefined;
  private readonly onCorruption: (raw: string, error: unknown) => void;
  private readonly listeners = new Set<(value: Stored) => void>();

  constructor(opts: LocalStorageStoreOptions<Stored>) {
    this.key = opts.key;
    this.defaults = opts.defaults;
    this.storage = opts.storage ?? globalThis.localStorage;
    this.onCorruption = opts.onCorruption ?? defaultCorruptionLogger(this.key);
  }

  /**
   * Whether a value has ever been persisted under this key (even a corrupt
   * one). Lets callers distinguish "user saved something" from "running on
   * defaults": e.g. first-run seeding only applies when nothing is stored.
   */
  isStored(): boolean {
    try {
      return (this.storage?.getItem(this.key) ?? null) !== null;
    } catch {
      return false;
    }
  }

  get(): Stored {
    let raw: string | null = null;
    try {
      raw = this.storage?.getItem(this.key) ?? null;
    } catch {
      return this.cloneDefaults();
    }
    if (raw === null) return this.cloneDefaults();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this.onCorruption(raw, err);
      return this.cloneDefaults();
    }

    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      this.defaults !== null &&
      typeof this.defaults === "object" &&
      !Array.isArray(this.defaults)
    ) {
      return {
        ...(this.defaults as object),
        ...(parsed as object),
      } as Stored;
    }
    return parsed as Stored;
  }

  set(value: Stored): void {
    try {
      this.storage?.setItem(this.key, JSON.stringify(value));
    } catch {
      return;
    }
    this.listeners.forEach((cb) => {
      cb(value);
    });
  }

  patch(partial: Partial<Stored>): void {
    const current = this.get();
    if (
      current !== null &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      const next = { ...(current as object), ...(partial as object) } as Stored;
      this.set(next);
      return;
    }
    this.set(partial as Stored);
  }

  clear(): void {
    try {
      this.storage?.removeItem(this.key);
    } catch {
      return;
    }
    const value = this.cloneDefaults();
    this.listeners.forEach((cb) => {
      cb(value);
    });
  }

  subscribe(cb: (value: Stored) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private cloneDefaults(): Stored {
    if (
      this.defaults !== null &&
      typeof this.defaults === "object" &&
      !Array.isArray(this.defaults)
    ) {
      return { ...(this.defaults as object) } as Stored;
    }
    return this.defaults;
  }
}

function defaultCorruptionLogger(
  key: string,
): (raw: string, error: unknown) => void {
  return (raw, error) => {
    logger.tag("storage").warn(`Corrupt JSON for ${key}: using defaults`, {
      raw: raw.length > 200 ? `${raw.slice(0, 200)}...` : raw,
      error,
    });
  };
}
