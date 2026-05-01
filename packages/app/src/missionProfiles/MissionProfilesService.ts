import type { Screen } from "@gonogo/core";
import { LocalStorageStore } from "@gonogo/data";
import type { Layouts } from "react-grid-layout";
import type { DashboardItem } from "../components/Dashboard";

/**
 * Named dashboard snapshots — "Launch", "Orbit", "Rendezvous", etc. —
 * scoped per-screen (main vs station). A profile bundles the items + per-
 * breakpoint layouts; loading one into the dashboard swaps the whole
 * state in a single tick via `useDashboardState.replaceState`.
 *
 * Storage is partitioned by screen so main and station have independent
 * profile libraries. Profile snapshots are duplicated into localStorage;
 * nothing is shared through the active-dashboard key.
 */

export interface MissionProfile {
  id: string;
  name: string;
  /** Which screen this profile was captured from. */
  screen: Screen;
  items: DashboardItem[];
  layouts: Layouts;
  /** ms — lets the UI sort by recency and detect "did I change this?". */
  updatedAt: number;
}

type Listener = () => void;

function storageKeyFor(screen: Screen): string {
  return `gonogo.missionProfiles.${screen}`;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `mp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export class MissionProfilesService {
  private profiles: MissionProfile[] = [];
  private listeners = new Set<Listener>();
  private store: LocalStorageStore<MissionProfile[]>;
  private screen: Screen;

  constructor(screen: Screen, storage: Storage = globalThis.localStorage) {
    this.screen = screen;
    this.store = new LocalStorageStore<MissionProfile[]>({
      key: storageKeyFor(screen),
      defaults: [],
      storage,
    });
    this.load();
  }

  list(): readonly MissionProfile[] {
    return [...this.profiles].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): MissionProfile | undefined {
    return this.profiles.find((p) => p.id === id);
  }

  save(name: string, items: DashboardItem[], layouts: Layouts): MissionProfile {
    const trimmed = name.trim() || "Untitled profile";
    const profile: MissionProfile = {
      id: generateId(),
      name: trimmed,
      screen: this.screen,
      items,
      layouts,
      updatedAt: Date.now(),
    };
    this.profiles.push(profile);
    this.persist();
    this.emit();
    return profile;
  }

  update(
    id: string,
    patch: Partial<Pick<MissionProfile, "name" | "items" | "layouts">>,
  ): void {
    const idx = this.profiles.findIndex((p) => p.id === id);
    if (idx < 0) return;
    this.profiles[idx] = {
      ...this.profiles[idx],
      ...patch,
      name: patch.name?.trim() || this.profiles[idx].name,
      updatedAt: Date.now(),
    };
    this.persist();
    this.emit();
  }

  remove(id: string): void {
    const before = this.profiles.length;
    this.profiles = this.profiles.filter((p) => p.id !== id);
    if (this.profiles.length !== before) {
      this.persist();
      this.emit();
    }
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private load(): void {
    const stored = this.store.get();
    if (Array.isArray(stored)) {
      this.profiles = stored.filter(
        (p): p is MissionProfile =>
          typeof p?.id === "string" && typeof p?.name === "string",
      );
    }
  }

  private persist(): void {
    this.store.set(this.profiles);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
