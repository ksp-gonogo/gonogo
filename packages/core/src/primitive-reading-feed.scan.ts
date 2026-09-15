/**
 * Finds the drift ruling 8 of ticket 257 exists to stop: a primitive that says it
 * handles a `Reading` being handed the value with the currency stripped off it.
 *
 * `Unit` and `Meter` each widened to `Value<U> | Reading<Value<U>>`, because
 * ruling 7 is right that a definite quantity should be passable as one. The
 * cost of that widening is that the compiler can no longer tell a caller who
 * HAS a reading to pass the reading:
 *
 *     const altitude = flight.altitudeAsl;   // Reading<Value<"m">>
 *     <Unit value={altitude.value} />        // compiles. Band and staleness gone
 *
 * Both lines typecheck, both render a number, and the second silently drops the
 * not-current mark and the uncertainty band that tickets 64 and 255 put there. That
 * is not a hypothetical failure mode: it is the SHORTER thing to write, and it
 * is what a call site reaches for the moment the reading's optional `value`
 * annoys it.
 *
 * WHY THE COMPILER AND NOT A REGEX. The question is "what is the type of the
 * thing this prop was handed", and only the compiler answers it. A text scan
 * for `value={x.value}` reports zero on this tree today and would keep
 * reporting zero through
 *
 *     const shown = altitude.value;
 *     <Unit value={shown} />
 *
 * which is the same defect with a variable in the way. It also cannot tell a
 * reading's `.value` from any other member spelled `value`. A gate that a
 * one-line refactor walks through is a gate that certifies the defect.
 *
 * WHAT COUNTS
 *
 *  - a JSX attribute whose DECLARED type accepts a reading (any union arm of
 *    the contextual type is reading-shaped), handed an expression whose type is
 *    NOT a reading, where that expression is `<reading>.value`: directly, or
 *    through a `const` whose initialiser is one
 *
 * The rule names no primitive and no prop. It asks the props type what it
 * accepts, so a primitive that widens to take a reading next month is covered
 * next month, which is what "per primitive" in ruling 8 has to mean if it is
 * not to be a list someone forgets to add to.
 *
 * WHAT DOES NOT
 *
 *  - a prop that accepts only a `Value`. Nothing was dropped: the primitive
 *    never offered to carry the currency
 *  - a `Value` that no reading was unwrapped to reach: a literal, a `value()`
 *    call, a prop the widget was handed. Those are ruling 7's legitimate case,
 *    and ticket 257 part 3's combinator is what moves the computed ones
 *  - `<reading>.modelled`, and anything off `reading.reckoning`. Reaching into
 *    the reckoning is a deliberate act with the reading still in hand, not the
 *    accidental discard this looks for
 *
 * WHAT IT STILL CANNOT SEE, stated because a gate's limit belongs beside it:
 * an unwrap laundered through anything other than one `const` hop: a function
 * return, a `??`, a ternary, an array element. Those are reachable and are not
 * reached today; the plant list in the test says which shapes are proven.
 *
 * Excluded from `tsconfig.build.json`: this reaches for `typescript`, which
 * does not belong in core's published dist.
 */

import { join } from "node:path";
import ts from "typescript";
import { modTsRoots, SCANNED_PACKAGE_ROOTS } from "./unknown-cast.scan";

/**
 * Every root the gate walks, shared with `unknown-cast.scan` rather than
 * re-listed.
 *
 * One list means a package added to the tree is added to both gates at once. A
 * second hand-maintained copy is how `styleguide-wall-clock` came to walk one
 * widget root of thirteen while reporting green.
 */
export function primitiveFeedScanRoots(repoRoot: string): string[] {
  return [...SCANNED_PACKAGE_ROOTS, ...modTsRoots(repoRoot)];
}

