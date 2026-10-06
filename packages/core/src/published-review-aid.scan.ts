import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import {
  compilerOptions,
  type EntryPoint,
  publishedEntryPoints,
} from "./published-entry-points";

/**
 * The scan behind `published-review-aid.test.ts`: a REVIEW AID, not a check.
 *
 * It lists the doc comments, widget descriptions and Uplink pages that a
 * reviewer should read again, each with the reason it was picked: a word a
 * review once called out in a sentence, history phrasing, a `##` heading that
 * reads as a sentence of argument. A hit is a prompt to read the sentence and
 * judge it. It is not a fault, no word is banned, nothing fails or is counted
 * against a build because of what it finds, and a legitimate use is expected.
 * The output is a reading list for rewrite and spot-check reviewers.
 *
 * Three corpora, listed apart:
 *
 * - doc comments: the `/** *\/` of every export of a published entry point and
 *   of its members, and the `///` XML docs of Sitrep.Contract's public members
 *   with their `<internal>` subtrees dropped
 * - widget descriptions: the `description` of every `registerComponent` call
 * - Uplink pages: each `uplink.md`
 *
 * Only prose is read. Inline code, fenced blocks, `{@link}` targets, tag
 * names and `@example` bodies are removed first, so `alarm.scet.arm` and a
 * code sample are never picked, and a `//` line comment is never a doc
 * comment. A pattern is kept precise so the list stays worth reading: the verb
 * "answers" and not the noun "an answer", "used to be" and not "used to
 * compare".
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

export type Family =
  | "arm"
  | "answer"
  | "caveat"
  | "floor"
  | "stale-word"
  | "legacy"
  | "history"
  | "heading";

export interface FamilyDefinition {
  /** What the pattern looks for, in a line. */
  summary: string;
  /** Matched against a prose paragraph with its whitespace collapsed. */
  pattern: RegExp;
  /** A paragraph matching this is left alone: the word is domain vocabulary there. */
  exclude?: RegExp;
  /** Prose that must hit. Wrapped mid-phrase where the pattern is multi-word. */
  plant: string;
  /** Prose that looks close and must not hit. */
  legitimate: string;
}

/**
 * Words are written in the pattern as typed here, assembled nowhere: this file
 * is not under any scanned root.
 */
export const FAMILIES: Record<Exclude<Family, "heading">, FamilyDefinition> = {
  arm: {
    summary:
      "a word a review called out: `arm`, for a variant of a union or as a verb",
    pattern:
      /\b(?:arms|arming|re-?arms?|(?:the|an?|each|every|that|this|one|other|both|either|neither|two|three|no|its|those|these|to|will|then|can|must|and|or|never|only|value-bearing|reckoning|none) arm)\b/i,
    exclude: /\b(?:disarm\w*|armed|alarms?)\b/i,
    plant: "so a reader branches on each\narm of the union",
    legitimate: "An alarm is armed by the host and disarmed by the client",
  },
  answer: {
    summary: "a word a review called out: `answers`, where `returns` is meant",
    pattern:
      /\b(?:answered|answering|(?<!\b(?:different|the|two|both|its|their|no|any|these|those|honest|real|wrong|right|few|many|other)\s)answers|(?:to|can|will|must|cannot|never|and|or|it|which|that|should|may) answer)\b/i,
    plant: "a hop that answers exactly\none pair",
    legitimate: "A null value is the honest answer when nothing was measured",
  },
  caveat: {
    summary: "a word a review called out: `caveat`",
    pattern: /\bcaveats?\b/i,
    plant: "a caveat drawn beside the value",
    legitimate: "Draws a note beside the value",
  },
  floor: {
    summary:
      "a word a review called out: `floor`, for a minimum or a recorded baseline",
    pattern: /\bfloor\b/i,
    plant: "the floor of the\nrange",
    legitimate: "Rounds down with `Math.floor`",
  },
  "stale-word": {
    summary:
      "a word a review called out: `stale`, which the docs write as `held`",
    pattern: /\bstale\b/i,
    plant: "a value that has gone\nstale",
    legitimate: "A value that has stopped updating is held",
  },
  legacy: {
    summary: "a word a review called out: `legacy`",
    pattern: /\blegacy\b/i,
    plant: "the legacy key",
    legitimate: "A key from an earlier version",
  },
  history: {
    summary:
      "history phrasing: `was renamed`, `used to be`, `no longer sends`, `previously`, `since <version>`",
    pattern:
      /\b(?:no longer (?:sends|emits|returns|exposes|uses|publishes|carries|supports|needs|requires|accepts|reads|writes)|previously|formerly|originally|renamed (?:from|to)|was (?:once|originally|formerly|previously|renamed|removed|deleted|replaced|retired|moved|split|added|introduced|dropped|merged|changed)|used to (?:be|return|emit|send|carry|have|do|live|read|mean|work|call|take|ride|ship)|since (?:v?\d+\.\d+|\d{4}-\d{2}|the \d+\.\d+|release \d|Major \d|contract \d))\b/i,
    plant: "a field that no longer\nreturns the clock",
    legitimate: "Used to compare two readings; was received at the host",
  },
};

