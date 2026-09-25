import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanScope } from "./scanScope";

/**
 * What a live read has to hold up on the wire is decided in ONE place.
 *
 * A read needs two sets of topics subscribed: the ones that feed it
 * (`resolveSubscriptionTopics`) and the ones its elected reckoner declared
 * (`reckonerDepTopics`). Every read path in the tree did the first and none of
 * them did the second, so a lone widget reading a modelled value declined
 * `input-absent` for ever unless some other widget on the dashboard happened to
 * be holding the model's inputs up. It was fixed for the series path first,
 * inline; the point path had the same hole in seven places, which is what makes
 * this a gate rather than an eighth copy. The next read path is going to be
 * written by somebody who has never read any of this.
 *
 * So `subscribeTopicRead` is the seam, and the rule is: a file that resolves a
 * read's topics does not also subscribe them. Resolving is still perfectly
 * legitimate on its own, and two things do it for reasons that have nothing to
 * do with subscribing: `isTopicCarried` asks which wire topics a read would
 * need in order to grade carriage, and `warnGatedRead` names them in a
 * diagnostic. Neither subscribes anything. It is the PAIR that is the seam's
 * job.
 *
 * ## Known reach
 *
 * The instrument is PROXIMITY, not dataflow: a subscribe within a few lines of
 * a resolve. File-level co-occurrence was tried first and was too blunt to
 * keep, because `useTelemetry` resolves for its diagnostic two hundred lines
 * away from where it subscribes the LEGACY `DataSource` it falls back to, and
 * nothing textual tells that subscribe from a wire one. What proximity cannot
 * see is a read path that resolves in one place and subscribes far from it; a
 * read path written like that has gone out of its way, and the caller floor
 * below is the second instrument over the same claim.
 */

const SCAN_ROOTS = ["packages", "mod"];

/** The seam itself, which necessarily does both. */
const SEAM = "mod/sitrep-sdk/src/spine/subscribe-read.ts";

/**
 * How few callers means the seam has been abandoned rather than adopted. Nine
 * call it today: `useStream`, `useTelemetry`, `useDataStreamStatus`,
 * `useDataSeries`, `useOptionalVesselIdentity`, `OrbitView`, `NotesComponent`,
 * the contributions runtime and the processor evaluator. A rewrite that quietly
 * went back to resolving per call site would leave the negative half below
 * passing over a tree where nothing holds a reckoner's inputs up.
 */
const SEAM_CALLER_FLOOR = 8;

const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT_RE = /\/\/.*$/gm;

/**
 * Executable source only. Comments are where this tree records what a rule used
 * to be, at length and on purpose, and several of these files quote the old
 * shape to explain the new one.
 */
function executable(source: string): string {
  return source
    .replace(BLOCK_COMMENT_RE, " ")
    .replace(LINE_COMMENT_RE, " ")
    .replace(/^import[\s\S]*?from\s+"[^"]*";$/gm, " ");
}

