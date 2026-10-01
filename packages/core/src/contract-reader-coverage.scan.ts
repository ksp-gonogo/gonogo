import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { enumerateTopicFields } from "@ksp-gonogo/sitrep-sdk";
import { widgetDrawnFields } from "@ksp-gonogo/ui-kit";
import ts from "typescript";
import { modTsRoots, SCANNED_PACKAGE_ROOTS } from "./unknown-cast.scan";

/**
 * The scan behind `styleguide-contract-reader-coverage.test.ts`: does any
 * PRODUCTION client read this contract field or send this contract command.
 *
 * gonogo Saga task 727. Core integrated the n-body arc and published it as
 * `vessel.orbit.Arc`, plus a `vessel.trajectory.forVantage` command; neither
 * had a production reader, only tests and an sdk hook. The existing ratchets
 * (`declaration-reachability`, uplink isolation, payload test coverage,
 * read-without-subscribe) never asked this question: `declaration-reachability`
 * grades an UPLINK's own declared topics/commands by whether the bare TOPIC id
 * is mentioned anywhere, which is exactly the blind spot named above, since
 * `vessel.orbit` is read everywhere and a topic-level check cannot see that one
 * FIELD of it never was.
 *
 * WHAT COUNTS AS A READER, per field:
 *
 *  1. A `registerComponent(...)` widget whose `channels`/`optionalChannels`
 *     name the field's Topic and whose `fields` (or the legacy flat
 *     `dataRequirements`) names the field. A widget that declares no `fields`
 *     is NOT credited with every field of its Topics: alarm attribution may
 *     treat such a widget as drawing everything it mounts on
 *     (`widgetDrawnFields`), but a mount is not a read, and crediting it hid
 *     `comms.delay`, `comms.link` and about 16 other payloads' `meta.source`,
 *     which no client reads.
 *  2. A non-widget production file that both (a) names the field's Topic as a
 *     string literal and (b) uses every segment of the field's path as an identifier
 *     somewhere in that file: `AlarmStatusBridge.tsx`, `TrajectoryCurrencyBridge.tsx`,
 *     the Settings panel and similar app chrome read contract fields directly,
 *     with no `registerComponent` in sight, and a gate that only understood
 *     widgets would manufacture debt for every one of them. This signal is
 *     Every segment need not be named: a field under a collection is read
 *     off an ELEMENT (`base.powerAvailable` for `deployed.bases.powerAvailable`,
 *     or a destructured `{ powerAvailable }`), so a nested path is also
 *     credited when its leaf is read as a member access or destructured
 *     binding, in a file that mounts the Topic or a sibling of one, provided no
 *     other contract field shares that leaf name. A leaf identifier merely
 *     appearing (a variable, a type name) is not enough.
 *     This signal is coarser (file-level co-occurrence, not a proven data-flow edge) and
 *     exists to avoid exactly that false debt; it can OVER-credit a field that
 *     merely shares a leaf name with something else the file touches, which is
 *     an acceptable failure direction for a signal that only ever CLEARS debt,
 *     never a substitute for signal 1.
 *  3. A production C# file under `mod/` (see `scanCsharpReaders`). The mod
 *     reads contract fields too, and a TypeScript-only scan reported them
 *     unread: `ScetPayload.ReadSource` reads `meta.source` of every SCET
 *     addressable Topic. The shape that counts is a dictionary-key read chain
 *     (`TryGetValue("meta"...)` then `TryGetValue("source"...)`, or
 *     `["meta"]["source"]`), credited to the Topics named by the file that
 *     holds the chain or by a file that calls the method that does. A `.Leaf`
 *     member access is deliberately not a reader: producers and serializers
 *     touch their own model's members constantly, and crediting those would
 *     over-credit worse than the TypeScript co-occurrence rule.
 *
 * WHAT COUNTS AS A COMMAND READER: a production file naming the command id as
 * a string literal, anywhere. `useCommand(id)` is the common shape, but a
 * command also dispatches through a `handle.send(...)` off a `useCommand`
 * result bound elsewhere, a local `send(id, args)` wrapper, or a bare
 * `service.dispatchCommand(id, args)` with no hook at all, and pattern-matching
 * one call shape undercounts real senders (measured against
 * `GoNoGoHostService`, `CommcastModLink` and `ManeuverPlanner`, none of which
 * call `useCommand` directly). A command id is namespaced and specific enough
 * that a plain literal match is trustworthy, the same trust
 * `declaration-reachability.ts` already places in it.
 *
 * THE CORPUS is `packages/*` plus every `mod/*\/client` (and `mod/sitrep-*`)
 * root with its own `tsconfig.json`, the same roots `unknown-cast.scan`
 * already discovers, minus `__generated__` directories, `dist`, and test
 * files. A bundled Uplink (today, only `GonogoBreakingGroundUplink`) is
 * therefore covered directly; the other Uplinks live in the separate
 * `gonogo-uplinks` repository and are NOT in this corpus at all: a field read
 * only there cannot be seen from here, which is why the debt list carries an
 * `Uplink-read: <name>` reason for those, checked from the other side by
 * `gonogo-uplinks/tooling/verify-contract-reader-debt.mjs`.
 *
 * WHY THE AST AND NOT A REGEX. A field's leaf name is a common enough word
 * (`state`, `type`, `id`) that a textual match with no structure would flag
 * every file that happens to use the word for something else. Parsing lets the
 * scan ask for an actual `Identifier`/`PropertyAssignment`/`CallExpression`
 * shape, and `registerComponent`'s own `channels`/`fields` arrays are read as
 * literal string ARRAYS rather than assumed from their text.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

const TOPIC_MAP_FILE = "mod/sitrep-sdk/src/__generated__/topic-map.ts";
const COMMAND_MAP_FILE = "mod/sitrep-sdk/src/__generated__/command-map.ts";

const GENERATED_ID_CONST = "GENERATED_TOPIC_IDS";
const GENERATED_COMMAND_ID_CONST = "GENERATED_COMMAND_IDS";

/**
 * One field of one contract Topic, as the gate grades it.
 */
