/**
 * The slots an `add augment` or `add contribution` can name: which ones the
 * installed sdk and the Uplink's own client declare, and the type declaration
 * that makes a slot some other Uplink declares known to this client.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type SlotKind = "augment" | "contribution";

/** A widget id, a dot and a segment: `crew-status.actions`. A segment may hold further dotted parts. */
const SLOT_SHAPE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

export const isSlotShape = (slot: string): boolean => SLOT_SHAPE.test(slot);

/** The widget id of a slot: everything before the first dot. */
export const widgetOf = (slot: string): string => slot.split(".")[0];

/** The standard segments every widget's panel carries, by the registry that types them. */
const STANDARD_SEGMENTS: Record<SlotKind, readonly string[]> = {
  augment: ["sections", "actions"],
  contribution: ["badges", "filters", "meters"],
};

const REGISTRY: Record<SlotKind, string> = {
  augment: "SlotRegistry",
  contribution: "ContributionRegistry",
};

/** The quoted keys at the top level of every `interface <name> { ... }` body in `text`, comments removed. */
function interfaceKeys(text: string, name: string): string[] {
  const bare = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const keys: string[] = [];
  const open = new RegExp(`interface\\s+${name}\\s*\\{`, "g");
  for (let at = open.exec(bare); at !== null; at = open.exec(bare)) {
    let depth = 1;
    let i = open.lastIndex;
    let body = "";
    while (i < bare.length && depth > 0) {
      const c = bare[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (depth === 1) body += c;
      i++;
    }
    for (const m of body.matchAll(/"([^"]+)"\s*\??:/g)) keys.push(m[1]);
  }
  return keys;
}

function filesUnder(dir: string, test: (file: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__generated__") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, test));
    else if (test(path)) out.push(path);
  }
  return out;
}

export interface KnownSlots {
  slots: Record<SlotKind, Set<string>>;
  widgets: Set<string>;
  /** Whether the installed sdk's declarations could be read. False when the client's dependencies are not installed. */
  sdkRead: boolean;
}

/**
 * The slots the Uplink's client can already type: those the installed sdk's
 * declaration files merge into its slot registries, and those the client's own
 * sources declare. It reads the sdk this client compiles against, so the list
 * is the one the compiler checks the slot against. A slot another Uplink
 * declares is not in it.
 */
export function knownSlots(uplinkDir: string): KnownSlots {
  const slots: Record<SlotKind, Set<string>> = {
    augment: new Set(),
    contribution: new Set(),
  };
  const sdkDist = join(
    uplinkDir,
    "client",
    "node_modules",
    "@ksp-gonogo",
    "sitrep-sdk",
    "dist",
  );
  const declarations = filesUnder(sdkDist, (file) => file.endsWith(".d.ts"));
  const own = filesUnder(
    join(uplinkDir, "client", "src"),
    (file) => /\.(ts|tsx)$/.test(file) && !file.endsWith(".test.ts"),
  );
  for (const file of [...declarations, ...own]) {
    const text = readFileSync(file, "utf8");
    for (const kind of ["augment", "contribution"] as const) {
      for (const key of interfaceKeys(text, REGISTRY[kind])) {
        if (isSlotShape(key)) slots[kind].add(key);
      }
    }
  }
  const widgets = new Set(
    [...slots.augment, ...slots.contribution].map(widgetOf),
  );
  return { slots, widgets, sdkRead: declarations.length > 0 };
}

/** Whether the sdk or the Uplink's own client declares `slot` for `kind`, counting a standard segment of a widget that declares any slot. */
export function isKnownSlot(
  known: KnownSlots,
  kind: SlotKind,
  slot: string,
): boolean {
  if (known.slots[kind].has(slot)) return true;
  const [widget, ...rest] = slot.split(".");
  return (
    known.widgets.has(widget) &&
    STANDARD_SEGMENTS[kind].includes(rest.join("."))
  );
}

/** The slots to show when `slot` is not known: that widget's own, or the widgets there are when it has none. */
export function suggestionsFor(
  known: KnownSlots,
  kind: SlotKind,
  slot: string,
): string {
  const widget = widgetOf(slot);
  const same = [...known.slots[kind]]
    .filter((id) => widgetOf(id) === widget)
    .sort();
  if (same.length > 0) {
    return `Slots of ${widget} it knows: ${[...same, ...STANDARD_SEGMENTS[kind].map((s) => `${widget}.${s}`)].join(", ")}`;
  }
  return `It declares no slot for a widget called ${widget}. Widgets it knows slots of: ${[...known.widgets].sort().join(", ") || "none, because the sdk's declarations could not be read"}`;
}

/** Where the declaration for `slot` is written, relative to the Uplink. */
export const declarationPath = (slot: string): string =>
  `client/src/slots/${slot.replaceAll(".", "-")}.ts`;

/**
 * A client file that makes a slot another Uplink declares known to this
 * client's compiler, by merging it into the sdk's slot registry. The slot's
 * props (an augment) or entry (a contribution) are left open, since only the
 * Uplink that owns the slot knows them.
 */
export function declarationFor(kind: SlotKind, slot: string): string {
  const entry =
    kind === "augment"
      ? `    "${slot}": Record<string, unknown>;`
      : `    "${slot}": { entry: Record<string, unknown> };`;
  const what =
    kind === "augment"
      ? "the props the slot passes to an augment"
      : "the entry a contribution to the slot returns";
  return `// The slot "${slot}" is declared by another Uplink, so the sdk's types do not know it. This merges it in, as the Uplink docs show for a slot of your own.
// Replace the open record with ${what}, as that Uplink's reference page gives it.
declare module "@ksp-gonogo/sitrep-sdk" {
  interface ${REGISTRY[kind]} {
${entry}
  }
}

export {};
`;
}
