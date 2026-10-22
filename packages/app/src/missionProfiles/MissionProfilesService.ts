import type { Screen } from "@ksp-gonogo/core";
import { safeRandomUuid } from "@ksp-gonogo/core";
import { LocalStorageStore } from "@ksp-gonogo/data";
import type { InputBinding } from "@ksp-gonogo/serial";
import type { Layout } from "react-grid-layout";
import type { DashboardItem } from "../components/Dashboard";

/**
 * Named dashboards: "Launch", "Orbit", "Rendezvous", etc.: scoped per-screen
 * (main vs station). A profile bundles the items + the layout. The dashboard
 * always belongs to one profile, the current one, and every change to it is
 * written straight into that profile; switching profiles swaps the whole
 * state in a single tick via `useDashboardState.replaceState`.
 *
 * Storage is partitioned by screen so main and station have independent
 * profile libraries.
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
   * The input that switches to this profile when pressed: a keyboard key, a
   * gamepad button or a serial device input. At most one profile per screen
   * holds a given input.
   */
  inputBinding?: InputBinding;
  /**
   * True for the one unnamed layout created by the first change made with no
   * profile current. It keeps being autosaved; renaming it makes it an
   * ordinary profile.
   */
  draft?: boolean;
  /** ms: lets the UI sort by recency and detect "did I change this?". */
  updatedAt: number;
}

/** What an unnamed autosaved layout is called until it is renamed. */
export const DRAFT_NAME = "Unsaved layout";

/** The name given to a screen's base dashboard when it is migrated into a profile. */
const MIGRATED_BASE_NAME = "Layout";

/** Bumped when the stored shape changes; see `migrate`. */
const SCHEMA_VERSION = 2;

type Listener = () => void;

function storageKeyFor(screen: Screen): string {
  return `gonogo.missionProfiles.${screen}`;
}

function currentKeyFor(screen: Screen): string {
  return `gonogo.missionProfiles.current.${screen}`;
}

function schemaKeyFor(screen: Screen): string {
  return `gonogo.missionProfiles.schema.${screen}`;
}

/** The dashboard slots each screen used before profiles held the working layout. */
function legacyKeysFor(screen: Screen): Array<{
  key: string;
  scene: BindableScene | null;
}> {
  return [
    { key: `gonogo:dashboard:${screen}`, scene: null },
    ...BINDABLE_SCENES.map((scene) => ({
      key: `gonogo:dashboard:${screen}:${scene}`,
      scene,
    })),
  ];
}

