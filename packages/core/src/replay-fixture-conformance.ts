import { join } from "node:path";
import ts from "typescript";

/**
 * Resolves the Sitrep contract's declared field names for a topic payload, and
 * walks a replay-fixture payload against them.
 *
 * Split out of the test beside it so the check can be pointed at a deliberately
 * blind resolver and shown to catch nothing, which is the only way to know the
 * harness can tell a working gate from a broken one.
 *
 * The check is NAME-oriented, never value-type-oriented. `dvVac` is declared
 * `Value<"m/s">` in the generated contract but crosses the wire as a bare
 * number: the SDK wraps units on ingest. So a walker that compared runtime
 * types against declared types would report the entire contract as violated.
 * The defect this exists for was a set of misspelled NAMES, and names are what
 * the wire and the contract genuinely share.
 */

/** A field the fixture sends that the contract does not declare at that position. */
export interface UndeclaredField {
  topic: string;
  /** Dotted path from the payload root, array indices included. */
  path: string;
  field: string;
  /** What the contract does declare there, for the "did you mean" line. */
  declared: string[];
}

/** A field the contract declares as required that the fixture omits. */
export interface OmittedField {
  topic: string;
  path: string;
  field: string;
}

/** A topic id the fixture publishes that the contract does not declare at all. */
export interface UndeclaredTopic {
  topic: string;
}

export interface ConformanceReport {
  /** How many topic payloads were resolved against the contract and walked. */
  topicsChecked: number;
  /** How many object/array nodes the walk actually descended into. */
  nodesVisited: number;
  /** How many individual field names were matched against a declared name. */
  fieldsChecked: number;
  undeclaredFields: UndeclaredField[];
  omittedFields: OmittedField[];
  undeclaredTopics: UndeclaredTopic[];
  /**
   * Positions where the fixture had an object but the contract offered no
   * declared property and no index signature to check it against. Reported
   * rather than swallowed: a position the walker cannot see into is a hole in
   * the coverage, and a hole that stays silent is the failure mode this whole
   * check exists to end.
   */
  unresolvedPositions: string[];
}

/** Resolves a topic id to the contract type the mod sends on it. */
export interface ContractResolver {
  /** Every topic id the contract declares. */
  topicIds: string[];
  /** The declared payload type for a topic, or undefined if it declares none. */
  payloadType(topic: string): ts.Type | undefined;
  checker: ts.TypeChecker;
}

/**
 * Builds a resolver over `mod/sitrep-sdk/src/topics.ts`'s `TopicPayloadMap`,
 * which is the complete wire surface: the codegen'd `GeneratedTopicPayloadMap`
 * plus the handful of engine-built channels (`system.uplinks` and friends) that
 * carry no `[SitrepTopic]` type to reflect and are hand-mirrored there.
 */
