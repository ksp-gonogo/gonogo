// @vitest-environment node
//
// Node realm rather than the package's jsdom default: everything here shells out
// to git.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RATCHET_ALLOWLIST_PATHS,
  ratchetBaseRef,
  ratchetRepoRoot,
  sourceAtRatchetBase,
} from "./ratchetBaseRef";

/**
 * Did the shrink-only ratchets actually get to run?
 *
 * A different kind of check from the five gates it covers. Each of those asks
 * "has this debt list grown", and each answers by reading the list at a base
 * revision. None of them can ask whether that read happened at all, because for
 * every one of them the read failing and the list not having grown produce the
 * same green. That is not a hypothesis: `actions/checkout` clones at depth 1 and
 * nothing set a base ref, so for the whole life of those gates the read failed on
 * every CI run and all five reported success without comparing anything.
 *
 * So this file asks the question they structurally cannot: was the instrument
 * able to read its input this run, and was the input something other than the
 * subject. Everything it asserts is about the measuring apparatus, and none of it
 * is about anyone's debt.
 */
describe("the shrink-only ratchets can reach a base revision", () => {
  const onGithubActions = process.env.GITHUB_ACTIONS === "true";
  const repoRoot = ratchetRepoRoot();
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();

  /** Trimmed stdout, or null when git exits non-zero (which several of these ask about). */
  function run(args: string[]): string | null {
    try {
      return execFileSync("git", args, {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch {
      return null;
    }
  }

  it("resolves one, or says plainly that it cannot", () => {
    // Not wrapped: an unreachable base throws, and the throw failing this test
    // is the entire behaviour under test. A green here means a base was found
    // or the checkout is sitting on it.
    const base = ratchetBaseRef();
    if (base) {
      expect(base.sha).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("never grades the tree against itself on a CI runner", () => {
    if (!onGithubActions) return;
    const base = ratchetBaseRef();
    expect(
      base,
      "On a runner the base is supplied by the workflow and must exist. A null " +
        "here means the checkout IS the base, so every debt list would be " +
        "diffed against itself.",
    ).not.toBeNull();
    expect(
      base?.sha,
      `The base (${base?.ref}) resolved to HEAD. On a push the base is the ` +
        "branch tip BEFORE the push (github.event.before), never " +
        "origin/<the branch being pushed>.",
    ).not.toBe(head);
  });

  it("grades against an ancestor of the checkout", () => {
    const base = ratchetBaseRef();
    if (!base) return;
    const isAncestor =
      run(["merge-base", "--is-ancestor", base.sha, head]) !== null;
    expect(
      isAncestor,
      `The base (${base.ref}, ${base.sha}) is not an ancestor of HEAD ` +
        `(${head}), so the two histories have nothing in common and any debt ` +
        "list read from it describes a different tree. This is what a wrong " +
        "ref looks like from the inside.",
    ).toBe(true);
  });

  /**
   * Every list that already existed at the base has to be readable there.
   *
   * Two different git mechanisms on purpose: `ls-tree` for "the base's tree
   * names this path" and `git show` for "and its content came back". They can
   * disagree, and the way they disagree is a partial or shallow clone where the
   * commit is present and the blob is not, which is the same silent skip this
   * whole file exists to end.
   *
   * A list added AFTER the base is genuinely absent from both, on a seeding
   * commit or on a branch cut before the list landed, and is not anybody's
   * mistake.
   */
  function existedButUnreadable(
    paths: readonly string[],
    existsAtBase: (path: string) => boolean,
    readAtBase: (path: string) => string | null,
  ): string[] {
    return paths.filter(
      (path) => existsAtBase(path) && readAtBase(path) === null,
    );
  }

  it("flags a list the base's tree names but cannot produce", () => {
    const flagged = existedButUnreadable(
      ["present.ts", "absent.ts", "listed-but-unfetched.ts"],
      (path) => path !== "absent.ts",
      (path) =>
        path === "listed-but-unfetched.ts" ? null : "export const A = 1;",
    );
    expect(flagged).toEqual(["listed-but-unfetched.ts"]);
  });

  it("can read every debt list that existed at the base", () => {
    const base = ratchetBaseRef();
    if (!base) return;
    const unreadable = existedButUnreadable(
      RATCHET_ALLOWLIST_PATHS,
      (path) => Boolean(run(["ls-tree", base.sha, "--", path])),
      (path) => sourceAtRatchetBase(base, path),
    );
    expect(
      unreadable,
      [
        `These debt lists are named in the base's tree (${base.ref},`,
        `${base.sha}) and could not be read there, so the gates that grade them`,
        "are skipping and no growth is being detected.",
      ].join("\n"),
    ).toEqual([]);
  });

  /**
   * The planted violations. A resolver that cannot refuse is a resolver whose
   * agreement means nothing, and the five gates now trust it to refuse on their
   * behalf, so its refusals are worth testing directly rather than inferring
   * from a green suite.
   */
  describe("refuses a base it cannot use", () => {
    function withBaseRef<T>(value: string, fn: () => T): T {
      const previous = process.env.RATCHET_BASE_REF;
      process.env.RATCHET_BASE_REF = value;
      try {
        return fn();
      } finally {
        if (previous === undefined) delete process.env.RATCHET_BASE_REF;
        else process.env.RATCHET_BASE_REF = previous;
      }
    }

    it("throws when the ref does not exist, naming it", () => {
      const planted = "refs/heads/no-such-ref-planted-by-the-guard";
      expect(() => withBaseRef(planted, ratchetBaseRef)).toThrow(planted);
      expect(() => withBaseRef(planted, ratchetBaseRef)).toThrow(
        /base revision unreachable/,
      );
    });

    it("throws when the ref IS the commit under test", () => {
      expect(() => withBaseRef(head, ratchetBaseRef)).toThrow(
        /IS the commit under test/,
      );
    });

    it("accepts a real ancestor, so the refusals above are not blanket", () => {
      const parent = execFileSync("git", ["rev-parse", "HEAD^"], {
        cwd: repoRoot,
        encoding: "utf8",
      }).trim();
      const base = withBaseRef(parent, ratchetBaseRef);
      expect(base?.sha).toBe(parent);
    });
  });

  /**
   * The old shape, kept out by name. Every one of the five carried
   * `process.env.RATCHET_BASE_REF ?? "origin/staging"` beside a `catch` that
   * returned undefined, and that pair is what made an unreachable base read as a
   * pass. Re-introducing it would restore the silence without failing anything,
   * which is exactly the kind of regression a behavioural test cannot see.
   */
  it("no ratchet re-introduces its own silent base-ref default", () => {
    // Every test file in this package, not the five by name: a sixth ratchet
    // will be written by copying one of the five, and a list of names cannot see
    // a file that is not on it.
    const files = execFileSync(
      "git",
      [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "packages/core/src",
      ],
      { cwd: repoRoot, encoding: "utf8" },
    )
      .split("\n")
      .filter((path) => path.endsWith(".test.ts"))
      // This file, which carries the pattern because it is the thing that
      // defines it. Flagging it would be flagging the answer as the offence.
      .filter((path) => !path.endsWith("/ratchet-base-ref.test.ts"));

    // The scan finding nothing is the failure mode this whole file is about, so
    // it is not allowed to be the reason for a pass.
    expect(
      files.length,
      "The scan for re-introduced base-ref defaults found no test files at all.",
    ).toBeGreaterThan(10);

    const offenders = files.filter((path) =>
      /process\.env\.RATCHET_BASE_REF\s*\?\?/.test(
        readFileSync(join(repoRoot, path), "utf8"),
      ),
    );

    expect(
      offenders,
      [
        "A ratchet is resolving its own base ref again, behind a fallback that",
        "cannot fail. Use `ratchetBaseRef()` from ./ratchetBaseRef, which throws",
        "when the base is unreachable instead of letting the caller return early",
        "and report green.",
      ].join("\n"),
    ).toEqual([]);
  });
});
