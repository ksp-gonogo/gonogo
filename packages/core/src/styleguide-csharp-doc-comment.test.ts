import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Design-system guard: C# documentation comments use the single-line
 * `///` form, never the delimited `/** ... *\/` form.
 *
 * Both are valid XML documentation comments per the C# spec, so this is
 * a consistency rule rather than a correctness one. `///` wins because
 * every editor in the ecosystem generates and continues it (typing it
 * above a member stubs out the summary), because the delimited form
 * strips a per-line leading asterisk only when every line carries one
 * consistently and otherwise leaks the asterisks into the rendered
 * docs, and because the existing `mod/` tree is already uniformly
 * `///`. A single mixed file is worse than either choice made
 * consistently.
 *
 * This is the C# counterpart of the repo's prose-style rules. It does
 * NOT apply to TypeScript, where `/** *\/` remains the correct block
 * form for a genuinely multi-line doc comment (a stack of `//` lines
 * is the thing to avoid there).
 *
 * Scans git-tracked `.cs` files so it respects `.gitignore` and needs
 * no hand-maintained directory list, the same approach as the em-dash
 * and uplink-boundary guards.
 */

const DELIMITED_DOC = "/**";

/**
 * `RtConfig.cs` builds the generated TypeScript SDK as C# string
 * literals, so the delimited doc comments it contains are TS being
 * emitted, not C# being documented, and `/** *\/` is the correct form
 * there. The C# in that file documents itself with `///` like the rest
 * of the tree.
 */
const ALLOWED_FILES = new Set(["mod/Sitrep.Contract/RtConfig.cs"]);

function repoRoot(startDir: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: startDir,
    encoding: "utf8",
  }).trim();
}

function csharpFilesWithDelimitedDoc(root: string): string[] {
  let out: string;
  try {
    out = execFileSync(
      "git",
      ["grep", "-Il", "--fixed-strings", DELIMITED_DOC, "--", "*.cs"],
      { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 16 },
    );
  } catch (err) {
    // git grep exits 1 when nothing matches anywhere.
    if ((err as { status?: number }).status === 1) return [];
    throw err;
  }
  return out
    .split("\n")
    .filter(Boolean)
    .filter((f) => !ALLOWED_FILES.has(f));
}

const root = repoRoot(dirname(fileURLToPath(import.meta.url)));

describe("design-system: C# doc comments", () => {
  it("use the /// form, never delimited /** */", () => {
    const offenders = csharpFilesWithDelimitedDoc(root);
    if (offenders.length > 0) {
      const sample = offenders
        .slice(0, 15)
        .map((f) => `  ${f}`)
        .join("\n");
      throw new Error(
        `Found a delimited doc comment in ${offenders.length} C# file(s). ` +
          "Rewrite it as consecutive /// lines with the same XML tags: the " +
          "mod tree is uniformly /// and editors generate and continue that " +
          "form. Offenders:\n" +
          sample,
      );
    }
    expect(offenders).toHaveLength(0);
  });
});
