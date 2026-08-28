import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The wire surface an Uplink ADDS, read out of its own generated contract slice.
 *
 * ## Why this source and no other
 *
 * The page's widget sections describe what the CLIENT reads. That is a different
 * question from what the Uplink PUBLISHES, and the second is the one a reader
 * evaluating an Uplink asks first: it is the durable half, the half another mod
 * can consume, and the half that survives every redesign of the widgets.
 *
 * It is declared in C#, and `mod/codegen.sh` already reflects over the
 * `[SitrepTopic]` / `[SitrepUnit]` attributes of the Uplink's contract assembly
 * and writes `src/__generated__/`. So the generated slice is the only source here
 * that is derived from the declaration rather than restated beside it, which is
 * the whole point: a hand-written channel table in a README is a second copy of
 * the contract, and this project has watched a second copy of a fact go stale
 * every time it has kept one.
 *
 * `units.json` carries the field/unit maps as plain JSON and is read directly.
 * The topic -> payload-type mapping and the array flag live only in
 * `topic-map.ts`, which is TypeScript this tool cannot import, so those two facts
 * are parsed out of it. A parse is a fragile instrument and is treated as one: a
 * channel present in `units.json` and absent from the parse THROWS rather than
 * rendering a row with a blank payload. The generated format changing is a thing
 * that should stop the build, not something a reader should have to notice from a
 * gap in a table.
 */
export interface WireField {
  name: string;
  /** A unit token (`m/s`, `ut`, `flag`) when the field is a scalar. */
  unit?: string;
  /** The nested payload type, with `[]` / `*` plural markers, when it holds one. */
  shape?: string;
}

export interface WireChannel {
  id: string;
  /** The payload interface name, as generated into `contract.ts`. */
  payload: string;
  /** The channel carries a bare JSON array of the payload type. */
  array: boolean;
  fields: WireField[];
}

export interface WirePayload {
  name: string;
  fields: WireField[];
}

export interface WireSurface {
  /** False when the Uplink has no contract slice, so nothing was generated. */
  present: boolean;
  channels: WireChannel[];
  /**
   * Shapes another payload's field holds, so a reader reaches them THROUGH a
   * channel rather than by subscribing to one. Separated from `payloads` because
   * they are the one group whose route onto the wire is visible here, and
   * lumping them in with the command args made the page claim a `*Ext`
   * provider-extension shape was a command's arguments.
   */
  nested: WirePayload[];
  /**
   * Wire shapes nothing on this page can route: a command's args, a dynamic
   * namespace's payload, or a namespace added inside another channel's
   * extensions bag. The distinction between those three is not in the generated
   * slice, so the page names all three rather than picking one.
   */
  payloads: WirePayload[];
}

const EMPTY: WireSurface = {
  present: false,
  channels: [],
  nested: [],
  payloads: [],
};

interface UnitsJson {
  types?: Record<string, Record<string, string>>;
  topics?: Record<string, Record<string, string>>;
  typeShapes?: Record<string, Record<string, string>>;
  topicShapes?: Record<string, Record<string, string>>;
}

/**
 * One entry of the generated payload map: `  "career.status": CareerStatus;` or
 * `  "kos.processors": KosProcessorInfo[];`. Anchored to the interface body's
 * two-space indent so a topic id appearing in the file's header prose cannot
 * match.
 */
const MAP_ENTRY = /^ {2}"([^"]+)": (\w+)(\[\])?;$/;

function fields(
  units: Record<string, string> | undefined,
  shapes: Record<string, string> | undefined,
): WireField[] {
  const names = new Set([
    ...Object.keys(units ?? {}),
    ...Object.keys(shapes ?? {}),
  ]);
  return [...names].sort().map((name) => ({
    name,
    unit: units?.[name],
    shape: shapes?.[name],
  }));
}

