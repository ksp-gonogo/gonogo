// @vitest-environment node
//
// Node realm rather than the package's jsdom default: this builds a TypeScript program over `ts.sys`.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_SITREP_CARRIED_TOPICS,
  isCollectionTopic,
} from "@ksp-gonogo/sitrep-sdk";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  getCollectionCarriedTopics,
  getTopicFieldCatalog,
  getUndescribedCarriedTopics,
} from "./topicFieldCatalog";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

/**
 * Every payload map the repo's generated contracts declare: the file and the
 * interface to read, and the generated file whose runtime collection list has
 * to agree with it. The SDK's map is `TopicPayloadMap`, which is the generated
 * map plus the engine-owned hand-declared tail; an Uplink's is its own
 * generated map.
 */
function payloadMaps(): { file: string; name: string; emitted: string }[] {
  const sdkMap = join(
    REPO_ROOT,
    "mod/sitrep-sdk/src/__generated__/topic-map.ts",
  );
  const maps = [
    {
      file: join(REPO_ROOT, "mod/sitrep-sdk/src/topics.ts"),
      name: "TopicPayloadMap",
      emitted: sdkMap,
    },
  ];
  const mod = join(REPO_ROOT, "mod");
  for (const entry of readdirSync(mod).sort()) {
    const file = join(mod, entry, "client/src/__generated__/topic-map.ts");
    if (existsSync(file)) {
      maps.push({ file, name: "GeneratedTopicPayloadMap", emitted: file });
    }
  }
  return maps;
}

/** The string literals a generated `export const <name> = [...] as const` holds. */
function emittedList(source: ts.SourceFile, name: string): string[] {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      if (declaration.name.text !== name) continue;
      let init = declaration.initializer;
      while (init !== undefined && ts.isAsExpression(init)) {
        init = init.expression;
      }
      if (init === undefined || !ts.isArrayLiteralExpression(init)) {
        throw new Error(`${source.fileName}: ${name} is not an array literal`);
      }
      return init.elements.map((element) => {
        if (!ts.isStringLiteral(element)) {
          throw new Error(`${source.fileName}: ${name} holds a non-string`);
        }
        return element.text;
      });
    }
  }
  throw new Error(`${source.fileName} declares no ${name}`);
}

/**
 * The Topics whose payload is an array, asked of the type checker over the
 * generated contract rather than of the text: a Topic is a collection when the
 * type its map entry resolves to is array-like.
 */
function deriveCollectionTopics() {
  const maps = payloadMaps();
  const program = ts.createProgram(
    maps.flatMap((m) => [m.file, m.emitted]),
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
  const sdkOwned = new Set<string>();
  const uplinkOwned = new Set<string>();
  const unresolved: string[] = [];
  const disagreements: string[] = [];
  let topicsSeen = 0;
  for (const [index, { file, name, emitted }] of maps.entries()) {
    const collections = index === 0 ? sdkOwned : uplinkOwned;
    const source = program.getSourceFile(file);
    const emittedSource = program.getSourceFile(emitted);
    if (source === undefined || emittedSource === undefined) {
      throw new Error(`not in the program: ${file}`);
    }
    const declaration = source.statements.find(
      (s): s is ts.InterfaceDeclaration =>
        ts.isInterfaceDeclaration(s) && s.name.text === name,
    );
    if (declaration === undefined) {
      throw new Error(`${file} declares no ${name}`);
    }
    const map = checker.getTypeAtLocation(declaration.name);
    const ofThisMap: string[] = [];
    for (const property of checker.getPropertiesOfType(map)) {
      topicsSeen++;
      const payload = checker.getTypeOfSymbol(property);
      if (payload.flags & ts.TypeFlags.Any) unresolved.push(property.name);
      if (checker.isArrayLikeType(payload)) {
        collections.add(property.name);
        ofThisMap.push(property.name);
      }
    }
    const listed = emittedList(emittedSource, "GENERATED_COLLECTION_TOPIC_IDS");
    const typed = ofThisMap.sort().join(",");
    if ([...listed].sort().join(",") !== typed) {
      disagreements.push(`${emitted}: lists [${listed}], types [${typed}]`);
    }
  }
  return {
    sdkOwned: [...sdkOwned].sort(),
    uplinkOwned: [...uplinkOwned].sort(),
    collections: [...sdkOwned, ...uplinkOwned].sort(),
    maps: maps.map((m) => m.file.slice(REPO_ROOT.length + 1)),
    topicsSeen,
    unresolved,
    disagreements,
  };
}

const derived = deriveCollectionTopics();

/**
 * Every collection Topic promoted at once, so a Topic the first-party default
 * leaves out cannot pass by simply not being walked.
 */
const ALL_COLLECTIONS_CARRIED: ReadonlySet<string> = new Set([
  ...DEFAULT_SITREP_CARRIED_TOPICS,
  ...derived.collections,
]);

describe("collection Topics in the generated contract", () => {
  it("reads the SDK's payload map and every Uplink client's", () => {
    expect(derived.maps[0]).toBe("mod/sitrep-sdk/src/topics.ts");
    expect(derived.maps.length).toBeGreaterThan(1);
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

  it("names every SDK-owned collection Topic", () => {
    expect(derived.sdkOwned).toEqual([
      "alarm.scet",
      "commandCentre.roster",
      "deployed.bases",
      "dv.stages",
      "isru.converters",
      "isru.drills",
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
    // Uplink-owned ones exist too, and are held to the same rule through
    // the registration their client package makes at load.
    expect(derived.uplinkOwned.length).toBeGreaterThan(0);
  });

  it("lists at runtime exactly the Topics each map types as a collection", () => {
    expect(derived.disagreements).toEqual([]);
  });
});

describe("the catalogue offers no key under a collection Topic", () => {
  it("offers none for any collection Topic, carried or not", () => {
    const collections = new Set(derived.collections);
    const offered = getTopicFieldCatalog(ALL_COLLECTIONS_CARRIED)
      .filter((entry) => collections.has(entry.topic))
      .map((entry) => entry.key);
    expect(offered).toEqual([]);
  });

  it("knows every SDK-owned collection Topic without a sample", () => {
    for (const topic of derived.sdkOwned) {
      expect(isCollectionTopic(topic)).toBe(true);
    }
    expect(isCollectionTopic("alarm.scet.fired")).toBe(false);
  });

  it("says which carried Topics it left out for being collections", () => {
    // An Uplink's collection is registered by its client package, which this
    // package does not load, so only the SDK-owned ones are known here.
    expect(
      [...getCollectionCarriedTopics(ALL_COLLECTIONS_CARRIED)].sort(),
    ).toEqual(derived.sdkOwned);
    const undescribed = new Set(
      getUndescribedCarriedTopics(ALL_COLLECTIONS_CARRIED),
    );
    for (const topic of getCollectionCarriedTopics(ALL_COLLECTIONS_CARRIED)) {
      expect(undescribed.has(topic)).toBe(false);
    }
  });

  it("still offers the fields of a single-record Topic", () => {
    const fired = getTopicFieldCatalog(ALL_COLLECTIONS_CARRIED)
      .filter((entry) => entry.topic === "alarm.scet.fired")
      .map((entry) => entry.key);
    expect(fired).toContain("alarm.scet.fired.firedAtUt");
  });
});
