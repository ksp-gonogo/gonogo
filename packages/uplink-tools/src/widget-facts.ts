import type { WidgetRecord } from "./render/widgetRecord";

/**
 * Which fact of a widget a {@link WidgetFact} row states.
 *
 * @category Inventory
 */
export type WidgetFactId =
  | "id"
  | "reads"
  | "drawsOnly"
  | "alsoReads"
  | "readsFromSettings"
  | "sends"
  | "actions"
  | "slots"
  | "needs"
  | "replaces"
  | "defaultSize"
  | "minSize";

/**
 * One entry in a fact row: an identifier shown as code, optionally under the
 * label an operator reads, or a plain phrase.
 *
 * @category Inventory
 */
export type WidgetFactItem =
  | {
      /** An identifier shown as code. */
      code: string;
      /** The label an operator reads for it. */
      label?: string;
    }
  | {
      /** A plain phrase. */
      prose: string;
    };

/**
 * One row of a widget's fact table: the label a reader sees and what the
 * registration says under it.
 *
 * @category Inventory
 */
export interface WidgetFact {
  /** Which fact the row states. */
  id: WidgetFactId;
  /** The label a reader sees. */
  label: string;
  /** What the registration says under the label. */
  items: WidgetFactItem[];
}

/**
 * Options for {@link widgetFactsOf}.
 *
 * @category Inventory
 */
export interface WidgetFactsOptions {
  /** Slots to leave out of the `slots` row, for a page that lists them elsewhere. */
  omitSlot?: (slot: string) => boolean;
}

/** What each requirement asks of the game, in the words a reader uses. */
const REQUIREMENT_WORDS: Record<string, string> = {
  flight: "a vessel in flight",
  career: "a career or science save",
};

const codes = (values: readonly string[]): WidgetFactItem[] =>
  values.map((code) => ({ code }));

/**
 * The facts of a widget's registration as table rows, in the order both the
 * Uplink README and the docs site's widget page show them. Rows with nothing
 * to say are left out. A page may add to these rows, never restate them
 * differently.
 *
 * @category Inventory
 */
export function widgetFactsOf(
  record: WidgetRecord,
  options: WidgetFactsOptions = {},
): WidgetFact[] {
  const flatKeys =
    record.channels.length === 0 && record.dataRequirements.length > 0;
  const reads = [
    ...(flatKeys ? record.dataRequirements : record.channels),
    ...record.channelFamilies,
  ];
  const slots = [...record.augmentSlots, ...record.contributionSlots].filter(
    (slot) => !options.omitSlot?.(slot),
  );
  const rows: WidgetFact[] = [
    { id: "id", label: "Widget id", items: [{ code: record.id }] },
    {
      id: "reads",
      label: flatKeys ? "Reads, as flat keys" : "Reads",
      items: codes(reads),
    },
    { id: "drawsOnly", label: "Draws only", items: codes(record.fields) },
    {
      id: "alsoReads",
      label: "Also reads, if published",
      items: codes([
        ...record.optionalChannels,
        ...record.optionalChannelFamilies,
      ]),
    },
    {
      id: "readsFromSettings",
      label: "Reads from settings",
      items: record.readsFromConfig
        ? [{ prose: "the Topics chosen in the tile's settings" }]
        : [],
    },
    { id: "sends", label: "Sends", items: codes(record.commands) },
    {
      id: "actions",
      label: "Actions to bind",
      items: record.actions.map((a) => ({ code: a.id, label: a.label })),
    },
    { id: "slots", label: "Slots", items: codes(slots) },
    {
      id: "needs",
      label: "Needs",
      items: record.requires.map((need) =>
        REQUIREMENT_WORDS[need]
          ? { prose: REQUIREMENT_WORDS[need] }
          : { code: need },
      ),
    },
    {
      id: "replaces",
      label: "Replaces",
      items: record.replaces ? [{ code: record.replaces }] : [],
    },
    {
      id: "defaultSize",
      label: "Default size",
      items: record.defaultSize
        ? [{ prose: `${record.defaultSize.w} × ${record.defaultSize.h}` }]
        : [],
    },
    {
      id: "minSize",
      label: "Smallest size",
      items: record.minSize
        ? [{ prose: `${record.minSize.w} × ${record.minSize.h}` }]
        : [],
    },
  ];
  return rows.filter((row) => row.items.length > 0);
}

/**
 * A fact row's items as one Markdown table cell: code spans, comma separated,
 * with `|` escaped for the table and, in prose, angle brackets too.
 *
 * @category Inventory
 */
export function widgetFactValueMd(items: readonly WidgetFactItem[]): string {
  const prose = (s: string) => s.replace(/([<>|])/g, "\\$1");
  return items
    .map((item) => {
      if ("prose" in item) return prose(item.prose);
      const code = `\`${item.code.replace(/\|/g, "\\|")}\``;
      return item.label ? `${prose(item.label)} (${code})` : code;
    })
    .join(", ");
}
