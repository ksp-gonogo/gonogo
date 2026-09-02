// @vitest-environment node
//
// Node realm: this reads markdown and package manifests off disk.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A published document may not tell a third-party author to install something
 * that does not exist.
 *
 * `docs/` is where an outside author is sent, and it had been telling them for
 * weeks to install `@ksp-gonogo/sitrep-testing` (deleted) and to import from
 * `@ksp-gonogo/ui-kit/testing-react` (a subpath the kit does not export). Two
 * named packages wrong in the two documents whose entire job is to say which
 * packages to use, which is the exact failure mode the render harness this gate
 * arrived with exists to end.
 *
 * IT IS A DIFFERENT KIND OF INSTRUMENT from `published-doc-reachability`, which
 * is why both are here. That one walks a TypeScript program and reads doc
 * comments on exported symbols, so it is structurally incapable of seeing a
 * sentence in a markdown file; it had a debt list at zero throughout the weeks
 * the two names above were wrong. A gate cannot report a failure it cannot
 * express.
 *
 * Only `@ksp-gonogo/*` specifiers are checked, and only in `docs/`: a third-party
 * npm name is not this repo's to vouch for, and `local_docs/` is scratch.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const DOCS_DIR = join(REPO_ROOT, "docs");

/**
 * Every `@ksp-gonogo/...` string in the docs, with the file and line it sits on.
 *
 * Matched with a deliberately loose head and a strict tail: a scoped name runs
 * to whitespace, a closing backtick or quote, or ordinary sentence punctuation.
 * Trailing punctuation is stripped, because a specifier at the end of a sentence
 * is followed by a full stop and reporting `@ksp-gonogo/ui-kit.` as a missing
 * package is how a gate like this gets switched off.
 */
const SPECIFIER_RE = /@ksp-gonogo\/[a-z0-9][a-z0-9._/-]*/gi;

interface Mention {
  file: string;
  line: number;
  specifier: string;
}

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // `docs/superpowers/` is gitignored working notes, not published docs.
      if (entry === "superpowers" || entry === "assets") continue;
      out.push(...markdownFiles(full));
    } else if (entry.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

function mentions(): Mention[] {
  const out: Mention[] = [];
  for (const file of markdownFiles(DOCS_DIR)) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (const [index, line] of lines.entries()) {
      for (const match of line.matchAll(SPECIFIER_RE)) {
        out.push({
          file: file.slice(REPO_ROOT.length + 1),
          line: index + 1,
          specifier: match[0].replace(/[.,;:)\]]+$/, ""),
        });
      }
    }
  }
  return out;
}

interface KnownPackage {
  /** `undefined` for a package installed from the registry rather than built here. */
  exports?: Record<string, unknown>;
}

/**
 * Every `@ksp-gonogo/...` package that exists: the workspace's own, plus any one a
 * workspace manifest depends on.
 *
 * The second half is not slack. Some `@ksp-gonogo/` packages are published from
 * a sister repository, so they are packages an author can genuinely install and
 * a doc naming one is right; a gate that only knew about workspace directories
 * would report it missing and get switched off for crying wolf. Their subpaths
 * are not this repo's to check, hence the absent `exports`.
 */
function knownPackages(): Map<string, KnownPackage> {
  const found = new Map<string, KnownPackage>();
  const dependencies = new Set<string>();
  const roots = [join(REPO_ROOT, "packages"), join(REPO_ROOT, "mod")];
  const consider = (dir: string) => {
    const manifest = join(dir, "package.json");
    try {
      statSync(manifest);
    } catch {
      return;
    }
    const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
      name?: string;
      exports?: Record<string, unknown>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    if (pkg.name?.startsWith("@ksp-gonogo/")) {
      found.set(pkg.name, { exports: pkg.exports });
    }
    for (const name of Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    })) {
      if (name.startsWith("@ksp-gonogo/")) dependencies.add(name);
    }
  };
  consider(REPO_ROOT);
  for (const root of roots) {
    for (const entry of readdirSync(root)) {
      const dir = join(root, entry);
      if (!statSync(dir).isDirectory()) continue;
      consider(dir);
      // Uplinks keep their npm package one level down, in `client/`.
      consider(join(dir, "client"));
    }
  }
  for (const name of dependencies) {
    if (!found.has(name)) found.set(name, {});
  }
  return found;
}

