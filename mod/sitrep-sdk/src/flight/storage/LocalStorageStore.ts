import { logger } from "../../api/logger";

/**
 * Where a `LocalStorageStore` keeps its value and what it holds before anything
 * is saved.
 *
 * @category Flight recording
 */
export interface LocalStorageStoreOptions<Stored> {
  /** The `localStorage` key the value is saved under. */
  key: string;
  /** The value read when nothing is saved, or what is saved cannot be read. */
  defaults: Stored;
  /** A `Storage` to use in place of `localStorage`, such as a test's own. */
  storage?: Storage;
  /**
   * Called with the saved text when it cannot be read. Absent, a warning is
   * logged under the `storage` tag; pass `() => {}` to stay silent.
   */
  onCorruption?: (raw: string, error: unknown) => void;
}

/**
 * One typed value saved in `localStorage`. A missing or unreadable value reads
 * as the defaults (and an unreadable one calls `onCorruption`), and a
 * `localStorage` that throws, as a private window's can, is ignored.
 *
 * Every read parses afresh. For an object value, a read returns the defaults
 * with the saved fields over them, so a field added later reads as its
 * default. Any other value is returned as saved, trusted to be the declared
 * type.
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
