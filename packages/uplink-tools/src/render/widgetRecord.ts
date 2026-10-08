import type { ComponentDefinition } from "@ksp-gonogo/sitrep-sdk";

/**
 * Everything an author declared about a widget in `registerComponent`, as
 * data: the one source the Uplink's README and the docs site's widget page
 * both read. Fields the registration leaves out are empty lists, `false` or
 * `null`, never missing.
 *
 * @category Inventory
 * @categoryDescription Inventory
 * What an Uplink client registered, read back as data: its widgets, augments
 * and contributions with everything their registrations declare. The renderer
 * and the generated page both read it.
 */
export interface WidgetRecord {
  /** The registered widget id. */
  id: string;
  /** The widget's display name. */
  name: string;
  /** What the widget shows, as the registration describes it. */
  description: string;
  /** The free-form tags the widget is filed under. */
  tags: string[];
  /** The Topics the widget needs to render. */
  channels: string[];
  /** The Topics the widget reads when they are present and draws without otherwise. */
  optionalChannels: string[];
  /** The commands the widget's controls can send, as the registration lists them. */
  commands: string[];
  /** The flat data keys an older widget declares instead of `channels`. */
  dataRequirements: string[];
  /** The fields of its Topics the widget draws. */
  fields: string[];
  /** The actions an input can be bound to, each with the label an operator reads. */
  actions: { id: string; label: string }[];
  /** The augment slots the widget renders, as the registration names them. */
  augmentSlots: string[];
  /** The contribution slots the widget reads, as the registration names them. */
  contributionSlots: string[];
  /** The Domains that must be present for the widget to show. */
  requires: string[];
  /** The id of the widget this one replaces, or `null`. */
  replaces: string | null;
  /** Whether a station can push this widget to the main screen. */
  pushable: boolean;
  /** The size a new tile opens at, in grid units, or `null` for the dashboard's default. */
  defaultSize: { w: number; h: number } | null;
  /** The smallest the tile may be resized to, in grid units, or `null` when unset. */
  minSize: { w: number; h: number } | null;
  /** Whether the widget has a tiny form for the smallest tiles. */
  tiny: boolean;
}

/**
 * The record of one registered widget. The only place a registration is turned
 * into a {@link WidgetRecord}, so the README, the docs-site file and the
 * render harness agree on every field.
 */
export function widgetRecordOf(def: ComponentDefinition): WidgetRecord {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    tags: [...def.tags],
    channels: [...(def.channels ?? [])],
    optionalChannels: [...(def.optionalChannels ?? [])],
    commands: [...(def.commands ?? [])],
    dataRequirements: (def.dataRequirements ?? []).map((r) => String(r)),
    fields: [...(def.fields ?? [])].map((f) => String(f)),
    actions: (def.actions ?? []).map((a) => ({ id: a.id, label: a.label })),
    augmentSlots: [...(def.augmentSlots ?? [])],
    contributionSlots: [...(def.contributionSlots ?? [])],
    requires: (def.requires ?? []).map((r) => String(r)),
    replaces: def.replaces ?? null,
    pushable: def.pushable === true,
    defaultSize: def.defaultSize
      ? { w: def.defaultSize.w, h: def.defaultSize.h }
      : null,
    minSize: def.minSize ? { w: def.minSize.w, h: def.minSize.h } : null,
    tiny: def.tiny !== undefined,
  };
}

/**
 * Where `uplink-tools docs` writes an Uplink's widget records, relative to its
 * client package. Committed beside the README and checked with it.
 *
 * @category Uplink page
 */
export const WIDGET_RECORDS_FILE = "docs/widgets.json";

/**
 * Widget records as the JSON file holds them: `{ "widgets": [...] }`, ordered
 * by id, two-space indented, ending in a newline. Each entry may carry extra
 * fields after the record's own.
 *
 * @category Uplink page
 */
export function widgetRecordsJson<Entry extends WidgetRecord>(
  records: readonly Entry[],
): string {
  const widgets = [...records].sort((a, b) => a.id.localeCompare(b.id));
  return `${JSON.stringify({ widgets }, null, 2)}\n`;
}