export function readWireSurface(pkgDir: string): WireSurface {
  const dir = join(pkgDir, "src", "__generated__");
  const unitsPath = join(dir, "units.json");
  const topicMapPath = join(dir, "topic-map.ts");
  if (!existsSync(unitsPath)) return EMPTY;

  const units = JSON.parse(readFileSync(unitsPath, "utf8")) as UnitsJson;

  const mapped = new Map<string, { payload: string; array: boolean }>();
  if (existsSync(topicMapPath)) {
    for (const line of readFileSync(topicMapPath, "utf8").split(/\r?\n/)) {
      const match = MAP_ENTRY.exec(line);
      if (match) {
        mapped.set(match[1], { payload: match[2], array: match[3] === "[]" });
      }
    }
  }

  const channels: WireChannel[] = [];
  for (const id of Object.keys(units.topics ?? {}).sort()) {
    const entry = mapped.get(id);
    if (!entry) {
      throw new Error(
        `gonogo-uplink docs: ${unitsPath} declares the channel "${id}" and ` +
          `${topicMapPath} does not say what payload it carries.\n` +
          "Both files come out of the same codegen run, so this is not an " +
          "authoring mistake: either the two are from different runs (re-run " +
          "`mod/codegen.sh`), or the emitted topic-map format has changed and " +
          "the parse in packages/ui-kit/src/render/wire.ts needs to change " +
          "with it.\n" +
          "It throws rather than printing a row with an empty payload, because " +
          "a channel table quietly missing its types is the kind of drift this " +
          "generator exists to prevent.",
      );
    }
    channels.push({
      id,
      payload: entry.payload,
      array: entry.array,
      fields: fields(units.topics?.[id], units.topicShapes?.[id]),
    });
  }

  // A type a static channel carries is already described by its channel row, so
  // it is not repeated. What is left splits in two, and the split matters: a
  // shape some field HOLDS is reachable from a channel and can be said to be,
  // while the rest have no route this page can name.
  const named = new Set(channels.map((c) => c.payload));
  const held = new Set(
    [
      ...Object.values(units.typeShapes ?? {}),
      ...Object.values(units.topicShapes ?? {}),
    ].flatMap((byField) => Object.values(byField).map(shapeElementName)),
  );

  const describe = (name: string): WirePayload => ({
    name,
    fields: fields(units.types?.[name], units.typeShapes?.[name]),
  });
  const rest = Object.keys(units.types ?? {})
    .filter((name) => !named.has(name))
    .sort();

  return {
    present: true,
    channels,
    nested: rest.filter((name) => held.has(name)).map(describe),
    payloads: rest.filter((name) => !held.has(name)).map(describe),
  };
}

/**
 * The ELEMENT type of a shape entry, dropping the generated plural markers: a
 * leading `*` is a string-keyed dictionary of it and a trailing `[]` a list. The
 * element is what a consumer indexes into either way, so it is the name that has
 * to match a `types` key.
 */
function shapeElementName(entry: string): string {
  return entry.replace(/^\*/, "").replace(/\[\]$/, "");
}

function fieldList(list: WireField[]): string {
  if (list.length === 0) return "none declared";
  return list
    .map((f) =>
      f.shape ? `\`${f.name}\` ${f.shape}` : `\`${f.name}\` ${f.unit ?? "?"}`,
    )
    .join(", ");
}

/**
 * The section, or nothing.
 *
 * An Uplink with no contract assembly (a client-only one, extending widgets that
 * already exist) adds nothing to the wire, and a heading saying so would be
 * noise. An Uplink WITH one that somehow generated no channel and no payload is
 * a different thing and still prints, because an empty table under a real
 * heading is information.
 */
export function wireSection(surface: WireSurface): string[] {
  if (!surface.present) return [];
  const out = [
    "## What it puts on the wire",
    "",
    "Reflected out of this Uplink's own contract assembly by the codegen that " +
      "writes `src/__generated__/`, so it describes the C# declaration itself " +
      "rather than a second copy of it. Each field is followed by its declared " +
      "unit (a lowercase token from the wire vocabulary) or, where it holds " +
      "another payload, that payload's name.",
    "",
  ];

  out.push("### Channels", "");
  if (surface.channels.length > 0) {
    out.push(
      "| Channel | Payload | Fields |",
      "| --- | --- | --- |",
      ...surface.channels.map(
        (c) =>
          `| \`${c.id}\` | \`${c.payload}${c.array ? "[]" : ""}\` | ${fieldList(c.fields)} |`,
      ),
      "",
    );
  } else {
    out.push(
      "This Uplink declares no statically-named channel. Everything it " +
        "publishes rides a dynamic namespace, whose payloads are below.",
      "",
    );
  }

  const table = (payloads: WirePayload[]) => [
    "| Payload | Fields |",
    "| --- | --- |",
    ...payloads.map((p) => `| \`${p.name}\` | ${fieldList(p.fields)} |`),
    "",
  ];

  if (surface.nested.length > 0) {
    out.push(
      "### Payloads held inside another payload",
      "",
      "Reached through a channel above rather than by subscribing to one: a " +
        "field named in the tables so far holds one of these, either singly, as " +
        "a list (`[]`) or as a string-keyed dictionary (`*`). Their own fields " +
        "carry declared units too, which is the reason they are listed: a " +
        "quantity nested two deep is still a quantity.",
      "",
      ...table(surface.nested),
    );
  }

  if (surface.payloads.length > 0) {
    out.push(
      "### Command args, dynamic channels and extensions",
      "",
      "Wire shapes whose route onto the wire is not in the generated slice, so " +
        "the honest description is all three things one of these can be: a " +
        "command's arguments, the payload of a dynamic namespace whose topic " +
        "string is composed at runtime (per vessel, per part, per CPU), or a " +
        "namespace this Uplink adds inside another channel's extensions bag. " +
        "None of the three is a fixed name an attribute could declare, which is " +
        "why they are listed by shape.",
      "",
      ...table(surface.payloads),
    );
  }
  return out;
}
