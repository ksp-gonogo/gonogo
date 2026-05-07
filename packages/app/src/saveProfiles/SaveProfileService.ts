/**
 * Save profile management — persistent game-save slots.
 *
 * Scope for v1: profiles only scope map exploration (fog masks) plus basic
 * identity metadata. Dashboard layout, data source config, and station config
 * remain global. The API is shaped so we can extend what profiles carry later
 * without breaking consumers.
 *
 * Storage: localStorage only (profile list + active id — small, synchronous).
 * Large per-body state (fog masks) is kept in IndexedDB keyed by profile id.
 */

import { safeRandomUuid } from "@gonogo/core";
import { LocalStorageStore } from "@gonogo/data";

const PROFILES_KEY = "gonogo.saveProfiles.list";
const ACTIVE_KEY = "gonogo.saveProfiles.active";
const DEFAULT_NAME = "Survey Profile 1";

export interface SaveProfile {
  id: string;
  name: string;
  createdAt: number;
  lastPlayed: number;
}

type ProfilesListener = () => void;
type ActiveListener = (profileId: string) => void;

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return safeRandomUuid();
  }
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export class SaveProfileService {
  private profiles = new Map<string, SaveProfile>();
  private activeId: string;
  private storage: Storage;
  private profilesStore: LocalStorageStore<SaveProfile[]>;

  private profilesListeners = new Set<ProfilesListener>();
  private activeListeners = new Set<ActiveListener>();

  constructor(storage: Storage = globalThis.localStorage) {
    this.storage = storage;
    this.profilesStore = new LocalStorageStore<SaveProfile[]>({
      key: PROFILES_KEY,
      defaults: [],
      storage,
    });
    this.load();
    if (this.profiles.size === 0) {
      const seed = this.createInternal(DEFAULT_NAME);
      this.activeId = seed.id;
      this.save();
    } else {
      // Recover an invalid activeId (e.g. manually cleared) by picking the
      // most-recently-played profile.
      const stored = this.storage.getItem(ACTIVE_KEY);
      if (stored && this.profiles.has(stored)) {
        this.activeId = stored;
      } else {
        this.activeId = this.pickFallbackActive();
        this.save();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  getAll(): SaveProfile[] {
    return Array.from(this.profiles.values()).sort(
      (a, b) => b.lastPlayed - a.lastPlayed,
    );
  }

  get(id: string): SaveProfile | undefined {
    return this.profiles.get(id);
  }

  getActiveId(): string {
    return this.activeId;
  }

  getActive(): SaveProfile {
    const profile = this.profiles.get(this.activeId);
    if (!profile) {
      // Should be impossible — the constructor guarantees a valid active id —
      // but narrow the type and recover if it ever happens.
      const fallback = this.pickFallbackActive();
      this.activeId = fallback;
      this.save();
      const resolved = this.profiles.get(fallback);
      if (!resolved) throw new Error("SaveProfileService: no profiles exist");
      return resolved;
    }
    return profile;
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  create(name: string): SaveProfile {
    const profile = this.createInternal(name);
    this.save();
    this.emitProfilesChange();
    return profile;
  }

  rename(id: string, name: string): void {
    const existing = this.profiles.get(id);
    if (!existing) return;
    this.profiles.set(id, { ...existing, name });
    this.save();
    this.emitProfilesChange();
  }

  /**
   * Delete a profile. If the deleted profile was active, auto-switch to the
   * next-most-recently-played one; if none remain, create a fresh default
   * so the app never has a null active state.
   */
  remove(id: string): void {
    if (!this.profiles.has(id)) return;
    this.profiles.delete(id);
    let activeChanged = false;
    if (this.activeId === id) {
      if (this.profiles.size === 0) {
        const seed = this.createInternal(DEFAULT_NAME);
        this.activeId = seed.id;
      } else {
        this.activeId = this.pickFallbackActive();
      }
      activeChanged = true;
    }
    this.save();
    this.emitProfilesChange();
    if (activeChanged) this.emitActiveChange();
  }

  setActive(id: string): void {
    if (!this.profiles.has(id) || this.activeId === id) return;
    const existing = this.profiles.get(id);
    if (existing) {
      this.profiles.set(id, { ...existing, lastPlayed: Date.now() });
    }
    this.activeId = id;
    this.save();
    this.emitProfilesChange();
    this.emitActiveChange();
  }

  /** Update `lastPlayed` on the active profile. Called at most once per session. */
  touchActive(): void {
    const existing = this.profiles.get(this.activeId);
    if (!existing) return;
    this.profiles.set(this.activeId, { ...existing, lastPlayed: Date.now() });
    this.save();
  }

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  onProfilesChange(listener: ProfilesListener): () => void {
    this.profilesListeners.add(listener);
    return () => this.profilesListeners.delete(listener);
  }

  onActiveChange(listener: ActiveListener): () => void {
    this.activeListeners.add(listener);
    return () => this.activeListeners.delete(listener);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private createInternal(name: string): SaveProfile {
    const now = Date.now();
    const profile: SaveProfile = {
      id: generateId(),
      name,
      createdAt: now,
      lastPlayed: now,
    };
    this.profiles.set(profile.id, profile);
    return profile;
  }

  private pickFallbackActive(): string {
    return this.getAll()[0].id;
  }

  private load(): void {
    const parsed = this.profilesStore.get();
    if (Array.isArray(parsed)) {
      for (const p of parsed) {
        if (typeof p?.id === "string" && typeof p?.name === "string") {
          this.profiles.set(p.id, p);
        }
      }
    }
  }

  private save(): void {
    this.profilesStore.set(Array.from(this.profiles.values()));
    this.storage.setItem(ACTIVE_KEY, this.activeId);
  }

  private emitProfilesChange(): void {
    for (const l of this.profilesListeners) l();
  }

  private emitActiveChange(): void {
    for (const l of this.activeListeners) l(this.activeId);
  }
}
