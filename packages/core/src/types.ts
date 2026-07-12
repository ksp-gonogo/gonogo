// Core shared types — expand as features are built

import type { TopicId } from "@ksp-gonogo/sitrep-sdk";
import type { ComponentType } from "react";
import type { TelemaachusSchema } from "./schemas/telemachus";
import type { GonogoTheme } from "./theme";

export type DataSourceStatus =
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "error";

// ---------------------------------------------------------------------------
// Data source schema registry — extensible via declaration merging
// ---------------------------------------------------------------------------

/**
 * Maps data source IDs to their key→value schema.
 *
 * Built-in schemas are pre-populated here. Third-party packages can add their
 * own data sources by augmenting this interface via declaration merging:
 *
 *   declare module '@ksp-gonogo/core' {
 *     interface DataSourceRegistry {
 *       'my-source': MySourceSchema;
 *     }
 *   }
 *
 * Once registered, `useDataValue("my-source", key)` infers the return type
 * from the schema automatically — no manual type parameter needed.
 */
export interface DataSourceRegistry {
  telemachus: TelemaachusSchema;
}

export interface DataKey {
  key: string;
  description?: string;
}

export interface ConfigField {
  key: string;
  label: string;
  type: "text" | "number";
  placeholder?: string;
}

export interface ActionGroup {
  name: string;
  /** Telemachus action key to toggle, or null for read-only groups. */
  toggle: string | null;
  /** Telemachus value key to read current state. Must be a key in TelemaachusSchema. */
  value: keyof TelemaachusSchema;
  description: string;
}

/**
 * Base interface for all data sources. TConfig types the config object so that
 * concrete sources can return a typed config from getConfig() and accept a typed
 * config in configure(). The registry erases TConfig to the default so the config
 * panel can work generically against any source.
 *
 * Follows the same generic pattern as ComponentDefinition<TConfig>.
 */
export interface DataSource<
  TConfig extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  name: string;
  connect(): Promise<void>;
  disconnect(): void;
  status: DataSourceStatus;
  schema(): DataKey[];
  subscribe(key: string, cb: (value: unknown) => void): () => void;
  onStatusChange(cb: (status: DataSourceStatus) => void): () => void;
  execute(action: string): Promise<void>;
  configSchema(): ConfigField[];
  /** Always accepts Record<string,unknown> so the generic config form can call it without knowing TConfig. */
  configure(config: Record<string, unknown>): void;
  getConfig(): TConfig;
  setupInstructions?(): string | null;
  /**
   * When true, samples from this source are gated by the vessel's CommNet
   * link — during blackout (`comm.connected === false`) the buffering layer
   * drops non-`comm.*` samples rather than persisting or fanning them out.
   * Sources that handle signal loss internally (e.g. kOS, which runs
   * autonomously on the vessel) should leave this false.
   */
  affectedBySignalLoss?: boolean;
}

export type ComponentBehavior = "gonogo-participant";

// ---------------------------------------------------------------------------
// Action inputs — wiring for physical/virtual controls to trigger component
// functionality. Components declare their available actions at registration;
// users later map device inputs to them via the input mapping UI.
// ---------------------------------------------------------------------------

export type ActionInputKind = "button" | "analog";

export interface ActionInputPayload {
  kind: ActionInputKind;
  /** Button: true=pressed, false=released. Analog: normalised to -1..1. */
  value: boolean | number;
  /** Device-specific raw value before normalisation, if the handler wants it. */
  raw?: unknown;
}

export interface ActionDefinition {
  /** Stable ID used when persisting an input→action mapping. Unique per component. */
  id: string;
  label: string;
  /** Which input kinds may drive this action. */
  accepts: readonly ActionInputKind[];
  description?: string;
}

/**
 * Typed handler map for `useActionInput`. Given a readonly array of
 * ActionDefinitions, the keys of the map are inferred from each definition's
 * `id`, so mismatched handler names fail typecheck at the call site.
 */
export type ActionHandlers<TActions extends readonly ActionDefinition[]> = {
  [K in TActions[number]["id"]]: (payload: ActionInputPayload) => unknown;
};

/**
 * Props passed to every registered dashboard component.
 *
 * Components that need a specific config shape should supply TConfig:
 *
 *   function MyWidget({ config }: ComponentProps<{ value: number }>) { … }
 *
 * The default (`Record<string, unknown>`) is kept for backward compat and for
 * the registry, which erases the type parameter when storing components.
 *
 * - `id`             — the DashboardItem instance ID (stable per placement)
 * - `w` / `h`        — current grid-unit size (column/row spans); use to adapt layout
 * - `onConfigChange` — call to persist inline config edits (e.g. label rename)
 */
export interface ComponentProps<TConfig = Record<string, unknown>> {
  config?: TConfig;
  id: string;
  w?: number;
  h?: number;
  onConfigChange?: (config: TConfig) => void;
}

/**
 * Props passed to a component's config UI (rendered inside a modal).
 *
 * `onSave` should be called with the full new config to persist and close.
 */
export interface ConfigComponentProps<TConfig = Record<string, unknown>> {
  config: TConfig;
  onSave: (config: TConfig) => void;
}

/**
 * Registration descriptor for a dashboard component.
 *
 * TConfig ties the component function's expected props to the defaultConfig
 * shape, so TypeScript catches mismatches at registration time:
 *
 *   registerComponent<ActionGroupConfig>({
 *     component: ActionGroupComponent,       // ComponentType<ComponentProps<ActionGroupConfig>>
 *     defaultConfig: { actionGroupId: 'AG1' }, // Partial<ActionGroupConfig> — checked ✓
 *   });
 *
 * The registry stores ComponentDefinition<any> so the orchestrator can render
 * any registered component without knowing its concrete TConfig.
 */