function readLegacyDashboard(
  storage: Storage,
  key: string,
): { items: DashboardItem[]; layout: Layout } | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { items, layout } = parsed as {
      items?: unknown;
      layout?: unknown;
    };
    return {
      items: Array.isArray(items)
        ? items.filter(
            (it): it is DashboardItem =>
              typeof it === "object" &&
              it !== null &&
              typeof it.i === "string" &&
              typeof it.componentId === "string",
          )
        : [],
      layout: Array.isArray(layout) ? layout : [],
    };
  } catch {
    return null;
  }
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
  private currentStore: LocalStorageStore<string | null>;
  private schemaStore: LocalStorageStore<number>;
  private screen: Screen;
  private storage: Storage;
  private currentId: string | null = null;

  constructor(screen: Screen, storage: Storage = globalThis.localStorage) {
    this.screen = screen;
    this.storage = storage;
    this.store = new LocalStorageStore<MissionProfile[]>({
      key: storageKeyFor(screen),
      defaults: [],
      storage,
    });
    this.currentStore = new LocalStorageStore<string | null>({
      key: currentKeyFor(screen),
      defaults: null,
      storage,
    });
    this.schemaStore = new LocalStorageStore<number>({
      key: schemaKeyFor(screen),
      defaults: 0,
      storage,
    });
    this.load();
    this.migrate();
  }

  /** The profile the dashboard belongs to, or null when none is current. */
  getCurrentId(): string | null {
    return this.currentId;
  }

  getCurrent(): MissionProfile | undefined {
    return this.currentId ? this.get(this.currentId) : undefined;
  }

  /** Makes a profile the one the dashboard belongs to; null leaves none current. */
  setCurrent(id: string | null): void {
    const next = id !== null && this.get(id) ? id : null;
    if (next === this.currentId) return;
    this.currentId = next;
    this.currentStore.set(next);
    this.emit();
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
   * Writes the dashboard into a profile as the autosave does: unlike `update`
   * it never renames and leaves the unnamed flag as it is. A write that only
   * records the grid settling keeps `updatedAt`, so it does not change which
   * profile a scene prefers.
   */
  writeContent(
    id: string,
    items: DashboardItem[],
    layout: Layout,
    { touch = true }: { touch?: boolean } = {},
  ): void {
    const idx = this.profiles.findIndex((p) => p.id === id);
    if (idx < 0) return;
    this.profiles[idx] = {
      ...this.profiles[idx],
      items,
      layout,
      updatedAt: touch ? Date.now() : this.profiles[idx].updatedAt,
    };
    this.persist();
    this.emit();
  }

  /**
   * Creates the one unnamed layout and makes it current. A previous unnamed
   * layout is kept as an ordinary profile rather than dropped, so there is
   * never more than one flagged at a time.
   */
  createDraft(items: DashboardItem[], layout: Layout): MissionProfile {
    this.profiles = this.profiles.map((p) =>
      p.draft ? { ...p, draft: undefined } : p,
    );
    const draft: MissionProfile = {
      id: generateId(),
      name: DRAFT_NAME,
      screen: this.screen,
      items,
      layout,
      draft: true,
      updatedAt: Date.now(),
    };
    this.profiles.push(draft);
    this.currentId = draft.id;
    this.persist();
    this.currentStore.set(draft.id);
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
    if (patch.name) next.draft = undefined;
    this.profiles[idx] = next;
    this.persist();
    this.emit();
  }

  /**
   * Binds an input to a profile, or clears it with null. An input already
   * bound to another profile moves here; that profile is returned so the
   * caller can say so.
   */
  bindInput(
    id: string,
    binding: InputBinding | null,
  ): { movedFrom: MissionProfile | null } {
    let movedFrom: MissionProfile | null = null;
    this.profiles = this.profiles.map((p) => {
      if (p.id === id) {
        return { ...p, inputBinding: binding ?? undefined };
      }
      const held = p.inputBinding;
      if (
        binding &&
        held?.deviceId === binding.deviceId &&
        held.inputId === binding.inputId
      ) {
        movedFrom = p;
        return { ...p, inputBinding: undefined };
      }
      return p;
    });
    this.persist();
    this.emit();
    return { movedFrom };
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
      if (this.currentId === id) {
        this.currentId = null;
        this.currentStore.set(null);
      }
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
          const p = {
            ...saved,
            items: Array.isArray(saved.items)
              ? saved.items.filter(
                  (it): it is DashboardItem =>
                    typeof it?.i === "string" &&
                    typeof it?.componentId === "string",
                )
              : [],
            layout: Array.isArray(saved.layout) ? saved.layout : [],
            updatedAt: Number.isFinite(saved.updatedAt) ? saved.updatedAt : 0,
          };
          const held = p.inputBinding;
          if (
            held &&
            (typeof held.deviceId !== "string" ||
              typeof held.inputId !== "string")
          ) {
            p.inputBinding = undefined;
          }
          // Drop unknown scene names quietly: `kc.scene` could in theory
          // emit values we haven't seen yet, but a tagged binding for an
          // unknown scene would never resolve, so it's noise.
          if (!Array.isArray(p.sceneBindings)) {
            return { ...p, sceneBindings: undefined };
          }
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
    const current = this.currentStore.get();
    this.currentId =
      typeof current === "string" && this.get(current) ? current : null;
  }

  /**
   * Brings an older store forward, once per schema bump and whenever an old
   * per-scene dashboard slot is found (a restored backup can bring one back).
   * Each slot becomes an ordinary profile: a scene's slot is named after the
   * scene and bound to it with auto-switch, so a scene keeps the arrangement
   * it had without a prompt, and the screen's base slot becomes the current
   * profile. Kept unnamed layouts stop being flagged, so the flag marks only
   * the one the autosave is writing.
   */
  private migrate(): void {
    let changed = false;
    if (this.schemaStore.get() < SCHEMA_VERSION) {
      this.profiles = this.profiles.map((p) =>
        p.draft ? { ...p, draft: undefined } : p,
      );
      this.schemaStore.set(SCHEMA_VERSION);
      changed = true;
    }

    const found = legacyKeysFor(this.screen).flatMap(({ key, scene }) => {
      const dashboard = readLegacyDashboard(this.storage, key);
      return dashboard ? [{ key, scene, dashboard }] : [];
    });
    for (const { scene, dashboard } of found.sort(
      (a, b) => Number(a.scene === null) - Number(b.scene === null),
    )) {
      if (scene) this.migrateSceneSlot(scene, dashboard);
      else this.migrateBaseSlot(dashboard);
      changed = true;
    }
    if (changed) this.persist();
    // The store swallows a refused write, so the slots go only once the converted profiles read back.
    if (found.length > 0 && !this.isPersisted()) return;
    for (const { key } of found) {
      try {
        this.storage.removeItem(key);
      } catch {
        // storage unavailable: the slot is converted either way.
      }
    }
  }

  private migrateSceneSlot(
    scene: BindableScene,
    dashboard: { items: DashboardItem[]; layout: Layout },
  ): void {
    const alreadyBound = this.profiles.some((p) =>
      p.sceneBindings?.includes(scene),
    );
    this.profiles.push({
      id: generateId(),
      name: `${SCENE_LABELS[scene]} layout`,
      screen: this.screen,
      items: dashboard.items,
      layout: dashboard.layout,
      sceneBindings: alreadyBound ? undefined : [scene],
      autoSwitch: alreadyBound ? undefined : true,
      updatedAt: Date.now(),
    });
  }

  private migrateBaseSlot(dashboard: {
    items: DashboardItem[];
    layout: Layout;
  }): void {
    if (dashboard.items.length === 0) return;
    const base: MissionProfile = {
      id: generateId(),
      name: MIGRATED_BASE_NAME,
      screen: this.screen,
      items: dashboard.items,
      layout: dashboard.layout,
      updatedAt: Date.now(),
    };
    this.profiles.push(base);
    if (this.currentId) return;
    this.currentId = base.id;
    this.currentStore.set(base.id);
  }

  private isPersisted(): boolean {
    const saved = this.store.get();
    return (
      Array.isArray(saved) &&
      this.profiles.every((p) => saved.some((s) => s?.id === p.id))
    );
  }

  private persist(): void {
    this.store.set(this.profiles);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