export const HEADING_PLANT =
  "## The capacity's doubt is drawn at the end, and never merged with the value's";
export const HEADING_LEGITIMATE = "## Bands";

export type FamilyKey = Family;

export const FAMILY_KEYS: readonly Family[] = [
  ...(Object.keys(FAMILIES) as Exclude<Family, "heading">[]),
  "heading",
];

export interface ReviewPrompt {
  family: Family;
  /** The repo-relative file, or the path inside the sibling repository. */
  file: string;
  line: number;
  /** The matched text, or the whole heading. */
  text: string;
  /** The sentence the match sits in, for reading it in place. */
  excerpt: string;
  /** The `@category` of the comment the sentence is in, when it has one. */
  category?: string;
}

export interface ProseUnit {
  /** The `@category` or `<category>` the comment names, when it has one. */
  category?: string;
  file: string;
  line: number;
  /** The comment's text with code and tags removed, one paragraph or heading per line. */
  prose: string;
}

const FINITE_VERB =
  /\b(?:is|are|was|were|does|do|never|always|cannot|must|will|should|draws|shows|reads|marks)\b/i;

/**
 * Whether a heading is a sentence of argument rather than a category or a
 * short fact: long, punctuated mid-line or at its end, or a clause carrying a
 * finite verb. `Bands`, `States` and `Standard slots` are not.
 */
export function isSentenceHeading(heading: string): boolean {
  const text = heading.trim();
  const words = text.split(/\s+/).length;
  if (words > 6) return true;
  if (/[,;]|\.$/.test(text)) return true;
  return words >= 5 && FINITE_VERB.test(text);
}

/** The prose of a TSDoc or Markdown body: tags, fences, inline code and link targets removed. */
export function proseOfMarkdown(text: string): string {
  const out: string[] = [];
  let fenced = false;
  let skipTag = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (/^```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const tag = /^@([a-zA-Z]+)\b/.exec(line);
    if (tag) {
      skipTag = tag[1] === "example" || tag[1] === "category";
      if (skipTag) continue;
      out.push(
        line
          .replace(/^@(?:param|typeParam|typeparam|template)\s+\S+\s*-?\s*/, "")
          .replace(/^@[a-zA-Z]+\s*/, ""),
      );
      continue;
    }
    if (skipTag) {
      if (line === "") skipTag = false;
      continue;
    }
    out.push(/^#{2,6}\s/.test(line) ? line.replace(/`/g, "") : line);
  }
  return out
    .join("\n")
    .replace(/\{@[a-z]+\s+[^}]*\}/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
}

/** The body of a `/** ... *\/` comment, its asterisks removed. */
function docBody(comment: string): string {
  return comment
    .replace(/^\/\*\*+/, "")
    .replace(/\*+\/$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\*? ?/, ""))
    .join("\n");
}

