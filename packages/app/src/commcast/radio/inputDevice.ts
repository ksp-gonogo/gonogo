/**
 * Which microphone this screen transmits from, across page loads.
 *
 * Stored, and keyed, exactly as the monitor's mute exceptions are, because it
 * is the same kind of fact: a decision about this console's audio, made by the
 * operator sitting at it, and one that would be quietly undone by a reload it
 * did not survive. An operator who plugged in a headset and chose it should not
 * find their next press going out through the laptop's own microphone, into a
 * room, because the tab was refreshed.
 *
 * Keyed on the STATION key for the reason `monitor.ts` gives: two tabs on one
 * browser are two consoles, and they may well have two different headsets.
 *
 * `null` means the browser's default, which is what a screen that has never
 * chosen gets, and what a screen whose storage is unreadable gets. That is the
 * safe reading of an absent setting: a default input exists on every machine
 * that has one at all, where a remembered id belongs to a device that may since
 * have been unplugged.
 */

const STORAGE_PREFIX = "gonogo.commcast.radio.input.v1.";

function storageFor(given?: Storage): Storage | undefined {
  if (given !== undefined) return given;
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

/** The input this screen transmits from, or `null` for the browser's default. */
export function loadInputDevice(
  screenKey: string,
  storage?: Storage,
): string | null {
  const store = storageFor(storage);
  if (store === undefined) return null;
  try {
    const raw = store.getItem(STORAGE_PREFIX + screenKey);
    // An empty string is not a device id: `enumerateDevices` uses it for an
    // entry that names nothing openable, and the picker drops those.
    return raw === null || raw === "" ? null : raw;
  } catch {
    return null;
  }
}

/** Remember the choice. Silent where storage is refused, as the mute is. */
export function saveInputDevice(
  screenKey: string,
  deviceId: string | null,
  storage?: Storage,
): void {
  const store = storageFor(storage);
  if (store === undefined) return;
  try {
    if (deviceId === null || deviceId === "") {
      store.removeItem(STORAGE_PREFIX + screenKey);
      return;
    }
    store.setItem(STORAGE_PREFIX + screenKey, deviceId);
  } catch {
    // The choice holds for this page load either way.
  }
}
