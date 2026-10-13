import type { WidgetRecord } from "./render/widgetRecord";

/**
 * Which fact of a widget a {@link WidgetFact} row states. Useful for letting a
 * page style or reorder the rows of a widget's fact table. Carried by
 * `WidgetFact`.
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
 * label an operator reads, or a plain phrase. Useful for showing the operator
 * what a widget reads, needs and offers. Held by {@link WidgetFact} and turned
 * into a table cell by {@link widgetFactValueMd}.
 *
 * @category Inventory
 */
export type WidgetFactItem =
  | {
      /** An identifier shown as code. */
      code: string;
      /** The label an operator reads for it. */
      label?: string;
      /** What it does, as one sentence. */
      description?: string;
    }
  | {
      /** A plain phrase. */
      prose: string;
    };

/**
 * One row of a widget's fact table: the label a reader sees and what the
 * registration says under it. Useful for describing a widget the same way on
 * the Uplink's README and on a docs site. Returned by {@link widgetFactsOf}.
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
 * Options for {@link widgetFactsOf}. Useful for leaving a row's content out of
 * the fact table when a page lists it elsewhere. Taken by `widgetFactsOf`.
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

/* The sdk's `TINY_SIZE`, kept here because this module loads in plain Node, where the sdk's source cannot be imported. A test holds the two equal. */
const TINY_SIZE = { w: 3, h: 3 } as const;

const smallestSizeOf = (
  record: WidgetRecord,
  minSize: { w: number; h: number },
): string =>
  record.tiny
    ? `${TINY_SIZE.w} × ${TINY_SIZE.h}, drawing only its tiny form; ${minSize.w} × ${minSize.h} for the full widget`
    : `${minSize.w} × ${minSize.h}`;

const codes = (values: readonly string[]): WidgetFactItem[] =>
  values.map((code) => ({ code }));

/**
 * The facts of a widget's registration as table rows, in the order the Uplink
 * README and a docs site's widget page show them. Rows with nothing to say are
 * left out. A page may add to these rows and must not restate them differently.
 * Useful for showing the operator what a widget needs and reads before they add
 * it to a dashboard. Used by the page generator for the README's widget
 * sections.
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
      label: flatKeys
        ? "Reads, as dotted paths (a Topic id or a field of its payload)"
        : "Reads",
      items: codes(reads),
    },
    {
      id: "drawsOnly",
      label: "Fields it draws, of the Topics it reads",
      items: codes(record.fields),
    },
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
        ? [
            {
              prose:
                "the Topics chosen in the widget's settings, each as a Topic id or a field path such as `vessel.flight.altitudeAsl`",
            },
          ]
        : [],
    },
    { id: "sends", label: "Sends", items: codes(record.commands) },
    {
      id: "actions",
      label: "Actions an input can be bound to",
      items: record.actions.map((a) => ({
        code: a.id,
        label: a.label,
        ...(a.description ? { description: a.description } : {}),
      })),
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
        ? [{ prose: smallestSizeOf(record, record.minSize) }]
        : [],
    },
  ];
  return rows.filter((row) => row.items.length > 0);
}

/**
 * A fact row's items as one Markdown table cell: code spans, comma separated,
 * with `|` escaped for the table and, in prose, angle brackets too. Useful for
 * writing a {@link WidgetFact} row into a README table. Used by the page
 * generator.
 *
 * @category Inventory
 */
export function widgetFactValueMd(items: readonly WidgetFactItem[]): string {
  const prose = (s: string) => s.replace(/([<>|])/g, "\\$1");
  return items
    .map((item) => {
      if ("prose" in item) return prose(item.prose);
      const code = `\`${item.code.replace(/\|/g, "\\|")}\``;
      const named = item.label ? `${prose(item.label)} (${code})` : code;
      return item.description
        ? `${named}: ${prose(item.description.replace(/\.$/, ""))}`
        : named;
    })
    .join(
      items.some((item) => "description" in item && item.description)
        ? "; "
        : ", ",
    );
}
