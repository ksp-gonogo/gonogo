/**
 * Which declared Topics and commands a client actually READS.
 *
 * Pure scan module, no test logic, so the shrink-only check can transpile it at
 * an arbitrary git ref without pulling in vitest. Same split-module shape as
 * `comment-stacks.scan.ts` and `panel-body.scan.ts`.
 *
 * WHY THIS EXISTS. Every other gate in the tree asks whether what exists is
 * CORRECT: the isolation ratchets police what an Uplink may import, the
 * extraction probe proves the published surface builds standing alone, the docs
 * gate proves each page regenerates. None of them asks whether what exists is
 * REACHED. `rp1.tooling` shipped as the mod half only, a Topic plus two commands
 * plus 159 lines of payload contract with no consumer at all, and passed every
 * one of them, because a declaration nothing reads is still a correct
 * declaration.
 *
 * WHY NOT A REGEX OVER TOPIC IDS. Each Uplink's `__generated__` directory
 * contains every id it declares, so grepping the tree for an id finds it whether
 * or not a human wrote a read. The scan therefore excludes generated files from
 * the CONSUMER corpus while taking the declaration list FROM them, which is the
 * only arrangement where a hit means somebody typed the id on purpose.
 *
 * WHY THE AST AND NOT LINE MATCHING. `index.ts` re-exports every Topic constant
 * its Uplink declares. Re-export is plumbing, not consumption: counting it marks
 * every declaration reached and the gate reports a permanent all-clear. Measured
 * on 2026-09-02, taking barrels at face value hid 8 of the 44 declared Topics,
 * `rp1.tooling` among them. `collectReferences` walks the tree and skips
 * `ExportDeclaration` outright for exactly that reason.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import ts from "typescript";

/** A Topic or command declared by an Uplink, with the constant that names it. */
export interface Declaration {
  /** Directory name under `mod/`, e.g. `GonogoRp1Uplink`. */
  uplink: string;
  kind: "topic" | "command";
  /** The wire id, e.g. `rp1.tooling`. */
  id: string;
  /** The exported constant, when one names it. Commands come off a generated array and have none. */
  konst?: string;
  /** Repo-relative file the declaration was read from. */
  declaredIn: string;
}

export interface ReachabilityScan {
  declarations: Declaration[];
  /** Declarations no consumer file names, by either id or constant. */
  unreached: Declaration[];
  /** Consumer files parsed, i.e. the ones that mentioned any candidate token. */
  filesParsed: number;
  /** Every file in the consumer corpus, parsed or not. */
  corpusSize: number;
}

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "obj",
  "bin",
  "__generated__",
]);

/**
 * A Domain presence gate is consumed generically and cannot be proven
 * individually.
 *
 * `AugmentAvailabilityFeeder` mounts one `DomainAvailabilityWatch` per watched
 * Domain and reads <code>useTelemetry(`${domain}.available`)</code>, so the id is
 * assembled at runtime from a string nobody writes down. Every `*.available`
 * Topic is reached by that one call site and none of them appears as a literal
 * anywhere. Listing them as debt would be false: the consumer exists, this
 * method just cannot see it. Bounded rather than ignored, and narrow on purpose,
 * it is the only computed-id consumer in the tree.
 */
export function hasGenericConsumer(id: string): boolean {
  return id.endsWith(".available");
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(path)) out.push(path);
  }
  return out;
}

const isTest = (path: string): boolean =>
  /\.test\.tsx?$|\.test-d\.ts$/.test(path);

/**
 * Identifiers and string literals a file USES.
 *
 * `ExportDeclaration` is skipped whole, so `export { RP1_TOOLING_TOPIC } from
 * "./topics"` contributes nothing. A declaration site is excluded by the caller
 * rather than here, because `export const X = "x"` is a variable statement and
 * looks identical to a use from inside the AST.
 */
function collectReferences(
  file: string,
  text: string,
): {
  identifiers: Set<string>;
  strings: Set<string>;
} {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const identifiers = new Set<string>();
  const strings = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isExportDeclaration(node)) return;
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    else if (ts.isStringLiteral(node)) strings.add(node.text);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return { identifiers, strings };
}

