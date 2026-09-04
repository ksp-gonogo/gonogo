import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Design-system guard: a status badge never reads before the thing it is a
 * status OF.
 *
 * The operator's ruling, off a render of the Administration Building's Program
 * detail pane: "status badges ideally should always be above, or aligned to the
 * right. Badge then title doesn't read well because the state comes before the
 * subject." It is a general rule rather than a fix to one pane, which is what
 * this file makes it: order in the SOURCE is order in the DOM, and order in the
 * DOM is what a screen reader walks and an eye scans.
 *
 * `SubjectHeading` in `@ksp-gonogo/ui-kit` is the sanctioned way to build one of
 * these lines, and it takes its status through a prop rather than as a child, so
 * the order is not a caller's to pass in. Adopting it is what clears a hit here.
 *
 * Two sites were violating it when the guard was written (an RP-1 Program's
 * detail pane and a training course's card), out of 112 badge call sites across
 * `packages/components` and the eleven bundled Uplinks. Both are fixed; the
 * allowed count is zero and there is no allowlist.
 */

/** A `<Badge` whose element closes, then a heading-ish node naming a subject. */
const HEADING_TAG = /<(Text|RowName|SectionTitle|h[1-6]|Truncate|strong)\b/;
const SUBJECT_WORD = /name|title|label|heading/i;

/**
 * How far past a badge's closing tag a following subject still counts as being
 * on the same line. Four is what separates `<Badge>X</Badge>` followed by the
 * subject's own two- or three-line element from a badge that simply ends a
 * block and is followed, several elements later, by an unrelated row.
 */
const WINDOW = 4;

/**
 * The badge is being handed to a component through a named prop rather than
 * laid out beside a sibling, so the COMPONENT decides where it lands and the
 * source order above it says nothing. `SubjectHeading`'s `status=` and
 * `ProjectCard`'s `badge=` are both this: they render the badge after their
 * subject however the call site is written, which is the whole reason to reach
 * for one. Looked for on the lines just above the badge, because a prop
 * expression opens on its own line and the badge follows on the next.
 */
const HANDED_TO_A_COMPONENT = /\b(status|badge)=\{/;
const LOOKBACK = 3;

interface Hit {
  file: string;
  line: number;
  excerpt: string;
}

function repoRoot(startDir: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: startDir,
    encoding: "utf8",
  }).trim();
}

/**
 * Every widget `.tsx` under the scanned roots, tracked or not. `--others` is
 * load-bearing for the same reason `--untracked` is in the ellipsis guard: a
 * violation in a BRAND-NEW file is invisible to a tracked-only scan until it is
 * staged, and a local run before `git add` reports success while not looking at
 * it.
 *
 * The Uplinks are selected in JS rather than by a `mod/*Uplink/client/src`
 * pathspec, because that pathspec matches NOTHING: git's `*` does not cross a
 * path separator here, so the whole `mod/` half of the scan silently found zero
 * files and the guard reported a clean tree while blind to the two violations
 * that prompted it. `uplinkFiles` below is the anchor that would have caught it.
 */
function scannedFiles(root: string): string[] {
  const out = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "packages/components/src",
      "packages/ui/src",
      "packages/ui-kit/src",
      "mod",
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 64 },
  );
  return out
    .split("\n")
    .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
    .filter((f) => !f.startsWith("mod/") || f.includes("/client/src/"));
}

/** The Uplink half of the scan, which is the half that went silently empty. */
function uplinkFiles(files: string[]): string[] {
  return files.filter((f) => f.startsWith("mod/"));
}

