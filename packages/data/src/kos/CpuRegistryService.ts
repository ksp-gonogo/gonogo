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
}

type Listener = () => void;

function storageKeyFor(screen: Screen): string {
  return `gonogo.kos.cpus.${screen}`;
}

function isEntry(value: unknown): value is KosCpuEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.tagname === "string" && typeof v.createdAt === "number";
}

export class CpuRegistryService {
  private entries: KosCpuEntry[] = [];
  private listeners = new Set<Listener>();
  private storage: Storage;
  private screen: Screen;

  constructor(screen: Screen, storage: Storage = globalThis.localStorage) {
    this.screen = screen;
    this.storage = storage;
    this.load();
  }

  list(): readonly KosCpuEntry[] {
    // Sort: online entries first (lastSeenAt within the freshness window),
    // then offline-but-known. Within each band, alphabetical by label/tagname.
    return [...this.entries].sort((a, b) => {
      const aSeen = a.lastSeenAt ?? 0;
      const bSeen = b.lastSeenAt ?? 0;
      if (aSeen !== bSeen) return bSeen - aSeen;
      return labelOf(a).localeCompare(labelOf(b));
    });
  }

  get(tagname: string): KosCpuEntry | undefined {
    return this.entries.find((e) => e.tagname === tagname);
  }

  /**
   * Insert or update an entry by tagname. Use this for user-driven edits;
   * discovery uses {@link markSeen} which only stamps `lastSeenAt`.
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
      return existing;
    }
    const entry: KosCpuEntry = {
      tagname,
      label: input.label?.trim() || undefined,
      description: input.description?.trim() || undefined,
      createdAt: Date.now(),
    };
    this.entries.push(entry);
    this.persist();
    this.emit();
    return entry;
  }

  remove(tagname: string): void {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.tagname !== tagname);
    if (this.entries.length !== before) {
      this.persist();
      this.emit();
    }
  }

  /**
   * Discovery hook. Stamps `lastSeenAt = now` on the named entry,
   * creating a bare entry if the tagname is new. Never removes entries —
   * an unloaded vessel's CPU just stops getting stamps.
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
    this.persist();
    this.emit();
  }

  /** Replace the discovered set in one shot. Anything not in `tagnames`
   * keeps its old `lastSeenAt` (it just doesn't get a new stamp). */
  reportSeen(tagnames: readonly string[], at: number = Date.now()): void {
    if (tagnames.length === 0) return;
    let changed = false;
    for (const raw of tagnames) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
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
    if (changed) {
      this.persist();
      this.emit();
    }
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private load(): void {
    const raw = this.storage.getItem(storageKeyFor(this.screen));
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        this.entries = parsed.filter(isEntry);
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