export interface ContractField {
  topic: string;
  /** Dotted path relative to the Topic root, e.g. `"balances.funds"`. */
  path: string;
  /** The full `WidgetFieldPath` spelling a widget's `fields` array would use. */
  key: string;
}

export interface ReaderHit {
  /** How the reader was found. */
  via: "widget" | "field-access" | "command-literal" | "csharp-chain";
  /** Repo-relative file the reader lives in. */
  file: string;
  /** The widget id, when `via` is `"widget"`. */
  widgetId?: string;
}

export interface CoverageScan {
  fields: ContractField[];
  commands: string[];
  /** `topic.path` -> the reader(s) found for it. */
  fieldReaders: Map<string, ReaderHit[]>;
  /** command id -> the reader(s) found for it. */
  commandReaders: Map<string, ReaderHit[]>;
  /** Every file the scan actually parsed, repo-relative. */
  filesParsed: string[];
}

/**
 * Extract `export const NAME = [ "a", "b" ] as const;` by walking the AST, so a
 * reformatted or reordered generated file is still read correctly rather than
 * by a regex tuned to today's exact layout.
 */
export function stringArrayConst(
  source: string,
  file: string,
  constName: string,
): string[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const out: string[] = [];
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === constName &&
      node.initializer
    ) {
      let init = node.initializer;
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) {
        init = init.expression;
      }
      if (ts.isArrayLiteralExpression(init)) {
        found = true;
        for (const el of init.elements) {
          if (ts.isStringLiteral(el)) out.push(el.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!found) {
    throw new Error(
      `[contract-reader-coverage] ${file} has no array constant named ` +
        `${constName}; the generated contract's shape changed under this scan.`,
    );
  }
  return out;
}

/** Every Topic id the C# contract declares (`mod/sitrep-sdk`'s generated topic map). */
export function contractTopicIds(root = REPO_ROOT): string[] {
  return stringArrayConst(
    readFileSync(join(root, TOPIC_MAP_FILE), "utf8"),
    TOPIC_MAP_FILE,
    GENERATED_ID_CONST,
  );
}

/** Every command id the C# contract declares (`mod/sitrep-sdk`'s generated command map). */
export function contractCommandIds(root = REPO_ROOT): string[] {
  return stringArrayConst(
    readFileSync(join(root, COMMAND_MAP_FILE), "utf8"),
    COMMAND_MAP_FILE,
    GENERATED_COMMAND_ID_CONST,
  );
}

/** Every field of every contract Topic, via the sdk's own field catalogue (`enumerateTopicFields`). */
export function contractFields(
  topics: readonly string[] = contractTopicIds(),
): ContractField[] {
  const out: ContractField[] = [];
  for (const topic of topics) {
    for (const field of enumerateTopicFields(topic)) {
      out.push({ topic, path: field.path, key: `${topic}.${field.path}` });
    }
  }
  return out;
}

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "obj",
  "bin",
  "__generated__",
]);

