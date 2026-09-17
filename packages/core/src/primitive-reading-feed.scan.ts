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
 * THE OTHER HALF OF RULING 8 IS `styleguide-primitive-inputs.test.ts`, and the
 * two are not duplicates. That one refuses a bare magnitude, top-level
 * arithmetic or a cast reaching the prop; this one refuses a reading that was
 * unwrapped on the way in. Cross-planted both ways rather than reasoned about:
 * arithmetic at a call site fails that gate and passes this one, and
 * `<Unit value={reading.value} />` fails this one and passes that. Deleting
 * either leaves a live fault uncovered.
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
  /**
   * How the figure lost its currency: unwrapped inline, unwrapped through a
   * `const`, or DERIVED from a reading further back (arithmetic named on an
   * earlier line, a magnitude taken through a helper). The three want
   * different fixes, so the report distinguishes them.
   */
  via: "direct" | "const" | "derived";
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

/**
 * The reading members a figure may be taken off WITHOUT the rule counting it.
 *
 * `value` is deliberately absent: taking the value off a reading is the whole
 * fault this file looks for. Everything else on a reading is about the reading
 * rather than about the quantity it carries, and reaching one is a deliberate
 * act with the reading still in hand, which is what the rule at the top of
 * this file already says does not count.
 *
 * ## An age handed its own reading would MAKE THE WIDGET LIE
 *
 * This is not a tidiness exemption, and `Targeting`'s two age readouts are why.
 * An age is `viewUt.minus(observedAt(reading))`: recomputed against the current
 * frame on every render, so it is exactly current at the instant it is drawn,
 * and its entire job is to say that something ELSE is old. Hand it the reading
 * it measured and `Unit` marks it not-current, which is self-refuting: the one
 * figure on the panel that is certainly current, drawn as stale, beside the
 * value it exists to caveat. A gate that forces that is a gate that produces
 * the defect it was written to prevent.
 *
 * ## Why this belongs in the walk and not only in `unwrapOf`
 *
 * `unwrapOf` already honours it, by matching the name `value` and nothing else.
 * The walk did not, so the exemption held for `reading.reckoning.x` and
 * evaporated for `f(reading.reckoning.x)`. A rule that survives a direct access
 * and not one hop is not a rule; it is an accident of which function got there
 * first.
 */
const EXEMPT_READING_MEMBERS: ReadonlySet<string> = new Set([
  "state",
  "reckoning",
  "atUt",
  "asOfUt",
  "grade",
]);

/**
 * Functions that take a reading and answer about its CURRENCY, never its value.
 *
 * The member exemption above cannot cover these, because they reach the
 * currency inside their own body and the walk deliberately never enters a
 * callee's body. `observedAt(reading)` arrives at the walk as a call whose
 * argument is reading-shaped, which is indistinguishable at the call site from
 * `current(reading)` handing the payload straight back.
 *
 * ## Why a type-level rule was rejected rather than not tried
 *
 * The tempting rule is "exempt a callee whose declared return type references
 * none of its own type parameters": `observedAt<T>(r: TopicCurrency<T>):
 * Value<"ut"> | undefined` passes it and `current<T>(r: TopicReading<T>): T |
 * undefined` fails it, which looks like exactly the discrimination wanted. It
 * has a hole big enough to drive the fault through: a NON-GENERIC laundering
 * helper, `function fundsOf(r: Reading<Career>): number`, references no type
 * parameter either and would be exempted while doing the very thing this file
 * exists to catch. So the rule is a closed list, because the alternative that
 * is not a list is unsound.
 *
 * ## Resolved by DECLARATION, never by name
 *
 * Membership is the declaring FILE plus the name, so a local helper a widget
 * happens to call `observedAt` is not exempted by sharing a spelling. That is
 * the same mistake `styleguide-reading-shape` avoided when it learned to see an
 * imported narrower: keying on the name would reopen the hole for the next
 * helper that borrows it.
 */
const CURRENCY_ACCESSORS: ReadonlySet<string> = new Set([
  "observedAt",
  "hasAnswered",
]);

/** The module those accessors are declared in, matched however it resolved. */
const CURRENCY_ACCESSOR_MODULE =
  /[/\\]sitrep-sdk[/\\](src|dist)[/\\]reading\.(ts|d\.ts)$/;

