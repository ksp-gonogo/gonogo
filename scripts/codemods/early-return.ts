#!/usr/bin/env node
/**
 * Rewrites an `if / else if / else` chain that only picks a value for a local
 * `let` into a small local function that returns case by case, and turns the
 * `let` into a `const` initialised from it.
 *
 *     let bars = 0;                       const resolveBars = (): number => {
 *     if (connected === false) {            if (connected === false) return 0;
 *       bars = 0;                  ->       if (pct !== null) return Math.max(1, pct);
 *     } else if (pct !== null) {            return 0;
 *       bars = Math.max(1, pct);          };
 *     }                                   const bars = resolveBars();
 *
 * The helper is an arrow function called where the chain stood, so conditions
 * and values are evaluated in the same order, the same number of times, with
 * the same `this` and `arguments`. It converts a chain only when every one of
 * these holds, and otherwise leaves the file untouched and names the reason:
 *
 * - every branch is exactly one statement, a plain `=` assignment to the same
 *   identifier
 * - that identifier is a `let` with a single declarator, declared in the same
 *   statement list as the chain, and neither read nor written between the
 *   declaration and the end of the chain nor written anywhere after it
 * - no branch condition or value assigns, increments, deletes, awaits or yields
 * - nothing the chain reads is a `let`, `var` or parameter that is written
 *   anywhere, because a closure over mutated state loses the narrowing the
 *   chain had in place
 * - a chain with no final `else` falls back to the declaration's initializer,
 *   so it needs one, and it must be safe to evaluate at the chain rather than
 *   at the declaration
 * - comments sit only before a branch's assignment, where they can move above
 *   that branch's `return`
 *
 * Usage:
 *   node scripts/codemods/early-return.ts <path>... [--write]
 *
 * Without `--write` it lists every chain with its verdict and writes nothing.
 * With it, each changed file is written and then formatted by biome, which
 * re-indents a value that spanned several lines. Directories are walked for
 * `.ts` and `.tsx` files.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type BinaryExpression,
  type IfStatement,
  Node,
  Project,
  type SourceFile,
  SyntaxKind,
  ts,
  type VariableDeclaration,
  type VariableStatement,
} from "ts-morph";

export const REFUSAL_REASONS = [
  "branch-has-multiple-statements",
  "branch-not-assignment",
  "compound-assignment",
  "target-not-identifier",
  "different-targets",
  "target-not-local-let",
  "multiple-declarators",
  "declaration-shares-line",
  "declared-in-other-block",
  "exported-declaration",
  "target-used-in-chain",
  "target-used-before-chain",
  "target-reassigned-after-chain",
  "side-effect-in-chain",
  "await-or-yield-in-chain",
  "closure-over-mutated-state",
  "missing-else-without-initializer",
  "initializer-not-movable",
  "initializer-has-effects",
  "untyped-declaration",
  "comment-position",
] as const;

export type RefusalReason = (typeof REFUSAL_REASONS)[number];

export interface Site {
  line: number;
  column: number;
  target?: string;
  verdict: "converted" | "refused";
  reason?: RefusalReason;
}

export interface Result {
  sites: Site[];
  output: string;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

interface Branch {
  condition?: string;
  value: string;
  comments: string[];
}

class Refusal extends Error {
  readonly reason: RefusalReason;

  constructor(reason: RefusalReason) {
    super(reason);
    this.reason = reason;
  }
}

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const project = new Project({
  useInMemoryFileSystem: true,
  skipFileDependencyResolution: true,
  compilerOptions: { strict: true, allowJs: false, jsx: ts.JsxEmit.Preserve },
});

/** Converts every safe chain in one file's text, returning the verdicts and the new text. */
export function transform(fileName: string, text: string): Result {
  const file = project.createSourceFile(fileName, text, { overwrite: true });
  try {
    const sites: Site[] = [];
    const edits: Edit[] = [];
    const taken = new Set(
      file.getDescendantsOfKind(SyntaxKind.Identifier).map((i) => i.getText()),
    );
    for (const head of chainHeads(file)) {
      const { line, column } = file.getLineAndColumnAtPos(head.getStart());
      try {
        const planned = plan(file, head, taken);
        sites.push({
          line,
          column,
          target: planned.target,
          verdict: "converted",
        });
        edits.push(...planned.edits);
      } catch (error) {
        if (!(error instanceof Refusal)) throw error;
        sites.push({ line, column, verdict: "refused", reason: error.reason });
      }
    }
    return { sites, output: applyEdits(text, edits) };
  } finally {
    project.removeSourceFile(file);
  }
}