/**
 * Test files, and the harness code beside them: a `scripts/` directory (fixture
 * generators, render probes) and a `src/test/` helper directory are not
 * production readers, and crediting them is how `comms.delay`'s `meta.source`
 * looked read.
 */
const isTest = (path: string): boolean =>
  /\.test\.tsx?$|\.test-d\.tsx?$|\/scripts\/|\/src\/test\//.test(path);
const isDeclaration = (path: string): boolean =>
  path === TOPIC_MAP_FILE || path === COMMAND_MAP_FILE;

function walkFiles(dir: string, out: string[] = []): string[] {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(path, out);
      continue;
    }
    if (/\.tsx?$/.test(path)) out.push(path);
  }
  return out;
}

function scriptKind(file: string): ts.ScriptKind {
  return file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

interface FileManifest {
  channels: string[];
  optionalChannels: string[];
  fields: string[];
}

/** Every `Array<string>` a string-literal array literal spells out, or `null` when any element is not a literal. */
function stringLiteralsOf(expr: ts.Expression): string[] | null {
  if (!ts.isArrayLiteralExpression(expr)) return null;
  const out: string[] = [];
  for (const el of expr.elements) {
    if (!ts.isStringLiteral(el)) return null;
    out.push(el.text);
  }
  return out;
}

const MANIFEST_KEYS = ["channels", "optionalChannels", "fields"] as const;

/**
 * The union of every `defineTopicManifest({...})` call's literal arrays in one
 * file. Files declare at most one manifest in practice; a second is unioned in
 * rather than disambiguated, which can only over-credit a field, the direction
 * this signal is allowed to err in (see the module doc).
 */
function fileManifestUnion(sf: ts.SourceFile): FileManifest {
  const out: FileManifest = { channels: [], optionalChannels: [], fields: [] };
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "defineTopicManifest" &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      for (const prop of node.arguments[0].properties) {
        if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name))
          continue;
        const key = prop.name.text;
        if (!(MANIFEST_KEYS as readonly string[]).includes(key)) continue;
        const literals = stringLiteralsOf(prop.initializer);
        if (literals)
          out[key as (typeof MANIFEST_KEYS)[number]].push(...literals);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

interface WidgetDeclaration {
  id?: string;
  channels: string[];
  optionalChannels: string[];
  fields: string[];
  dataRequirements: string[];
}

const WIDGET_KEYS = [
  "channels",
  "optionalChannels",
  "fields",
  "dataRequirements",
] as const;

/** Resolve one `registerComponent` property to the strings it names, literal or via the file's manifest. */
function resolvePropertyStrings(
  key: (typeof WIDGET_KEYS)[number],
  valueExpr: ts.Expression,
  manifest: FileManifest,
): string[] {
  const direct = stringLiteralsOf(valueExpr);
  if (direct) return direct;
  if (key === "dataRequirements") return [];
  if (ts.isIdentifier(valueExpr) && valueExpr.text === key)
    return manifest[key];
  if (ts.isPropertyAccessExpression(valueExpr) && valueExpr.name.text === key) {
    return manifest[key];
  }
  return [];
}

/** The property's name and value, for the two shapes `registerComponent`'s object literal writes them in. */
function propertyKeyAndValue(
  prop: ts.ObjectLiteralElementLike,
): { key: string; valueExpr: ts.Expression } | undefined {
  if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
    return { key: prop.name.text, valueExpr: prop.initializer };
  }
  if (ts.isShorthandPropertyAssignment(prop)) {
    return { key: prop.name.text, valueExpr: prop.name };
  }
  return undefined;
}