/**
 * Whether this call is one of the currency accessors, asked of its DECLARATION.
 *
 * A callee with no resolvable declaration answers `false`, so an unresolved
 * import is treated as capable of leaking the value rather than assumed safe:
 * this gate's failure direction is to report, never to wave through.
 */
function isCurrencyAccessor(
  checker: ts.TypeChecker,
  callee: ts.Expression,
): boolean {
  const name = ts.isPropertyAccessExpression(callee)
    ? callee.name.text
    : ts.isIdentifier(callee)
      ? callee.text
      : undefined;
  if (name === undefined || !CURRENCY_ACCESSORS.has(name)) return false;

  let symbol = checker.getSymbolAtLocation(callee);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
    symbol = checker.getAliasedSymbol(symbol);
  }
  const declarations = symbol?.declarations ?? [];
  return declarations.some((declaration) =>
    CURRENCY_ACCESSOR_MODULE.test(
      declaration.getSourceFile().fileName.replace(/\\/g, "/"),
    ),
  );
}

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
 * How far back the derivation walk follows a value before giving up.
 *
 * Twelve rather than a smaller round number, measured rather than chosen. The
 * plant named `PlantedIndirectUnwrap` mints a ratio from a payload quantity
 * defaulted with `??` and divided by a literal: that is SEVEN hops from the
 * prop back to the reading (call, identifier, two binaries, two optional
 * property accesses, identifier), and a cap of six caught its sibling at
 * exactly six while missing it. A real call site nests further than a
 * written-out example suggests, so the cap sits well clear of the deepest
 * shape the tree actually contains rather than against its edge.
 *
 * It is a bound on WORK, not a rule about what counts: every path that
 * terminates does so at a reading or at a literal, and the `seen` set is what
 * stops a cycle.
 */
/**
 * Array methods that hand a callback an ELEMENT of their receiver, and which
 * parameter position that element arrives in.
 *
 * A callback's parameter is not a variable declaration, so the one `const` hop
 * below reaches nothing for it and a figure taken off it reads as having no
 * provenance at all. That is how seven sites sat inside one `flatMap` in a file
 * this gate had already reported on: the array was plainly a reading's payload
 * and every element taken out of it was invisible.
 *
 * A closed list, for the reason `CURRENCY_ACCESSORS` is one. Following ANY
 * callback parameter back to its receiver would make `reduce`'s accumulator
 * reading-derived on the receiver's account even when it is seeded from a
 * literal. The POSITION matters as much as the method: `reduce` hands the
 * element second, so a rule keyed on parameter 0 would follow the accumulator
 * and miss the element.
 */
const ELEMENT_YIELDING_CALLBACKS: ReadonlyMap<string, readonly number[]> =
  new Map([
    ["map", [0]],
    ["flatMap", [0]],
    ["filter", [0]],
    ["forEach", [0]],
    ["find", [0]],
    ["findLast", [0]],
    ["findIndex", [0]],
    ["findLastIndex", [0]],
    ["some", [0]],
    ["every", [0]],
    ["sort", [0, 1]],
    ["reduce", [1]],
    ["reduceRight", [1]],
  ]);

/**
 * The array a callback parameter's elements come from, when that parameter IS
 * an element rather than an index, an accumulator or the array itself.
 *
 * The callback must be the call's FIRST argument, which it is for every method
 * on the list, so a function handed over as a later argument cannot be mistaken
 * for the element-yielding one.
 */
function callbackElementReceiver(
  parameter: ts.ParameterDeclaration,
): ts.Expression | undefined {
  const callback = parameter.parent;
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) {
    return undefined;
  }
  const call = callback.parent;
  if (!ts.isCallExpression(call) || call.arguments[0] !== callback) {
    return undefined;
  }
  const callee = skipParens(call.expression);
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  const positions = ELEMENT_YIELDING_CALLBACKS.get(callee.name.text);
  return positions?.includes(callback.parameters.indexOf(parameter))
    ? callee.expression
    : undefined;
}

const DERIVATION_DEPTH = 12;

