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
 * Stores one object under an Uplink's id, so code elsewhere can find it with
 * {@link getUplinkHandle} without importing the Uplink's own module: a client
 * for the Uplink's own server, say. Useful for letting a station's call to an
 * Uplink reach the object on the main screen. The object can be anything;
 * whoever reads it knows its shape. A second call for the same id replaces the
 * first.
 *
 * For {@link useUplinkRelay} to reach the object, it needs a
 * `relay(method, args)` function that returns a promise.
 *
 * @category Registering
 */
export function registerUplinkHandle<Handle>(
  uplinkId: string,
  handle: Handle,
): void {
  handles().set(uplinkId, handle);
}

/**
 * The object {@link registerUplinkHandle} stored under `uplinkId`, typed as
 * `Handle`, or `undefined` if there is none. Used by the main screen when it
 * answers a station's call to an Uplink.
 *
 * @category Registering
 */
export function getUplinkHandle<Handle = unknown>(
  uplinkId: string,
): Handle | undefined {
  return handles().get(uplinkId) as Handle | undefined;
}

/**
 * Removes the object stored under `uplinkId`, so {@link getUplinkHandle} no
 * longer finds it. Does nothing if there is none. Useful for an Uplink that
 * shuts down and should stop answering a station's calls.
 *
 * @category Registering
 */
export function unregisterUplinkHandle(uplinkId: string): void {
  handles().delete(uplinkId);
}

/**
 * Removes every object stored with {@link registerUplinkHandle}. Useful for
 * resetting between tests; a running app never calls it. Re-exported by the
 * SDK's testing helpers.
 *
 * @category Registering
 */
export function clearUplinkHandles(): void {
  handles().clear();
}