function findWidgetDeclarations(
  sf: ts.SourceFile,
  manifest: FileManifest,
): WidgetDeclaration[] {
  const out: WidgetDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "registerComponent" &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const decl: WidgetDeclaration = {
        channels: [],
        optionalChannels: [],
        fields: [],
        dataRequirements: [],
      };
      for (const prop of node.arguments[0].properties) {
        const kv = propertyKeyAndValue(prop);
        if (!kv) continue;
        const { key, valueExpr } = kv;
        if (key === "id" && ts.isStringLiteral(valueExpr)) {
          decl.id = valueExpr.text;
        }
        if ((WIDGET_KEYS as readonly string[]).includes(key)) {
          decl[key as (typeof WIDGET_KEYS)[number]] = resolvePropertyStrings(
            key as (typeof WIDGET_KEYS)[number],
            valueExpr,
            manifest,
          );
        }
      }
      out.push(decl);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * Every plain identifier and string literal named in this file.
 *
 * Command dispatch has no single call shape worth pattern-matching: the same
 * repo sends a command through `useCommand(id)` (most widgets),
 * `handle.send(args)` off a `useCommand` result named elsewhere
 * (`ManeuverPlanner`), a local `send(id, args)` wrapper
 * (`CommcastModLink`), and a bare `this.dispatchCommand(id, args)` on a
 * service class with no hook at all (`GoNoGoHostService`). A command id is
 * namespaced and specific enough (`"vessel.control.setThrottle"`, never a bare
 * word) that a plain STRING LITERAL match carries the same confidence
 * `declaration-reachability.ts` already trusted it with, so this reads
 * command ids the same way it reads field leaves: from the string-literal set,
 * not from one recognised call shape.
 */
function collectTokens(sf: ts.SourceFile): {
  identifiers: Set<string>;
  members: Set<string>;
  strings: Set<string>;
} {
  const identifiers = new Set<string>();
  const members = new Set<string>();
  const strings = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isExportDeclaration(node)) return;
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    if (ts.isPropertyAccessExpression(node)) members.add(node.name.text);
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const named = node.propertyName ?? node.name;
      if (ts.isIdentifier(named)) members.add(named.text);
    }
    if (ts.isStringLiteral(node)) strings.add(node.text);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return { identifiers, members, strings };
}

const EXPORTED_CONST_STRING_RE =
  /export const ([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*"([^"]+)"/g;

/**
 * `id -> the exported constant name(s) that alias it`, e.g.
 * `"commcast.traffic" -> {"COMMCAST_TRAFFIC_TOPIC"}` from
 * `packages/app/src/commcast/topics.ts`.
 *
 * A consumer names a Topic or command far more often through an imported
 * constant than by repeating the wire string: `CommcastModLink.ts` reads
 * `commcast.traffic` entirely through `COMMCAST_TRAFFIC_TOPIC`, and the
 * literal `"commcast.traffic"` appears nowhere in that file. Without this, the
 * string-literal signal below is blind to most of app chrome's own reads and
 * manufactures debt for a field a real subscriber already destructures.
 *
 * A textual regex rather than an AST walk per file, because this runs once
 * over the WHOLE corpus (every file, not just the ones already worth parsing)
 * and only ever feeds a lookup table that the AST-based signals below still
 * gate the real verdict on; a false alias here only widens which files get a
 * full parse; it does not itself mark anything read.
 */
function collectAliases(
  fileTexts: ReadonlyMap<string, string>,
  ids: ReadonlySet<string>,
): Map<string, Set<string>> {
  const aliases = new Map<string, Set<string>>();
  for (const text of fileTexts.values()) {
    if (!text.includes("export const")) continue;
    for (const m of text.matchAll(EXPORTED_CONST_STRING_RE)) {
      const name = m[1];
      const value = m[2];
      if (!ids.has(value)) continue;
      const set = aliases.get(value) ?? new Set<string>();
      set.add(name);
      aliases.set(value, set);
    }
  }
  return aliases;
}