/** The families that hit in one unit of prose. */
export function hitsInProse(unit: ProseUnit): ReviewPrompt[] {
  const hits: ReviewPrompt[] = [];
  const paragraphs = unit.prose.split(/\n\s*\n/);
  let offset = 0;
  for (const paragraph of paragraphs) {
    const lines = paragraph.split("\n");
    const headings = lines.filter((l) => /^#{2,6}\s+\S/.test(l));
    for (const heading of headings) {
      if (isSentenceHeading(heading.replace(/^#+\s+/, ""))) {
        hits.push({
          family: "heading",
          file: unit.file,
          line: unit.line,
          text: heading.trim(),
          excerpt: heading.trim(),
          category: unit.category,
        });
      }
    }
    const collapsed = lines
      .filter((l) => !/^#{2,6}\s+\S/.test(l))
      .join(" ")
      .replace(/\s+/g, " ");
    for (const [family, definition] of Object.entries(FAMILIES)) {
      if (definition.exclude?.test(collapsed)) continue;
      const flags = definition.pattern.flags.includes("g")
        ? definition.pattern.flags
        : `${definition.pattern.flags}g`;
      for (const match of collapsed.matchAll(
        new RegExp(definition.pattern, flags),
      )) {
        hits.push({
          family: family as Family,
          file: unit.file,
          line: unit.line + offset,
          text: match[0],
          excerpt: sentenceAround(collapsed, match.index ?? 0),
          category: unit.category,
        });
      }
    }
    offset += lines.length + 1;
  }
  return hits;
}

/** The sentence of `text` that holds `index`, trimmed to a readable length. */
function sentenceAround(text: string, index: number): string {
  const start = text.lastIndexOf(". ", index) + 1;
  const end = text.indexOf(". ", index);
  const sentence = text.slice(start, end === -1 ? undefined : end + 1).trim();
  return sentence.length > 240 ? `${sentence.slice(0, 237)}...` : sentence;
}

function lineOf(text: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/** The `/** *\/` comment directly above a declaration, or null. */
function docOf(sf: ts.SourceFile, node: ts.Node): ProseUnit | null {
  const target =
    ts.isVariableDeclaration(node) &&
    ts.isVariableDeclarationList(node.parent) &&
    ts.isVariableStatement(node.parent.parent)
      ? node.parent.parent
      : node;
  const ranges = ts
    .getLeadingCommentRanges(sf.text, target.getFullStart())
    ?.filter(
      (r) =>
        r.kind === ts.SyntaxKind.MultiLineCommentTrivia &&
        sf.text.startsWith("/**", r.pos),
    );
  const range = ranges?.at(-1);
  if (!range) return null;
  const body = docBody(sf.text.slice(range.pos, range.end));
  return {
    category: /^@category\s+(.+)$/m.exec(body)?.[1].trim(),
    file: sf.fileName,
    line: lineOf(sf.text, range.pos),
    prose: proseOfMarkdown(body),
  };
}

/** The declarations of a symbol and the members under them that carry their own doc. */
function documentedNodes(declaration: ts.Node, into: Set<ts.Node>): void {
  const visit = (node: ts.Node): void => {
    if (
      ts.isBlock(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node)
    ) {
      return;
    }
    if (
      ts.isPropertySignature(node) ||
      ts.isMethodSignature(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isEnumMember(node) ||
      ts.isPropertyAssignment(node) ||
      ts.isGetAccessor(node) ||
      ts.isSetAccessor(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isCallSignatureDeclaration(node) ||
      ts.isIndexSignatureDeclaration(node)
    ) {
      into.add(node);
    }
    ts.forEachChild(node, visit);
  };
  into.add(declaration);
  visit(declaration);
}

/** Every doc comment on what one entry point exports, deduplicated against `seen`. */
export function docUnitsOfEntry(
  program: ts.Program,
  entryFile: string,
  declaredElsewhere: (file: string) => boolean,
  seen: Set<string>,
  relativeTo: string,
): ProseUnit[] {
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(entryFile);
  const moduleSymbol = sf && checker.getSymbolAtLocation(sf);
  if (!moduleSymbol) return [];
  const units: ProseUnit[] = [];
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const symbol =
      exported.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(exported)
        : exported;
    for (const declaration of symbol.declarations ?? []) {
      const file = declaration.getSourceFile();
      if (
        declaredElsewhere(file.fileName) ||
        file.fileName.includes("/node_modules/") ||
        file.fileName.includes("/__generated__/")
      ) {
        continue;
      }
      const nodes = new Set<ts.Node>();
      documentedNodes(declaration, nodes);
      const category = docOf(file, declaration)?.category;
      for (const node of nodes) {
        const unit = docOf(file, node);
        if (!unit) continue;
        unit.category ??= category;
        const key = `${file.fileName}:${unit.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        units.push({
          ...unit,
          file: relative(relativeTo, file.fileName).split(sep).join("/"),
        });
      }
    }
  }
  return units;
}

export interface Corpus {
  /** What is counted: a package, or a corpus name. */
  name: string;
  units: ProseUnit[];
}

/** The doc comments of every published package's author entry points. */
export function publishedDocCorpora(root = REPO_ROOT): Corpus[] {
  const entries = publishedEntryPoints(root);
  const dirs = [...new Set(entries.map((e) => e.dir))];
  const packageOf = (file: string): string | null => {
    const rel = relative(root, file).split(sep).join("/");
    return dirs.find((dir) => rel.startsWith(`${dir}/`)) ?? null;
  };
  const corpora: Corpus[] = [];
  for (const dir of dirs) {
    const own = entries.filter((e) => e.dir === dir);
    const program = ts.createProgram(
      own.map((e) => join(root, dir, e.file)),
      compilerOptions(dir, root),
    );
    const seen = new Set<string>();
    const units: ProseUnit[] = [];
    for (const entry of own) {
      units.push(
        ...docUnitsOfEntry(
          program,
          join(root, dir, entry.file),
          (file) => {
            const owner = packageOf(file);
            return owner !== null && owner !== dir;
          },
          seen,
          root,
        ),
      );
    }
    corpora.push({ name: own[0].pkg, units });
  }
  return corpora;
}

/** Text of a C# XML doc with its `<internal>` subtree and its code removed, as Markdown-ish prose. */
export function proseOfXmlDoc(xml: string): string {
  return xml
    .replace(/<internal>[\s\S]*?<\/internal>/g, " ")
    .replace(/<(?:c|code)>[\s\S]*?<\/(?:c|code)>/g, " ")
    .replace(/<(?:see|seealso|paramref|typeparamref)\b[^>]*\/>/g, " ")
    .replace(
      /<\/?(?:para|b|i|summary|remarks|returns|list|item|description|term|example)\b[^>]*>/g,
      "\n",
    )
    .replace(/<param\b[^>]*>|<\/param>|<typeparam\b[^>]*>|<\/typeparam>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** A `.cs` file's public doc comments, one unit each. */
export function xmlDocUnits(source: string, file: string): ProseUnit[] {
  const units: ProseUnit[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*\/\/\//.test(lines[i])) continue;
    const start = i;
    const block: string[] = [];
    while (i < lines.length && /^\s*\/\/\//.test(lines[i])) {
      block.push(lines[i].replace(/^\s*\/\/\/ ?/, ""));
      i += 1;
    }
    let declaration = i;
    while (
      declaration < lines.length &&
      /^\s*(?:\[|$)/.test(lines[declaration])
    ) {
      declaration += 1;
    }
    const head = (lines[declaration] ?? "").trim();
    if (/^(?:private|internal|protected)\b/.test(head)) {
      i -= 1;
      continue;
    }
    const xml = block.join("\n");
    units.push({
      category: /<category>(.*?)<\/category>/.exec(xml)?.[1].trim(),
      file,
      line: start + 1,
      prose: proseOfXmlDoc(xml),
    });
    i -= 1;
  }
  return units;
}

function listFiles(dir: string, keep: (name: string) => boolean): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      ["node_modules", "obj", "bin", "dist", "__generated__"].includes(
        entry.name,
      )
    ) {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(path, keep));
      continue;
    }
    if (keep(entry.name)) out.push(path);
  }
  return out;
}

/** Sitrep.Contract's public members' XML docs. */
export function contractDocCorpus(root = REPO_ROOT): Corpus {
  const dir = join(root, "mod", "Sitrep.Contract");
  const units: ProseUnit[] = [];
  for (const file of listFiles(dir, (n) => n.endsWith(".cs"))) {
    units.push(
      ...xmlDocUnits(
        readFileSync(file, "utf8"),
        relative(root, file).split(sep).join("/"),
      ),
    );
  }
  return { name: "Sitrep.Contract", units };
}

/** The strings a `registerComponent` call carries as `description`, from a parsed file. */
export function descriptionsIn(sf: ts.SourceFile, file: string): ProseUnit[] {
  const units: ProseUnit[] = [];
  const text = (node: ts.Expression): string | null => {
    if (ts.isStringLiteralLike(node)) return node.text;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      const left = text(node.left);
      const right = text(node.right);
      return left !== null && right !== null ? left + right : null;
    }
    if (ts.isParenthesizedExpression(node)) return text(node.expression);
    return null;
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "registerComponent"
    ) {
      const [arg] = node.arguments;
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const property of arg.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === "description"
          ) {
            const value = text(property.initializer);
            if (value !== null) {
              units.push({
                file,
                line:
                  sf.getLineAndCharacterOfPosition(property.getStart(sf)).line +
                  1,
                prose: value,
              });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return units;
}

/** Widget descriptions under a source root, test files excluded. */
export function widgetDescriptionCorpus(
  name: string,
  root: string,
  dirs: readonly string[],
): Corpus {
  const units: ProseUnit[] = [];
  for (const dir of dirs) {
    const files = listFiles(
      join(root, dir),
      (n) => /\.tsx?$/.test(n) && !/\.(test|test-d|stories|d)\.tsx?$/.test(n),
    );
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("registerComponent")) continue;
      const sf = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      units.push(
        ...descriptionsIn(sf, relative(root, file).split(sep).join("/")),
      );
    }
  }
  return { name, units };
}

/** An `uplink.md` as prose units, front matter and fences handled by `proseOfMarkdown`. */
export function uplinkPageCorpus(
  name: string,
  root: string,
  files: readonly string[],
): Corpus {
  return {
    name,
    units: files.map((file) => ({
      file: relative(root, file).split(sep).join("/"),
      line: 1,
      prose: proseOfMarkdown(
        readFileSync(file, "utf8")
          .replace(/^---\n[\s\S]*?\n---\n/, "")
          .replace(/<!--[\s\S]*?-->/g, " "),
      ),
    })),
  };
}

/** Where the sibling Uplinks repository is, if it is checked out beside this one. */
export function siblingUplinksRoot(root = REPO_ROOT): string | null {
  const configured = process.env.GONOGO_UPLINKS_DIR;
  const path = configured ?? join(root, "..", "gonogo-uplinks");
  return existsSync(join(path, "uplinks")) ? path : null;
}

export interface ReviewScan {
  /** Doc comments, one corpus per published package and one for the contract. */
  docs: Corpus[];
  /** Widget descriptions. */
  widgets: Corpus[];
  /** Uplink pages. */
  uplinkPages: Corpus[];
  /** Hits by corpus name, then family. */
  hits: Map<string, ReviewPrompt[]>;
}

/** Reads every corpus and grades it. */
export function scanForReview(root = REPO_ROOT): ReviewScan {
  const docs = [...publishedDocCorpora(root), contractDocCorpus(root)];
  const widgets = [
    widgetDescriptionCorpus("core widgets", root, ["packages/components/src"]),
    widgetDescriptionCorpus("bundled Uplink widgets", root, [
      "mod/GonogoBreakingGroundUplink/client/src",
      "mod/GonogoMakingHistoryUplink/client/src",
    ]),
  ];
  const uplinkPages = [
    uplinkPageCorpus(
      "bundled Uplink pages",
      root,
      [
        "mod/GonogoBreakingGroundUplink",
        "mod/GonogoMakingHistoryUplink",
      ].flatMap((dir) => listFiles(join(root, dir), (n) => n === "uplink.md")),
    ),
  ];
  const sibling = siblingUplinksRoot(root);
  if (sibling) {
    const uplinks = join(sibling, "uplinks");
    uplinkPages.push(
      uplinkPageCorpus(
        "gonogo-uplinks pages",
        sibling,
        listFiles(uplinks, (n) => n === "uplink.md"),
      ),
    );
    widgets.push(
      widgetDescriptionCorpus(
        "gonogo-uplinks widgets",
        sibling,
        readdirSync(uplinks).map((u) => `uplinks/${u}/client/src`),
      ),
    );
  }
  const hits = new Map<string, ReviewPrompt[]>();
  for (const corpus of [...docs, ...widgets, ...uplinkPages]) {
    hits.set(
      corpus.name,
      corpus.units.flatMap((unit) => hitsInProse(unit)),
    );
  }
  return { docs, widgets, uplinkPages, hits };
}

/** Counts per family for one corpus. */
export function countsByFamily(
  hits: readonly ReviewPrompt[],
): Record<Family, number> {
  const counts = Object.fromEntries(FAMILY_KEYS.map((f) => [f, 0])) as Record<
    Family,
    number
  >;
  for (const hit of hits) counts[hit.family] += 1;
  return counts;
}

/** How many sentences each corpus holds to re-read, as a Markdown table. Not a count of faults. */
export function reportTable(scan: ReviewScan): string {
  const head = `| corpus | units read | ${FAMILY_KEYS.join(" | ")} | sentences to re-read |`;
  const rule = `| --- | ---: | ${FAMILY_KEYS.map(() => "---:").join(" | ")} | ---: |`;
  const rows: string[] = [];
  for (const [group, corpora] of [
    ["doc comments", scan.docs],
    ["widget descriptions", scan.widgets],
    ["uplink pages", scan.uplinkPages],
  ] as const) {
    for (const corpus of corpora) {
      const found = scan.hits.get(corpus.name) ?? [];
      const counts = countsByFamily(found);
      rows.push(
        `| ${group}: ${corpus.name} | ${corpus.units.length} | ${FAMILY_KEYS.map((f) => counts[f]).join(" | ")} | ${found.length} |`,
      );
    }
  }
  return [head, rule, ...rows].join("\n");
}

const HEADING_REASON =
  "a `##` heading that reads as a sentence of argument rather than a category or a short fact";

function reasonOf(family: Family): string {
  return family === "heading" ? HEADING_REASON : FAMILIES[family].summary;
}

export interface ListFilter {
  /** A substring of the corpus name, such as `ui-kit` or `Contract`. */
  corpus?: string;
  /** An exact `@category`, such as `Badge`. */
  category?: string;
}

/**
 * The reading list for review: sentences to read again, grouped by reason,
 * then by file and line. Narrow it to one corpus or one category. A sentence
 * here is a prompt to read it and judge it, never a fault.
 */
export function readingList(scan: ReviewScan, filter: ListFilter = {}): string {
  const out = [
    "# Sentences to re-read",
    "",
    "Each sentence below was picked as a prompt to read it and judge it. It is",
    "not a fault, no word is banned, and a legitimate use is expected among them.",
  ];
  for (const [name, hits] of scan.hits) {
    if (filter.corpus && !name.includes(filter.corpus)) continue;
    const picked = hits.filter(
      (h) => !filter.category || h.category === filter.category,
    );
    if (picked.length === 0) continue;
    out.push("", `## ${name} (${picked.length})`);
    const byReason = new Map<string, ReviewPrompt[]>();
    for (const hit of picked) {
      const reason = reasonOf(hit.family);
      byReason.set(reason, [...(byReason.get(reason) ?? []), hit]);
    }
    for (const [reason, all] of [...byReason].sort(([x], [y]) =>
      x.localeCompare(y),
    )) {
      const seen = new Set<string>();
      const found = all
        .filter((hit) => {
          const key = `${hit.file}:${hit.line}:${hit.excerpt}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((x, y) => x.file.localeCompare(y.file) || x.line - y.line);
      out.push("", `### ${reason} (${found.length})`);
      for (const hit of found) {
        out.push(`- ${hit.file}:${hit.line}: ${hit.excerpt}`);
      }
    }
  }
  return `${out.join("\n")}\n`;
}

/** A TS source graded by the same collectors, for the plants: its doc comments and its line comments. */
export function plantedTsHits(source: string): ReviewPrompt[] {
  const file = join(REPO_ROOT, "__wording_plant__.ts");
  const host = ts.createCompilerHost({});
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version) =>
    name === file
      ? ts.createSourceFile(name, source, version, true)
      : getSourceFile(name, version);
  host.fileExists = (name) => name === file || ts.sys.fileExists(name);
  host.readFile = (name) => (name === file ? source : ts.sys.readFile(name));
  const program = ts.createProgram([file], { noEmit: true }, host);
  return docUnitsOfEntry(
    program,
    file,
    () => false,
    new Set(),
    REPO_ROOT,
  ).flatMap((unit) => hitsInProse(unit));
}

export type { EntryPoint };
