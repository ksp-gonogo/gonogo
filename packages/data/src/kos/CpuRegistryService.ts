import type { Screen } from "@gonogo/core";

/**
 * Per-screen registry of kOS CPU tagnames the user has named or that
 * discovery has surfaced. The point is to centralise CPU labelling: a
 * tagname is a bare string that appears on every kOS widget, but
 * "what does this CPU do?" lives nowhere otherwise. The registry lets
 * a user describe each CPU once and then pick from the list.
 *
 * Discovery (the kOS top-level menu, parsed by KosDataSource) feeds in
 * tagnames it has seen on currently-loaded vessels and they are merged
 * as registry entries with `lastSeenAt` set. Entries are never removed
 * by discovery — a CPU on an unloaded craft just stops being "online";
 * the user-supplied name and description persist.
 *
 * Per-screen storage is intentional: a station can keep its own
 * private list of CPU labels distinct from the main screen.
 */
export interface KosCpuEntry {
  /** Unique key used by widgets when dispatching kerboscripts. */
  tagname: string;
  /** Optional human-friendly name for the picker UI. */
  label?: string;
  /** Optional free-text description ("flight computer", "lander", etc.). */
  description?: string;
  /** ms — most recent moment discovery saw this CPU in the kOS menu. */
  lastSeenAt?: number;
  /** ms — when the entry was first created. */
  createdAt: number;
  /**
   * True if discovery currently sees this CPU on the active vessel.
   * Derived from the in-memory online set; not persisted. Stale across
   * a page reload — `lastSeenAt` is the persisted half of the signal.
   */
  online: boolean;
}

type Listener = () => void;

function storageKeyFor(screen: Screen): string {
  return `gonogo.kos.cpus.${screen}`;
}

/** Stored shape — the persisted half of an entry, without the in-memory `online` flag. */
type StoredEntry = Omit<KosCpuEntry, "online">;

function isStoredEntry(value: unknown): value is StoredEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.tagname === "string" && typeof v.createdAt === "number";
}

export class CpuRegistryService {
  private entries: StoredEntry[] = [];
  /** Tagnames currently visible in the kOS top-level menu. Transient. */
  private onlineSet = new Set<string>();
  private listeners = new Set<Listener>();
  private storage: Storage;
  private screen: Screen;

  constructor(screen: Screen, storage: Storage = globalThis.localStorage) {
    this.screen = screen;
    this.storage = storage;
    this.load();
  }

  list(): readonly KosCpuEntry[] {
    // Sort: online first; then by recency of lastSeenAt; then alphabetical
    // by label/tagname. Online-first matters for the picker — the CPUs the
    // user can actually run a script on right now should sit at the top.
    const decorated = this.entries.map((e) => this.decorate(e));
    return decorated.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      const aSeen = a.lastSeenAt ?? 0;
      const bSeen = b.lastSeenAt ?? 0;
      if (aSeen !== bSeen) return bSeen - aSeen;
      return labelOf(a).localeCompare(labelOf(b));
    });
  }

  get(tagname: string): KosCpuEntry | undefined {
    const stored = this.entries.find((e) => e.tagname === tagname);
    return stored ? this.decorate(stored) : undefined;
  }

  /**
   * Insert or update an entry by tagname. Use this for user-driven edits;
   * discovery uses {@link reportOnline} for transient online state.
   */
  upsert(input: {
    tagname: string;
    label?: string;
    description?: string;
  }): KosCpuEntry {
    const tagname = input.tagname.trim();
    if (!tagname) {
      throw new Error("CpuRegistryService.upsert: tagname is required");
    }
    const existing = this.entries.find((e) => e.tagname === tagname);
    if (existing) {
      existing.label = input.label?.trim() || undefined;
      existing.description = input.description?.trim() || undefined;
      this.persist();
      this.emit();
      return this.decorate(existing);
    }
    const stored: StoredEntry = {
      tagname,
      label: input.label?.trim() || undefined,
      description: input.description?.trim() || undefined,
      createdAt: Date.now(),
    };
    this.entries.push(stored);
    this.persist();
    this.emit();
    return this.decorate(stored);
  }

  remove(tagname: string): void {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.tagname !== tagname);
    this.onlineSet.delete(tagname);
    if (this.entries.length !== before) {
      this.persist();
      this.emit();
    }
  }

  /**
   * Additive: stamps `lastSeenAt` and marks online. Doesn't touch other
   * entries' online state. Useful when something has confirmed presence
   * of one specific CPU (e.g. a successful executeScript).
   */
  markSeen(tagname: string, at: number = Date.now()): void {
    const trimmed = tagname.trim();
    if (!trimmed) return;
    const existing = this.entries.find((e) => e.tagname === trimmed);
    if (existing) {
      existing.lastSeenAt = at;
    } else {
      this.entries.push({
        tagname: trimmed,
        lastSeenAt: at,
        createdAt: at,
      });
    }
    this.onlineSet.add(trimmed);
    this.persist();
    this.emit();
  }

  /**
   * Replace the in-memory online set with `tagnames`. Stamps `lastSeenAt`
   * for everything in the new set; entries previously online but not in
   * the new set become offline (their `lastSeenAt` is untouched, so the
   * picker can still show "last seen N min ago"). Unknown tagnames get
   * bare entries created — discovery shouldn't lose data.
   *
   * This is the canonical hook for the kOS menu peek: "these are the
   * CPUs kOS is currently exposing on the active vessel."
   */
  reportOnline(tagnames: readonly string[], at: number = Date.now()): void {
    const next = new Set<string>();
    let changed = false;
    for (const raw of tagnames) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      next.add(trimmed);
      const existing = this.entries.find((e) => e.tagname === trimmed);
      if (existing) {
        existing.lastSeenAt = at;
      } else {
        this.entries.push({
          tagname: trimmed,
          lastSeenAt: at,
          createdAt: at,
        });
      }
      changed = true;
    }
    // Detect online-set changes even when no entries were stamped (e.g. the
    // last visible CPU disappeared and `tagnames` is empty).
    if (
      next.size !== this.onlineSet.size ||
      [...next].some((t) => !this.onlineSet.has(t)) ||
      [...this.onlineSet].some((t) => !next.has(t))
    ) {
      changed = true;
    }
    this.onlineSet = next;
    if (changed) {
      this.persist();
      this.emit();
    }
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private decorate(stored: StoredEntry): KosCpuEntry {
    return { ...stored, online: this.onlineSet.has(stored.tagname) };
  }

  private load(): void {
    const raw = this.storage.getItem(storageKeyFor(this.screen));
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        this.entries = parsed.filter(isStoredEntry);
      }
    } catch {
      // Corrupt JSON shouldn't wedge the screen — drop the key.
      this.storage.removeItem(storageKeyFor(this.screen));
    }
  }

  private persist(): void {
    this.storage.setItem(
      storageKeyFor(this.screen),
      JSON.stringify(this.entries),
    );
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

function labelOf(entry: KosCpuEntry): string {
  return entry.label ?? entry.tagname;
}
