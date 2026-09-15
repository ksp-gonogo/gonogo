import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * No field that takes a host share code may cap its input BELOW the length the
 * host mints.
 *
 * The defect this generalises: the share code grew from four characters to six
 * (`crypto.getRandomValues`, 2026-09-15) and the switch-host field in
 * `StationConnectionFab` still carried `maxLength={4}` with a matching
 * `slice(0, 4)`. It silently trimmed the code the operator typed and the
 * station then reported "couldn't find that code" about a host that was up:
 * the mint looked complete, the failure surfaced two components away, and the
 * one visible symptom blamed the host.
 *
 * It is a scan rather than an assertion on that one field because the field
 * that drifted was not the field anyone would have thought to check. There are
 * two such inputs today and they already disagreed with each other; a third
 * would drift the same way.
 */

const SCAN_ROOTS = ["packages", "mod"];

/** Where the minted length is declared. Read, never duplicated. */
const MINT_FILE = "packages/app/src/peer/PeerHostService.ts";
const MINT_RE = /const SHARE_CODE_LENGTH = (\d+);/;

/**
 * A file deals with host codes if it names one of these. Deliberately the
 * plumbing names rather than the word "code", which half the tree uses for
 * something else.
 */
const HOST_CODE_MARKERS = [
  /\bhostInput\b/,
  /\bonSwitchHost\b/,
  /\bshareCode\b/,
  /\bHOST_ID_KEY\b/,
];

const MAX_LENGTH_RE = /maxLength=\{(\d+)\}/g;

interface Source {
  path: string;
  text: string;
}

interface Judged {
  path: string;
  maxLength: number;
}

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

/**
 * Every `maxLength` in a file that handles host codes, whatever its value. The
 * verdict is a separate step so the planted-violation check below can judge a
 * synthetic tree the git enumeration cannot reach.
 */
function judge(sources: Source[]): Judged[] {
  const judged: Judged[] = [];
  for (const source of sources) {
    if (!HOST_CODE_MARKERS.some((re) => re.test(source.text))) continue;
    for (const match of source.text.matchAll(MAX_LENGTH_RE)) {
      judged.push({ path: source.path, maxLength: Number(match[1]) });
    }
  }
  return judged;
}

/** The length a freshly-minted code carries, read from its own declaration. */
function mintedLength(root: string): number {
  const text = readFileSync(join(root, MINT_FILE), "utf8");
  const match = MINT_RE.exec(text);
  if (match === null) {
    throw new Error(
      `${MINT_FILE} no longer declares SHARE_CODE_LENGTH in the shape this scan reads. ` +
        "Fix the pattern rather than dropping the check: a scan that cannot find the " +
        "minted length would otherwise compare every input against nothing.",
    );
  }
  return Number(match[1]);
}

function trackedSources(root: string): Source[] {
  /*
   * Production sources only: a test file plants fixtures, and a planted
   * fixture is not a field an operator can type into. THIS file was the first
   * proof of that, and it only showed up once it was tracked: its own planted
   * `maxLength={4}` came back as three real offenders against the real tree,
   * so the scan reported itself. A run before `git add` passed, which is the
   * shape of blindness worth writing down rather than quietly fixing.
   */
  const tracked = execFileSync("git", ["ls-files", "-z", "--", ...SCAN_ROOTS], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((rel) => /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel));
  /*
   * Narrow with `git grep` before reading anything: a file carrying a
   * `maxLength` attribute necessarily contains that string, so this is a
   * superset of the answer and the regexes above still decide every candidate.
   */
  const candidates = execFileSync(
    "git",
    ["grep", "-l", "--", "maxLength={", "--", ...SCAN_ROOTS],
    { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  )
    .split("\n")
    .filter((rel) => rel.length > 0 && tracked.includes(rel));
  return candidates.map((rel) => ({
    path: rel,
    text: readFileSync(join(root, rel), "utf8"),
  }));
}

describe("share-code inputs", () => {
  const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

  it("never cap below the length a host mints", () => {
    const minimum = mintedLength(root);
    const tooNarrow = judge(trackedSources(root)).filter(
      (input) => input.maxLength < minimum,
    );

    expect(
      tooNarrow.map((input) => `${input.path}: maxLength=${input.maxLength}`),
      `A host mints a ${minimum}-character share code, and these inputs cannot hold one. ` +
        "An input narrower than the code TRIMS what the operator typed and the station " +
        "then reports the host as missing, which is the defect this scan was written for. " +
        "Widen the input (the join field allows 8, leaving room for a longer code later); " +
        "do not shorten the code.",
    ).toEqual([]);
  });

  it("sees the inputs it judges", () => {
    /*
     * A scan that has stopped matching reports a clean tree. Two fields take a
     * host code today (the first-run join view and the switch-host panel), so
     * a run that judges fewer than two has lost its subjects to a rename, a
     * moved directory or a changed attribute spelling.
     */
    const judged = judge(trackedSources(root));

    expect(judged.length).toBeGreaterThanOrEqual(2);
  });

  it("can see an input that is too narrow", () => {
    /*
     * The planted violation, judged through the same function as the real
     * tree. Without this the first test passes just as happily if the marker
     * list or the attribute pattern stopped matching anything at all.
     */
    const planted = judge([
      {
        path: "packages/app/src/components/Planted.tsx",
        text: "<Input onChange={(e) => onSwitchHost(e.target.value)} maxLength={4} />",
      },
      {
        path: "packages/app/src/components/PlantedWide.tsx",
        text: "<Input value={hostInput} maxLength={8} />",
      },
      {
        // No host-code marker, so its narrow cap is none of this scan's
        // business: a station NAME field is not a code field.
        path: "packages/app/src/components/PlantedUnrelated.tsx",
        text: '<Input aria-label="Station name" maxLength={2} />',
      },
    ]);

    expect(planted).toEqual([
      { path: "packages/app/src/components/Planted.tsx", maxLength: 4 },
      { path: "packages/app/src/components/PlantedWide.tsx", maxLength: 8 },
    ]);
    expect(planted.filter((input) => input.maxLength < 6)).toEqual([
      { path: "packages/app/src/components/Planted.tsx", maxLength: 4 },
    ]);
  });
});
