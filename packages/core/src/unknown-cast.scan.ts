/**
 * Finds the escape hatch out of `unknown`: a type assertion whose subject the
 * compiler knows nothing about.
 *
 * `unknown` is the right return for a genuine boundary. It forces a reader to
 * narrow, and that is the whole value of it. What has no value is the exit:
 * `value as SomeType` is accepted out of `unknown` to anything at all, with no
 * check, so a WRONG assertion compiles exactly like a right one and the reader
 * gets a typed handle on a shape the value never had.
 *
 * That is not hypothetical. Seven call sites in one Uplink asserted that a
 * command envelope was the flat payload inside it, which was false, so three
 * receipt fields read `undefined` on every write ever made and the "nothing was
 * written" banner could not fire. It survived weeks behind a
 * passing test whose fixture carried the same mistake. Nothing complained,
 * because `unknown` accepts every reader including a wrong one.
 *
 * WHY THE COMPILER AND NOT A REGEX. The question is "what is the type of the
 * thing being asserted", and only the compiler can answer it. A regex over
 * `as ` cannot tell `payload as Receipt` (payload is `unknown`, nothing was
 * checked) from the same line three statements later, after a `typeof` guard
 * has narrowed `payload` to `object`. Those two are the defect and the fix, and
 * a scanner that reports both is a scanner that has to be turned off.
 *
 * That distinction is also why biome's `noUnsafeTypeAssertion` (nursery, 2.5.9+)
 * is not this rule. It bans every assertion but `as const`, syntactically, with
 * no type information: run against this tree it reports 2381 sites, and two of
 * them are both halves of the repo's own worked example of the correct remedy,
 * which `unknown-cast.test.ts` compiles as its false-positive control. Measured,
 * not assumed, on 2026-09-04.
 *
 * WHAT COUNTS
 *
 *  - `x as T` and `<T>x`, where the type of `x` AT THAT POINT is `unknown` or
 *    `any`. Narrowing is credited automatically: after a real guard the type is
 *    no longer `unknown` and there is nothing to report
 *  - `x as unknown as T` (and `as any as`) counts DOUBLE. It is the shape that
 *    exists only to defeat the compiler's own refusal to allow the conversion,
 *    so it is reported separately and held to its own list
 *
 * WHAT DOES NOT
 *
 *  - `as const`: an assertion about literalness, not about identity
 *  - `x as unknown` / `x as any` on their own: widening loses a guarantee, it
 *    does not claim one. The claim is in the assertion that follows, which is
 *    the one counted above
 *  - an assertion whose subject is the compiler's ERROR type. That is a build
 *    that did not resolve, not a defect in the source, and reporting it would
 *    make the census depend on whether `dist` happened to be built. The scan
 *    counts those separately and the gate fails on any, so the case is loud
 *    rather than absorbed
 *
 * Excluded from `tsconfig.build.json`: this reaches for `typescript` and
 * `node:fs`, neither of which belongs in core's published dist.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/**
 * `packages/*` roots in the scan. Explicit, because a new package here is a
 * deliberate act and `UNSCANNED_PACKAGE_ROOTS` below makes an omission speak.
 */
export const SCANNED_PACKAGE_ROOTS = [
  "packages/app",
  "packages/components",
  "packages/core",
  "packages/data",
  "packages/logger",
  "packages/relay",
  "packages/serial",
  "packages/sitrep-client",
  "packages/test-utils",
  "packages/theme",
  "packages/ui",
  "packages/ui-kit",
] as const;

/**
 * `packages/*` deliberately outside the scan, each with the reason.
 *
 * EMPTY, and the empty list is the point: `unknown-cast.test.ts` asserts that
 * every `packages/*` carrying a `tsconfig.json` is either scanned or named
 * here, so a new package cannot be born outside the rule by nobody noticing.
 */
export const UNSCANNED_PACKAGE_ROOTS: { path: string; reason: string }[] = [];

/**
 * Every TypeScript root under `mod/`, found by looking rather than listed.
 *
 * An Uplink client is a `mod/<Uplink>/client`, and `mod/sitrep-*` are the SDK
 * and its two servers. Discovered, so an Uplink landing tomorrow is covered
 * tomorrow: a hand-list is what left three raw hex literals ungated when the
 * design-system roots were enumerated by hand.
 */