/** The first `if` of every chain holding at least one `else if`. */
function chainHeads(file: SourceFile): IfStatement[] {
  return file.getDescendantsOfKind(SyntaxKind.IfStatement).filter((node) => {
    const parent = node.getParent();
    if (Node.isIfStatement(parent) && parent.getElseStatement() === node) {
      return false;
    }
    return Node.isIfStatement(node.getElseStatement());
  });
}

function plan(file: SourceFile, head: IfStatement, taken: Set<string>) {
  const links: { condition?: Node; body: Node }[] = [];
  let cursor: Node | undefined = head;
  while (cursor) {
    if (Node.isIfStatement(cursor)) {
      links.push({
        condition: cursor.getExpression(),
        body: cursor.getThenStatement(),
      });
      cursor = cursor.getElseStatement();
    } else {
      links.push({ body: cursor });
      cursor = undefined;
    }
  }

  const assignments = links.map((link) => singleAssignment(link.body));
  const target = assignments[0].getLeft().getText();
  if (assignments.some((a) => a.getLeft().getText() !== target)) {
    throw new Refusal("different-targets");
  }

  const declaration = localLet(assignments[0].getLeft());
  const statement = declaration.getVariableStatementOrThrow();
  if (statement.getDeclarations().length !== 1) {
    throw new Refusal("multiple-declarators");
  }
  if (statement.hasExportKeyword()) throw new Refusal("exported-declaration");
  if (statement.getParent() !== head.getParent()) {
    throw new Refusal("declared-in-other-block");
  }
  if (!ownsItsLines(file, statement)) {
    throw new Refusal("declaration-shares-line");
  }

  const readsInChain = [
    ...links.flatMap((l) => (l.condition ? [l.condition] : [])),
    ...assignments.map((a) => a.getRight()),
  ];
  checkTargetUses(file, declaration, head, assignments);
  for (const part of readsInChain) checkPure(part);
  checkClosure(file, readsInChain);
  checkComments(head, assignments);

  const hasElse = links[links.length - 1].condition === undefined;
  const initializer = declaration.getInitializer();
  if (!hasElse && !initializer) {
    throw new Refusal("missing-else-without-initializer");
  }
  if (initializer) {
    checkInitializer(initializer, hasElse, statement, head, links);
  }
  const typeNode = declaration.getTypeNode();
  if (!typeNode && (!initializer || isNullish(initializer))) {
    throw new Refusal("untyped-declaration");
  }

  const branches: Branch[] = links.map((link, i) => ({
    condition: link.condition?.getText(),
    value: assignments[i].getRight().getText(),
    comments: leadingComments(assignments[i].getParentOrThrow()),
  }));
  if (!hasElse && initializer) {
    branches.push({ value: initializer.getText(), comments: [] });
  }

  const helper = helperName(target, taken);
  taken.add(helper);
  const indent = indentOf(file, head.getStart());
  const returnType = typeNode ? `: ${typeNode.getText()}` : "";
  const body = branches.flatMap((b) => [
    ...b.comments.map((c) => `${indent}  ${c}`),
    b.condition === undefined
      ? `${indent}  return ${b.value};`
      : `${indent}  if (${b.condition}) return ${b.value};`,
  ]);
  const declarationComments = leadingComments(statement).map(
    (c) => `${c}\n${indent}`,
  );
  const replacement = [
    `${declarationComments.join("")}const ${helper} = ()${returnType} => {`,
    ...body,
    `${indent}};`,
    `${indent}const ${target} = ${helper}();`,
  ].join("\n");

  return {
    target,
    edits: [
      removal(file, statement),
      { start: head.getStart(), end: head.getEnd(), text: replacement },
    ],
  };
}

