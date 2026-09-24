import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Base-revision resolution shared by every shrink-only ratchet in this repo.
 *
 * A shrink-only ratchet grades a committed debt list by reading the SAME file at
 * a base revision and diffing the two. If that revision cannot be read the diff
 * never happens, and until this module existed each of the five gates caught the
 * git failure and returned early, so the comparison not happening was
 * indistinguishable from it passing. `actions/checkout` clones at depth 1 and no
 * workflow set a base ref, so in CI the comparison had never once run.
 *
 * Two rules follow, and both are enforced here rather than at each call site:
 *
 * - a base that cannot be read is an ERROR, never a skip
 * - a base that IS the commit under test is an error too, because a file
 *   compared against itself can only ever report "unchanged", and a gate
 *   incapable of failing must not report success
 *
 * The second rule is the one a push to `staging` walks into: `origin/staging` on
 * such a run is the pushed commit, so the obvious-looking base is the subject.
 * The real base there is the branch tip BEFORE the push, which CI supplies
 * through `RATCHET_BASE_REF` (see `scripts/resolve-ratchet-base-ref.sh`).
 *
 * Excluded from the package build in `tsconfig.build.json`: this is test support
 * and reaches for `node:child_process`, which has no business in core's dist.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** Repo root by way of git, so a worktree resolves to its own checkout. */
export function ratchetRepoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: HERE,
    encoding: "utf8",
  }).trim();
}

export interface RatchetBase {
  /** How the base was named, so a failure can quote what was asked for. */
  ref: string;
  /** The commit it resolved to. */
  sha: string;
}

/**
 * Ordered fallbacks for a local run, where no `RATCHET_BASE_REF` is set.
 *
 * `origin/staging` first because branches are cut from staging and land there,
 * so main trails it by however long a release takes, and diffing against main
 * means diffing against a ref where a recently-added allowlist file may not
 * exist yet. A ratchet is at its most load-bearing in the weeks after it lands,
 * which is exactly the window resolving to main would lose.
 */
const LOCAL_CANDIDATES = ["origin/staging", "origin/main", "main"] as const;

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: ratchetRepoRoot(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function resolveCommit(ref: string): string | null {
  try {
    return git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) || null;
  } catch {
    return null;
  }
}

function mergeBase(a: string, b: string): string | null {
  try {
    return git(["merge-base", a, b]) || null;
  } catch {
    return null;
  }
}

/** True on a GitHub Actions runner, where a vacuous comparison is a config bug. */
function onGithubActions(): boolean {
  return process.env.GITHUB_ACTIONS === "true";
}

/**
 * The revision a debt list is graded against.
 *
 * Throws when no base can be reached, and throws when the base turns out to be
 * the commit under test on a run where that cannot be an accident (CI, or an
 * explicitly supplied `RATCHET_BASE_REF`).
 *
 * Returns null in exactly one case: a local checkout sitting on the base itself
 * with nothing supplied, where there is genuinely nothing to diff and no claim
 * is being made. `ratchet-base-ref.test.ts` is what stops that case widening,
 * by asserting the resolver reaches a real, non-self base whenever it runs
 * anywhere the result is load-bearing.
 */
export function ratchetBaseRef(): RatchetBase | null {
  const head = resolveCommit("HEAD");
  if (!head) {
    throw new Error(
      "[ratchet] HEAD does not resolve to a commit, so no shrink-only gate can " +
        "run. This is not a checkout the ratchets can grade.",
    );
  }

  const explicit = process.env.RATCHET_BASE_REF;
  if (explicit) {
    const sha = resolveCommit(explicit);
    if (!sha) throw unreachable(`RATCHET_BASE_REF=${explicit}`);
    return vet({ ref: explicit, sha }, head, true);
  }

  for (const candidate of LOCAL_CANDIDATES) {
    const tip = resolveCommit(candidate);
    if (!tip) continue;
    // The merge base rather than the tip: a branch that is merely BEHIND its
    // target would otherwise be graded against entries the target added, and
    // read as having grown a list it never touched.
    const sha = mergeBase(head, tip) ?? tip;
    return vet({ ref: candidate, sha }, head, onGithubActions());
  }

  throw unreachable(
    `none of ${LOCAL_CANDIDATES.join(", ")} exist in this checkout`,
  );
}

function vet(
  base: RatchetBase,
  head: string,
  strict: boolean,
): RatchetBase | null {
  if (base.sha !== head) return base;
  if (!strict) return null;
  throw new Error(
    `[ratchet] the base revision ${base.ref} IS the commit under test ` +
      `(${head}), so every debt list would be diffed against itself and could ` +
      `only ever report "unchanged". A gate that cannot fail must not report ` +
      `success.\n` +
      "On a push, the base is the branch tip BEFORE the push " +
      "(github.event.before), never origin/<the branch being pushed>. " +
      "scripts/resolve-ratchet-base-ref.sh works that out per trigger and CI " +
      "publishes it as RATCHET_BASE_REF.",
  );
}

function unreachable(what: string): Error {
  return new Error(
    `[ratchet] base revision unreachable: ${what}.\n` +
      "A shrink-only debt list is graded by reading the same file at a base " +
      "revision, so with no base there is no check at all. This used to return " +
      "early and report green, which is how every one of these gates spent its " +
      "whole life passing in CI without running.\n" +
      "In GitHub Actions: the checkout needs `fetch-depth: 0` and the " +
      '"Resolve the ratchets\' base revision" step must set RATCHET_BASE_REF.\n' +
      "Locally: `git fetch origin staging` so origin/staging exists, or set " +
      "RATCHET_BASE_REF=<commit> yourself.",
  );
}