/**
 * Every root the gate walks: the published/private package tree plus every
 * `mod/*` root with its own `tsconfig.json`, shared with `unknown-cast.scan`
 * so a package added there is covered here on the same day.
 */
export function readerScanRoots(repoRoot: string): string[] {
  return [...SCANNED_PACKAGE_ROOTS, ...modTsRoots(repoRoot)];
}

export function scanContractReaderCoverage(root = REPO_ROOT): CoverageScan {
  const topics = contractTopicIds(root);
  const commands = contractCommandIds(root);
  const fields = contractFields(topics);
  const fieldByKey = new Map(fields.map((f) => [f.key, f]));
  const fieldsByTopic = new Map<string, ContractField[]>();
  for (const f of fields) {
    const list = fieldsByTopic.get(f.topic) ?? [];
    list.push(f);
    fieldsByTopic.set(f.topic, list);
  }
  const leafCount = new Map<string, number>();
  for (const f of fields) {
    const leaf = f.path.slice(f.path.lastIndexOf(".") + 1);
    leafCount.set(leaf, (leafCount.get(leaf) ?? 0) + 1);
  }
  /** A field whose leaf name no other contract field shares, so a bare member access of it can only mean this one. */
  const hasUniqueLeaf = (f: ContractField): boolean =>
    leafCount.get(f.path.slice(f.path.lastIndexOf(".") + 1)) === 1;
  const topicSet = new Set(topics);
  const commandSet = new Set(commands);

  const fieldReaders = new Map<string, ReaderHit[]>();
  const commandReaders = new Map<string, ReaderHit[]>();
  const addField = (key: string, hit: ReaderHit): void => {
    if (!fieldByKey.has(key)) return;
    const list = fieldReaders.get(key) ?? [];
    list.push(hit);
    fieldReaders.set(key, list);
  };
  const addCommand = (id: string, hit: ReaderHit): void => {
    if (!commandSet.has(id)) return;
    const list = commandReaders.get(id) ?? [];
    list.push(hit);
    commandReaders.set(id, list);
  };

  const roots = readerScanRoots(root);
  const candidates: { abs: string; rel: string }[] = [];
  for (const relRoot of roots) {
    for (const abs of walkFiles(join(root, relRoot))) {
      const rel = abs
        .slice(root.length + 1)
        .split("\\")
        .join("/");
      if (isTest(rel) || isDeclaration(rel)) continue;
      candidates.push({ abs, rel });
    }
  }

  const texts = new Map<string, string>();
  for (const { abs, rel } of candidates) {
    try {
      texts.set(rel, readFileSync(abs, "utf8"));
    } catch {
      // Tracked but deleted in the working tree: nothing to parse.
    }
  }

  const topicAliases = collectAliases(texts, topicSet);
  const commandAliases = collectAliases(texts, commandSet);
  const aliasNamesOf = (
    aliases: Map<string, Set<string>>,
    id: string,
  ): string[] => [...(aliases.get(id) ?? [])];

  const filesParsed: string[] = [];
  const topicsByDir = new Map<string, Set<string>>();
  for (const { rel, text } of [...texts].map(([rel, text]) => ({
    rel,
    text,
  }))) {
    /*
     * Not `"registerComponent("`: a call with an explicit type argument
     * (`registerComponent<FooConfig>({`) has no such substring, and several
     * real widgets write exactly that, which silently dropped them from the
     * corpus until this was caught against `DeployedScience`.
     */
    const mightDeclareWidget = text.includes("registerComponent");
    const mightTouchContract =
      topics.some(
        (t) =>
          text.includes(t) ||
          aliasNamesOf(topicAliases, t).some((n) => text.includes(n)),
      ) ||
      commands.some(
        (c) =>
          text.includes(c) ||
          aliasNamesOf(commandAliases, c).some((n) => text.includes(n)),
      );
    if (!mightDeclareWidget && !mightTouchContract) continue;

    filesParsed.push(rel);
    const sf = ts.createSourceFile(
      rel,
      text,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(rel),
    );

    if (mightDeclareWidget) {
      const manifest = fileManifestUnion(sf);
      for (const decl of findWidgetDeclarations(sf, manifest)) {
        const drawn = widgetDrawnFields(decl);
        const declaresFields = decl.fields.length > 0;
        for (const entry of drawn) {
          if (topicSet.has(entry)) {
            // A bare Topic id counts only when written in `fields`: a mount is not a read.
            if (!declaresFields) continue;
            for (const f of fieldsByTopic.get(entry) ?? []) {
              addField(f.key, { via: "widget", file: rel, widgetId: decl.id });
            }
            continue;
          }
          addField(entry, { via: "widget", file: rel, widgetId: decl.id });
        }
      }
    }

    if (mightTouchContract) {
      const { identifiers, members, strings } = collectTokens(sf);
      const touchesId = (
        id: string,
        aliases: Map<string, Set<string>>,
      ): boolean =>
        strings.has(id) ||
        aliasNamesOf(aliases, id).some((n) => identifiers.has(n));

      for (const id of commands) {
        if (touchesId(id, commandAliases)) {
          addCommand(id, { via: "command-literal", file: rel });
        }
      }
      for (const topic of topics) {
        if (!touchesId(topic, topicAliases)) continue;
        const dir = rel.slice(0, rel.lastIndexOf("/"));
        const mounted = topicsByDir.get(dir) ?? new Set<string>();
        mounted.add(topic);
        topicsByDir.set(dir, mounted);
        for (const f of fieldsByTopic.get(topic) ?? []) {
          const segments = f.path.split(".");
          const leaf = segments[segments.length - 1];
          const namedWhole = segments.every((s) => identifiers.has(s));
          const readThroughElement = hasUniqueLeaf(f) && members.has(leaf);
          if (namedWhole || readThroughElement) {
            addField(f.key, { via: "field-access", file: rel });
          }
        }
      }
    }
  }

  /*
   * A widget's mount and its parser are usually sibling files: the one that
   * names the Topic hands the payload to a helper that reads `base.leaf` off
   * each element and never names the Topic itself. A sibling in the same
   * directory is credited for a nested field's leaf, by member access only.
   * Both relaxed credits need a leaf name no other contract field shares:
   * `source` or `kind` read off some object says nothing about which field.
   */
  for (const [rel, text] of texts) {
    const dir = rel.slice(0, rel.lastIndexOf("/"));
    const mounted = topicsByDir.get(dir);
    if (!mounted) continue;
    const { members } = collectTokens(
      ts.createSourceFile(
        rel,
        text,
        ts.ScriptTarget.Latest,
        true,
        scriptKind(rel),
      ),
    );
    for (const topic of mounted) {
      for (const f of fieldsByTopic.get(topic) ?? []) {
        const leaf = f.path.slice(f.path.lastIndexOf(".") + 1);
        const already = fieldReaders.get(f.key)?.some((h) => h.file === rel);
        if (hasUniqueLeaf(f) && members.has(leaf) && !already) {
          addField(f.key, { via: "field-access", file: rel });
        }
      }
    }
  }

  scanCsharpReaders(root, topics, fieldsByTopic, addField, filesParsed);

  return { fields, commands, fieldReaders, commandReaders, filesParsed };
}