const RESOLVES_RE = /\bresolveSubscriptionTopics\s*\(/;

/**
 * How far after a resolve a subscribe still belongs to it. Six lines covers
 * every spelling the tree has held: the two-statement `const t = ...; t.map(t
 * => client.subscribe(t))`, the `for (const t of ...) { subscribe(t) }` block,
 * and the argument-per-line forms biome wraps both into.
 */
const WINDOW_LINES = 6;

/**
 * A wire subscribe, by either spelling: a method on a client, or the injected
 * one-argument function the processor evaluator subscribes through. The store's
 * frame listener and the seam itself are removed before the test, because both
 * are the correct thing to write next to a resolve.
 */
const SUBSCRIBES_RE = /\.subscribe\s*\(|\bsubscribe[A-Z][A-Za-z]*\s*\(/;

function subscribesResolvedTopics(source: string): boolean {
  const lines = executable(source).split("\n");
  return lines.some((line, i) => {
    if (!RESOLVES_RE.test(line)) return false;
    const window = lines
      .slice(i, i + 1 + WINDOW_LINES)
      .join("\n")
      .replaceAll(/\bsubscribe(?:TopicRead|Frame)\s*\(/g, " ");
    return SUBSCRIBES_RE.test(window);
  });
}

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

function trackedSources(): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", ...SCAN_ROOTS], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(
      (rel) =>
        /\.tsx?$/.test(rel) &&
        !/\.test\.tsx?$/.test(rel) &&
        !/\.test-d\.ts$/.test(rel) &&
        !/(?:^|\/)(?:dist|node_modules|__fixtures__)\//.test(rel),
    );
}

const SCOPE = scanScope();

/** Each file read once per run: both checks below walk the same tree. */
const texts = new Map<string, string>();
function source(rel: string): string {
  let text = texts.get(rel);
  if (text === undefined) {
    text = readFileSync(join(ROOT, rel), "utf8");
    texts.set(rel, text);
  }
  return text;
}

describe("one seam decides what a read subscribes", () => {
  it("has a probe that can see the pairing it is looking for", () => {
    // A gate that cannot see a violation reports a clean tree, so both verdicts
    // are planted rather than assumed.
    // The three spellings the tree actually held before the seam existed.
    expect(
      subscribesResolvedTopics(
        "const t = store.resolveSubscriptionTopics(topic);\n" +
          "const u = t.map((i) =>\n  client.subscribe(i, () => {}),\n);",
      ),
    ).toBe(true);
    expect(
      subscribesResolvedTopics(
        "for (const i of telemetryStore.resolveSubscriptionTopics(\n  topic,\n)) {\n" +
          "  unsubs.push(client.subscribe(i, () => {}));\n}",
      ),
    ).toBe(true);
    expect(
      subscribesResolvedTopics(
        "for (const i of activeStore.resolveSubscriptionTopics(dep)) {\n" +
          "  unsubs.push(subscribeInputTopic(i));\n}",
      ),
    ).toBe(true);
    // Resolving for a carriage verdict or a diagnostic, subscribing nothing.
    expect(
      subscribesResolvedTopics(
        "const inputs = store.resolveSubscriptionTopics(topic);\n" +
          "if (inputs.length === 0) return false;\n" +
          "return inputs.every(isCarried);",
      ),
    ).toBe(false);
    // The frame listener is not a wire subscribe, and neither is the seam.
    expect(
      subscribesResolvedTopics(
        "const t = store.resolveSubscriptionTopics(topic);\n" +
          "store.subscribeFrame(onChange);\n" +
          "subscribeTopicRead(client, store, topic);",
      ),
    ).toBe(false);
    // A legacy `DataSource` subscribe far from the diagnostic that resolves.
    expect(
      subscribesResolvedTopics(
        "source.subscribe(legacyKey, cb);\n" +
          `${"x;\n".repeat(WINDOW_LINES + 1)}` +
          "warnGatedRead(hook, id, key, topic, store.resolveSubscriptionTopics(topic));",
      ),
    ).toBe(false);
    // The old shape quoted in a comment is history, not a violation.
    expect(
      subscribesResolvedTopics(
        "/* was: resolveSubscriptionTopics(topic).map((i) => client.subscribe(i)) */",
      ),
    ).toBe(false);
  });

  it("routes every read path that subscribes through subscribeTopicRead", () => {
    const sources = trackedSources();
    // An enumeration that returned nothing would find no offenders, and no
    // offenders is exactly what success looks like here.
    expect(sources.length).toBeGreaterThan(500);

    const offenders = sources
      .filter((rel) => rel !== SEAM)
      .filter(SCOPE.covers)
      .filter((rel) => subscribesResolvedTopics(source(rel)));

    expect(
      offenders,
      "a read path that resolves its own subscription topics subscribes the " +
        "topics that FEED the read and not the ones its elected reckoner " +
        "declared, so the model declines `input-absent` unless another widget " +
        "happens to be holding those inputs up. Call " +
        "`subscribeTopicRead(client, store, topic)` instead: it holds up both " +
        "and hands back one release.",
    ).toEqual([]);
  });

  it("still has the read paths actually going through it", () => {
    // A census of the whole tree, which the changed-only run does not read.
    if (SCOPE.mode === "changed") return;
    const callers = trackedSources().filter(
      (rel) =>
        rel !== SEAM &&
        /\bsubscribeTopicRead\s*\(/.test(executable(source(rel))),
    );
    expect(
      callers.length,
      "the seam has callers or it is not a seam; the check above passes just " +
        "as happily over a tree where nobody subscribes anything at all",
    ).toBeGreaterThanOrEqual(SEAM_CALLER_FLOOR);
  });
});
