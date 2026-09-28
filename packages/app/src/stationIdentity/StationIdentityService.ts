/**
 * Station identity: a user-editable name for this station screen, kept in
 * localStorage so it survives reload.
 *
 * The station's PeerJS peer id already exists (assigned by the broker), but
 * it's opaque and changes per session. The name is a human-readable handle
 * for things like GO/NO-GO aggregation and abort attribution.
 *
 * Storage key: `gonogo.station.name`.
 */

const NAME_KEY = "gonogo.station.name";
const SUFFIX_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateSuffix(): string {
  return Array.from(
    { length: 4 },
    () => SUFFIX_CHARS[Math.floor(Math.random() * SUFFIX_CHARS.length)],
  ).join("");
}

type NameListener = (name: string) => void;

export class StationIdentityService {
  private name: string;
  private listeners = new Set<NameListener>();
  private readonly storage: Storage;

  /**
   * `defaultName` is what a device that has never been named is called. It
   * exists because the main screen and a pilot page are participants in the
   * shared thread too, and "Station ABCD" is the wrong thing to call the
   * operator running the mission from KSC.
   */
  constructor(
    storage: Storage = globalThis.localStorage,
    defaultName?: string,
  ) {
    this.storage = storage;

    const saved = storage.getItem(NAME_KEY);
    if (saved?.trim()) {
      this.name = saved.trim();
      return;
    }

    this.name = defaultName ?? `Station ${generateSuffix()}`;
    storage.setItem(NAME_KEY, this.name);
  }

  getName(): string {
    return this.name;
  }

  setName(next: string): void {
    const trimmed = next.trim();
    if (!trimmed || trimmed === this.name) return;
    this.name = trimmed;
    this.storage.setItem(NAME_KEY, trimmed);
    for (const listener of this.listeners) listener(trimmed);
  }

  onChange(listener: NameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
