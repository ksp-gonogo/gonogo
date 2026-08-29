import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import {
  type ContractResolver,
  checkFixturePayloads,
} from "./replay-fixture-conformance";

/**
 * Resolves every topic a widget fixture can emit, sdk and Uplink alike, and
 * walks each fixture payload against the shape the contract declares for it.
 *
 * Split from the test beside it for the same reason
 * `replay-fixture-conformance.ts` is: the check has to be pointable at a
 * deliberately blind resolver, and a defect has to be plantable in a fixture
 * held in memory, so neither can live inside the assertion that consumes them.
 *
 * The walk itself is `checkFixturePayloads`, unchanged: arrays, unions,
 * `Dictionary<string, X>` index signatures and nesting were all solved there
 * for the replay servers and none of it is different here. What is new is where
 * the payloads come from (a `__fixtures__` dir rather than one exported map)
 * and how much contract has to be loaded to grade them (nine Uplink topic maps
 * as well as the sdk's).
 */

/** Widget-fixture-shaped view of one undeclared field. */
export interface FixtureFinding {
  /** Repo-relative fixture path. */
  fixture: string;
  /** The widget directory the fixture belongs to, repo-relative. */
  dir: string;
  topic: string;
  /** Dotted path from the payload root, array indices included. */
  path: string;
  field: string;
  /** What the contract declares at that position, for the "did you mean" line. */
  declared: string[];
}

export interface FixtureScan {
  /** Repo-relative widget directory (the parent of `__fixtures__`). */
  dir: string;
  /** Payloads walked against a declared type. */
  payloadsChecked: number;
  /** Topic ids no contract declares, so nothing about them can be graded. */
  ungradedTopics: string[];
  /** Object/array nodes the walk descended into. */
  nodesVisited: number;
  /** Field names matched against a declared name. */
  fieldsChecked: number;
  findings: FixtureFinding[];
  /** Positions the walk could not see into, which are holes in the coverage. */
  unresolvedPositions: string[];
}

/**
 * Keys a fixture carries for the harness rather than for the wire.
 *
 * Everything else at a fixture's top level is a legacy `DataSource` key, and
 * `packages/ui-kit/src/render/scenes.ts` feeds exactly that set through as one
 * source's data. The underscore convention is the harness's own: `_scene` names
 * the target, `_meta` is prose, `_stream` holds the emits. None of the three
 * describes a payload, so a check that walked them would report the scene
 * language itself as contract violations.
 */
const HARNESS_KEYS = new Set(["_scene", "_meta", "_stream"]);

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "bin",
  "obj",
  "coverage",
  ".turbo",
]);

/**
 * A resolver that also says WHERE each topic was declared.
 *
 * The provenance is what lets a test ask whether both halves of the wire really
 * loaded without naming a single Uplink, which matters because a check that
 * hardcodes one mod's topic id is a check that has to be excused by the Uplink
 * boundary ratchet forever.
 */
export interface WireContractResolver extends ContractResolver {
  /** Repo-relative file the topic's declaration came from. */
  sourceOf(topic: string): string | undefined;
  /** Every declaring file, sdk first. */
  sources: string[];
}

/**
 * A resolver over the whole wire surface: the sdk's `TopicPayloadMap` plus each
 * Uplink client's `GeneratedTopicPayloadMap`.
 *
 * One `ts.Program` over all of them rather than one per file, because a
 * `ts.Type` only means anything to the checker that produced it, and the walker
 * takes a single checker.
 *
 * An Uplink's topics live only in its own generated map: `mod/sitrep-sdk`
 * cannot see them, and a resolver built from the sdk alone grades every fixture
 * an Uplink ships against nothing while reporting a clean run. That is why the
 * Uplink half is loaded here rather than left out as an approximation.
 */
export function buildWireContractResolver(
  repoRoot: string,
): WireContractResolver {
  const entries: Array<{ file: string; exportName: string }> = [
    {
      file: join(repoRoot, "mod/sitrep-sdk/src/topics.ts"),
      exportName: "TopicPayloadMap",
    },
  ];
  for (const uplink of readdirSync(join(repoRoot, "mod"))) {
    const file = join(
      repoRoot,
      "mod",
      uplink,
      "client/src/__generated__/topic-map.ts",
    );
    if (existsSync(file)) {
      entries.push({ file, exportName: "GeneratedTopicPayloadMap" });
    }
  }

  const program = ts.createProgram(
    entries.map((e) => e.file),
    {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    },
  );
  const checker = program.getTypeChecker();

  const byTopic = new Map<string, ts.Type>();
  const sourceByTopic = new Map<string, string>();
  for (const entry of entries) {
    const source = relative(repoRoot, entry.file);
    const sourceFile = program.getSourceFile(entry.file);
    if (!sourceFile) throw new Error(`could not load ${entry.file}`);
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) {
      throw new Error(`${entry.file} resolved no module symbol`);
    }
    const mapSymbol = checker
      .getExportsOfModule(moduleSymbol)
      .find((s) => s.getName() === entry.exportName);
    if (!mapSymbol) {
      throw new Error(`${entry.file} exports no ${entry.exportName}`);
    }
    const mapType = checker.getDeclaredTypeOfSymbol(mapSymbol);
    for (const prop of checker.getPropertiesOfType(mapType)) {
      // First map wins. Nothing collides today; if two ever did, the sdk's
      // spelling is the one the app's own hooks resolve against.
      if (byTopic.has(prop.getName())) continue;
      byTopic.set(prop.getName(), checker.getTypeOfSymbol(prop));
      sourceByTopic.set(prop.getName(), source);
    }
  }

  return {
    topicIds: [...byTopic.keys()],
    payloadType: (topic) => byTopic.get(topic),
    checker,
    sourceOf: (topic) => sourceByTopic.get(topic),
    sources: entries.map((e) => relative(repoRoot, e.file)),
  };
}

