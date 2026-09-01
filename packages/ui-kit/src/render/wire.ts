import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type ChannelDisposition, readChannelDispositions } from "./channels";

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
  /** The payload interface name, or undefined for one the slice does not type. */
  payload?: string;
  /** The channel carries a bare JSON array of the payload type. */
  array: boolean;
  fields: WireField[];
  /** From the C# declaration site. See `./channels`. */
  disposition: ChannelDisposition;
}

export interface WirePayload {
  name: string;
  fields: WireField[];
}

/** One command the Uplink accepts, off its generated command map. */
export interface WireCommand {
  id: string;
  /** The args interface name. An empty shape means the command takes nothing. */
  args: string;
  /** What a dispatch resolves with, e.g. `CommandResult`. */
  result: string;
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
   * Wire shapes nothing on this page can route: a dynamic namespace's payload,
   * or a namespace added inside another channel's extensions bag. The
   * distinction between the two is not in the generated slice, so the page names
   * both rather than picking one.
   *
   * A command's args USED to be in here too, unmarked, which is how a reader of
   * the kOS page concluded that ten payloads were published on one topic. They
   * are routed now, through `commands`, so they have left.
   */
  payloads: WirePayload[];
  /**
   * The commands this Uplink accepts, and the shape of each one's arguments.
   * Empty for an Uplink that only publishes.
   */
  commands: WireCommand[];
  /** One entry per distinct args type named in `commands`, with its fields. */
  argShapes: WirePayload[];
}

const EMPTY: WireSurface = {
  present: false,
  channels: [],
  nested: [],
  payloads: [],
  commands: [],
  argShapes: [],
};

interface UnitsJson {
  types?: Record<string, Record<string, string>>;
  topics?: Record<string, Record<string, string>>;
  typeShapes?: Record<string, Record<string, string>>;
  topicShapes?: Record<string, Record<string, string>>;
}

/**
 * One entry of the generated payload map: `  "career.status": CareerStatus;` for
 * a single payload, or the same with a trailing `[]` for an array channel.
 * Anchored to the interface body's two-space indent so a topic id appearing in
 * the file's header prose cannot match, which the real emitted header does.
 */
const MAP_ENTRY = /^ {2}"([^"]+)": (\w+)(\[\])?;$/;

/**
 * One entry of the generated command map. Looser than {@link MAP_ENTRY} because
 * a reply is a type EXPRESSION rather than a bare name: `CommandResult`,
 * `CommandResultOf<Record<string, unknown>>`, or the interface a command that
 * does not answer a `CommandResult` resolves. The whole expression is what the
 * table prints, so it is captured whole.
 */
const COMMAND_ENTRY = /^ {2}"([^"]+)": (.+);$/;

/**
 * The two maps in the generated command file, read in one pass: the args map
 * comes first and the reply map second, so the block a line falls in is what
 * says which of the two it belongs to.
 */