export function buildContractResolver(repoRoot: string): ContractResolver {
  const topicsFile = join(repoRoot, "mod/sitrep-sdk/src/topics.ts");
  const program = ts.createProgram([topicsFile], {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(topicsFile);
  if (!sourceFile) {
    throw new Error(`could not load ${topicsFile}`);
  }
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) {
    throw new Error(`${topicsFile} resolved no module symbol`);
  }
  const mapSymbol = checker
    .getExportsOfModule(moduleSymbol)
    .find((s) => s.getName() === "TopicPayloadMap");
  if (!mapSymbol) {
    throw new Error(`${topicsFile} exports no TopicPayloadMap`);
  }
  const mapType = checker.getDeclaredTypeOfSymbol(mapSymbol);
  const byTopic = new Map<string, ts.Type>();
  for (const prop of checker.getPropertiesOfType(mapType)) {
    byTopic.set(prop.getName(), checker.getTypeOfSymbol(prop));
  }
  return {
    topicIds: [...byTopic.keys()],
    payloadType: (topic) => byTopic.get(topic),
    checker,
  };
}

/** Drops `null`/`undefined` from a union, leaving the shapes worth walking. */
function objectConstituents(type: ts.Type): ts.Type[] {
  const parts = type.isUnion() ? type.types : [type];
  return parts.filter(
    (t) => (t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) === 0,
  );
}

interface WalkContext {
  checker: ts.TypeChecker;
  topic: string;
  report: ConformanceReport;
}

function walkValue(
  ctx: WalkContext,
  type: ts.Type,
  value: unknown,
  path: string,
): void {
  if (value === null || value === undefined) return;

  const constituents = objectConstituents(type);
  if (constituents.length === 0) return;

  if (Array.isArray(value)) {
    ctx.report.nodesVisited += 1;
    const elementTypes = constituents
      .map((t) => ctx.checker.getIndexTypeOfType(t, ts.IndexKind.Number))
      .filter((t): t is ts.Type => t !== undefined);
    if (elementTypes.length === 0) {
      // The fixture sent an array where the contract declares no array. Not a
      // name defect, but the walk stops here, so say so rather than pass.
      ctx.report.unresolvedPositions.push(`${ctx.topic}${path} (array)`);
      return;
    }
    value.forEach((item, index) => {
      for (const elementType of elementTypes) {
        walkValue(ctx, elementType, item, `${path}[${index}]`);
      }
    });
    return;
  }

  if (typeof value !== "object") return;

  ctx.report.nodesVisited += 1;
  const record = value as Record<string, unknown>;

  const declared = new Map<string, { type: ts.Type; optional: boolean }>();
  let indexType: ts.Type | undefined;
  for (const constituent of constituents) {
    for (const prop of ctx.checker.getPropertiesOfType(constituent)) {
      const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
      const existing = declared.get(prop.getName());
      if (existing) {
        // A union constituent that omits the field makes it optional overall.
        existing.optional ||= optional;
        continue;
      }
      declared.set(prop.getName(), {
        type: ctx.checker.getTypeOfSymbol(prop),
        optional,
      });
    }
    indexType ??= ctx.checker.getIndexTypeOfType(
      constituent,
      ts.IndexKind.String,
    );
  }

  if (declared.size === 0 && !indexType) {
    ctx.report.unresolvedPositions.push(`${ctx.topic}${path} (object)`);
    return;
  }

  for (const [key, child] of Object.entries(record)) {
    ctx.report.fieldsChecked += 1;
    const declaredField = declared.get(key);
    if (declaredField) {
      walkValue(ctx, declaredField.type, child, `${path}.${key}`);
      continue;
    }
    if (indexType) {
      // A `Dictionary<string, X>` channel: any key is legal, the VALUE shape
      // is still the contract's and still gets walked.
      walkValue(ctx, indexType, child, `${path}.${key}`);
      continue;
    }
    ctx.report.undeclaredFields.push({
      topic: ctx.topic,
      path: path === "" ? "(root)" : path,
      field: key,
      declared: [...declared.keys()],
    });
  }

  if (indexType) return;
  for (const [name, declaredField] of declared) {
    if (name in record || declaredField.optional) continue;
    ctx.report.omittedFields.push({
      topic: ctx.topic,
      path: path === "" ? "(root)" : path,
      field: name,
    });
  }
}

/**
 * Walks every payload a replay fixture publishes against the contract.
 *
 * `payloads` is the topic -> payload map the fixture actually serves, so what
 * gets checked is the same object the WebSocket writes onto the wire, not a
 * transcription of it.
 */
export function checkFixturePayloads(
  resolver: ContractResolver,
  payloads: Record<string, unknown>,
  exemptTopics: ReadonlySet<string> = new Set(),
): ConformanceReport {
  const report: ConformanceReport = {
    topicsChecked: 0,
    nodesVisited: 0,
    fieldsChecked: 0,
    undeclaredFields: [],
    omittedFields: [],
    undeclaredTopics: [],
    unresolvedPositions: [],
  };

  for (const [topic, payload] of Object.entries(payloads)) {
    if (exemptTopics.has(topic)) continue;
    const type = resolver.payloadType(topic);
    if (!type) {
      report.undeclaredTopics.push({ topic });
      continue;
    }
    report.topicsChecked += 1;
    walkValue({ checker: resolver.checker, topic, report }, type, payload, "");
  }

  return report;
}
