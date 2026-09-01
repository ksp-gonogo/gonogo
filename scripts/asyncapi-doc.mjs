#!/usr/bin/env node

// Generates `asyncapi.yaml`, the Sitrep contract's core wire surface as an
// AsyncAPI 3.0.0 document, and validates it.
//
//   node scripts/asyncapi-doc.mjs            write the document
//   node scripts/asyncapi-doc.mjs --check    fail if the committed file is stale
//   node scripts/asyncapi-doc.mjs --stdout   print it and write nothing
//
// A DERIVED file. Do not edit `asyncapi.yaml`; change the C# in
// `mod/Sitrep.Contract/` (or the declaration in `mod/Gonogo.KSP/`) and
// regenerate. `--check` is what stops a hand edit surviving, and it is the step
// CI runs.
//
// ## Five things are verified, not one
//
// Emitting a document and calling it valid is how a page of
// named-but-unexplained shapes ships looking like an answer. So:
//
// 1. Every statically declared topic and command reaches the document. The count
//    comes from the generated maps, never from what the walk happened to find
// 2. Every one of them has a `Delivery` and a `Delay` off its declaration site.
//    The source scan those come from is the fragile input, and a scan that
//    quietly matches nothing reads exactly like a contract that declares nothing
// 3. The document VALIDATES, by `@asyncapi/parser` rather than by eye
// 4. It carries PROSE. The count of descriptions is printed and floored: the
//    whole point of the exercise is that the contract's own explanations reach
//    the reader, and a generator that silently stopped carrying them would still
//    emit a valid document
// 5. No unit the contract declares is missing from it. See
//    `assertUnitsSurvived`, and note WHY it exists: the first version of this
//    generator read units off the TYPE only and silently dropped 476 of the 860
//    the contract declares, including the three m/s and one ut on the arguments
//    to the command that plans a burn. Nothing in the output looked wrong,
//    because a field that lost its unit reads exactly like a field that never
//    had one

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Parser } from "@asyncapi/parser";
import { stringify } from "yaml";
import { readContract, readMapInterface } from "./asyncapi/contract-model.mjs";
import { buildDocument } from "./asyncapi/document.mjs";
import { SchemaBuilder } from "./asyncapi/json-schema.mjs";
import {
  readChannelDispositions,
  readCommandDispositions,
  readContractVersion,
  readUnitMap,
  SOURCES,
} from "./asyncapi/sources.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const OUTPUT = "asyncapi.yaml";

/**
 * The floor the prose count is held to.
 *
 * Not the current figure, which would fail on any contract edit that merges two
 * doc comments, and not zero, which would let the carrier silently stop
 * carrying. Set below the measured count with room for ordinary churn, and
 * RAISED deliberately when the contract gains prose, never lowered to make a
 * red build green.
 */
const PROSE_FLOOR = 800;

/**
 * Every `description` in the document, counted at any depth.
 *
 * Counted on the emitted object rather than on the parse, because the question
 * is what the file says. A description that is present and empty does not count:
 * it is the shape of carrying prose without the prose.
 */
function countDescriptions(node) {
  if (Array.isArray(node)) {
    return node.reduce((total, item) => total + countDescriptions(item), 0);
  }
  if (node === null || typeof node !== "object") return 0;
  let total = 0;
  for (const [key, value] of Object.entries(node)) {
    if (
      key === "description" &&
      typeof value === "string" &&
      value.trim().length > 0
    ) {
      total++;
    }
    total += countDescriptions(value);
  }
  return total;
}

/**
 * `x-sitrep-unit` annotations in the document, counted for the summary line.
 *
 * Printed beside the description count for the same reason: a number in the log
 * is what lets the next person tell "the contract declares none" from "the
 * generator stopped carrying them", and the difference between those two is the
 * whole history of this file.
 */
