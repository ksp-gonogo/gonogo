import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { splitRawFieldSubtopic } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { modClientRoots } from "./styleguideScanRoots";

/**
 * An Uplink Topic id must resolve WHOLE through the static splitter, and in
 * practice that means it must have exactly two segments.
 *
 * `splitRawFieldSubtopic` (mod/sitrep-sdk/src/raw-field-split.ts) turns a dotted
 * key into a wire Topic plus a field path into that record, splitting at the
 * LONGEST STATICALLY KNOWN Topic id. It deliberately does not consult the
 * runtime registry an Uplink self-registers into, because that registry fills in
 * after the app has rendered and a split that changed answer when a bundle
 * loaded would resolve one subscription differently from the next. So an id the
 * static list cannot know, which is every Uplink id, gets the fallback
 * `<domain>.<channel>.<field...>` split the moment it has three segments: the
 * read walks into a payload with no such field, the subscription starves, and
 * nothing anywhere throws. The channel reads as nothing forever.
 *
 * That is not theoretical. A three-segment Uplink id shipped that way on
 * 2026-09-12 and was renamed to its two-segment form after a TEST caught it,
 * never a typecheck: the augmentation types fine, the registration runs fine,
 * and the silence is indistinguishable from a mod that is not installed.
 *
 * THE RULE IS NOT "three segments is wrong". Core ships five three-segment
 * Topics that work perfectly (`vessel.orbit.truth`, `alarm.scet.fired`,
 * `vessel.physics.mode`, `system.uplink.pending`, `system.uplink.gates`), and
 * they work because they ARE in the static list the splitter matches against. A
 * guard that banned three segments outright would fail core and would be
 * teaching the wrong rule. So this asks the splitter itself rather than counting
 * dots: the real function, on the real id, and the verdict is whatever the app
 * will actually do.
 *
 * `dynamicWholeTopicPrefixes` is not the escape hatch, whatever
 * `raw-field-split.ts`'s own doc suggests. That mechanism covers a DYNAMIC
 * namespace whose members are computed at runtime (per-body, per-part, per-CPU),
 * which is why a per-CPU terminal channel is fine and is not declared here at
 * all. A fixed Topic has no prefix to declare.
 *
 * Scanned by directory walk rather than `git grep`, so a violation in a
 * brand-new file is seen before it is ever staged, and so a glob pathspec cannot
 * return a false zero.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");

/** Where an Uplink spells a static Topic id, and there is more than one place. */
type Construct = "TopicPayloadMap" | "GENERATED_TOPIC_IDS";

interface DeclaredTopicId {
  id: string;
  /** Repo-relative, so a failure names a path the author can open. */
  file: string;
  construct: Construct;
}

/**
 * Reads the balanced `open`..`close` region whose opening delimiter sits at
 * `start`, and returns its interior.
 *
 * A non-greedy regex to the next `\n}` was the obvious alternative and it is
 * wrong twice over: the augmentation nests an interface inside the module
 * declaration, and four of the five Uplink files mention `declare module
 * "@ksp-gonogo/sitrep-sdk"` in a header comment before they ever write one.
 */
function balancedRegion(
  text: string,
  start: number,
  open: string,
  close: string,
): string | undefined {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return text.slice(start + 1, i);
    }
  }
  return undefined;
}