/** One prop handed a reading's value instead of the reading. */
export interface UnwrappedFeedSite {
  /** Repo-relative, POSIX separators. */
  file: string;
  /** One-based, so it pastes into an editor. */
  line: number;
  /** The JSX tag as written, e.g. `Unit`. */
  element: string;
  /** The attribute that was handed the unwrapped value, e.g. `value`. */
  prop: string;
  /** Whether the unwrap was written inline or reached through a `const`. */
  via: "direct" | "const";
  /** The attribute as written, whitespace collapsed, for the failure message. */
  text: string;
}

/** What one root's walk found, including the numbers that grade the walk. */
export interface FeedScan {
  root: string;
  /** Non-declaration source files inside the root that the program contained. */
  files: number;
  /**
   * Those files, repo-relative, so coverage can be graded against what git
   * tracks rather than against this walk's own opinion of itself.
   *
   * A count cannot answer "was THIS file scanned", and that is the question
   * that mattered: `packages/components/scripts/` is outside the package's
   * tsconfig `include`, so a planted violation there was walked past in
   * silence while every check reported green.
   */
  fileNames: string[];
  /** Every JSX attribute seen whose declared type accepts a reading. */
  readingProps: number;
  /**
   * Reading-accepting attributes whose expression was the compiler's ERROR
   * type.
   *
   * Counted rather than ignored, for the same reason `unknown-cast` counts
   * them: it means the program did not resolve, and a scan reading unresolved
   * types reports whatever it likes.
   */
  errorTyped: number;
  sites: UnwrappedFeedSite[];
}

/**
 * The two currency members every reading carries, and no payload may.
 *
 * Structural rather than by symbol name, so a reading reaching a call site
 * through a type alias, a mapped field property or a re-export is still a
 * reading. That is sound rather than lucky: `RtConfig.CheckReservedFieldNames`
 * refuses a contract payload field spelled like a currency member, so a payload
 * cannot arrive here wearing both of these.
 */
const CURRENCY_MEMBERS = ["state", "reckoning"] as const;

/** Whether `type`, or any arm of it, is a reading. */
export function isReadingShaped(
  checker: ts.TypeChecker,
  type: ts.Type,
): boolean {
  if (type.isUnion()) {
    return type.types.some((arm) => isReadingShaped(checker, arm));
  }
  return CURRENCY_MEMBERS.every(
    (member) => checker.getPropertyOfType(type, member) !== undefined,
  );
}

