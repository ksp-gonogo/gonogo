// @vitest-environment node
//
// Node realm rather than the package's jsdom default: this builds a TypeScript program over `ts.sys`.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { getTopicFieldCatalog } from "./topicFieldCatalog";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

/**
 * Every payload map the repo's generated contracts declare, as the file and
 * the interface to read. The SDK's is `TopicPayloadMap`, which is the generated
 * map plus the engine-owned hand-declared tail; an Uplink's is its own
 * generated map.
 */
function payloadMaps(): { file: string; name: string }[] {
  const maps = [
    {
      file: join(REPO_ROOT, "mod/sitrep-sdk/src/topics.ts"),
      name: "TopicPayloadMap",
    },
  ];
  const mod = join(REPO_ROOT, "mod");
  for (const entry of readdirSync(mod).sort()) {
    const file = join(mod, entry, "client/src/__generated__/topic-map.ts");
    if (existsSync(file)) maps.push({ file, name: "GeneratedTopicPayloadMap" });
  }
  return maps;
}

/**
 * The Topics whose payload is an array, asked of the type checker over the
 * generated contract rather than of the text: a Topic is a collection when the
 * type its map entry resolves to is array-like.
 */
function deriveCollectionTopics(): {
  collections: string[];
  maps: string[];
  topicsSeen: number;
  unresolved: string[];
} {
  const maps = payloadMaps();
  const program = ts.createProgram(
    maps.map((m) => m.file),
    {
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
    },
  );
  const checker = program.getTypeChecker();
  const collections = new Set<string>();
  const unresolved: string[] = [];
  let topicsSeen = 0;
  for (const { file, name } of maps) {
    const source = program.getSourceFile(file);
    if (source === undefined) throw new Error(`not in the program: ${file}`);
    const declaration = source.statements.find(
      (s): s is ts.InterfaceDeclaration =>
        ts.isInterfaceDeclaration(s) && s.name.text === name,
    );
    if (declaration === undefined) {
      throw new Error(`${file} declares no ${name}`);
    }
    const map = checker.getTypeAtLocation(declaration.name);
    for (const property of checker.getPropertiesOfType(map)) {
      topicsSeen++;
      const payload = checker.getTypeOfSymbol(property);
      if (payload.flags & ts.TypeFlags.Any) unresolved.push(property.name);
      if (checker.isArrayLikeType(payload)) collections.add(property.name);
    }
  }
  return {
    collections: [...collections].sort(),
    maps: maps.map((m) => m.file.slice(REPO_ROOT.length + 1)),
    topicsSeen,
    unresolved,
  };
}

const derived = deriveCollectionTopics();

describe("collection Topics in the generated contract", () => {
  it("reads every payload map in the repo", () => {
    expect(derived.maps).toEqual([
      "mod/sitrep-sdk/src/topics.ts",
      "mod/GonogoKerbalismUplink/client/src/__generated__/topic-map.ts",
      "mod/GonogoKosUplink/client/src/__generated__/topic-map.ts",
    ]);
    expect(derived.topicsSeen).toBeGreaterThan(80);
    // A payload type the program failed to resolve reads as `any`, which is
    // not array-like, so it would drop out of the count without a sound.
    expect(derived.unresolved).toEqual([]);
  });

  it("finds alarm.scet, whose payload is ScetAlarm[]", () => {
    expect(derived.collections).toContain("alarm.scet");
    // Its sibling is a single record and must not be swept in with it.
    expect(derived.collections).not.toContain("alarm.scet.fired");
  });

  it("names every collection Topic", () => {
    expect(derived.collections).toEqual([
      "alarm.scet",
      "commandCentre.roster",
      "deployed.bases",
      "dv.stages",
      "isru.converters",
      "isru.drills",
      "kerbalism.crew",
      "kos.processors",
      "reliability.parts",
      "robotics.servos",
      "science.archive",
      "science.experimentBreakdown",
      "science.experiments",
      "science.instruments",
      "science.lab",
      "science.sensors",
      "spaceCenter.crewRoster",
      "spaceCenter.launchSites",
      "spaceCenter.pois",
      "spaceCenter.savedShips",
    ]);
  });

  it("names the collection Topics the default catalogue offers element fields for", () => {
    const collections = new Set(derived.collections);
    const offered = [
      ...new Set(
        getTopicFieldCatalog()
          .map((entry) => entry.topic)
          .filter((topic) => collections.has(topic)),
      ),
    ].sort();
    expect(offered).toEqual([
      "alarm.scet",
      "deployed.bases",
      "dv.stages",
      "robotics.servos",
      "science.archive",
      "science.experimentBreakdown",
      "science.experiments",
      "science.instruments",
      "science.lab",
      "science.sensors",
      "spaceCenter.crewRoster",
      "spaceCenter.launchSites",
      "spaceCenter.pois",
      "spaceCenter.savedShips",
    ]);
  });
});
