import type { Screen } from "@ksp-gonogo/core";
import { safeRandomUuid } from "@ksp-gonogo/core";
import { LocalStorageStore } from "@ksp-gonogo/data";
import type { Layout } from "react-grid-layout";
import type { DashboardItem } from "../components/Dashboard";

/**
 * Named dashboard snapshots: "Launch", "Orbit", "Rendezvous", etc.:
 * scoped per-screen (main vs station). A profile bundles the items + the
 * layout; loading one into the dashboard swaps the whole
 * state in a single tick via `useDashboardState.replaceState`.
 *
 * Storage is partitioned by screen so main and station have independent
 * profile libraries. Profile snapshots are duplicated into localStorage;
 * nothing is shared through the active-dashboard key.
 */

/**
 * KSP scene names a profile can bind to. Stored as plain strings so
 * the wire's scene values flow through unchanged. Transient scenes
 * (MainMenu, Loading, Unknown) are intentionally absent, the binding
 * model only ever switches *to* a profile when entering a tagged scene,
 * never away because of one, so there's no use case for binding to a
 * transient.
 */
export const BINDABLE_SCENES = [
  "SpaceCenter",
  "Editor",
  "Flight",
  "TrackingStation",
] as const;

export type BindableScene = (typeof BINDABLE_SCENES)[number];

/** The name a player knows each bindable scene by. */
export const SCENE_LABELS: Record<BindableScene, string> = {
  SpaceCenter: "Space Center",
  Editor: "Editor",
  Flight: "Flight",
  TrackingStation: "Tracking Station",
};

/** The scene as a phrase for a sentence ("Now in flight"). */
export const SCENE_PHRASES: Record<BindableScene, string> = {
  SpaceCenter: "at the Space Center",
  Editor: "in the Editor",
  Flight: "in flight",
  TrackingStation: "at the Tracking Station",
};

export interface MissionProfile {
  id: string;
  name: string;
  /** Which screen this profile was captured from. */
  screen: Screen;
  items: DashboardItem[];
  layout: Layout;
  /**
   * Scenes that should prompt the user to load this profile. Empty /
   * absent = profile is purely manual. Multiple entries are allowed
   * (one profile can serve multiple scenes); when several profiles
   * are tagged for the same scene, the most recently updated wins.
   */
  sceneBindings?: BindableScene[];
  /**
   * When true, a matching scene transition loads this profile
   * immediately instead of showing the "Switch to X?" prompt. Only
   * meaningful when `sceneBindings` is non-empty.
   */
  autoSwitch?: boolean;
  /**
   * True for a layout kept automatically because loading another one would
   * have replaced it before it was saved. Renaming it or overwriting it makes
   * it an ordinary saved layout.
   */
  draft?: boolean;
  /** ms: lets the UI sort by recency and detect "did I change this?". */
  updatedAt: number;
}

/** How many automatically kept layouts are held; the oldest go first. */
export const MAX_DRAFTS = 5;

/** What a layout is, ignoring the grid bookkeeping fields react-grid-layout adds. */
function fingerprint(items: DashboardItem[], layout: Layout): string {
  const byId = (a: { i: string }, b: { i: string }) => a.i.localeCompare(b.i);
  return JSON.stringify([
    [...items].sort(byId),
    layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })).sort(byId),
  ]);
}

type Listener = () => void;

function storageKeyFor(screen: Screen): string {
  return `gonogo.missionProfiles.${screen}`;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return safeRandomUuid();
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

  save(
    name: string,
    items: DashboardItem[],
    layout: Layout,
    sceneBindings: BindableScene[] = [],
    autoSwitch = false,
  ): MissionProfile {
    const trimmed = name.trim() || "Untitled profile";
    const profile: MissionProfile = {
      id: generateId(),
      name: trimmed,
      screen: this.screen,
      items,
      layout,
      sceneBindings: sceneBindings.length > 0 ? [...sceneBindings] : undefined,
      autoSwitch: autoSwitch || undefined,
      updatedAt: Date.now(),
    };
    this.profiles.push(profile);
    this.persist();
    this.emit();
    return profile;
  }

  /**
   * Keeps a dashboard that is about to be replaced, so a layout the operator
   * arranged and never saved can be loaded back from the layouts list. Does
   * nothing for an empty dashboard or one already held by a saved layout.
   * Returns the layout kept, if any.
   */
  saveDraft(items: DashboardItem[], layout: Layout): MissionProfile | null {
    if (items.length === 0) return null;
    const print = fingerprint(items, layout);
    if (this.profiles.some((p) => fingerprint(p.items, p.layout) === print)) {
      return null;
    }
    const draft: MissionProfile = {
      id: generateId(),
      name: "Unsaved layout",
      screen: this.screen,
      items,
      layout,
      draft: true,
      updatedAt: Date.now(),
    };
    const drafts = this.profiles
      .filter((p) => p.draft)
      .sort((a, b) => a.updatedAt - b.updatedAt);
    const dropped = new Set(
      drafts.slice(0, Math.max(0, drafts.length - (MAX_DRAFTS - 1))),
    );
    this.profiles = this.profiles.filter((p) => !dropped.has(p));
    this.profiles.push(draft);
    this.persist();
    this.emit();
    return draft;
  }

  update(
    id: string,
    patch: Partial<
      Pick<
        MissionProfile,
        "name" | "items" | "layout" | "sceneBindings" | "autoSwitch"
      >
    >,
  ): void {
    const idx = this.profiles.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const next = {
      ...this.profiles[idx],
      ...patch,
      name: patch.name?.trim() || this.profiles[idx].name,
      updatedAt: Date.now(),
    };
    // Normalise empty arrays back to undefined so storage stays tidy.
    if (Array.isArray(next.sceneBindings) && next.sceneBindings.length === 0) {
      next.sceneBindings = undefined;
    }
    if (next.autoSwitch !== true) next.autoSwitch = undefined;
    if (patch.name || patch.items || patch.layout) next.draft = undefined;
    this.profiles[idx] = next;
    this.persist();
    this.emit();
  }

  /**
   * Profile that should prompt for the given scene, or undefined.
   * When multiple profiles are tagged for the same scene we resolve to
   * the most recently updated: `list()` already returns newest-first,
   * so the first match in that ordering wins.
   */
  findForScene(scene: string): MissionProfile | undefined {
    return this.list().find((p) =>
      p.sceneBindings?.includes(scene as BindableScene),
    );
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
      this.profiles = stored
        .filter(
          (p): p is MissionProfile =>
            typeof p?.id === "string" && typeof p?.name === "string",
        )
        .map((saved) => {
          const p = Array.isArray(saved.layout)
            ? saved
            : { ...saved, layout: [] };
          // Drop unknown scene names quietly: `kc.scene` could in theory
          // emit values we haven't seen yet, but a tagged binding for an
          // unknown scene would never resolve, so it's noise.
          if (Array.isArray(p.sceneBindings)) {
            const filtered = p.sceneBindings.filter((s): s is BindableScene =>
              (BINDABLE_SCENES as readonly string[]).includes(s),
            );
            return {
              ...p,
              sceneBindings: filtered.length > 0 ? filtered : undefined,
            };
          }
          return p;
        });
    }
  }

  private persist(): void {
    this.store.set(this.profiles);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