function skipParens(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

/**
 * The `<reading>.value` this expression is, or reaches through one `const`.
 *
 * The hop is capped rather than followed to a fixed point: a cap terminates on
 * `const a = a` and on a circular re-export, and one hop is the shape that
 * actually appears when a call site pulls the value out to name it.
 */
function unwrapOf(
  checker: ts.TypeChecker,
  expr: ts.Expression,
  depth = 0,
): { node: ts.PropertyAccessExpression; via: "direct" | "const" } | null {
  if (depth > 1) return null;
  const node = skipParens(expr);

  if (ts.isPropertyAccessExpression(node) && node.name.text === "value") {
    const objectType = checker.getTypeAtLocation(node.expression);
    if (isReadingShaped(checker, objectType)) {
      return { node, via: depth === 0 ? "direct" : "const" };
    }
    return null;
  }

  if (ts.isIdentifier(node)) {
    const declaration = checker
      .getSymbolAtLocation(node)
      ?.declarations?.find(ts.isVariableDeclaration);
    if (!declaration?.initializer) return null;
    const inner = unwrapOf(checker, declaration.initializer, depth + 1);
    return inner ? { node: inner.node, via: "const" } : null;
  }

  return null;
}

/**
 * The verdict on one JSX attribute, or null when there is nothing to report.
 *
 * Exported so the blindness check drives the live predicate rather than a
 * second copy of the rule that agrees with itself.
 */
export function classifyAttribute(
  checker: ts.TypeChecker,
  attr: ts.JsxAttribute,
):
  | { prop: string; via: "direct" | "const"; counted: true }
  | "error-typed"
  | "not-a-reading-prop"
  | null {
  const initializer = attr.initializer;
  if (!initializer || !ts.isJsxExpression(initializer)) {
    return "not-a-reading-prop";
  }
  const expression = initializer.expression;
  if (!expression) return "not-a-reading-prop";

  // What the PROP declared it takes, asked of the props type rather than of a
  // list of prop names kept here.
  const declared = checker.getContextualType(expression);
  if (!declared || !isReadingShaped(checker, declared)) {
    return "not-a-reading-prop";
  }

  const passed = checker.getTypeAtLocation(expression);
  const intrinsic = (passed as ts.Type & { intrinsicName?: string })
    .intrinsicName;
  if (intrinsic === "error") return "error-typed";

  // The reading was passed whole. That is the shape the rule wants.
  if (isReadingShaped(checker, passed)) return null;

  const unwrap = unwrapOf(checker, expression);
  if (!unwrap) return null;

  return {
    prop: ts.isIdentifier(attr.name) ? attr.name.text : attr.name.getText(),
    via: unwrap.via,
    counted: true,
  };
}

/** Walk one already-built program, reporting only files inside `absPrefix`. */
export function scanProgram(
  program: ts.Program,
  repoRoot: string,
  root: string,
  absPrefix: string,
): FeedScan {
  const checker = program.getTypeChecker();
  const scan: FeedScan = {
    root,
    files: 0,
    fileNames: [],
    readingProps: 0,
    errorTyped: 0,
    sites: [],
  };

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    if (!sf.fileName.startsWith(absPrefix)) continue;
    if (sf.fileName.includes("/node_modules/")) continue;
    scan.files += 1;
    scan.fileNames.push(sf.fileName.slice(repoRoot.length + 1));

    const visit = (node: ts.Node): void => {
      if (ts.isJsxAttribute(node)) {
        const verdict = classifyAttribute(checker, node);
        if (verdict === "error-typed") {
          scan.readingProps += 1;
          scan.errorTyped += 1;
        } else if (verdict !== "not-a-reading-prop") {
          scan.readingProps += 1;
          if (verdict) {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
            const owner = node.parent.parent;
            const tag = ts.isJsxSelfClosingElement(owner)
              ? owner.tagName.getText()
              : ts.isJsxOpeningElement(owner)
                ? owner.tagName.getText()
                : "?";
            scan.sites.push({
              file: sf.fileName.slice(repoRoot.length + 1),
              line: line + 1,
              element: tag,
              prop: verdict.prop,
              via: verdict.via,
              text: node.getText().replace(/\s+/g, " ").slice(0, 140),
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  scan.sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return scan;
}

/** Build the root's own program from its own `tsconfig.json`. */
export function scanRoot(repoRoot: string, root: string): FeedScan {
  const configPath = join(repoRoot, root, "tsconfig.json");
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => {},
  } as ts.ParseConfigFileHost);
  if (!parsed) {
    throw new Error(
      `[primitive-reading-feed] ${root}/tsconfig.json would not parse, so ` +
        "nothing in that root was scanned. A root the gate cannot read is a " +
        "root outside the rule.",
    );
  }
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: { ...parsed.options, noEmit: true },
  });
  return scanProgram(program, repoRoot, root, `${join(repoRoot, root)}/`);
}

/** Every root, in order. */
export function scanPrimitiveReadingFeed(repoRoot: string): FeedScan[] {
  return primitiveFeedScanRoots(repoRoot).map((root) =>
    scanRoot(repoRoot, root),
  );
}

/**
 * Scan a directory of hand-written files as its own root.
 *
 * The planted-violation check uses this, through the SAME `scanProgram` the
 * real walk uses, so a plant that is seen proves the live predicate saw it.
 */
export function scanScratchDir(
  dir: string,
  fileNames: string[],
  options: ts.CompilerOptions = {},
): FeedScan {
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
