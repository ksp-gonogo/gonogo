// ---------------------------------------------------------------------------
// `LocalStorageStore` — bundled directly (not a host shim), same reasoning
// as `safeRandomUuid` in `./index.ts`: no module-global state, so
// duplicating it here carries none of the "second copy of a registry" risk
// that rules out bundling core's stateful members. A byte-for-byte port of
// `@ksp-gonogo/data`'s implementation (`storage/LocalStorageStore.ts`), not
// a re-export — the sdk leaf cannot name `@ksp-gonogo/data` as a workspace
// dependency (data depends on core, which depends on the sdk — naming it
// here would form the same turbo `^build` cycle the mirrored types in
// `./types.ts` avoid).
//
// One behavioural difference from the original: the default corruption
// logger routes through the injected host's `logger` (via `getHost()`)
// instead of importing `@ksp-gonogo/logger`'s singleton directly — bundling
// that import here would be exactly the "second, console-only logger copy"
// failure `./index.ts`'s own `logger` Proxy shim exists to prevent (see its
// doc comment). This path is lazy — only reached on an actual corrupt-JSON
// read — so a caller who never hits corruption, or who supplies their own
// `onCorruption`, never touches the host at all.
// ---------------------------------------------------------------------------

import { getHost } from "./host";

interface LocalStorageStoreOptions<T> {
  /** localStorage key */
  key: string;
  /** default value used when key is missing or corrupt */
  defaults: T;
  /** Optional: if provided, this Storage shim is used instead of
   *  `globalThis.localStorage`. Useful for tests. */
  storage?: Storage;
  /** Optional callback fired when a stored value can't be parsed.
   *  Receives the offending raw string. Default: logs a warning via
   *  the injected host's logger under the `storage` tag. Pass an explicit
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
 * For object T, `get()` returns `{ ...defaults, ...parsed }` so adding new
 * fields to T defaults to `defaults[newField]` rather than `undefined`.
 * Non-object stored values (string, number, boolean, array, null) are
 * returned as-is — TypeScript can't enforce that at runtime, so the caller's
 * type parameter is trusted.
 */
export class LocalStorageStore<T> {
  private readonly key: string;
  private readonly defaults: T;
  private readonly storage: Storage | undefined;
  private readonly onCorruption: (raw: string, error: unknown) => void;
  private readonly listeners = new Set<(value: T) => void>();

  constructor(opts: LocalStorageStoreOptions<T>) {
    this.key = opts.key;
    this.defaults = opts.defaults;
    this.storage = opts.storage ?? globalThis.localStorage;
    this.onCorruption = opts.onCorruption ?? defaultCorruptionLogger(this.key);
  }

  /**
   * Whether a value has ever been persisted under this key (even a corrupt
   * one). Lets callers distinguish "user saved something" from "running on
   * defaults" — e.g. first-run seeding only applies when nothing is stored.
   */
  isStored(): boolean {
    try {
      return (this.storage?.getItem(this.key) ?? null) !== null;
    } catch {
      return false;
    }
  }

  get(): T {
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
      } as T;
    }
    return parsed as T;
  }

  set(value: T): void {
    try {
      this.storage?.setItem(this.key, JSON.stringify(value));
    } catch {
      return;
    }
    this.listeners.forEach((cb) => {
      cb(value);
    });
  }

  patch(partial: Partial<T>): void {
    const current = this.get();
    if (
      current !== null &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      const next = { ...(current as object), ...(partial as object) } as T;
      this.set(next);
      return;
    }
    this.set(partial as T);
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

  subscribe(cb: (value: T) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private cloneDefaults(): T {
    if (
      this.defaults !== null &&
      typeof this.defaults === "object" &&
      !Array.isArray(this.defaults)
    ) {
      return { ...(this.defaults as object) } as T;
    }
    return this.defaults;
  }
}

function defaultCorruptionLogger(
  key: string,
): (raw: string, error: unknown) => void {
  return (raw, error) => {
    getHost()
      .logger.tag("storage")
      .warn(`Corrupt JSON for ${key} — using defaults`, {
        raw: raw.length > 200 ? `${raw.slice(0, 200)}...` : raw,
        error,
      });
  };
}