/** The matcher itself, over one file's lines. The control test runs it too. */
function hitsIn(file: string, lines: string[]): Hit[] {
  const hits: Hit[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/<Badge[\s>]/.test(lines[i])) continue;
    const before = lines.slice(Math.max(0, i - LOOKBACK), i).join(" ");
    if (HANDED_TO_A_COMPONENT.test(before)) continue;

    // Where this badge's element ends, so the window starts after it.
    let close = -1;
    for (let j = i; j < Math.min(lines.length, i + 10); j++) {
      if (/<\/Badge>|\/>/.test(lines[j])) {
        close = j;
        break;
      }
    }
    if (close < 0) continue;

    const window = lines.slice(close + 1, close + 1 + WINDOW).join(" ");
    if (HEADING_TAG.test(window) && SUBJECT_WORD.test(window)) {
      hits.push({
        file,
        line: i + 1,
        excerpt: lines
          .slice(i, close + 1 + WINDOW)
          .map((l) => l.trim())
          .filter(Boolean)
          .join(" ")
          .slice(0, 180),
      });
    }
  }
  return hits;
}

function badgesBeforeTheirSubject(root: string, files: string[]): Hit[] {
  return files.flatMap((file) =>
    hitsIn(file, readFileSync(join(root, file), "utf8").split("\n")),
  );
}

const here = fileURLToPath(import.meta.url);
const root = repoRoot(dirname(here));
const files = scannedFiles(root);
const offenders = badgesBeforeTheirSubject(root, files);

describe("design-system: a status badge never precedes its subject", () => {
  it("finds no badge drawn before the name of the thing it describes", () => {
    if (offenders.length > 0) {
      throw new Error(
        `A status badge is drawn before its subject in ${offenders.length} ` +
          "place(s). A state chip reads after the thing it is a state OF, " +
          "above it or at the end of its line; use `SubjectHeading` from " +
          "@ksp-gonogo/ui-kit, which takes the badge through `status=` so the " +
          "order cannot be passed in wrong:\n" +
          offenders
            .map((h) => `  ${h.file}:${h.line}\n    ${h.excerpt}`)
            .join("\n"),
      );
    }
    expect(offenders).toHaveLength(0);
  });

  /*
   * A zero-hit scan and a scan that ran in the wrong directory, matched nothing
   * through a quoting mistake, or was handed a pathspec excluding the whole
   * tree all read the same way: green. So the SAME matcher is shown a planted
   * violation, in memory rather than on disk, and has to find it. The first
   * version of this guard reported a clean tree while its `mod/*Uplink/...`
   * pathspec matched no file at all, which is the failure this is here for.
   */
  it("can see a violation, so the empty result above means something", () => {
    const planted = [
      '        <Cluster gap="xs" wrap>',
      '          <Badge severity="info">ACTIVE</Badge>',
      '          <Text weight="semibold">{label(program)}</Text>',
      "        </Cluster>",
    ];
    expect(hitsIn("planted", planted)).toHaveLength(1);
  });

  /*
   * And the other half of the same worry: a matcher that flagged every badge
   * would also be "seeing violations". The sanctioned form has to come back
   * clean, or the guard would fail the very component it names as the fix.
   */
  it("passes the sanctioned form, so it is not just flagging every badge", () => {
    const sanctioned = [
      "        <SubjectHeading",
      "          status={",
      '            <Badge severity="info">ACTIVE</Badge>',
      "          }",
      "        >",
      '          <Text weight="semibold">{label(program)}</Text>',
      "        </SubjectHeading>",
    ];
    expect(hitsIn("sanctioned", sanctioned)).toHaveLength(0);
  });

  it("scanned a real tree rather than an empty file list", () => {
    // The roots hold well over two hundred .tsx files between them; a handful
    // means the pathspec matched almost nothing and the verdict is worthless.
    expect(files.length).toBeGreaterThan(200);
  });

  /*
   * Named separately because it is the half that failed silently: a
   * `mod/*Uplink/client/src` pathspec found zero files, and both violations
   * this guard was written for live under `mod/`. A count folded into the total
   * above would have stayed comfortably over its floor on `packages/` alone.
   */
  it("reached the Uplinks, not just the app's own packages", () => {
    expect(uplinkFiles(files).length).toBeGreaterThan(50);
  });
});