function singleAssignment(body: Node) {
  let statement = body;
  if (Node.isBlock(body)) {
    const statements = body.getStatements();
    if (statements.length > 1) {
      throw new Refusal("branch-has-multiple-statements");
    }
    if (statements.length === 0) throw new Refusal("branch-not-assignment");
    statement = statements[0];
  }
  if (!Node.isExpressionStatement(statement)) {
    throw new Refusal("branch-not-assignment");
  }
  const expression = statement.getExpression();
  if (!Node.isBinaryExpression(expression)) {
    throw new Refusal("branch-not-assignment");
  }
  const operator = expression.getOperatorToken().getKind();
  if (operator !== SyntaxKind.EqualsToken) {
    throw new Refusal(
      isAssignmentOperator(operator)
        ? "compound-assignment"
        : "branch-not-assignment",
    );
  }
  if (!Node.isIdentifier(expression.getLeft())) {
    throw new Refusal("target-not-identifier");
  }
  return expression;
}

function localLet(identifier: Node): VariableDeclaration {
  const declaration = bindingOf(identifier)?.getDeclarations()[0];
  if (!declaration || !Node.isVariableDeclaration(declaration)) {
    throw new Refusal("target-not-local-let");
  }
  const list = declaration.getParent();
  if (
    !Node.isVariableDeclarationList(list) ||
    list.getDeclarationKind() !== "let" ||
    !Node.isVariableStatement(list.getParent())
  ) {
    throw new Refusal("target-not-local-let");
  }
  return declaration;
}

/** Every identifier in the file bound to the same symbol as `declaration`'s name. */
function referencesTo(file: SourceFile, declaration: Node) {
  const symbol = declaration.getSymbol();
  const name = symbol?.getName();
  return file
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .filter((i) => i.getText() === name && bindingOf(i) === symbol);
}

/** The binding an identifier reads, which for a `{ x }` shorthand is the variable rather than the property. */
function bindingOf(id: Node) {
  const parent = id.getParent();
  if (
    Node.isShorthandPropertyAssignment(parent) &&
    parent.getNameNode() === id
  ) {
    return project.getTypeChecker().getShorthandAssignmentValueSymbol(parent);
  }
  return id.getSymbol();
}

function checkTargetUses(
  file: SourceFile,
  declaration: VariableDeclaration,
  head: IfStatement,
  assignments: BinaryExpression[],
) {
  const allowed = new Set<Node>([
    declaration.getNameNode(),
    ...assignments.map((a) => a.getLeft()),
  ]);
  for (const ref of referencesTo(file, declaration)) {
    if (allowed.has(ref)) continue;
    const pos = ref.getStart();
    if (pos >= head.getStart() && pos < head.getEnd()) {
      throw new Refusal("target-used-in-chain");
    }
    if (pos < head.getStart()) throw new Refusal("target-used-before-chain");
    if (isWrite(ref)) throw new Refusal("target-reassigned-after-chain");
  }
}

function checkPure(node: Node) {
  for (const n of [node, ...node.getDescendants()]) {
    if (Node.isAwaitExpression(n) || Node.isYieldExpression(n)) {
      throw new Refusal("await-or-yield-in-chain");
    }
    if (
      Node.isDeleteExpression(n) ||
      (Node.isBinaryExpression(n) &&
        isAssignmentOperator(n.getOperatorToken().getKind())) ||
      ((Node.isPrefixUnaryExpression(n) || Node.isPostfixUnaryExpression(n)) &&
        isIncrement(n.getOperatorToken()))
    ) {
      throw new Refusal("side-effect-in-chain");
    }
  }
}

function checkClosure(file: SourceFile, parts: Node[]) {
  const checked = new Set<Node>();
  for (const part of parts) {
    for (const id of part.getDescendantsOfKind(SyntaxKind.Identifier)) {
      const declaration = bindingOf(id)?.getDeclarations()[0];
      if (!declaration || checked.has(declaration)) continue;
      checked.add(declaration);
      if (!isMutableBinding(declaration)) continue;
      if (referencesTo(file, declaration).some(isWrite)) {
        throw new Refusal("closure-over-mutated-state");
      }
    }
  }
}

function isMutableBinding(declaration: Node) {
  if (Node.isParameterDeclaration(declaration)) return true;
  if (!Node.isVariableDeclaration(declaration)) return false;
  const list = declaration.getParent();
  return (
    Node.isVariableDeclarationList(list) &&
    list.getDeclarationKind() !== "const"
  );
}

/**
 * A branch's own comments may sit only before its assignment, inside its
 * block; anything else (in a condition, trailing a value, between `}` and
 * `else`) has no place to go in the helper.
 */