export interface ComponentDefinition<TConfig = Record<string, unknown>> {
  id: string;
  name: string;
  description: string;
  /** Free-form tags; UI may style known values (e.g. 'telemetry', 'control', 'kos'). */
  tags: string[];
  component: ComponentType<ComponentProps<TConfig>>;
  /** Config UI rendered inside a modal; shown via gear icon in the Dashboard. */
  configComponent?: ComponentType<ConfigComponentProps<TConfig>>;
  /** If true, config modal opens immediately when the component is added from the overlay. */
  openConfigOnAdd?: boolean;
  /** Default grid size when placed from the overlay. Falls back to { w: 3, h: 3 }. */
  defaultSize?: { w: number; h: number };
  /**
   * Minimum grid size — RGL prevents the user dragging below these dimensions
   * and saved layouts smaller than this are clamped on load. Use to gate sizes
   * where the widget becomes unreadable. Falls back to { w: 1, h: 1 } (no
   * floor) when omitted, but most widgets should set this.
   */
  minSize?: { w: number; h: number };
  /**
   * Width hint for the mobile / touch dashboard layout, which is a flex-wrap
   * column rather than a grid. `'half'` items take ~50% of the row and pair
   * up when consecutive; `'full'` (default) takes the full row. Use `'half'`
   * for compact controls (e.g. ActionGroup) — most widgets should stay full.
   */
  mobileWidth?: "full" | "half";
  /**
   * Height in px for the mobile layout. Defaults to `defaultSize.h * ROW_HEIGHT`
   * (the same vertical space the widget gets on desktop). Override only when
   * the desktop default looks cramped at full mobile width — typically graphs
   * and maps that benefit from extra vertical room in portrait.
   */
  mobileHeight?: number;
  dataRequirements?: string[];
  /**
   * Topics this widget REQUIRES (Uplink architecture spec §3.2). The widget
   * only mounts once every one of these Topics is live, so a required Topic's
   * payload is read non-null through the manifest hook (§3.3). Typed as
   * `readonly TopicId[]` — the same typed token the read hook is keyed by, so
   * there is no drift between declaration and read. Authored via
   * {@link defineTopicManifest} (`channels`), which also yields the bound
   * `useTelemetry` hook. Coexists with the legacy `dataRequirements` during
   * migration; the rename/removal is R7 (do-last) territory.
   */
  channels?: readonly TopicId[];
  /**
   * Topics this widget OPTIONALLY consumes (Uplink architecture spec §3.2).
   * May be absent at runtime, so every Value read from one is `| undefined`
   * through the manifest hook (§3.3) — a widget therefore cannot hard-depend
   * on an optional Topic, statically. Typed as `readonly TopicId[]`. Authored
   * via {@link defineTopicManifest} (`optionalChannels`).
   */
  optionalChannels?: readonly TopicId[];
  behaviors?: ComponentBehavior[];
  defaultConfig?: Partial<TConfig>;
  /**
   * Actions this component exposes to the serial input platform. Each entry
   * becomes a selectable target in the input-mapping UI and is resolved at
   * runtime by the component calling `useActionInput`.
   */
  actions?: readonly ActionDefinition[];
  /**
   * When true, this component can be mirrored onto the main screen's modal
   * dashboard from a station via the "Push to main" button. Only set this
   * on components whose config + data shape work identically when re-rendered
   * on main (i.e. that read data via `useDataValue` and don't depend on
   * station-local state like serial input mappings).
   */
  pushable?: boolean;
  /**
   * Game-state preconditions for this widget to be "live". The dashboard
   * orchestrator dims the widget with an explanatory overlay when any
   * requirement is unmet (vessel not flying, career save not active, …)
   * — the widget still renders its current values underneath the dim
   * layer so the operator sees layout + last-good data, just visually
   * de-emphasised. Empty / omitted = always live.
   *
   * Honoured via `useGameContext` from the GonogoTelemetry plugin's
   * `kc.scene` + `career.mode` keys; without the plugin installed, the
   * context reports `Unknown` and widgets stay live.
   */
  requires?: readonly ComponentRequirement[];
  /**
   * Addressable augment slots this widget owns (Uplink architecture spec §4.1).
   * Each entry is a small, stable API the base widget exposes via
   * `<AugmentSlot name="…" />`; any Uplink may contribute into it with
   * `registerAugment`. Slot names are authored up front (`augment-slot-map.md`)
   * and are discoverable/version-able like any contract surface. Not a
   * core-widget privilege — an Uplink-owned widget can expose slots too (§4.6).
   */
  augmentSlots?: string[];
  /**
   * Replacement escape hatch (Uplink architecture spec §4.5): declares that this
   * widget REPLACES the widget with the given id — the registry suppresses the
   * original and renders this one instead. This is the "throw the whole widget
   * away and render mine" case, distinct from (composable) augments. One active
   * replacement wins; TWO widgets replacing the same target is a surfaced
   * conflict ({@link getReplacementConflicts}), never silently merged.
   */
  replaces?: string;
}

/**
 * Game-state preconditions a widget can declare. The orchestrator looks
 * each one up against `useGameContext()` and dims the widget if any is
 * unmet.
 *
 * - `flight` — `kc.scene === "Flight"`. Most vessel-data widgets.
 * - `career` — `career.mode` ∈ {CAREER, SCIENCE}. Funds / contracts /
 *   tech-tree widgets where sandbox mode has nothing meaningful to show.
 *
 * Add new requirement names here when a widget needs a different gate;
 * keep the enum closed so the matching overlay messages stay coherent.
 */
export type ComponentRequirement = "flight" | "career";

export interface ThemeDefinition {
  id: string;
  name: string;
  theme: GonogoTheme;
}
