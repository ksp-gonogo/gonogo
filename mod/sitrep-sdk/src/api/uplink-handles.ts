/**
 * Generic, mod-agnostic id -> singleton "host handle" registry.
 *
 * The shared substrate for anything that needs to register a singleton object
 * under an Uplink's id and have it looked up elsewhere, without coupling the
 * lookup site to the Uplink's own module. Deliberately has no opinion on what a
 * "handle" looks like (a relay-capable object, a WebRTC client, a future health
 * reporter, whatever): callers own the shape and narrow it themselves.
 *
 * Never import a mod-specific type here, and never name a specific mod.
 */

/**
 * The single global slot the handles live in, keyed by a string rather than a
 * symbol so two different builds of this package still find the same Map. See
 * `map-poi.ts` for why a module-static one is not safe once this can be bundled.
 */
const UPLINK_HANDLES_KEY = "__GONOGO_UPLINK_HANDLES__" as const;

function handles(): Map<string, unknown> {
  const slot = globalThis as typeof globalThis & {
    [UPLINK_HANDLES_KEY]?: Map<string, unknown>;
  };
  slot[UPLINK_HANDLES_KEY] ??= new Map();
  return slot[UPLINK_HANDLES_KEY];
}

/**
 * Register a singleton handle for an Uplink, keyed by its id. Last write wins: a
 * second call for the same id replaces the first.
 */
export function registerUplinkHandle<T>(uplinkId: string, handle: T): void {
  handles().set(uplinkId, handle);
}

/** Look up a previously registered handle by Uplink id. `undefined` if none. */
export function getUplinkHandle<T = unknown>(uplinkId: string): T | undefined {
  return handles().get(uplinkId) as T | undefined;
}

/** Remove a previously registered handle. No-op if none was registered. */
export function unregisterUplinkHandle(uplinkId: string): void {
  handles().delete(uplinkId);
}

/** Remove every registered handle. For tests; a running app never calls it. */
export function clearUplinkHandles(): void {
  handles().clear();
}
