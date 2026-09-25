import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, matchesGlob, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { scanTestFiles } from "../scan-tests.mjs";

/**
 * A turbo cache key that leaves out a file a test reads replays that test's
 * last result whenever only that file changed. The pre-push hook runs
 * `turbo run test test:scans` from cache, so every file outside a key is a
 * change the local gate cannot see. CI restores no turbo cache and runs cold,
 * which is why none of this ever shows as a red there.
 *
 * What a key covers is asked of turbo itself (`--dry=json`), never modelled: a
 * task hashes its own `inputs`, and through `dependsOn` the inputs of every
 * build task it transitively waits on. What a test READS is found from the
 * tree:
 *
 * 1. core's scans walk and `git grep` the whole repo, so their key covers
 *    every tracked file
 * 2. every other test file's path expressions are evaluated (string literals,
 *    `const` bindings, the file's own directory, `join`/`resolve`/`new URL`,
 *    with any other operand read as a `*` wildcard), and so are the pathspecs
 *    of any `git grep` or `git ls-files` it runs. Every tracked file they reach
 *    must be in its task's key, and pathspecs built at runtime count as the
 *    whole tree
 * 3. no test task hashes an ignored file, which would move its key on a
 *    rebuild or on local state rather than on a change to the tree
 *
 * What it cannot see: a path assembled at runtime from something other than
 * literals and `const`s it can follow (a parameter, a loop over a listing).
 * Such a read evaluates to no path at all rather than to a wrong one, so it is
 * missed, not misreported.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..");
const CORE_SCANS_TASK = "@ksp-gonogo/core#test:scans";

const run = (command: string, args: string[]) =>
  execFileSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    stdio: ["ignore", "pipe", "ignore"],
  });

const TRACKED = run("git", ["ls-files"]).split("\n").filter(Boolean);
const TRACKED_SET = new Set(TRACKED);
const UNTRACKED_VISIBLE = new Set(
  run("git", ["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .filter(Boolean),
);

interface DryTask {
  taskId: string;
  task: string;
  directory: string;
  inputs: Record<string, string>;
  dependencies: string[];
}

function isDryTask(value: unknown): value is DryTask {
  return (
    typeof value === "object" &&
    value !== null &&
    "taskId" in value &&
    typeof value.taskId === "string" &&
    "task" in value &&
    typeof value.task === "string" &&
    "directory" in value &&
    typeof value.directory === "string" &&
    "inputs" in value &&
    typeof value.inputs === "object" &&
    value.inputs !== null &&
    "dependencies" in value &&
    Array.isArray(value.dependencies)
  );
}

/** Every task a cached `turbo run test test:scans` would hash, as turbo reports it. */
function dryRun(): DryTask[] {
  const parsed: unknown = JSON.parse(
    run("pnpm", ["exec", "turbo", "run", "test", "test:scans", "--dry=json"]),
  );
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("tasks" in parsed) ||
    !Array.isArray(parsed.tasks)
  )
    throw new Error("turbo --dry=json printed no task list");
  const malformed = parsed.tasks.filter((t: unknown) => !isDryTask(t));
  if (malformed.length > 0)
    throw new Error(
      `turbo --dry=json printed ${malformed.length} task(s) without the fields this guard reads, so its report format has moved`,
    );
  return parsed.tasks.filter(isDryTask);
}

const DRY = { tasks: dryRun() };

const TASKS = new Map(DRY.tasks.map((t) => [t.taskId, t]));

/** A task's own hashed files, repo-relative. */
function ownInputs(task: DryTask): Set<string> {
  return new Set(
    Object.keys(task.inputs).map((f) =>
      relative(ROOT, resolve(ROOT, task.directory, f)),
    ),
  );
}

const keyCache = new Map<string, Set<string>>();
/** Every file whose change moves `taskId`'s hash. */
function hashedBy(taskId: string): Set<string> {
  const cached = keyCache.get(taskId);
  if (cached) return cached;
  const out = new Set<string>();
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const task = TASKS.get(id);
    if (!task) return;
    for (const f of ownInputs(task)) out.add(f);
    for (const dep of task.dependencies) visit(dep);
  };
  visit(taskId);
  keyCache.set(taskId, out);
  return out;
}