/**
 * Whether this expression's value was DERIVED from a reading, however far back.
 *
 * The direct unwrap above is one shape of a bigger fault, and the other shapes
 * defeat both of the tree's existing checks. `styleguide-primitive-inputs` is
 * textual and refuses arithmetic written IN the prop, so a quotient named on
 * the previous line walks through it. This file's own rule keys on a property
 * literally spelled `value`, so a magnitude taken two calls deep walks through
 * that. Both hand a primitive a figure that came off a reading with the
 * currency stripped, which is the thing the combinator exists to stop.
 *
 * So the question is PROVENANCE rather than shape: does the data flow behind
 * this expression reach something reading-typed. It follows operands, call
 * ARGUMENTS (never a callee's body, which would be a whole-program analysis),
 * property objects and one `const` hop per identifier.
 *
 * It deliberately does NOT flag ruling 7's legitimate case. A literal, a
 * constant, a prop the widget was handed: none of those reach a reading, so
 * none of them is reported. The discriminator is where the number CAME FROM,
 * not what it looks like on arrival, and a rule that cannot tell those apart
 * is one that gets switched off in a week.
 */
function derivedFromReading(
  checker: ts.TypeChecker,
  expr: ts.Expression,
  depth = 0,
  seen = new Set<ts.Node>(),
): boolean {
  if (depth > DERIVATION_DEPTH) return false;
  const node = skipParens(expr);
  if (seen.has(node)) return false;
  seen.add(node);

  // The base case: this expression IS a reading, so anything taken off it is
  // reading-derived by construction.
  if (isReadingShaped(checker, checker.getTypeAtLocation(node))) return true;

  const recur = (child: ts.Expression) =>
    derivedFromReading(checker, child, depth + 1, seen);

  if (ts.isPropertyAccessExpression(node)) {
    /*
     * A member of the READING rather than of the quantity it carries: the
     * provenance stops here, for the reasons on `EXEMPT_READING_MEMBERS`. Asked
     * of the object's TYPE, so a payload field that merely happens to be
     * spelled `grade` is not exempted by its name.
     */
    if (
      EXEMPT_READING_MEMBERS.has(node.name.text) &&
      isReadingShaped(checker, checker.getTypeAtLocation(node.expression))
    ) {
      return false;
    }
    return recur(node.expression);
  }
  if (ts.isElementAccessExpression(node)) return recur(node.expression);
  if (ts.isNonNullExpression(node) || ts.isAsExpression(node))
    return recur(node.expression);
  if (ts.isBinaryExpression(node)) return recur(node.left) || recur(node.right);
  if (ts.isConditionalExpression(node))
    return recur(node.whenTrue) || recur(node.whenFalse);
  if (ts.isPrefixUnaryExpression(node)) return recur(node.operand);
  if (ts.isCallExpression(node)) {
    /*
     * A currency accessor's result is about the reading, not about the quantity
     * it carries, so the reading it was handed contributes no provenance. See
     * `CURRENCY_ACCESSORS`: the age readouts this unblocks would otherwise be
     * forced to draw themselves as not-current.
     */
    if (isCurrencyAccessor(checker, node.expression)) return false;
    /*
     * The CALLEE as well as the arguments, because a method called ON a value
     * is a derivation too and the callee is where its object lives:
     * `reading.value.times(2)` puts the reading nowhere in the argument list.
     * Found by trying to plant that shape as this exemption's control and
     * watching it not be reported.
     */
    return recur(node.expression) || node.arguments.some(recur);
  }

  if (ts.isIdentifier(node)) {
    const declarations = checker.getSymbolAtLocation(node)?.declarations ?? [];
    const declaration = declarations.find(ts.isVariableDeclaration);
    if (declaration?.initializer) return recur(declaration.initializer);
    /*
     * A callback's element parameter carries the provenance of the array it
     * was taken out of, which no `const` hop can reach because a parameter is
     * not a variable declaration. See `ELEMENT_YIELDING_CALLBACKS`.
     */
    const parameter = declarations.find(ts.isParameter);
    const receiver = parameter && callbackElementReceiver(parameter);
    return receiver ? recur(receiver) : false;
  }

  return false;
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
  | { prop: string; via: "direct" | "const" | "derived"; counted: true }
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
  if (!unwrap) {
    /*
     * Not a direct `<reading>.value`, but the figure may still have come off
     * one further back: a quotient named on the previous line, a magnitude
     * taken two calls deep. Reported as its own `via` so the two faults stay
     * distinguishable in the message, since they want different fixes: the
     * direct unwrap passes the reading instead, this one goes through the
     * combinator or the field property.
     */
    return derivedFromReading(checker, expression)
      ? {
          prop: ts.isIdentifier(attr.name)
            ? attr.name.text
            : attr.name.getText(),
          via: "derived",
          counted: true,
        }
      : null;
  }

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
