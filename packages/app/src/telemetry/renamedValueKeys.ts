/**
 * Value keys that have been renamed, and the two deserialisers that apply them.
 *
 * The widget-id twin of this is `RENAMED_COMPONENT_IDS`, and the convention is
 * the same: when a key an operator can PICK stops being offered, add an entry
 * here rather than leaving saved configs pointing at a name the picker can no
 * longer produce. Key = the retired spelling, value = what it is now.
 *
 * A saved key does not have to be broken to be worth migrating. The first two
 * below still resolve and still fire, but they are no longer in the picker, so
 * an operator who lost one could not make it again; and the wire spelling they
 * move to is the one carrying a reckoning, so the migration is also what hands
 * an existing alarm or graph the band its key never had.
 *
 * An entry belongs here only when the target is the SAME quantity. A derived
 * key with no wire twin is left to `DataKeyPicker`, which shows a saved key
 * the catalogue no longer offers as "no longer available": pointing a saved
 * threshold at a near-neighbour would hand the operator a plausible number
 * about something else, which is worse than being told the key is gone.
 */
export const RENAMED_VALUE_KEYS: Readonly<Record<string, string>> =
  Object.freeze({
    "vessel.state.altitudeAsl": "vessel.flight.altitudeAsl",
    "vessel.state.orbitalSpeed": "vessel.flight.orbitalSpeed",
    "vessel.state.verticalSpeed": "vessel.flight.verticalSpeed",
    "vessel.state.surfaceSpeed": "vessel.flight.surfaceSpeed",
  });

/** Map one saved value key forward. Identity fallback, and idempotent. */
export function migrateValueKey(key: string): string {
  return RENAMED_VALUE_KEYS[key] ?? key;
}
