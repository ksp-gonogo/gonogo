/**
 * Station identity — a user-editable name for this station screen, kept in
 * localStorage so it survives reload.
 *
 * The station's PeerJS peer id already exists (assigned by the broker), but
 * it's opaque and changes per session. The name is a human-readable handle
 * for things like GO/NO-GO aggregation and abort attribution.
 *
 * Storage key: `gonogo.station.name`. Two one-shot migrations on first
 * construction:
 *   1. From `gonogo.station.name.<active save-profile id>` — the previous
 *      shape, retired when save-profiles were removed.
 *   2. From the original unscoped `gonogo.station.name` legacy key — kept
 *      from before profile-scoping existed (now the same key it migrates
 *      *to*, so this branch is a no-op once both keys collapse).
 */

const NAME_KEY = "gonogo.station.name";
const LEGACY_ACTIVE_PROFILE_KEY = "gonogo.saveProfiles.active";
const SUFFIX_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateSuffix(): string {
  return Array.from(
    { length: 4 },
    () => SUFFIX_CHARS[Math.floor(Math.random() * SUFFIX_CHARS.length)],
  ).join("");
}

function migrateFromSaveProfileScoping(storage: Storage): string | null {
  // Look for `gonogo.station.name.<oldActiveProfileId>` once and migrate it
  // into the flat key. Older builds keyed station identity under the active
  // save-profile UUID; we now have a single station identity per device.
  const oldActive = storage.getItem(LEGACY_ACTIVE_PROFILE_KEY)?.trim();
  if (!oldActive) return null;
  const oldKey = `${NAME_KEY}.${oldActive}`;
  const value = storage.getItem(oldKey)?.trim();
  if (!value) return null;
  storage.setItem(NAME_KEY, value);
  storage.removeItem(oldKey);
  return value;
}

type NameListener = (name: string) => void;

export class StationIdentityService {
  private name: string;
  private listeners = new Set<NameListener>();
  private readonly storage: Storage;

  constructor(storage: Storage = globalThis.localStorage) {
    this.storage = storage;

    const saved = storage.getItem(NAME_KEY);
    if (saved?.trim()) {
      this.name = saved.trim();
      return;
    }

    const migrated = migrateFromSaveProfileScoping(storage);
    if (migrated) {
      this.name = migrated;
      return;
    }

    this.name = `Station ${generateSuffix()}`;
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
