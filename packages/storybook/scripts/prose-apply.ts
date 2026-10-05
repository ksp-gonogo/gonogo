/**
 * Writes the strings edited on a review sheet back into their copy tables:
 *
 *   pnpm --filter @ksp-gonogo/storybook prose-apply <export.json> [--dry-run]
 *
 * Each edit carries the text it was made against. A key whose table no longer
 * holds that text is refused, so an export made before a later rewrite cannot
 * undo it; the other edits are still written. Exits 1 when anything was
 * refused. `--dry-run` reports and writes nothing.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEdits, type ProseEdit, readEdits } from "./prose";
import { PROSE_SOURCES } from "./prose-sources";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function main(): void {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const [path] = argv.filter((arg) => !arg.startsWith("--"));
  if (!path) throw new Error("usage: prose-apply <export.json> [--dry-run]");
  const file = resolve(process.env.INIT_CWD ?? process.cwd(), path);
  const edits = readEdits(JSON.parse(readFileSync(file, "utf8")), file);
  if (edits.length === 0) {
    console.log(`prose-apply: ${file} carries no edited text`);
    return;
  }

  let refused = 0;
  let written = 0;
  const bySource = new Map<string, ProseEdit[]>();
  for (const edit of edits) {
    const sourceId = edit.id.slice(0, edit.id.indexOf(":"));
    bySource.set(sourceId, [...(bySource.get(sourceId) ?? []), edit]);
  }
  for (const [sourceId, mine] of bySource) {
    const source = PROSE_SOURCES.find((s) => s.id === sourceId);
    if (!source) {
      for (const edit of mine) {
        console.error(
          `prose-apply: REFUSED ${edit.id}: no prose source ${JSON.stringify(sourceId)} is registered`,
        );
      }
      refused += mine.length;
      continue;
    }
    const target = resolve(REPO, source.file);
    const result = applyEdits(
      readFileSync(target, "utf8"),
      source.exportName,
      source.id,
      mine,
    );
    for (const edit of result.applied) {
      console.log(
        `prose-apply: ${edit.id}\n    was ${JSON.stringify(edit.old)}\n    now ${JSON.stringify(edit.new)}`,
      );
    }
    for (const edit of result.already) {
      console.log(`prose-apply: ${edit.id} already reads as edited`);
    }
    for (const r of result.refused) {
      console.error(`prose-apply: REFUSED ${r.id}: ${r.why}`);
    }
    refused += result.refused.length;
    written += result.applied.length;
    if (result.applied.length > 0 && !dryRun) {
      writeFileSync(target, result.text);
      // A longer string can want a different line break than the one it replaced.
      execFileSync("pnpm", ["exec", "biome", "format", "--write", target], {
        cwd: REPO,
        stdio: "ignore",
      });
      console.log(`prose-apply: wrote ${source.file}`);
    }
  }
  console.log(
    `prose-apply: ${written} string(s) ${dryRun ? "would be written" : "written"}, ${refused} refused`,
  );
  if (refused > 0) process.exitCode = 1;
}

main();
