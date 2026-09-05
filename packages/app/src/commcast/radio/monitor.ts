/**
 * Which voice loops this screen is monitoring, across page loads.
 *
 * Everything is monitored by default and a mute is the operator's explicit
 * departure from that, so what is stored is the exceptions: the empty set is
 * "hear everybody", which is what a fresh screen and a screen whose storage was
 * cleared both get.
 *
 * It has to persist for the same reason it is not tied to the open thread. A
 * mute is a decision about who this operator listens to, not a property of the
 * view they happen to be in, and a decision that evaporated on reload would
 * quietly put a loop they had tuned out back in their ear.
 *
 * Keyed on the STATION key, the same identity `CommcastLog` files a screen's
 * own mail under: two tabs on one browser are two operators at two consoles and
 * are entitled to tune differently.
 */

const STORAGE_PREFIX = "gonogo.commcast.radio.muted.v1.";

function storageFor(given?: Storage): Storage | undefined {
  if (given !== undefined) return given;
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

/** The conversations this screen has tuned out, by thread key. */
export function loadMutedThreads(
  screenKey: string,
  storage?: Storage,
): ReadonlySet<string> {
  const store = storageFor(storage);
  if (store === undefined) return new Set();
  try {
    const raw = store.getItem(STORAGE_PREFIX + screenKey);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((k): k is string => typeof k === "string"));
  } catch {
    /*
     * A quota error, a private-browsing refusal or something else's key at this
     * name. Hearing everybody is the safe reading of an unreadable setting: a
     * radio that came back silent because its storage was odd would look like a
     * dead correspondent.
     */
    return new Set();
  }
}

/** Record the tuning. Silent where storage is refused, for the same reason. */
export function saveMutedThreads(
  screenKey: string,
  keys: ReadonlySet<string>,
  storage?: Storage,
): void {
  const store = storageFor(storage);
  if (store === undefined) return;
  try {
    store.setItem(STORAGE_PREFIX + screenKey, JSON.stringify([...keys]));
  } catch {
    // Nothing to do and nothing worth saying: the operator's mute holds for
    // this page load either way.
  }
}