/** Every directory holding a `__fixtures__` dir, under packages and Uplink clients. */
export function fixtureDirs(repoRoot: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const path = join(dir, name);
      if (!statSync(path).isDirectory()) continue;
      if (name === "__fixtures__") {
        found.push(dir);
        continue;
      }
      walk(path);
    }
  };
  for (const pkg of readdirSync(join(repoRoot, "packages"))) {
    const src = join(repoRoot, "packages", pkg, "src");
    if (existsSync(src)) walk(src);
  }
  for (const uplink of readdirSync(join(repoRoot, "mod"))) {
    const src = join(repoRoot, "mod", uplink, "client/src");
    if (existsSync(src)) walk(src);
  }
  return found.sort();
}

/** One `topic -> payload` pair a fixture puts on the wire, and where it came from. */
export interface FixturePayload {
  topic: string;
  payload: unknown;
  /** How the fixture expressed it, for a message that can be acted on. */
  where: string;
}

/**
 * The payloads one parsed fixture publishes.
 *
 * Two shapes, because the harness feeds two: `_stream.emits[]` carries the
 * Sitrep stream (`payload` on a Topic, `value` on a channel), and every
 * remaining top-level key is a legacy `DataSource` key. Both end up in front of
 * the same widget through the same hooks, so a legacy key named after a
 * declared topic is making the same claim about the wire as an emit is, and is
 * graded the same way. A top-level key the contract does not declare is simply
 * not a topic and grades as ungraded rather than as a defect.
 */
export function fixturePayloads(fixture: unknown): FixturePayload[] {
  if (fixture === null || typeof fixture !== "object") return [];
  const raw = fixture as Record<string, unknown>;
  const out: FixturePayload[] = [];

  const stream = raw._stream as
    | {
        emits?: Array<{
          topic?: string;
          channel?: string;
          payload?: unknown;
          value?: unknown;
        }>;
      }
    | undefined;
  (stream?.emits ?? []).forEach((emit, index) => {
    const topic = emit.topic ?? emit.channel;
    if (!topic) return;
    out.push({
      topic,
      payload: emit.payload ?? emit.value,
      where: `_stream.emits[${index}]`,
    });
  });

  for (const [key, value] of Object.entries(raw)) {
    if (HARNESS_KEYS.has(key) || key.startsWith("_")) continue;
    out.push({ topic: key, payload: value, where: `"${key}"` });
  }

  return out;
}

/** Walks every fixture in one widget directory against the contract. */
export function scanFixtureDir(
  resolver: ContractResolver,
  repoRoot: string,
  dir: string,
): FixtureScan {
  const relDir = relative(repoRoot, dir);
  const scan: FixtureScan = {
    dir: relDir,
    payloadsChecked: 0,
    ungradedTopics: [],
    nodesVisited: 0,
    fieldsChecked: 0,
    findings: [],
    unresolvedPositions: [],
  };
  const ungraded = new Set<string>();

  const fixtureDir = join(dir, "__fixtures__");
  for (const name of readdirSync(fixtureDir).sort()) {
    if (!name.endsWith(".json")) continue;
    const relFixture = relative(repoRoot, join(fixtureDir, name));
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));
    } catch {
      // A fixture that will not parse is the render harness's problem, and it
      // says so loudly. Skipping it loses one fixture, never the whole scan.
      continue;
    }
    for (const { topic, payload, where } of fixturePayloads(parsed)) {
      /*
       * One payload at a time rather than a merged map: a fixture can emit the
       * same topic several times (a stream that changes over a scene), and a
       * map would keep only the last of them.
       */
      const report = checkFixturePayloads(resolver, { [topic]: payload });
      if (report.undeclaredTopics.length > 0) {
        ungraded.add(topic);
        continue;
      }
      scan.payloadsChecked += 1;
      scan.nodesVisited += report.nodesVisited;
      scan.fieldsChecked += report.fieldsChecked;
      for (const position of report.unresolvedPositions) {
        scan.unresolvedPositions.push(`${relFixture} ${where} ${position}`);
      }
      for (const found of report.undeclaredFields) {
        scan.findings.push({
          fixture: relFixture,
          dir: relDir,
          topic: found.topic,
          path: found.path,
          field: found.field,
          declared: found.declared,
        });
      }
    }
  }

  scan.ungradedTopics = [...ungraded].sort();
  return scan;
}

/** Walks every widget fixture in the repo. */
export function scanAllFixtures(
  resolver: ContractResolver,
  repoRoot: string,
): FixtureScan[] {
  return fixtureDirs(repoRoot).map((dir) =>
    scanFixtureDir(resolver, repoRoot, dir),
  );
}

/**
 * The debt-list key for a finding: widget directory, topic and field name.
 *
 * Deliberately NOT the fixture path. The same invented name is copied across
 * every fixture in a widget's dir (`departmentName` sits in five of the six
 * Strategies fixtures), and keying per file would turn one defect into five
 * entries that have to be deleted in lockstep. The path inside the payload is
 * left out too: the name is what is wrong, and the message prints the full
 * position for whoever is fixing it.
 */
export function findingKey(finding: FixtureFinding): string {
  return `${finding.dir}#${finding.topic}.${finding.field}`;
}