/**
 * The source of `relPath` as it stood at `base`, or null when the file did not
 * exist there.
 *
 * Null is genuine on the commit that first seeds a list, and on a branch cut
 * before the list landed. It is a lie anywhere else, and the caller cannot tell
 * the two apart, so the callers skip and `ratchet-base-ref.test.ts` asserts
 * separately that every known debt list really was readable at the base. That
 * split is deliberate: one place says "the instrument could not read its input",
 * instead of five places each quietly deciding it does not matter.
 */
export function sourceAtRatchetBase(
  base: RatchetBase,
  relPath: string,
): string | null {
  try {
    return execFileSync("git", ["show", `${base.sha}:${relPath}`], {
      cwd: ratchetRepoRoot(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

/**
 * Every debt-list module graded against a base revision, as repo-relative paths.
 *
 * Enumerated here rather than discovered by filename, so a list renamed to
 * something that stops matching a pattern shows up as a missing file rather than
 * as a shorter scan nobody reads.
 */
export const RATCHET_ALLOWLIST_PATHS = [
  "packages/core/src/banner-comments.allowlist.ts",
  "packages/core/src/comment-stacks.allowlist.ts",
  "packages/core/src/declaration-reachability.allowlist.ts",
  "packages/core/src/panel-body.allowlist.ts",
  "packages/core/src/published-doc-reachability.allowlist.ts",
  "packages/core/src/render-fixture-coverage.debt.ts",
  "packages/core/src/typecheck-coverage.allowlist.ts",
  "packages/core/src/unknown-cast.debt.ts",
  "packages/core/src/uplink-boundary.allowlist.ts",
  "packages/core/src/uplink-isolation.allowlist.ts",
  "packages/core/src/widget-fixture-conformance.debt.ts",
] as const;

/**
 * A module's exports as read at the ratchet base.
 *
 * Everything in here is `unknown`: the file came off another commit and nothing
 * typechecked it against today's declarations. The readers below are how a gate
 * asks for one export at one shape, and each checks the shape it is about to
 * read rather than asserting it.
 */
export type BaseExports = Record<string, unknown>;

function exported(lists: BaseExports | undefined, name: string): unknown {
  return lists === undefined ? undefined : lists[name];
}

/** A `number` export, or `undefined` when the base did not carry one. */
export function baseNumber(
  lists: BaseExports | undefined,
  name: string,
): number | undefined {
  const value = exported(lists, name);
  return typeof value === "number" ? value : undefined;
}

/** A `readonly string[]` export, or `undefined` when the base carried anything else. */
export function baseStrings(
  lists: BaseExports | undefined,
  name: string,
): readonly string[] | undefined {
  const value = exported(lists, name);
  if (!Array.isArray(value)) return undefined;
  return value.every((entry) => typeof entry === "string")
    ? (value as string[])
    : undefined;
}

/** A per-key COUNT map, the shape most debt lists have. */
export function baseCounts(
  lists: BaseExports | undefined,
  name: string,
): Record<string, number> | undefined {
  return baseMapOf(lists, name, (v): v is number => typeof v === "number");
}

/** A per-key string map, the shape a reason-carrying debt list has. */
export function baseReasons(
  lists: BaseExports | undefined,
  name: string,
): Record<string, string> | undefined {
  return baseMapOf(lists, name, (v): v is string => typeof v === "string");
}

/** A per-key list-of-strings map, the shape a per-Uplink debt list has. */
export function baseStringLists(
  lists: BaseExports | undefined,
  name: string,
): Record<string, readonly string[]> | undefined {
  return baseMapOf(
    lists,
    name,
    (v): v is readonly string[] =>
      Array.isArray(v) && v.every((entry) => typeof entry === "string"),
  );
}

/**
 * An export that is a record of one value shape, or `undefined` when the base
 * carried something else. One bad value disqualifies the whole export: a
 * partially-read ratchet list grades against a population nobody wrote.
 */
export function baseMapOf<V>(
  lists: BaseExports | undefined,
  name: string,
  isValue: (value: unknown) => value is V,
): Record<string, V> | undefined {
  const value = exported(lists, name);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const out: Record<string, V> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isValue(entry)) return undefined;
    out[key] = entry;
  }
  return out;
}

/**
 * An export that is an object of NUMBER fields, naming which fields the caller
 * goes on to read. `undefined` when any of them is missing or is not a number,
 * for the same reason `baseMapOf` refuses a partial map.
 */
export function baseNumberFields<F extends string>(
  lists: BaseExports | undefined,
  name: string,
  fields: readonly F[],
): Record<F, number> | undefined {
  const counts = baseCounts(lists, name);
  if (!counts) return undefined;
  const out = {} as Record<F, number>;
  for (const field of fields) {
    const value = counts[field];
    if (typeof value !== "number") return undefined;
    out[field] = value;
  }
  return out;
}

/**
 * The exit status a child process failed with, and `undefined` when the throw
 * was something else.
 *
 * A `git grep` exiting 1 means "no matches", which several scans have to tell
 * apart from a real failure. `execFileSync` throws a plain `Error` with a
 * `status` property bolted on, so there is nothing to `instanceof`.
 */
export function exitStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const status: unknown = Reflect.get(err, "status");
  return typeof status === "number" ? status : undefined;
}

/**
 * A JSON file's top-level object, or a failure naming the file.
 *
 * `JSON.parse` answers `any`, so every field read off it is unchecked. Callers
 * take the fields they read off the record and check each one, which is how a
 * `package.json` missing a `name` becomes an error instead of `undefined`.
 */
export function readJsonObject(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} does not hold a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}