const PACKAGE_DIRS = [...new Set(DRY.tasks.map((t) => t.directory))];

function owningPackage(file: string): string | undefined {
  return PACKAGE_DIRS.filter((d) => file.startsWith(`${d}/`)).sort(
    (a, b) => b.length - a.length,
  )[0];
}

const CORE_SCANS = new Set(
  scanTestFiles().map((rel: string) => `packages/core/${rel}`),
);

function taskIdFor(file: string): string | undefined {
  const dir = owningPackage(file);
  if (!dir) return undefined;
  const kind = CORE_SCANS.has(file) ? "test:scans" : "test";
  return DRY.tasks.find((t) => t.directory === dir && t.task === kind)?.taskId;
}

const WILDCARD = Symbol("wildcard");
type Evaluated = string | typeof WILDCARD;

/**
 * The absolute path an expression denotes, `WILDCARD` for an operand it cannot
 * follow. Only a `join`/`resolve` whose first operand is itself an absolute
 * path counts as a path at all, so a bare literal like `"mod"` is never read as
 * one.
 */
function evaluate(
  node: ts.Node,
  file: string,
  consts: Map<string, ts.Expression>,
  depth = 0,
): Evaluated {
  if (depth > 8) return WILDCARD;
  const fileAbs = join(ROOT, file);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) {
      const value = evaluate(span.expression, file, consts, depth + 1);
      out += (typeof value === "string" ? value : "*") + span.literal.text;
    }
    return out;
  }
  if (ts.isIdentifier(node)) {
    if (node.text === "__dirname") return dirname(fileAbs);
    const init = consts.get(node.text);
    return init ? evaluate(init, file, consts, depth + 1) : WILDCARD;
  }
  const text = node.getText();
  if (text === "import.meta.url") return fileAbs;
  if (text === "import.meta.dirname") return dirname(fileAbs);
  if (
    ts.isNewExpression(node) &&
    node.expression.getText() === "URL" &&
    node.arguments?.length === 2 &&
    node.arguments[1].getText() === "import.meta.url"
  ) {
    const target = evaluate(node.arguments[0], file, consts, depth + 1);
    return typeof target === "string"
      ? resolve(dirname(fileAbs), target)
      : WILDCARD;
  }
  if (ts.isCallExpression(node)) {
    const callee = node.expression.getText();
    const args = node.arguments.map((a) =>
      evaluate(a, file, consts, depth + 1),
    );
    if (/^(path\.)?(join|resolve)$/.test(callee)) {
      const [first] = args;
      if (typeof first !== "string" || !first.startsWith("/")) return WILDCARD;
      const parts = args.map((a) => (a === WILDCARD ? "*" : a));
      return callee.endsWith("resolve") ? resolve(...parts) : join(...parts);
    }
    if (/^(path\.)?dirname$/.test(callee) && typeof args[0] === "string")
      return dirname(args[0]);
    if (/fileURLToPath$/.test(callee)) return args[0] ?? WILDCARD;
  }
  return WILDCARD;
}

