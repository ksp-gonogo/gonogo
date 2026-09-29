import type { StationBrokerAttach } from "./types";

/** Called by the screen watching the registry, once per registration it sees. */
type StationBrokerWatcher = (
  uplinkId: string,
  attach: StationBrokerAttach,
) => void;

interface Slot {
  attaches: Map<string, StationBrokerAttach>;
  watchers: Set<StationBrokerWatcher>;
}

/**
 * A `globalThis` slot keyed by a string, like the handle registry, so an Uplink
 * bundle and the app find the same registrations whichever copy of this
 * package each was built against.
 */
const STATION_BROKERS_KEY = "__GONOGO_STATION_BROKERS__" as const;

function slot(): Slot {
  const g = globalThis as typeof globalThis & {
    [STATION_BROKERS_KEY]?: Slot;
  };
  g[STATION_BROKERS_KEY] ??= { attaches: new Map(), watchers: new Set() };
  return g[STATION_BROKERS_KEY];
}

/**
 * Ask to be handed a {@link StationBroker} whenever this screen is a station.
 *
 * For an Uplink whose client keeps a long-lived object outside React, such as a
 * media connection, and so cannot use `useUplinkRelay` or `useHostIceServers`.
 * `attach` is never called on the main screen, and is called on a station
 * whether the Uplink registered before the station screen came up or after.
 * The broker can arrive before the link to the main screen does, and `relay`
 * rejects until it is up, so a caller retries rather than giving up.
 *
 *   registerStationBroker("my-uplink", ({ relay, iceServers }) =>
 *     mySource.routeThrough(relay, iceServers));
 *
 * Last write wins: registering the same id again replaces the previous attach,
 * and a station already up is handed the new one.
 *
 * @category Registering
 */
export function registerStationBroker(
  uplinkId: string,
  attach: StationBrokerAttach,
): void {
  const { attaches, watchers } = slot();
  attaches.set(uplinkId, attach);
  for (const watcher of watchers) watcher(uplinkId, attach);
}

/**
 * Remove a registration, so a station that comes up later does not attach it.
 * No-op if none was registered.
 *
 * @category Registering
 */
export function unregisterStationBroker(uplinkId: string): void {
  slot().attaches.delete(uplinkId);
}

/**
 * Remove every registration and every watcher. For tests; a running app never
 * calls it.
 *
 * @category Registering
 */
export function clearStationBrokers(): void {
  const { attaches, watchers } = slot();
  attaches.clear();
  watchers.clear();
}

/**
 * Hand every registration, present and future, to `watcher`, until the
 * returned function is called. The station screen's half of
 * `registerStationBroker`; an Uplink never calls it.
 */
export function watchStationBrokers(watcher: StationBrokerWatcher): () => void {
  const { attaches, watchers } = slot();
  watchers.add(watcher);
  for (const [uplinkId, attach] of attaches) watcher(uplinkId, attach);
  return () => {
    watchers.delete(watcher);
  };
}
