import type { ComponentDefinition } from "@ksp-gonogo/sitrep-sdk";

/**
 * Everything an author declared about a widget in `registerComponent`, as data.
 * Fields the registration leaves out are empty lists, `false` or `null`, never
 * missing. Useful for describing a widget to an operator the same way on the
 * Uplink's README and on a docs site. Built by the render probe's inventory and
 * written by {@link widgetRecordsJson}.
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
  /** The Topic families the widget needs to render, each as a pattern such as `fleet.<vessel>.contact`. */
  channelFamilies: string[];
  /** The Topic families the widget reads when present and draws without otherwise. */
  optionalChannelFamilies: string[];
  /** Whether the Topics the widget reads depend on the tile's settings, as a graph's chosen series do. */
  readsFromConfig: boolean;
  /** The flat data keys an older widget declares instead of `channels`. */
  dataRequirements: string[];
  /** The fields of its Topics the widget draws. */
  fields: string[];
  /** The actions an input can be bound to, each with the label an operator reads and, when the registration gives one, what it does. */
  actions: { id: string; label: string; description: string | null }[];
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
 * The {@link WidgetRecord} of one registered widget. Useful for keeping the
 * README, the widget records file and the render harness in agreement on every
 * field. Used by the render probe when it reads the inventory.
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
    channelFamilies: [...(def.channelFamilies ?? [])],
    optionalChannelFamilies: [...(def.optionalChannelFamilies ?? [])],
    readsFromConfig: def.channelsFromConfig !== undefined,
    dataRequirements: (def.dataRequirements ?? []).map((r) => String(r)),
    fields: [...(def.fields ?? [])].map((f) => String(f)),
    actions: (def.actions ?? []).map((a) => ({
      id: a.id,
      label: a.label,
      description: a.description ?? null,
    })),
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
 * client package. It is committed beside the README and checked with it. Useful
 * for letting a docs site list the Uplink's widgets. Used by the `docs` command
 * and the page check.
 *
 * @category Uplink page
 */
export const WIDGET_RECORDS_FILE = "docs/widgets.json";

/**
 * Widget records as the JSON file holds them: `{ "widgets": [...] }`, ordered
 * by id, two-space indented, ending in a newline. Each entry may carry extra
 * fields after the record's own. Useful for writing the widget records file.
 * Used by the `docs` command and the page check.
 *
 * @category Uplink page
 */
export function widgetRecordsJson<Entry extends WidgetRecord>(
  records: readonly Entry[],
): string {
  const widgets = [...records].sort((a, b) => a.id.localeCompare(b.id));
  return `${JSON.stringify({ widgets }, null, 2)}\n`;
}
