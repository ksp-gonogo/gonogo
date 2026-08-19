/**
 * Shared, dependency-free key/value settings for the whole app.
 *
 * Owned by this package, the leaf everything else depends on, so every package
 * AND every Uplink reads the SAME authoritative value: `gameHost` is the one host
 * the mod runs on, and two answers to that question is not a degraded experience,
 * it is an Uplink dialling nothing. `setSetting` and `subscribeSetting` were
 * already published as host shims for exactly that reason; `resetSettingsForTests`
 * was not, so an Uplink's test could not clear the store between cases without
 * importing `@ksp-gonogo/core`, which is `private: true`.
 *
 * Two runtime layers:
 *
 *   getSetting(key) = saved ?? seed
 *
 * - saved: persisted to localStorage (`gonogo.settings`); a user's Settings
 *   write; wins forever on this browser.
 * - seed: in-memory only (never persisted); set at runtime from the bundle's
 *   KSP_HOST so changing that env + restarting takes effect on next load,
 *   never stuck behind a stale saved value.
 *
 * The build-time default is NOT a layer here, a typed accessor (e.g.
 * `getGameHost`) supplies it at the call site, so this store needs no per-key
 * defaults registry and stays fully generic.
 *
 * This is the bottom layer and cannot use `@ksp-gonogo/data`'s
 * `LocalStorageStore`, so it talks to `localStorage` directly.
 */

const STORAGE_KEY = "gonogo.settings";
const SCHEMA_VERSION = 1;

interface SettingsBlob {
  version: number;
  values: Record<string, string>;
}

/**
 * The single global slot the two IN-MEMORY layers live in, keyed by a string so
 * two different builds of this package still find the same state.
 *
 * The SAVED layer needs no such treatment: `localStorage` is already one shared
 * object, so a second bundle reads the same blob. The seed layer and the
 * subscriber sets are plain memory, and a second copy of those is precisely the
 * `gameHost` split this store exists to prevent: an Uplink seeded through its own
 * copy would dial a host the app never saw, and a subscriber registered in one copy
 * would never fire for a write to the other.
 */
const SETTINGS_STATE_KEY = "__GONOGO_SETTINGS_STATE__" as const;

interface SettingsState {
  /** In-memory seed layer: deliberately never written to localStorage. */
  seedLayer: Map<string, string>;
  /** Per-key subscriber sets. */
  listeners: Map<string, Set<() => void>>;
}

function state(): SettingsState {
  const slot = globalThis as typeof globalThis & {
    [SETTINGS_STATE_KEY]?: SettingsState;
  };
  slot[SETTINGS_STATE_KEY] ??= {
    seedLayer: new Map(),
    listeners: new Map(),
  };
  return slot[SETTINGS_STATE_KEY];
}

function readBlob(): SettingsBlob {
  if (typeof localStorage === "undefined") {
    return { version: SCHEMA_VERSION, values: {} };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: SCHEMA_VERSION, values: {} };
    const parsed = JSON.parse(raw) as Partial<SettingsBlob>;
    return {
      version:
        typeof parsed.version === "number" ? parsed.version : SCHEMA_VERSION,
      values:
        parsed.values && typeof parsed.values === "object"
          ? (parsed.values as Record<string, string>)
          : {},
    };
  } catch {
    return { version: SCHEMA_VERSION, values: {} };
  }
}

function writeBlob(values: Record<string, string>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: SCHEMA_VERSION,
        values,
      } satisfies SettingsBlob),
    );
  } catch {
    /* storage full / disabled: in-memory read still works this session */
  }
}

function notify(key: string): void {
  const set = state().listeners.get(key);
  if (!set) return;
  for (const cb of set) cb();
}

/** `saved ?? seed`; `undefined` if neither. The build default is the caller's. */
export function getSetting(key: string): string | undefined {
  const saved = readBlob().values[key];
  if (saved !== undefined) return saved;
  return state().seedLayer.get(key);
}

/** Persist a user-chosen value (the "saved" layer). Wins forever on this browser. */
export function setSetting(key: string, value: string): void {
  const values = readBlob().values;
  values[key] = value;
  writeBlob(values);
  notify(key);
}

/** Set the in-memory seed layer (NOT persisted). Overridden by a saved value. */
export function seedSetting(key: string, value: string): void {
  state().seedLayer.set(key, value);
  notify(key);
}

/** Subscribe to any change (save OR seed) for one key. */
export function subscribeSetting(key: string, cb: () => void): () => void {
  const { listeners } = state();
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(cb);
  return () => set?.delete(cb);
}

/** Test-only: clear the persisted blob and the in-memory seed layer. */
export function resetSettingsForTests(): void {
  state().seedLayer.clear();
  if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
}