/** Uplink client source roots, e.g. `mod/GonogoRp1Uplink/client/src`. */
export function uplinkClientRoots(repoRoot: string): string[] {
  const modDir = join(repoRoot, "mod");
  let entries: string[];
  try {
    entries = readdirSync(modDir);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => /^Gonogo.*Uplink$/.test(entry))
    .map((entry) => join(modDir, entry, "client", "src"))
    .filter((dir) => {
      try {
        return statSync(dir).isDirectory();
      } catch {
        return false;
      }
    });
}

const TOPIC_CONST_RE = /export const ([A-Z0-9_]+_TOPIC)\s*=\s*"([^"]+)"/g;
const COMMAND_IDS_RE =
  /export const GENERATED_COMMAND_IDS\s*=\s*\[([\s\S]*?)\]/;

/** Every Topic and command an Uplink declares, read from its own sources. */
export function collectDeclarations(repoRoot: string): Declaration[] {
  const declarations: Declaration[] = [];
  for (const srcDir of uplinkClientRoots(repoRoot)) {
    const uplink = basename(join(srcDir, "..", ".."));

    const topicsFile = join(srcDir, "topics.ts");
    let topicsText: string | undefined;
    try {
      topicsText = readFileSync(topicsFile, "utf8");
    } catch {
      topicsText = undefined;
    }
    if (topicsText) {
      for (const match of topicsText.matchAll(TOPIC_CONST_RE)) {
        declarations.push({
          uplink,
          kind: "topic",
          id: match[2],
          konst: match[1],
          declaredIn: relative(repoRoot, topicsFile),
        });
      }
    }

    const commandMap = join(srcDir, "__generated__", "command-map.ts");
    let commandText: string | undefined;
    try {
      commandText = readFileSync(commandMap, "utf8");
    } catch {
      commandText = undefined;
    }
    const ids = commandText?.match(COMMAND_IDS_RE);
    if (ids) {
      for (const match of ids[1].matchAll(/"([^"]+)"/g)) {
        declarations.push({
          uplink,
          kind: "command",
          id: match[1],
          declaredIn: relative(repoRoot, commandMap),
        });
      }
    }
  }
  return declarations;
}

/**
 * Scan the tree and report which declarations no client reads.
 *
 * The consumer corpus is every non-generated, non-test `.ts`/`.tsx` under `mod/`
 * and `packages/`, not just the declaring Uplink's own client: a Topic may
 * legitimately be read by the SDK or by an app package, and scoping the search
 * to one Uplink would invent violations. Declaration sites themselves are
 * excluded, so a Topic is not counted as reading itself.
 */
export function scanReachability(repoRoot: string): ReachabilityScan {
  const declarations = collectDeclarations(repoRoot);
  const declarationSites = new Set(
    declarations.map((declaration) => declaration.declaredIn),
  );

  const corpus = [join(repoRoot, "mod"), join(repoRoot, "packages")]
    .flatMap((root) => walk(root))
    .filter((file) => !isTest(file))
    .filter((file) => !declarationSites.has(relative(repoRoot, file)));

  // Only files that mention a candidate token are worth an AST parse, which
  // keeps this to a couple of hundred files rather than the whole tree.
  const tokens = new Set<string>();
  for (const declaration of declarations) {
    tokens.add(declaration.id);
    if (declaration.konst) tokens.add(declaration.konst);
  }

  const identifiers = new Set<string>();
  const strings = new Set<string>();
  let filesParsed = 0;
  for (const file of corpus) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    let interesting = false;
    for (const token of tokens) {
      if (text.includes(token)) {
        interesting = true;
        break;
      }
    }
    if (!interesting) continue;
    filesParsed += 1;
    const found = collectReferences(file, text);
    for (const name of found.identifiers) identifiers.add(name);
    for (const literal of found.strings) strings.add(literal);
  }

  const unreached = declarations.filter((declaration) => {
    if (hasGenericConsumer(declaration.id)) return false;
    if (strings.has(declaration.id)) return false;
    if (declaration.konst && identifiers.has(declaration.konst)) return false;
    return true;
  });

  return { declarations, unreached, filesParsed, corpusSize: corpus.length };
}

/** `<uplink>: <kind> <id>`, the shape the debt list is keyed by. */
export function debtKey(declaration: Declaration): string {
  return `${declaration.uplink}: ${declaration.kind} ${declaration.id}`;
}