function countUnits(node) {
  if (Array.isArray(node)) {
    return node.reduce((total, item) => total + countUnits(item), 0);
  }
  if (node === null || typeof node !== "object") return 0;
  let total = 0;
  for (const [key, value] of Object.entries(node)) {
    if (key === "x-sitrep-unit" && typeof value === "string") total++;
    total += countUnits(value);
  }
  return total;
}

function crossCheck(label, declared, scanned) {
  const missing = declared.filter((id) => !scanned.has(id));
  if (missing.length > 0) {
    throw new Error(
      `asyncapi: the declaration scan found no ${label} for ${missing.length} of ` +
        `${declared.length}: ${missing.join(", ")}. Either the declaration moved ` +
        "or the scan in scripts/asyncapi/sources.mjs no longer matches it. Fix the " +
        "scan; do not drop the column.",
    );
  }
}

export function generate() {
  const contract = readContract(join(ROOT, SOURCES.contract));
  const topics = readMapInterface(
    join(ROOT, SOURCES.topicMap),
    "GeneratedTopicPayloadMap",
  );
  const commandArgs = readMapInterface(
    join(ROOT, SOURCES.commandMap),
    "GeneratedCommandArgsMap",
  );
  const commandReplies = readMapInterface(
    join(ROOT, SOURCES.commandMap),
    "GeneratedCommandReplyMap",
  );

  const dispositions = readChannelDispositions(ROOT);
  const commandDispositions = readCommandDispositions(ROOT);
  crossCheck(
    "channel declaration",
    topics.map((t) => t.key),
    dispositions,
  );
  crossCheck(
    "command declaration",
    commandArgs.map((c) => c.key),
    commandDispositions,
  );

  for (const { key } of topics) {
    const disposition = dispositions.get(key);
    if (!disposition.delivery || !disposition.delay) {
      throw new Error(
        `asyncapi: ${key}'s declaration was found but carries no ` +
          `${disposition.delivery ? "Delay" : "Delivery"}. A blank column is the ` +
          "shape of a scan that half-matched; fix the scan or the declaration.",
      );
    }
  }
  for (const { key } of commandArgs) {
    if (commandDispositions.get(key).delayed === undefined) {
      throw new Error(
        `asyncapi: ${key}'s CommandDeclaration was found but its Delayed flag ` +
          "did not resolve. Whether a write rides light-time is not a fact to omit.",
      );
    }
  }

  const units = readUnitMap(ROOT);
  const schemas = new SchemaBuilder(contract, units.types);
  const document = buildDocument({
    contract,
    topics,
    commandArgs,
    commandReplies,
    dispositions,
    commandDispositions,
    schemas,
    version: readContractVersion(ROOT),
  });

  assertUnitsSurvived(document, units);

  return { document, contract, topics, commandArgs, units };
}

/** A shape's own properties, whether it is plain or extends another. */
function propertiesOf(schema) {
  if (!schema) return undefined;
  return (
    schema.properties ??
    schema.allOf?.filter((arm) => arm.properties).pop()?.properties
  );
}

/**
 * A field's schema inside `components.schemas`, following the dotted leaf form
 * the unit map uses for a vector's components (`relativePosition.x`).
 */
function propertyAt(schema, path) {
  let at = schema;
  for (const step of path) {
    at = propertiesOf(at)?.[step];
    if (!at) return undefined;
  }
  return at;
}

/**
 * The unit annotation on a field's schema, wherever the shape put it.
 *
 * Four places, because a unit annotates the thing that HAS a magnitude rather
 * than the field that holds it: on the field for a scalar, on `items` for a
 * list, and inside the `anyOf` / `allOf` arm that a nullable or documented
 * `$ref` gets wrapped in. Reading only the field's own level reported 27 units
 * as dropped that were correctly emitted one level in, which is the same class
 * of mistake as the loss it is checking for.
 */