const CSHARP_SKIP_DIRS = new Set(["node_modules", "obj", "bin"]);

/** Mod projects that only test, generate, fake or measure the contract, never serve a reader. */
const CSHARP_NON_PRODUCTION_PROJECT =
  /(\.Tests|\.TestSupport|\.Codegen|\.Package|\.Skeleton|\.LoadProbe|\.CaptureAnalysis|^GonogoDevTools)$/;

function walkCsharp(dir: string, out: string[] = []): string[] {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (CSHARP_SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkCsharp(path, out);
      continue;
    }
    if (/\.cs$/.test(path)) out.push(path);
  }
  return out;
}

const CSHARP_CONST_STRING_RE =
  /\bconst\s+string\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]+)"/g;

/**
 * A dictionary-key read chain: `TryGetValue("a", ...)` then `TryGetValue("b",
 * ...)` inside one statement, or adjacent indexers `["a"]["b"]`. A lone
 * indexer is deliberately not a read: `["a"] = ...` is how the wire is written.
 */
const CSHARP_READ_CHAIN_RE =
  /TryGetValue\(\s*"(\w+)"[^;]*?TryGetValue\(\s*"(\w+)"|\["(\w+)"\]\["(\w+)"\]/g;

const CSHARP_METHOD_HEAD_RE = /\b([A-Za-z_]\w*)\s*\([^()]*\)\s*(?:=>|\{)/g;
const CSHARP_NOT_A_METHOD = new Set([
  "if",
  "while",
  "for",
  "foreach",
  "switch",
  "catch",
  "using",
  "lock",
  "when",
]);

function escapeRe(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The mod's own readers of contract fields (signal 3 in the module doc).
 *
 * Production `.cs` under `mod/` (test, fake, codegen and probe projects are
 * left out). A file names a Topic by its wire string or by a `const string`
 * alias of it, the same two spellings the TypeScript side resolves.
 */
function scanCsharpReaders(
  root: string,
  topics: readonly string[],
  fieldsByTopic: ReadonlyMap<string, ContractField[]>,
  addField: (key: string, hit: ReaderHit) => void,
  filesParsed: string[],
): void {
  const modDir = join(root, "mod");
  const texts = new Map<string, string>();
  for (const abs of walkCsharp(modDir)) {
    const rel = abs
      .slice(root.length + 1)
      .split("\\")
      .join("/");
    const project = rel.split("/")[1] ?? "";
    if (CSHARP_NON_PRODUCTION_PROJECT.test(project)) continue;
    try {
      texts.set(rel, readFileSync(abs, "utf8"));
    } catch {
      // Tracked but deleted in the working tree: nothing to read.
    }
  }

  const topicSet = new Set(topics);
  const aliases = new Map<string, Set<string>>();
  for (const text of texts.values()) {
    if (!text.includes("const string")) continue;
    for (const m of text.matchAll(CSHARP_CONST_STRING_RE)) {
      if (!topicSet.has(m[2])) continue;
      const set = aliases.get(m[2]) ?? new Set<string>();
      set.add(m[1]);
      aliases.set(m[2], set);
    }
  }

  const methodChains = new Map<string, Set<string>>();
  const chainsOf = (text: string): { path: string; method?: string }[] => {
    const out: { path: string; method?: string }[] = [];
    for (const m of text.matchAll(CSHARP_READ_CHAIN_RE)) {
      let method: string | undefined;
      for (const h of text.slice(0, m.index).matchAll(CSHARP_METHOD_HEAD_RE)) {
        if (!CSHARP_NOT_A_METHOD.has(h[1])) method = h[1];
      }
      out.push({ path: `${m[1] ?? m[3]}.${m[2] ?? m[4]}`, method });
    }
    return out;
  };
  const fileChains = new Map<string, { path: string; method?: string }[]>();
  for (const [rel, text] of texts) {
    if (!text.includes("TryGetValue") && !text.includes('["')) continue;
    const chains = chainsOf(text);
    fileChains.set(rel, chains);
    for (const c of chains) {
      if (!c.method) continue;
      const set = methodChains.get(c.method) ?? new Set<string>();
      set.add(c.path);
      methodChains.set(c.method, set);
    }
  }

  for (const [rel, text] of texts) {
    const named = topics.filter(
      (t) =>
        text.includes(`"${t}"`) ||
        [...(aliases.get(t) ?? [])].some((n) =>
          new RegExp(`\\b${escapeRe(n)}\\b`).test(text),
        ),
    );
    if (named.length === 0) continue;
    let touched = false;
    const credit = (
      topic: string,
      predicate: (f: ContractField) => boolean,
      via: ReaderHit["via"],
    ): void => {
      for (const f of fieldsByTopic.get(topic) ?? []) {
        if (!predicate(f)) continue;
        touched = true;
        addField(f.key, { via, file: rel });
      }
    };

    const chainPaths = new Set<string>();
    for (const c of fileChains.get(rel) ?? []) chainPaths.add(c.path);
    for (const [method, paths] of methodChains) {
      if (new RegExp(`\\b${escapeRe(method)}\\s*\\(`).test(text)) {
        for (const p of paths) chainPaths.add(p);
      }
    }
    for (const topic of named) {
      credit(topic, (f) => chainPaths.has(f.path), "csharp-chain");
    }
    if (touched) filesParsed.push(rel);
  }
}