/**
 * Names a document may mention BECAUSE they do not exist, with the reason.
 *
 * A document has to be able to say "this used to exist and is gone", or the only
 * way to satisfy the gate is to delete the sentence that tells a reader why their
 * old import stopped working. So the exemption is a short explicit list rather
 * than a lexical negation detector: `published-doc-reachability` built one of
 * those, measured it and rejected it, and a list of five names anyone can read is
 * a better instrument than a regex that guesses at English.
 *
 * Adding a line here is asserting "this name is dead and the docs discuss it as
 * dead", which is a claim someone can check.
 */
const KNOWN_ABSENT: Record<string, string> = {
  "@ksp-gonogo/sitrep-testing":
    "deleted; the harness moved to @ksp-gonogo/sitrep-sdk/testing and " +
    "@ksp-gonogo/ui-kit/testing, and both documents explain the move",
  "@ksp-gonogo/ui-kit/testing-react":
    "never existed; named by uplink-isolation.md for months, and that " +
    "document now says so",
};

/** Split `@scope/name/sub/path` into the package name and its subpath. */
function split(specifier: string): { name: string; subpath: string } {
  const parts = specifier.split("/");
  const name = parts.slice(0, 2).join("/");
  const rest = parts.slice(2).join("/");
  return { name, subpath: rest ? `./${rest}` : "." };
}

describe("published docs name packages that exist", () => {
  const packages = knownPackages();
  const all = mentions();

  it("finds specifiers to check, so a silent zero cannot pass for clean", () => {
    // A regex that matched nothing would report every document perfect. The
    // floor is deliberately far below the real count (over a hundred) and only
    // has to prove the scanner ran.
    expect(all.length).toBeGreaterThan(20);
  });

  it("still names the dead packages it exempts, so the list cannot rot", () => {
    // An entry in KNOWN_ABSENT is a statement that the docs DISCUSS a dead
    // name. Once no document mentions it, the entry is a permission nobody
    // needs, and a stale permission is how an exemption outlives its reason.
    const mentioned = new Set(all.map((m) => m.specifier));
    const unused = Object.keys(KNOWN_ABSENT).filter((n) => !mentioned.has(n));
    expect(unused).toEqual([]);
  });

  it("every named package is one that exists", () => {
    const unknown = all.filter(
      (m) =>
        KNOWN_ABSENT[m.specifier] === undefined &&
        !packages.has(split(m.specifier).name),
    );
    expect(
      unknown.map((m) => `${m.file}:${m.line} names ${m.specifier}`),
    ).toEqual([]);
  });

  it("every named subpath is one the package actually exports", () => {
    const bad: string[] = [];
    for (const mention of all) {
      if (KNOWN_ABSENT[mention.specifier] !== undefined) continue;
      const { name, subpath } = split(mention.specifier);
      const pkg = packages.get(name);
      // The package half is the other test's finding; do not report it twice.
      if (!pkg) continue;
      // A package with no `exports` map exposes whatever it likes, so there is
      // nothing here to be wrong about.
      if (!pkg.exports) continue;
      // A file path inside the package (`@ksp-gonogo/core/src/foo.ts`) is prose
      // about the repository rather than an import an author would write.
      if (subpath.startsWith("./src/")) continue;
      if (subpath in pkg.exports) continue;
      bad.push(
        `${mention.file}:${mention.line} names ${mention.specifier}, but ` +
          `${name} exports only ${Object.keys(pkg.exports).join(", ")}`,
      );
    }
    expect(bad).toEqual([]);
  });
});