export function modTsRoots(repoRoot: string): string[] {
  const modDir = join(repoRoot, "mod");
  if (!existsSync(modDir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(modDir)) {
    for (const rel of [join("mod", name, "client"), join("mod", name)]) {
      const abs = join(repoRoot, rel);
      if (!existsSync(join(abs, "tsconfig.json"))) continue;
      if (!statSync(abs).isDirectory()) continue;
      out.push(rel);
      break;
    }
  }
  return out.sort();
}

/** Every root the gate walks, workspace-relative and POSIX-spelled. */
export function unknownCastScanRoots(repoRoot: string): string[] {
  return [...SCANNED_PACKAGE_ROOTS, ...modTsRoots(repoRoot)];
}

/** One assertion out of `unknown` or `any`. */
export interface UnknownCastSite {
  /** Repo-relative, POSIX separators. */
  file: string;
  /** One-based, so it pastes into an editor. */
  line: number;
  /** What the compiler knew about the subject: nothing, or nothing checked. */
  kind: "unknown" | "any";
  /** `x as unknown as T`: an assertion laundered through a widening. */
  double: boolean;
  /** The assertion as written, whitespace collapsed, for the failure message. */
  text: string;
}

/** What one root's walk found, including the numbers that grade the walk. */
export interface RootScan {
  root: string;
  /** Non-declaration source files inside the root that the program contained. */
  files: number;
  /** Every non-`const` assertion seen, offending or not. */
  assertions: number;
  /**
   * Assertions whose subject was the compiler's ERROR type.
   *
   * Counted rather than ignored. It means the program did not resolve, and a
   * scan reading unresolved types reports whatever it likes; the gate fails on
   * any, naming the build step that fixes it.
   */
  errorTyped: number;
  /** Import specifiers in the walked files that resolved to no module. */
  unresolvedImports: string[];
  sites: UnknownCastSite[];
}

const isConstAssertion = (target: ts.TypeNode): boolean =>
  ts.isTypeReferenceNode(target) &&
  ts.isIdentifier(target.typeName) &&
  target.typeName.text === "const";

const isWideKeyword = (target: ts.TypeNode): boolean =>
  target.kind === ts.SyntaxKind.UnknownKeyword ||
  target.kind === ts.SyntaxKind.AnyKeyword;

type Assertion = ts.AsExpression | ts.TypeAssertion;

const isAssertion = (node: ts.Node): node is Assertion =>
  ts.isAsExpression(node) || ts.isTypeAssertionExpression(node);

/**
 * The verdict on one assertion, or null when there is nothing to report.
 *
 * Exported so the blindness check can drive the predicate itself rather than
 * inferring it from a whole-tree count, and so the regeneration script cannot
 * hold a second copy of the rule that drifts from the gate's.
 */
export function classifyAssertion(
  checker: ts.TypeChecker,
  node: Assertion,
): { kind: "unknown" | "any"; double: boolean } | "error-typed" | null {
  if (isConstAssertion(node.type)) return null;
  // Widening claims nothing. The claim, if there is one, is the assertion
  // wrapped around this one, and that is where it gets counted.
  if (isWideKeyword(node.type)) return null;

  const type = checker.getTypeAtLocation(node.expression);
  const intrinsic = (type as ts.Type & { intrinsicName?: string })
    .intrinsicName;
  const wide = Boolean(type.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any));
  if (!wide) return null;
  if (intrinsic === "error") return "error-typed";

  const inner = skipParens(node.expression);
  const double = isAssertion(inner) && isWideKeyword(inner.type);
  return {
    kind: type.flags & ts.TypeFlags.Unknown ? "unknown" : "any",
    double,
  };
}

