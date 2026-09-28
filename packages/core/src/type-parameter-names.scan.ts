import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";

/**
 * The scan behind `styleguide-type-parameter-names.test.ts`: every type
 * parameter declared in a PUBLISHED package's source whose name is a single
 * character or a `T`-prefixed abbreviation (`TArgs`, `TConfig`).
 *
 * A published type parameter is read in an author's hover and in the generated
 * docs, where `Reading<V>` needs a sentence explaining what `V` is and
 * `Reading<Payload>` does not. Mapped-type keys and `infer` bindings count: they
 * appear in the same hovers.
 *
 * The one exemption is an interface merged into a THIRD-PARTY module
 * (`declare module "vitest" { interface Assertion<T> ... }`): TypeScript
 * requires every declaration of a merged interface to spell its type
 * parameters identically, so that name belongs to the library.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

const SOURCE_GLOBS = ["*.ts", "*.tsx", "*.mts", "*.cts"];

export interface TypeParameterHit {
  line: number;
  name: string;
  text: string;
}

export interface TypeParameterScan {
  /** The published packages found, by manifest directory; empty means discovery failed. */
  packages: string[];
  /** Every file parsed; empty means the listing failed, not that the tree is clean. */
  read: string[];
  hits: Map<string, TypeParameterHit[]>;
}

/** A single character, or `T` followed by a capitalised word. */
export function isAbbreviatedTypeParameter(name: string): boolean {
  return name.length === 1 || /^T[A-Z]/.test(name);
}

/** Whether `node` sits inside `declare module "<spec>"` for a module outside this workspace. */
function inThirdPartyAugmentation(node: ts.Node): boolean {
  for (let at: ts.Node | undefined = node; at; at = at.parent) {
    if (!ts.isModuleDeclaration(at) || !ts.isStringLiteral(at.name)) continue;
    return !at.name.text.startsWith("@ksp-gonogo/");
  }
  return false;
}

function scriptKind(file: string): ts.ScriptKind {
  return file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/** Every abbreviated type parameter in one source text. */
export function typeParameterHitsIn(
  source: string,
  file = "planted.ts",
): TypeParameterHit[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const lines = source.split("\n");
  const hits: TypeParameterHit[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isTypeParameterDeclaration(node) &&
      isAbbreviatedTypeParameter(node.name.text) &&
      !inThirdPartyAugmentation(node)
    ) {
      const { line } = sf.getLineAndCharacterOfPosition(node.name.getStart(sf));
      hits.push({
        line: line + 1,
        name: node.name.text,
        text: lines[line].trim(),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/**
 * Every workspace package that `npm publish` would publish: not `private`, by
 * the same flag the Uplink isolation gate reads, so there is no second list to
 * keep in step.
 */
export function publishedPackageDirs(root = REPO_ROOT): string[] {
  const manifests = execFileSync(
    "git",
    ["ls-files", "-z", "--", "package.json", "*/package.json"],
    { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  )
    .split("\0")
    .filter((file) => file && !file.includes("node_modules/"));
  const dirs: string[] = [];
  for (const manifest of manifests) {
    const pkg: unknown = JSON.parse(readFileSync(join(root, manifest), "utf8"));
    if (typeof pkg !== "object" || pkg === null) continue;
    if (!("name" in pkg) || typeof pkg.name !== "string") continue;
    if (!pkg.name.startsWith("@ksp-gonogo/")) continue;
    if ("private" in pkg && pkg.private === true) continue;
    dirs.push(dirname(manifest));
  }
  return dirs.sort();
}

/** The tracked TypeScript under each package's `src`, generated output included. */
export function publishedSources(
  packages: readonly string[],
  root = REPO_ROOT,
): string[] {
  if (packages.length === 0) return [];
  const pathspecs = packages.flatMap((dir) =>
    SOURCE_GLOBS.map((glob) => `${dir}/src/${glob}`),
  );
  return execFileSync("git", ["ls-files", "-z", "--", ...pathspecs], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
}

export function scanTypeParameterNames(
  files?: readonly string[],
  root = REPO_ROOT,
): TypeParameterScan {
  const packages = files ? [] : publishedPackageDirs(root);
  const hits = new Map<string, TypeParameterHit[]>();
  const read: string[] = [];
  for (const file of files ?? publishedSources(packages, root)) {
    let source: string;
    try {
      source = readFileSync(join(root, file), "utf8");
    } catch {
      // Tracked but deleted in the working tree: nothing to parse.
      continue;
    }
    read.push(file);
    const found = typeParameterHitsIn(source, file);
    if (found.length > 0) hits.set(file, found);
  }
  return { packages, read, hits };
}

/**
 * The gate's verdict on one scan, or `null` when it passes.
 *
 * A scan that read nothing fails as BLIND rather than passing: a listing that
 * errored into an empty string or a discovery that found no package would
 * otherwise look exactly like a clean tree.
 */
export function typeParameterVerdict(scan: TypeParameterScan): string | null {
  if (scan.read.length === 0) {
    return "BLIND: the type-parameter scan read no files, so a clean result means nothing";
  }
  if (scan.hits.size === 0) return null;
  const lines = [...scan.hits].flatMap(([file, found]) =>
    found.map((hit) => `  ${file}:${hit.line}  ${hit.name}  ${hit.text}`),
  );
  return [
    `${lines.length} abbreviated type parameter(s) in published source. Name each for what it is (Payload, Unit, Topic, Slot), choosing a word that does not shadow a type already in scope:`,
    ...lines,
  ].join("\n");
}