function unitAt(schema) {
  if (!schema || typeof schema !== "object") return undefined;
  if (schema["x-sitrep-unit"] !== undefined) return schema["x-sitrep-unit"];
  if (schema.items) return unitAt(schema.items);
  for (const arm of schema.anyOf ?? schema.allOf ?? []) {
    const found = unitAt(arm);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * No unit the contract declares may vanish from the emitted document.
 *
 * The check that would have caught this class of loss the first time. A dropped
 * unit is INVISIBLE in the output: the document looks complete, and a field that
 * lost its unit reads exactly like a field that never had one, which is how 514
 * dropped units reached a reviewer as a finding about the contract rather than
 * about this generator: 476 of the 860 this now reaches.
 *
 * Asked of the OUTPUT rather than of the generator's own bookkeeping, because a
 * bookkeeping check passes when the attach step and the count step share the same
 * wrong idea of where a unit goes.
 *
 * A map entry naming a type the document does not emit, or a field the contract
 * does not declare, is skipped and not an error: 24 declared types are
 * unreachable from any core channel, and `CommandRequirement` is in the map with
 * no contract declaration at all. The floor below is what stops those skips
 * turning the whole check into a pass by reaching nothing.
 */
function assertUnitsSurvived(document, units) {
  const schemas = document.components.schemas;
  const messages = document.components.messages;
  const lost = [];
  let checked = 0;

  const compare = (label, fields, target) => {
    for (const [field, unit] of Object.entries(fields)) {
      const at = propertyAt(target, field.split("."));
      if (!at) continue;
      checked++;
      const carried = unitAt(at);
      if (carried !== unit) {
        lost.push(
          `${label}.${field} declares ${unit}, document says ${carried ?? "nothing"}`,
        );
      }
    }
  };

  for (const [typeName, fields] of Object.entries(units.types)) {
    const schema = schemas[typeName];
    if (schema) compare(typeName, fields, schema);
  }

  /*
   * The three envelope types whose payload the document INLINES rather than
   * `$ref`s, because each channel binds their generic parameter to its own
   * payload or args type. Their fields are drawn from the same contract
   * declarations and so are subject to the same map, and reaching them means
   * naming one emitted message rather than a component. Checked on the first
   * such message of each kind: the builder writes all 122 from one code path, so
   * one is representative and 122 would be the same assertion 122 times.
   *
   * Not academic. All three declare no unit at all today, alone among the eight
   * envelope types, so without this the day somebody annotates
   * `CommandRequest.SentAt` the document would silently drop it and the check
   * above would not look.
   */
  const firstOf = (prefix) =>
    Object.keys(messages)
      .filter((key) => key.startsWith(prefix))
      .sort()[0];
  for (const [typeName, prefix] of [
    ["CommandRequest", "commandRequest."],
    ["CommandResponse", "commandResponse."],
    ["StreamData", "streamData."],
  ]) {
    const fields = units.types[typeName];
    const message = messages[firstOf(prefix)];
    if (fields && message) compare(typeName, fields, message.payload);
  }

  if (checked < 300) {
    throw new Error(
      `asyncapi: the unit-survival check only reached ${checked} declared units, ` +
        "which is fewer than this contract has ever had. The walk is broken rather " +
        "than the document being clean; a check that reaches nothing reports nothing.",
    );
  }
  if (lost.length > 0) {
    throw new Error(
      `asyncapi: ${lost.length} of ${checked} declared units did not reach the ` +
        `document:\n  ${lost.slice(0, 20).join("\n  ")}\n` +
        "A unit the contract declares and the document drops is invisible in the " +
        "output: the field reads as one that never had a unit.",
    );
  }

  // The topic half of the map against the type half. Two maps meant to say the
  // same thing, compared once, so a divergence cannot be silently resolved by
  // whichever one this generator happens to read.
  for (const [topic, fields] of Object.entries(units.topics)) {
    const channel = document.channels[topic];
    if (!channel) continue;
    for (const [field, unit] of Object.entries(fields)) {
      const payload =
        document.components.messages[`streamData.${topic}`]?.payload?.properties
          ?.payload;
      const target = payload?.$ref
        ? schemas[payload.$ref.split("/").pop()]
        : payload?.items?.$ref
          ? schemas[payload.items.$ref.split("/").pop()]
          : undefined;
      const at = target && propertyAt(target, field.split("."));
      const carried = at && unitAt(at);
      if (at && carried !== unit) {
        throw new Error(
          `asyncapi: the unit map's topic half says ${topic}.${field} is ${unit} ` +
            `and its type half produced ${carried ?? "nothing"}. The two halves ` +
            "have diverged; decide which is authoritative before generating.",
        );
      }
    }
  }
}

/**
 * Deterministic YAML: the same object always produces the same bytes.
 *
 * `lineWidth: 0` turns folding off, so a description's own line breaks are the
 * only ones in the file. Folding would have made the output depend on where a
 * word happened to fall, which is a diff on every unrelated re-indent of the C#.
 */
export function serialise(document) {
  return stringify(document, { lineWidth: 0, singleQuote: false });
}

async function validate(yaml) {
  const parser = new Parser();
  const { diagnostics } = await parser.parse(yaml, { source: OUTPUT });
  const errors = diagnostics.filter((entry) => entry.severity === 0);
  const warnings = diagnostics.filter((entry) => entry.severity === 1);
  for (const entry of [...errors, ...warnings]) {
    const at = entry.path?.join("/") ?? "";
    console.error(
      `  ${entry.severity === 0 ? "error" : "warn "} ${entry.code}: ${entry.message}${at ? ` at ${at}` : ""}`,
    );
  }
  if (errors.length > 0) {
    throw new Error(
      `asyncapi: ${errors.length} spec violation(s). The document does not validate.`,
    );
  }
  return { warnings: warnings.length };
}

async function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes("--check");
  const toStdout = argv.includes("--stdout");

  const { document, topics, commandArgs } = generate();
  const yaml = serialise(document);
  const { warnings } = await validate(yaml);

  const prose = countDescriptions(document);
  if (prose < PROSE_FLOOR) {
    throw new Error(
      `asyncapi: the document carries ${prose} descriptions, below the floor of ` +
        `${PROSE_FLOOR}. The contract's prose has stopped reaching the document, ` +
        "which is the one thing this document exists to do.",
    );
  }

  const summary =
    `asyncapi: ${topics.length} channels, ${commandArgs.length} commands, ` +
    `${Object.keys(document.components.schemas).length} schemas, ${prose} descriptions, ` +
    `${countUnits(document)} unit annotations, ${warnings} spec warning(s)`;

  if (toStdout) {
    process.stdout.write(yaml);
    console.error(summary);
    return;
  }

  const path = join(ROOT, OUTPUT);
  if (check) {
    let committed = "";
    try {
      committed = readFileSync(path, "utf8");
    } catch {
      throw new Error(
        `asyncapi: ${OUTPUT} does not exist. Run \`pnpm asyncapi\`.`,
      );
    }
    if (committed !== yaml) {
      writeFileSync(join(ROOT, `${OUTPUT}.actual`), yaml);
      const diff = diffAgainst(path, `${OUTPUT}.actual`);
      throw new Error(
        `asyncapi: ${OUTPUT} is stale. Run \`pnpm asyncapi\` and commit the result.\n${diff}`,
      );
    }
    console.log(`${summary}, up to date`);
    return;
  }

  writeFileSync(path, yaml);
  console.log(`${summary}, written to ${OUTPUT}`);
}

/** A readable diff for the CI log, capped so a whole-file change does not bury it. */
function diffAgainst(committed, actual) {
  try {
    execFileSync(
      "git",
      ["--no-pager", "diff", "--no-index", "--", committed, actual],
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    );
    return "";
  } catch (error) {
    return (error.stdout ?? "").split("\n").slice(0, 60).join("\n");
  }
}

const invoked =
  process.argv[1] && resolve(process.argv[1]).endsWith("asyncapi-doc.mjs");
if (invoked) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
