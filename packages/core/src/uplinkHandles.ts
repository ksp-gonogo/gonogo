/**
 * Generic, mod-agnostic id -> singleton "host handle" registry.
 *
 * This is the shared substrate for anything that needs to register a
 * singleton object under an uplink's id and have it looked up elsewhere,
 * without coupling the lookup site to the uplink's own module. Deliberately
 * has no opinion on what a "handle" looks like (a relay-capable object, a
 * WebRTC client, a future health reporter, whatever) — callers own the
 * shape and narrow it themselves.
 *
 * Not tied to the `DataSource` interface or any specific mod. This file
 * stays mod-agnostic: never import mod-specific types, and never reference
 * a specific mod's name here.
 */

const handles = new Map<string, unknown>();

/**
 * Register a singleton handle for an uplink, keyed by its id. Last write
 * wins — a second `registerUplinkHandle` call for the same id replaces the
 * first.
 */
export function registerUplinkHandle<T>(uplinkId: string, handle: T): void {
  handles.set(uplinkId, handle);
}

/** Look up a previously registered handle by uplink id. `undefined` if none. */
export function getUplinkHandle<T = unknown>(uplinkId: string): T | undefined {
  return handles.get(uplinkId) as T | undefined;
}

/** Remove a previously registered handle. No-op if none was registered. */
export function unregisterUplinkHandle(uplinkId: string): void {
  handles.delete(uplinkId);
}
