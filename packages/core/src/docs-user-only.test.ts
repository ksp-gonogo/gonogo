// @vitest-environment node
//
// Node realm: this lists files through git.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `docs/` is for people running gonogo: installing it, setting up KSP,
 * networking, deploying. Building an Uplink is documented on the Uplink docs
 * site, and notes on how this repository is maintained do not belong in the
 * repository at all. A new markdown file under `docs/` fails here until it is
 * added to this list, which is the moment to ask which of those three it is.
 */
const USER_DOCS: readonly string[] = [
  "docs/DEPLOYMENT.md",
  "docs/KSP-SETUP.md",
  "docs/NETWORKING.md",
  "docs/homepage/README.md",
];

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

/** Markdown under `docs/`, tracked or untracked, minus what git ignores. */
function docsMarkdown(): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", "docs"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  return out
    .split("\n")
    .filter((f) => f.toLowerCase().endsWith(".md"))
    .sort();
}

function unlistedDocs(
  files: readonly string[],
  allowed: readonly string[],
): string[] {
  const permitted = new Set(allowed);
  return files.filter((f) => !permitted.has(f));
}

describe("docs/ holds user docs only", () => {
  const files = docsMarkdown();

  it("sees a planted internal doc, so a clean result means something", () => {
    const planted = [
      ...USER_DOCS,
      "docs/creating-an-uplink.md",
      "docs/notes/ratchets.MD",
    ];
    expect(unlistedDocs(planted, USER_DOCS)).toEqual([
      "docs/creating-an-uplink.md",
      "docs/notes/ratchets.MD",
    ]);
  });

  it("finds every listed doc, so the list cannot outlive its files", () => {
    expect(USER_DOCS.filter((f) => !files.includes(f))).toEqual([]);
  });

  it("carries no markdown under docs/ outside the list", () => {
    expect(
      unlistedDocs(files, USER_DOCS),
      "docs/ is for people running gonogo. Uplink author docs belong on " +
        "https://ksp-gonogo.github.io/uplink-dev-docs/ (repository " +
        "ksp-gonogo/uplink-dev-docs), and maintainer notes do not belong in " +
        "the repository. Add a genuine user doc to USER_DOCS.",
    ).toEqual([]);
  });
});