/** The opening brace or bracket has to be adjacent, so a prose mention cannot open a region. */
const MAP_OPEN = /interface\s+TopicPayloadMap\s*\{/g;
const LIST_OPEN = /GENERATED_TOPIC_IDS[^=\n]*=\s*\[/g;

const QUOTED_KEY = /["']([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)["']\s*\??\s*:/g;
const QUOTED_ITEM = /["']([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)["']/g;

/**
 * Every static Topic id one Uplink source spells, across both constructs.
 *
 * The hand-written `declare module "@ksp-gonogo/sitrep-sdk"` augmentation of
 * `TopicPayloadMap` is the superset today: 44 ids, of which the 41 with a C#
 * payload type behind them are also in the Uplink's own generated
 * `GENERATED_TOPIC_IDS`, and the three `<domain>.available` presence gates are
 * bare JSON booleans that codegen never sees. Both are read anyway, because
 * which one is the superset is an accident of what carries `[SitrepTopic]` and
 * could invert the day an Uplink stops re-declaring a generated id by hand.
 *
 * Matching only the string constants (`export const X_TOPIC = "..."`) would look
 * thorough and miss an entire Uplink: one of the five declares its three ids in
 * the map and the type assertions only, and has no topic constants at all.
 */
function topicIdsInSource(
  text: string,
): { id: string; construct: Construct }[] {
  const out: { id: string; construct: Construct }[] = [];

  for (const open of text.matchAll(MAP_OPEN)) {
    const brace = (open.index ?? 0) + open[0].length - 1;
    const body = balancedRegion(text, brace, "{", "}");
    if (body === undefined) continue;
    for (const [, id] of body.matchAll(QUOTED_KEY)) {
      out.push({ id, construct: "TopicPayloadMap" });
    }
  }

  for (const open of text.matchAll(LIST_OPEN)) {
    const bracket = (open.index ?? 0) + open[0].length - 1;
    const body = balancedRegion(text, bracket, "[", "]");
    if (body === undefined) continue;
    for (const [, id] of body.matchAll(QUOTED_ITEM)) {
      out.push({ id, construct: "GENERATED_TOPIC_IDS" });
    }
  }

  return out;
}

/**
 * Shipped Uplink sources only.
 *
 * A test double is excluded on purpose: a probe Topic exists to be fed by a stub
 * transport and is never held to the shipped registry, which is the whole point
 * of the fixture.
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.(test|test-d|spec)\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

function declaredUplinkTopicIds(): DeclaredTopicId[] {
  const out: DeclaredTopicId[] = [];
  for (const root of modClientRoots(REPO)) {
    const abs = join(REPO, root);
    for (const file of sourceFiles(abs)) {
      const text = readFileSync(file, "utf8");
      for (const found of topicIdsInSource(text)) {
        out.push({ ...found, file: relative(REPO, file) });
      }
    }
  }
  return out;
}

/** `demo.antenna.chains` becomes `demo.antennaChains`. */
function suggestedRename(id: string): string {
  const [domain, ...rest] = id.split(".");
  const channel = rest
    .map((seg, i) =>
      i === 0 ? seg : seg.charAt(0).toUpperCase() + seg.slice(1),
    )
    .join("");
  return `${domain}.${channel}`;
}

/**
 * What a third-party author sees. It has to carry the convention and the reason,
 * because "invalid Topic id" would send them looking for a validator that does
 * not exist and would not explain why core gets to do the thing they cannot.
 */
function deadChannelReport(decl: DeclaredTopicId): string {
  const split = splitRawFieldSubtopic(decl.id);
  const into = split
    ? `raw topic "${split.rawTopic}" plus field path "${split.fieldPath.join(".")}"`
    : "nothing (this id already resolves whole)";
  return [
    `${decl.file} declares the Topic id "${decl.id}" (in ${decl.construct}), and the static splitter does not resolve it whole.`,
    `It splits into ${into}, so every read and every subscription on it walks into a payload with no such field. Nothing throws and no channel is ever opened: the Topic reads as nothing, forever, and looks exactly like a mod that is not installed.`,
    `splitRawFieldSubtopic matches the LONGEST STATICALLY KNOWN Topic id, and it deliberately ignores the runtime registry an Uplink self-registers into: that registry fills in after the app has rendered, and a split that changed answer when a bundle loaded would resolve one subscription differently from the next. Core's own three-segment Topics (vessel.orbit.truth, alarm.scet.fired, system.uplink.pending) resolve whole precisely because they ARE in that static list, and an Uplink id never can be.`,
    `Rename it to "${suggestedRename(decl.id)}": keep the id at domain.channel, and fold the rest of the tail into the channel segment in camelCase.`,
    `dynamicWholeTopicPrefixes will not rescue it. That mechanism is for a DYNAMIC namespace whose members are computed at runtime (per-body, per-part, per-CPU, as a per-CPU terminal channel is), and a fixed Topic has no prefix to declare.`,
  ].join("\n\n");
}

function deadChannels(declared: DeclaredTopicId[]): DeclaredTopicId[] {
  return declared.filter((d) => splitRawFieldSubtopic(d.id) !== undefined);
}

describe("every Uplink Topic id resolves whole through the static splitter", () => {
  const declared = declaredUplinkTopicIds();

  it("finds no Uplink channel that splits into a topic plus a field path", () => {
    expect(deadChannels(declared).map(deadChannelReport)).toEqual([]);
  });

  it("read an id out of every Uplink client bundle that declares one", () => {
    const roots = modClientRoots(REPO);
    expect(roots.length).toBeGreaterThan(0);

    const silent = roots.filter((root) => {
      const hasTopics = sourceFiles(join(REPO, root)).some((f) =>
        f.endsWith("topics.ts"),
      );
      if (!hasTopics) return false;
      return !declared.some((d) => d.file.startsWith(root));
    });
    expect(silent).toEqual([]);
  });

  it("matched each construct in every file that writes it", () => {
    /*
     * This asked for both constructs somewhere in the real tree, and every file
     * writing either belongs to a mod Uplink leaving for the gonogo-uplinks repo.
     * Held per file instead: wherever a client source contains a construct's
     * opening, as git tracks it and read by a plain substring, the extractor must
     * have taken at least one id of that construct out of that file. The planted
     * verdicts below prove each construct can match at all.
     */
    const openings: [Construct, string][] = [
      ["TopicPayloadMap", "interface TopicPayloadMap {"],
      ["GENERATED_TOPIC_IDS", "GENERATED_TOPIC_IDS = ["],
    ];
    const missed: string[] = [];
    const tracked = execFileSync("git", ["ls-files", "mod"], {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\n")
      .filter((rel) => /^mod\/[^/]+\/client\/src\/.*\.tsx?$/.test(rel))
      .filter((rel) => !/\.(test|test-d|spec)\.tsx?$/.test(rel));
    for (const rel of tracked) {
      const text = readFileSync(join(REPO, rel), "utf8");
      for (const [construct, opening] of openings) {
        if (!text.includes(opening)) continue;
        const read = declared.some(
          (d) => d.file === rel && d.construct === construct,
        );
        if (!read) missed.push(`${rel}: ${construct}`);
      }
    }
    expect(missed).toEqual([]);
  });
});

/**
 * The planted verdicts.
 *
 * A guard that cannot be seen to fail is the failure mode this repo has recorded
 * more often than any other, and a matcher keyed to one construct reports a
 * clean tree while missing the other. These run the real extractor over real
 * Uplink-shaped text and take the real verdict, so a construct that stops
 * matching fails here rather than going quiet.
 */
describe("the scan can be seen to fail, and to pass for the right reasons", () => {
  const VIOLATION = `
declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap {
    "demo.antenna.chains": DemoChain[];
  }
}
`;

  const CORE_THREE_SEGMENT = `
declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap {
    "vessel.orbit.truth": VesselOrbitTruth;
  }
}
`;

  const TWO_SEGMENT = `
declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap {
    "rp1.buildQueue": Rp1BuildItemEntry[];
  }
}
`;

  const GENERATED_LIST = `
export const GENERATED_TOPIC_IDS = [
  "demo.antenna.chains",
  "demo.hopRates",
] as const;
`;

  function verdict(
    source: string,
    file = "mod/PlantedUplink/client/src/topics.ts",
  ) {
    const declared = topicIdsInSource(source).map((d) => ({ ...d, file }));
    return { declared, dead: deadChannels(declared) };
  }

  it("FAILS on a three-segment id in an Uplink map, by name and by path", () => {
    const { declared, dead } = verdict(VIOLATION);
    expect(declared).toEqual([
      {
        id: "demo.antenna.chains",
        construct: "TopicPayloadMap",
        file: "mod/PlantedUplink/client/src/topics.ts",
      },
    ]);
    expect(dead).toHaveLength(1);

    const report = deadChannelReport(dead[0]);
    expect(report).toContain("mod/PlantedUplink/client/src/topics.ts");
    expect(report).toContain('"demo.antenna.chains"');
    expect(report).toContain('raw topic "demo.antenna"');
    expect(report).toContain('field path "chains"');
    expect(report).toContain('Rename it to "demo.antennaChains"');
    expect(report).toContain("dynamicWholeTopicPrefixes will not rescue it");
  });

  it("FAILS on a three-segment id in the generated list too", () => {
    const { declared, dead } = verdict(GENERATED_LIST);
    expect(declared.map((d) => d.construct)).toEqual([
      "GENERATED_TOPIC_IDS",
      "GENERATED_TOPIC_IDS",
    ]);
    expect(dead.map((d) => d.id)).toEqual(["demo.antenna.chains"]);
  });

  it("PASSES a three-segment id the static list knows, which is the core case", () => {
    const { declared, dead } = verdict(CORE_THREE_SEGMENT);
    expect(declared.map((d) => d.id)).toEqual(["vessel.orbit.truth"]);
    expect(dead).toEqual([]);
  });

  it("PASSES a two-segment Uplink id", () => {
    const { declared, dead } = verdict(TWO_SEGMENT);
    expect(declared.map((d) => d.id)).toEqual(["rp1.buildQueue"]);
    expect(dead).toEqual([]);
  });

  it("reads the map when the file mentions the augmentation in a comment first", () => {
    const withHeader = `// a \`declare module "@ksp-gonogo/sitrep-sdk"\` augmentation adds each Topic\n${VIOLATION}`;
    expect(verdict(withHeader).dead.map((d) => d.id)).toEqual([
      "demo.antenna.chains",
    ]);
  });
});
