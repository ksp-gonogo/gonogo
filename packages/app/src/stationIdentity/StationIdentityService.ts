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

/** Mission control keeps the original key; the pilot seat has its own, so two seats in one browser never share a name. */
function nameKeyFor(seat?: string): string {
  return seat && seat !== "mission-control" ? `${NAME_KEY}.${seat}` : NAME_KEY;
}
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
  /** Whether the name was typed by an operator, as opposed to being what the device is called until someone names it. */
  private explicit = false;
  private listeners = new Set<NameListener>();
  private readonly storage: Storage;
  private readonly nameKey: string;

  /**
   * `defaultName` is what a device that has never been named is called. It
   * exists because the main screen and a pilot page are participants in the
   * shared thread too, and "Station ABCD" is the wrong thing to call the
   * operator running the mission from KSC.
   */
  constructor(
    storage: Storage = globalThis.localStorage,
    defaultName?: string,
    seat?: string,
  ) {
    this.storage = storage;
    this.nameKey = nameKeyFor(seat);

    const saved = storage.getItem(this.nameKey);
    if (saved?.trim()) {
      this.name = saved.trim();
      this.explicit = true;
      return;
    }

    if (defaultName !== undefined) {
      // Not stored: it is only what the device is called until someone names it, so it can follow where the screen sits.
      this.name = defaultName;
      return;
    }
    this.name = `Station ${generateSuffix()}`;
    storage.setItem(this.nameKey, this.name);
    this.explicit = true;
  }

  getName(): string {
    return this.name;
  }

  /** The name an operator typed, or `undefined` while the device only has the name it started with. */
  getExplicitName(): string | undefined {
    return this.explicit ? this.name : undefined;
  }

  setName(next: string): void {
    const trimmed = next.trim();
    if (!trimmed || (this.explicit && trimmed === this.name)) return;
    this.explicit = true;
    this.name = trimmed;
    this.storage.setItem(this.nameKey, trimmed);
    for (const listener of this.listeners) listener(trimmed);
  }

  onChange(listener: NameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