function skipParens(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

/**
 * Import specifiers in `sf` that bind a name and resolved to nothing.
 *
 * The point is not tidiness, it is whether the types this scan reads are real:
 * an import that did not resolve makes everything reached through it the ERROR
 * type, and a census taken through one is a census of the build.
 *
 * A SIDE-EFFECT import is skipped, and skipping it is not a loophole. `import
 * "@testing-library/jest-dom"`, `import "fake-indexeddb/auto"` and a CSS import
 * bind no name, so the compiler reports no module symbol for them whether they
 * resolved or not, and nothing downstream can be typed through them. Asking
 * about them flagged fifteen of the twenty-five roots on a fully built tree.
 */
function unresolvedIn(checker: ts.TypeChecker, sf: ts.SourceFile): string[] {
  const out: string[] = [];
  for (const statement of sf.statements) {
    let specifier: ts.Expression | undefined;
    if (ts.isImportDeclaration(statement)) {
      if (!statement.importClause) continue;
      specifier = statement.moduleSpecifier;
    } else if (ts.isExportDeclaration(statement)) {
      specifier = statement.moduleSpecifier;
    }
    if (!specifier || !ts.isStringLiteral(specifier)) continue;
    // A type-only import of a type-only module still resolves to a symbol; no
    // symbol at all means the module was not found.
    if (!checker.getSymbolAtLocation(specifier)) out.push(specifier.text);
  }
  return out;
}

/** Walk one already-built program, reporting only files inside `absPrefix`. */
export function scanProgram(
  program: ts.Program,
  repoRoot: string,
  root: string,
  absPrefix: string,
): RootScan {
  const checker = program.getTypeChecker();
  const scan: RootScan = {
    root,
    files: 0,
    assertions: 0,
    errorTyped: 0,
    unresolvedImports: [],
    sites: [],
  };

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    if (!sf.fileName.startsWith(absPrefix)) continue;
    if (sf.fileName.includes("/node_modules/")) continue;
    scan.files += 1;
    scan.unresolvedImports.push(...unresolvedIn(checker, sf));

    const visit = (node: ts.Node): void => {
      if (isAssertion(node)) {
        if (!isConstAssertion(node.type)) scan.assertions += 1;
        const verdict = classifyAssertion(checker, node);
        if (verdict === "error-typed") {
          scan.errorTyped += 1;
        } else if (verdict) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
          scan.sites.push({
            file: sf.fileName.slice(repoRoot.length + 1),
            line: line + 1,
            kind: verdict.kind,
            double: verdict.double,
            text: node.getText().replace(/\s+/g, " ").slice(0, 140),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  scan.sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return scan;
}

/**
 * Build the root's own program from its own `tsconfig.json`.
 *
 * The compiler's config parser rather than a re-reading of `include` /
 * `exclude`: a package that arrives at its file set some other way (`files`, an
 * inherited `exclude`, a narrowed `include`) is then covered by the same walk
 * instead of by a second implementation of glob semantics.
 */
export function scanRoot(repoRoot: string, root: string): RootScan {
  const configPath = join(repoRoot, root, "tsconfig.json");
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => {},
  } as ts.ParseConfigFileHost);
  if (!parsed) {
    throw new Error(
      `[unknown-cast] ${root}/tsconfig.json would not parse, so nothing in ` +
        "that root was scanned. A root the gate cannot read is a root outside " +
        "the rule.",
    );
  }
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: { ...parsed.options, noEmit: true },
  });
  return scanProgram(program, repoRoot, root, `${join(repoRoot, root)}/`);
}

/** Every root, in order. */
export function scanUnknownCasts(repoRoot: string): RootScan[] {
  return unknownCastScanRoots(repoRoot).map((root) => scanRoot(repoRoot, root));
}

/**
 * Scan a directory of hand-written files as its own root.
 *
 * The planted-violation check uses this, and uses the SAME `scanProgram` the
 * real walk uses, so a plant that is seen proves the live predicate saw it
 * rather than proving a parallel implementation agrees with itself.
 */
export function scanScratchDir(
  dir: string,
  fileNames: string[],
  options: ts.CompilerOptions = {},
): RootScan {
  const program = ts.createProgram({
    rootNames: fileNames,
    options: {
      strict: true,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      noEmit: true,
      ...options,
    },
  });
  return scanProgram(program, dir, "", `${dir}/`);
}