function readCommands(dir: string): WireCommand[] {
  const path = join(dir, "command-map.ts");
  if (!existsSync(path)) return [];

  const args = new Map<string, string>();
  const replies = new Map<string, string>();
  let into: Map<string, string> | null = null;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (line.startsWith("export interface GeneratedCommandArgsMap"))
      into = args;
    else if (line.startsWith("export interface GeneratedCommandReplyMap"))
      into = replies;
    else if (line === "}") into = null;
    else if (into) {
      const match = COMMAND_ENTRY.exec(line);
      if (match) into.set(match[1], match[2]);
    }
  }

  return [...args.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, argsType]) => ({
      id,
      args: argsType,
      // The two maps come out of one codegen pass over one attribute, so a
      // command in the args map and missing from the reply map cannot happen
      // without the emitter changing. The fallback names the bare result rather
      // than printing an empty cell, so a format change shows up as a wrong
      // answer in review rather than as a gap nobody reads.
      result: replies.get(id) ?? "CommandResult",
    }));
}

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

  const dispositions = readChannelDispositions(pkgDir);
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
    /*
     * The cross-check that makes the C# scan safe to be a scan.
     *
     * This topic is declared in the generated slice, so it EXISTS, so a
     * `ChannelDeclaration` for it exists too and the scan should have found one.
     * Coming back empty means the scan missed a shape (a factory, a helper, a
     * layout it did not look in), and a scanner that quietly finds nothing is the
     * failure this project keeps meeting. So it fails here instead, naming the
     * topic, rather than printing a row with two blank columns.
     */
    if (dispositions.size > 0 && !dispositions.has(id)) {
      throw new Error(
        `gonogo-uplink docs: the channel "${id}" is declared in the generated ` +
          "contract slice, and no `ChannelDeclaration` for it was found in this " +
          "Uplink's C#.\n" +
          "The scan reads plain object initialisers and single-expression " +
          "factories (see packages/ui-kit/src/render/channels.ts). A declaration " +
          "built some other way needs that scan to grow, and this fails rather " +
          "than printing a row with no delivery and no delay, because a scanner " +
          "that silently finds nothing reports a clean pass.",
      );
    }
    channels.push({
      id,
      payload: entry.payload,
      array: entry.array,
      fields: fields(units.topics?.[id], units.topicShapes?.[id]),
      disposition: dispositions.get(id) ?? {},
    });
  }

  /*
   * Channels the C# declares that the generated slice does not type: a topic
   * whose payload lives in `Sitrep.Contract` rather than in this Uplink's own
   * slice, most often. Still this Uplink's wire surface, so still on the page.
   */
  for (const id of [...dispositions.keys()].sort()) {
    if (channels.some((channel) => channel.id === id)) continue;
    channels.push({
      id,
      array: false,
      fields: [],
      disposition: dispositions.get(id) ?? {},
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
  const commands = readCommands(dir);
  // A command's args type is routed by the Commands table below, so it leaves
  // the "nothing can route this" bucket. Every distinct one is described, even a
  // shape `units.json` has never heard of: an args class with no annotated
  // property (a no-args marker, or one carrying only untyped strings) is absent
  // from that file and would otherwise be named in the table with no row saying
  // what it holds.
  const argTypes = [...new Set(commands.map((c) => c.args))].sort();
  const argTypeSet = new Set(argTypes);

  const rest = Object.keys(units.types ?? {})
    .filter((name) => !named.has(name) && !argTypeSet.has(name))
    .sort();

  return {
    present: true,
    channels,
    nested: rest.filter((name) => held.has(name)).map(describe),
    payloads: rest.filter((name) => !held.has(name)).map(describe),
    commands,
    argShapes: argTypes.map(describe),
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
  if (list.length === 0) return "–";
  return list
    .map((f) =>
      f.shape ? `\`${f.name}\` ${f.shape}` : `\`${f.name}\` ${f.unit ?? "?"}`,
    )
    .join(", ");
}

/**
 * `## Wire`: two tables and no sentences.
 *
 * Channels with their payload, delivery and delay, then every payload shape with
 * its fields and each field's declared unit. A reader comparing Uplinks is
 * scanning for a topic name and a unit, and a paragraph between them is in the
 * way: this section carried four explanatory paragraphs and they said the same
 * things the tables' own headers do.
 *
 * The second table folds together shapes that reach the wire two different ways:
 * a nested payload another field holds, and a namespace inside another channel's
 * extensions bag. The distinction is not in the generated slice, and a `Kind`
 * column that could only ever say "one of two" is not a fact. Every one of them
 * is a shape this Uplink puts on the wire, which is what the table claims.
 * Command args used to be folded in here as a third, which is how the kOS page
 * read as ten payloads on one topic; they have their own section now.
 *
 * Nothing at all when the Uplink has no contract slice: a client-only Uplink
 * extending widgets that already exist adds no wire values, and a heading saying
 * so is the kind of line this page does not carry.
 */
export function wireSection(surface: WireSurface): string[] {
  if (!surface.present) return [];
  const out = ["## Wire", ""];

  if (surface.channels.length > 0) {
    out.push(
      "| Topic | Payload | Delivery | Delay |",
      "| --- | --- | --- | --- |",
      ...surface.channels.map(
        (c) =>
          `| \`${c.id}\` | ${c.payload ? `\`${c.payload}${c.array ? "[]" : ""}\`` : "–"} | ` +
          `${c.disposition.delivery ?? "–"} | ${c.disposition.delay ?? "–"} |`,
      ),
      "",
    );
  }

  const shapes = [...surface.nested, ...surface.payloads].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  if (shapes.length > 0) {
    out.push(
      "| Payload | Fields |",
      "| --- | --- |",
      ...shapes.map((p) => `| \`${p.name}\` | ${fieldList(p.fields)} |`),
      "",
    );
  }
  return out;
}

/**
 * `## Commands`: the write half, two tables and no sentences, beside `## Wire`.
 *
 * The page carried none of this until 2026-09-01. A reader could enumerate every
 * value an Uplink publishes and not one of the calls it accepts, which is not a
 * documentation gap: the vocabulary did not exist anywhere a third party could
 * reach. It is derived from the generated command map, the same rule the Wire
 * section follows, so a command added in C# reaches this table with no hand edit.
 *
 * The Result column is what a dispatch RESOLVES with, which is not what the
 * handler returns: a refusal rejects, carrying its `CommandErrorCode`, so
 * `CommandResult` in that column means "ran, or threw", never "said no quietly".
 *
 * There is deliberately no Delayed column, though `CommandDeclaration.Delayed`
 * is a real fact an author wants. It is set in the PLUGIN assembly, which no
 * generated artifact reaches, and one Uplink builds its whole list through a
 * private `DeclareCommands(...)` helper: a source scan would have found nothing
 * for it and said so by printing 29 blank cells. The channel scan next door is
 * safe because `readWireSurface` can cross-check every topic it should have
 * found; there is no equivalent check available here yet.
 */
export function commandSection(surface: WireSurface): string[] {
  if (surface.commands.length === 0) return [];
  const out = [
    "## Commands",
    "",
    "| Command | Args | Result |",
    "| --- | --- | --- |",
    ...surface.commands.map(
      (c) => `| \`${c.id}\` | \`${c.args}\` | \`${c.result}\` |`,
    ),
    "",
  ];

  if (surface.argShapes.length > 0) {
    out.push(
      "| Args | Fields |",
      "| --- | --- |",
      ...surface.argShapes.map(
        (p) => `| \`${p.name}\` | ${fieldList(p.fields)} |`,
      ),
      "",
    );
  }
  return out;
}