function checkComments(head: IfStatement, assignments: BinaryExpression[]) {
  const text = head.getSourceFile().getFullText();
  const movable = new Set<number>();
  for (const a of assignments) {
    const statement = a.getParentOrThrow();
    for (const range of statement.getLeadingCommentRanges())
      movable.add(range.getPos());
  }
  for (const node of [head, ...head.getDescendants()]) {
    const ranges = [
      ...(ts.getLeadingCommentRanges(text, node.getPos()) ?? []),
      ...(ts.getTrailingCommentRanges(text, node.getEnd()) ?? []),
    ];
    for (const range of ranges) {
      const inside = range.pos >= head.getStart() && range.pos < head.getEnd();
      if (inside && !movable.has(range.pos)) {
        throw new Refusal("comment-position");
      }
    }
  }
  for (const a of assignments) {
    if (a.getParentOrThrow().getTrailingCommentRanges().length > 0) {
      throw new Refusal("comment-position");
    }
  }
}

/**
 * With a final `else` the initializer is never observed, so it is dropped and
 * need only be free of effects. Without one it becomes the fallback return and
 * is evaluated at the chain instead of at the declaration: a literal or a
 * `const` reads the same at either point, and any other effect-free expression
 * does only when nothing runs between the two.
 */
function checkInitializer(
  initializer: Node,
  hasElse: boolean,
  statement: VariableStatement,
  head: IfStatement,
  links: { condition?: Node }[],
) {
  if (hasEffects(initializer)) throw new Refusal("initializer-has-effects");
  if (hasElse || isStable(initializer)) return;
  const adjacent = statement.getNextSibling() === head;
  const conditionsCall = links.some(
    (l) =>
      l.condition &&
      (Node.isCallExpression(l.condition) ||
        l.condition.getDescendantsOfKind(SyntaxKind.CallExpression).length > 0),
  );
  if (!adjacent || conditionsCall) throw new Refusal("initializer-not-movable");
}

function hasEffects(node: Node) {
  return [node, ...node.getDescendants()].some(
    (n) =>
      Node.isCallExpression(n) ||
      Node.isNewExpression(n) ||
      Node.isTaggedTemplateExpression(n) ||
      Node.isAwaitExpression(n) ||
      Node.isYieldExpression(n) ||
      Node.isDeleteExpression(n) ||
      (Node.isBinaryExpression(n) &&
        isAssignmentOperator(n.getOperatorToken().getKind())) ||
      ((Node.isPrefixUnaryExpression(n) || Node.isPostfixUnaryExpression(n)) &&
        isIncrement(n.getOperatorToken())),
  );
}

function isStable(node: Node): boolean {
  if (
    Node.isStringLiteral(node) ||
    Node.isNumericLiteral(node) ||
    Node.isBigIntLiteral(node) ||
    Node.isNoSubstitutionTemplateLiteral(node) ||
    Node.isTrueLiteral(node) ||
    Node.isFalseLiteral(node) ||
    Node.isNullLiteral(node)
  ) {
    return true;
  }
  if (Node.isPrefixUnaryExpression(node)) {
    return Node.isNumericLiteral(node.getOperand());
  }
  if (Node.isAsExpression(node) || Node.isParenthesizedExpression(node)) {
    return isStable(node.getExpression());
  }
  if (Node.isIdentifier(node)) {
    if (node.getText() === "undefined") return true;
    const declaration = bindingOf(node)?.getDeclarations()[0];
    if (!declaration) return false;
    if (
      Node.isImportSpecifier(declaration) ||
      Node.isImportClause(declaration)
    ) {
      return true;
    }
    return (
      Node.isVariableDeclaration(declaration) && !isMutableBinding(declaration)
    );
  }
  return false;
}

function isNullish(node: Node) {
  return Node.isNullLiteral(node) || node.getText() === "undefined";
}