/** A git pathspec as a matcher: git's `*` crosses directory separators. */
function pathspecMatches(spec: string, file: string): boolean {
  const pattern = spec
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}(/|$)`).test(file);
}

/**
 * The pathspecs of an `execFileSync("git", ["grep" | "ls-files", ...])`, the
 * empty pathspec for a search with none, `"runtime"` when any is not a literal.
 */
function gitSearchPathspecs(
  call: ts.CallExpression,
): string[] | "runtime" | null {
  if (!/execFileSync$/.test(call.expression.getText())) return null;
  const [command, argv] = call.arguments;
  if (!command || !ts.isStringLiteral(command) || command.text !== "git")
    return null;
  if (!argv || !ts.isArrayLiteralExpression(argv)) return null;
  const words = argv.elements;
  const verb = words[0];
  if (
    !verb ||
    !ts.isStringLiteral(verb) ||
    !["grep", "ls-files"].includes(verb.text)
  )
    return null;
  const dashes = words.findIndex(
    (w) => ts.isStringLiteral(w) && w.text === "--",
  );
  if (dashes === -1) return [""];
  const specs: string[] = [];
  for (const w of words.slice(dashes + 1)) {
    if (!ts.isStringLiteral(w)) return "runtime";
    if (!w.text.startsWith(":!")) specs.push(w.text);
  }
  return specs.length > 0 ? specs : [""];
}

interface Reads {
  /** Repo-relative paths and globs outside the test's own package. */
  paths: Set<string>;
  /** Literal pathspecs of a `git grep` or `git ls-files`. */
  pathspecs: Set<string>;
  /** A git search over pathspecs built at runtime. */
  searchesTree: boolean;
}

function readsOf(file: string, source: string): Reads {
  const pkg = owningPackage(file) ?? "";
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const consts = new Map<string, ts.Expression>();
  const collect = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer)
      consts.set(n.name.text, n.initializer);
    ts.forEachChild(n, collect);
  };
  collect(sf);

  const paths = new Set<string>();
  const pathspecs = new Set<string>();
  let searchesTree = false;
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const specs = gitSearchPathspecs(n);
      if (specs === "runtime") searchesTree = true;
      else if (specs) for (const spec of specs) pathspecs.add(spec);
    }
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const value = evaluate(n, file, consts);
      if (typeof value === "string" && value.startsWith(`${ROOT}/`)) {
        const rel = relative(ROOT, value);
        if (rel !== pkg && !rel.startsWith(`${pkg}/`)) paths.add(rel);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { paths, pathspecs, searchesTree };
}

/** Tracked files a set of reads reaches. */
function reached(reads: Reads): Set<string> {
  const out = new Set<string>();
  for (const rel of reads.paths)
    for (const t of TRACKED)
      if (t === rel || t.startsWith(`${rel}/`) || matchesGlob(t, rel))
        out.add(t);
  for (const spec of reads.pathspecs)
    for (const t of TRACKED)
      if (spec === "" || pathspecMatches(spec, t)) out.add(t);
  if (reads.searchesTree) for (const t of TRACKED) out.add(t);
  return out;
}

const TEST_FILES = TRACKED.filter((f) => /\.test\.tsx?$/.test(f));

/** Each test outside core's scans, with every tracked file it reads unkeyed. */
function unkeyedReads(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const file of TEST_FILES) {
    if (CORE_SCANS.has(file)) continue;
    const taskId = taskIdFor(file);
    if (!taskId) continue;
    const key = hashedBy(taskId);
    const reads = readsOf(file, readFileSync(join(ROOT, file), "utf8"));
    const missing = [...reached(reads)].filter((t) => !key.has(t)).sort();
    if (missing.length > 0) out.set(`${taskId}  ${file}`, missing);
  }
  return out;
}

describe("turbo cache keys cover what each test reads", () => {
  it("lists the tree and every test task, so the rules below have something to cover", () => {
    expect(TRACKED.length).toBeGreaterThan(1000);
    expect(TRACKED).toContain("asyncapi.yaml");
    expect(TRACKED).toContain(".github/workflows/ci.yml");
    expect(TASKS.has(CORE_SCANS_TASK)).toBe(true);
    expect(DRY.tasks.filter((t) => t.task === "test").length).toBeGreaterThan(
      10,
    );
  });

  it("keys core's scans on every tracked file", () => {
    const key = hashedBy(CORE_SCANS_TASK);
    const unkeyed = TRACKED.filter((t) => !key.has(t));
    expect(
      unkeyed,
      `${CORE_SCANS_TASK} replays a cached pass when any of these changes. Add them to its inputs in packages/core/turbo.json:\n  ${unkeyed.slice(0, 20).join("\n  ")}`,
    ).toEqual([]);
  });

  it("keys every other test on the files it reads outside its package", () => {
    const unkeyed = unkeyedReads();
    if (unkeyed.size > 0) {
      const detail = [...unkeyed]
        .map(
          ([test, files]) =>
            `  ${test}\n    ${files.length} unkeyed, e.g. ${files.slice(0, 3).join(", ")}`,
        )
        .join("\n");
      throw new Error(
        `${unkeyed.size} test file(s) read tracked files their turbo task does not hash, so a change to one of those files replays a cached pass. Name them in that package's turbo.json \`inputs\` (keeping "$TURBO_DEFAULT$"):\n${detail}`,
      );
    }
  });

  it("hashes no ignored file into a test key, so a key moves only when the tree does", () => {
    /* local_docs holds the gitignored recordings the fixture-gated scans read,
       so a changed recording is meant to invalidate them. `.git` is the
       worktree's own pointer file, which turbo hashes for every task. */
    const ignoredIn = DRY.tasks
      .filter((t) => t.task === "test" || t.task === "test:scans")
      .flatMap((t) =>
        [...ownInputs(t)]
          .filter(
            (f) =>
              f !== ".git" &&
              !TRACKED_SET.has(f) &&
              !UNTRACKED_VISIBLE.has(f) &&
              !f.startsWith("local_docs/"),
          )
          .map((f) => `${t.taskId}  ${f}`),
      );
    expect(
      ignoredIn,
      `These tasks hash ignored files, so build output or local state moves their key. Negate them in that package's turbo.json:\n  ${ignoredIn.slice(0, 20).join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("the coverage rules see what they are meant to", () => {
  it("finds reads the tree is known to make, through the same walk the rule uses", () => {
    const file = "packages/sitrep-client/src/propagation.test.ts";
    const { paths } = readsOf(file, readFileSync(join(ROOT, file), "utf8"));
    expect([...paths]).toContain("mod/golden-fixtures/propagation.json");

    const baked = "packages/app/src/uplinks/bakedClientHash.test.ts";
    const bakedReads = readsOf(baked, readFileSync(join(ROOT, baked), "utf8"));
    expect([...bakedReads.paths]).toContain("scripts/uplink-matrix.mjs");
    expect([...bakedReads.paths]).toContain("mod/*/ExpectedClientHash.g.cs");
  });

  it("flags a planted read of a file the test's key leaves out", () => {
    const planted = readsOf(
      "packages/ui/src/planted.test.ts",
      [
        'import { join, dirname } from "node:path";',
        'import { fileURLToPath } from "node:url";',
        "const HERE = dirname(fileURLToPath(import.meta.url));",
        'const target = join(HERE, "..", "..", "..", "scripts", "uplink-matrix.mjs");',
      ].join("\n"),
    );
    expect([...planted.paths]).toEqual(["scripts/uplink-matrix.mjs"]);
    expect(
      hashedBy("@ksp-gonogo/ui#test").has("scripts/uplink-matrix.mjs"),
    ).toBe(false);
  });

  it("reads a planted git search by its pathspecs, and a runtime one as the whole tree", () => {
    const literal = readsOf(
      "packages/ui/src/planted.test.ts",
      'execFileSync("git", ["grep", "-l", "x", "--", "mod/*.cs", ":!*/obj/*"]);',
    );
    expect([...literal.pathspecs]).toEqual(["mod/*.cs"]);
    expect(literal.searchesTree).toBe(false);
    expect(
      pathspecMatches("mod/*.cs", "mod/Gonogo.KSP/CommsCoreUplink.cs"),
    ).toBe(true);
    expect(pathspecMatches("mod/*.cs", "packages/app/src/App.tsx")).toBe(false);

    const runtime = readsOf(
      "packages/ui/src/planted.test.ts",
      'const specs = ["mod"];\nexecFileSync("git", ["grep", "-l", "x", "--", ...specs]);',
    );
    expect(runtime.searchesTree).toBe(true);
  });

  it("counts a dependency's build inputs as part of a key, as turbo does", () => {
    /* components never hashes theme's tokens.css itself, yet a change to it
       moves components#test's hash, because the file is an input of the
       theme build that `^build` makes it wait on. */
    const components = "@ksp-gonogo/components#test";
    const tokens = "packages/theme/src/tokens.css";
    const task = TASKS.get(components);
    expect(task).toBeDefined();
    if (!task) return;
    expect(ownInputs(task).has(tokens)).toBe(false);
    expect(hashedBy(components).has(tokens)).toBe(true);
  });
});
