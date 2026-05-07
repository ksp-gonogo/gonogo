/**
 * Station identity vs. session peer id.
 *
 * - **stationKey** (persistent, in localStorage) is the stable identity for
 *   the device. Used by anything that wants continuity across refreshes —
 *   today nothing reads it directly; in future GO/NO-GO state could re-key
 *   on it to collapse the brief "ghost station" window after a refresh.
 *
 * - **stationPeerId** (per-session, derived) is the id the station claims
 *   on the PeerJS broker. We append a session token so a hard refresh is
 *   guaranteed to hit a fresh broker entry — this dodges the "ID is taken"
 *   stall the broker imposes for ~60 s when the previous WS hasn't been
 *   reaped yet (e.g. tab refresh, force close).
 *
 * Background: previously the broker peer id WAS the persistent identity.
 * On hard refresh the new page tried to claim the same id, the broker
 * rejected with `unavailable-id`, and the slow retry loop stalled the
 * station for 60–90 s. Logs from 2026-05-06 captured the symptom on two
 * stations simultaneously.
 */

const STATION_KEY_STORAGE = "gonogo.station.key";
// Legacy storage key — earlier versions stored the full peer id here. We
// migrate it forward as the stationKey so existing devices keep their
// stable identity across the upgrade.
const LEGACY_PEER_ID_STORAGE = "gonogo.station.peer-id";

function generateUuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Stable per-device identity. Survives refresh; only changes when the user
 * explicitly clears it via `clearStationKey()`.
 */
export function getStationKey(
  storage: Storage = globalThis.localStorage,
): string {
  const existing = storage.getItem(STATION_KEY_STORAGE);
  if (existing?.trim()) return existing.trim();

  // Migrate the old persistent peer id forward as the stationKey so a
  // device that had a long-lived id keeps it after the upgrade.
  const legacy = storage.getItem(LEGACY_PEER_ID_STORAGE);
  if (legacy?.trim()) {
    const stripped = legacy.trim().replace(/^station-/, "");
    storage.setItem(STATION_KEY_STORAGE, stripped);
    storage.removeItem(LEGACY_PEER_ID_STORAGE);
    return stripped;
  }

  const id = generateUuid();
  storage.setItem(STATION_KEY_STORAGE, id);
  return id;
}

/**
 * Per-session PeerJS id: `station-<stationKey>-<sessionToken>`. Fresh on
 * every call so each session presents a unique id to the broker. Callers
 * should call this *once* per `Peer` instance and reuse the result.
 */
export function getStationPeerId(
  storage: Storage = globalThis.localStorage,
): string {
  const key = getStationKey(storage);
  const sessionToken = generateUuid().slice(0, 8);
  return `station-${key}-${sessionToken}`;
}

/**
 * Wipe the persistent stationKey so the next session starts as a brand-new
 * device. Irreversible; intended for an explicit "reset this station" UI.
 */
export function clearStationKey(
  storage: Storage = globalThis.localStorage,
): void {
  storage.removeItem(STATION_KEY_STORAGE);
  storage.removeItem(LEGACY_PEER_ID_STORAGE);
}

/** Back-compat alias — call sites that wanted the old "stable" id now get a
 * fresh session id instead. Kept for any external imports. */
export const clearStationPeerId = clearStationKey;