function isWrite(ref: Node): boolean {
  let child: Node = ref;
  let parent = ref.getParent();
  while (
    parent &&
    (Node.isArrayLiteralExpression(parent) ||
      Node.isObjectLiteralExpression(parent) ||
      Node.isShorthandPropertyAssignment(parent) ||
      Node.isPropertyAssignment(parent) ||
      Node.isSpreadElement(parent) ||
      Node.isParenthesizedExpression(parent))
  ) {
    if (
      Node.isPropertyAssignment(parent) &&
      parent.getInitializer() !== child
    ) {
      return false;
    }
    child = parent;
    parent = parent.getParent();
  }
  if (!parent) return false;
  if (Node.isBinaryExpression(parent)) {
    return (
      parent.getLeft() === child &&
      isAssignmentOperator(parent.getOperatorToken().getKind())
    );
  }
  if (
    Node.isPrefixUnaryExpression(parent) ||
    Node.isPostfixUnaryExpression(parent)
  ) {
    return isIncrement(parent.getOperatorToken());
  }
  if (Node.isForOfStatement(parent) || Node.isForInStatement(parent)) {
    return parent.getInitializer() === child;
  }
  return false;
}

function isAssignmentOperator(kind: SyntaxKind) {
  return (
    kind >= SyntaxKind.FirstAssignment && kind <= SyntaxKind.LastAssignment
  );
}

function isIncrement(kind: SyntaxKind) {
  return (
    kind === SyntaxKind.PlusPlusToken || kind === SyntaxKind.MinusMinusToken
  );
}

function leadingComments(node: Node) {
  return node.getLeadingCommentRanges().map((r) => r.getText());
}

function helperName(target: string, taken: Set<string>) {
  const base = `resolve${target[0].toUpperCase()}${target.slice(1)}`;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

function indentOf(file: SourceFile, pos: number) {
  const text = file.getFullText();
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  return text.slice(lineStart, pos);
}

/** Whether the declaration's lines hold nothing else, so removing them removes only it. */
function ownsItsLines(file: SourceFile, statement: Node) {
  const text = file.getFullText();
  const first =
    statement.getLeadingCommentRanges()[0]?.getPos() ?? statement.getStart();
  const lineStart = text.lastIndexOf("\n", first - 1) + 1;
  const newline = text.indexOf("\n", statement.getEnd());
  const lineEnd = newline === -1 ? text.length : newline;
  return (
    text.slice(lineStart, first).trim() === "" &&
    text.slice(statement.getEnd(), lineEnd).trim() === ""
  );
}

/** The declaration's whole lines, with its leading comments, which the helper carries instead. */
function removal(file: SourceFile, statement: Node): Edit {
  const text = file.getFullText();
  const first =
    statement.getLeadingCommentRanges()[0]?.getPos() ?? statement.getStart();
  const start = text.lastIndexOf("\n", first - 1) + 1;
  const newline = text.indexOf("\n", statement.getEnd());
  return { start, end: newline === -1 ? text.length : newline + 1, text: "" };
}

function applyEdits(text: string, edits: Edit[]) {
  let out = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

function sourceFiles(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", "dist", "coverage", ".turbo"].includes(entry.name)) {
      return [];
    }
    const full = join(path, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")
      ? [full]
      : [];
  });
}

function main(argv: string[]) {
  const write = argv.includes("--write");
  const paths = argv.filter((a) => a !== "--write");
  if (paths.length === 0) {
    console.error(
      "usage: node scripts/codemods/early-return.ts <path>... [--write]",
    );
    return 2;
  }
  const counts = new Map<string, number>();
  const written: string[] = [];
  for (const file of paths.flatMap(sourceFiles)) {
    const text = readFileSync(file, "utf8");
    const { sites, output } = transform(file, text);
    for (const site of sites) {
      const key =
        site.verdict === "converted" ? "converted" : `refused ${site.reason}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const where = `${relative(process.cwd(), file)}:${site.line}:${site.column}`;
      console.log(
        site.verdict === "converted"
          ? `${where} converted ${site.target}`
          : `${where} refused ${site.reason}`,
      );
    }
    if (write && output !== text) {
      writeFileSync(file, output);
      written.push(file);
    }
  }
  console.log("");
  for (const [key, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(n).padStart(5)}  ${key}`);
  }
  if (written.length === 0) return 0;
  const format = spawnSync(
    join(REPO_ROOT, "node_modules/.bin/biome"),
    [
      "format",
      "--write",
      `--config-path=${join(REPO_ROOT, "biome.json")}`,
      ...written,
    ],
    { encoding: "utf8" },
  );
  if (format.status !== 0) {
    console.error(format.stdout + format.stderr);
    return 1;
  }
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2));
}
