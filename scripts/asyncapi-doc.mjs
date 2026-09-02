#!/usr/bin/env node

// Generates `asyncapi.yaml`, the Sitrep contract's core wire surface as an
// AsyncAPI 3.0.0 document, and validates it.
//
//   node scripts/asyncapi-doc.mjs            write the document
//   node scripts/asyncapi-doc.mjs --check    fail if the committed file is stale
//   node scripts/asyncapi-doc.mjs --stdout   print it and write nothing
//   node scripts/asyncapi-doc.mjs --update-prose-debt    tighten the prose ratchet
//   node scripts/asyncapi-doc.mjs --reseed-prose-debt    re-baseline it (detector change only)
//
// A DERIVED file. Do not edit `asyncapi.yaml`; change the C# in
// `mod/Sitrep.Contract/` (or the declaration in `mod/Gonogo.KSP/`) and
// regenerate. `--check` is what stops a hand edit surviving, and it is the step
// CI runs.
//
// ## Six things are verified, not one
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
// 6. The prose it carries is written for the READER of the contract, not for its
//    maintainer. See `./asyncapi/prose-hygiene.mjs` and the `<internal>`
//    convention it gates: the check that catches a doc comment explaining the
//    mod's internals to somebody who cannot see them

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Parser } from "@asyncapi/parser";
import { stringify } from "yaml";
import { readContract, readMapInterface } from "./asyncapi/contract-model.mjs";
import {
  buildDocument,
  EXAMPLE_COMMAND,
  EXAMPLE_TOPIC,
} from "./asyncapi/document.mjs";
import { SchemaBuilder } from "./asyncapi/json-schema.mjs";
import {
  assertProseHygiene,
  measure,
  PROSE_DEBT,
} from "./asyncapi/prose-hygiene.mjs";
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
  assertExamplesMatchTheirSchemas(document);
  const hygiene = assertProseHygiene(contract);

  return { document, contract, topics, commandArgs, units, hygiene };
}

/**
 * Every schema an `allOf` chain contributes, flattened and dereferenced.
 *
 * `allOf` means all of them apply, so a value has to satisfy each arm and the
 * declared property names are the UNION across arms. That is exactly the shape a
 * narrowed message has: one arm `$ref`s the envelope and the other pins `topic`
 * and re-declares `payload` as the channel's own type, and both describe the
 * same object.
 */
function flattenAllOf(schema, schemas, seen = new Set()) {
  const node = schema?.$ref ? schemas[schema.$ref.split("/").pop()] : schema;
  if (!node || typeof node !== "object" || seen.has(node)) return [];
  seen.add(node);
  const flat = [];
  if (!node.allOf) flat.push(node);
  for (const arm of node.allOf ?? []) {
    flat.push(...flattenAllOf(arm, schemas, seen));
  }
  return flat;
}

/**
 * A worked example against the schema it claims to be an example OF.
 *
 * A deliberately small subset of JSON Schema: `$ref`, `allOf`, `type`,
 * `required`, `properties`, `const`, `oneOf` and `anyOf`. That is everything
 * this generator emits, and a fuller validator would be a dependency for no
 * extra coverage.
 *
 * STRICTER than JSON Schema in one place, on purpose: a property the object's
 * schemas do not declare is an error here, where the spec's default would allow
 * it. Permissiveness is what let `args: { throttle: 0.4 }` read as valid against
 * an args type whose field is `value`, and an example is the one place in a
 * contract document where an undeclared field can only be a mistake.
 */
function validateExample(schema, value, schemas, path = "") {
  const arms = flattenAllOf(schema, schemas);
  const errors = [];
  const at = path || "(root)";

  for (const arm of arms) {
    if (arm.const !== undefined && value !== arm.const) {
      errors.push(`${at}: expected the constant ${JSON.stringify(arm.const)}`);
    }
    const types = arm.type
      ? Array.isArray(arm.type)
        ? arm.type
        : [arm.type]
      : undefined;
    if (types && !types.some((t) => matchesType(t, value))) {
      errors.push(`${at}: expected ${types.join(" or ")}`);
    }
    for (const branch of ["oneOf", "anyOf"]) {
      const options = arm[branch];
      if (!options) continue;
      const passing = options.filter(
        (option) => validateExample(option, value, schemas, path).length === 0,
      );
      if (passing.length === 0) {
        errors.push(`${at}: matched no ${branch} arm`);
      }
    }
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    if (Array.isArray(value)) {
      const items = arms.find((arm) => arm.items)?.items;
      if (items) {
        value.forEach((entry, index) => {
          errors.push(
            ...validateExample(items, entry, schemas, `${at}[${index}]`),
          );
        });
      }
    }
    return errors;
  }

  const declaresProperties = arms.some((arm) => arm.properties);
  const required = new Set(arms.flatMap((arm) => arm.required ?? []));
  for (const name of required) {
    if (!(name in value)) errors.push(`${at}.${name}: required, and absent`);
  }
  for (const [name, child] of Object.entries(value)) {
    const declared = arms
      .map((arm) => arm.properties?.[name])
      .filter((found) => found !== undefined);
    if (declared.length === 0) {
      if (declaresProperties) {
        errors.push(`${at}.${name}: not a property this schema declares`);
      }
      continue;
    }
    for (const property of declared) {
      errors.push(
        ...validateExample(property, child, schemas, `${at}.${name}`),
      );
    }
  }
  return errors;
}

function matchesType(type, value) {
  switch (type) {
    case "object":
      return (
        value !== null && typeof value === "object" && !Array.isArray(value)
      );
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    default:
      return true;
  }
}

/**
 * The envelope examples, checked against the NARROWED message rather than
 * against the envelope they hang on.
 *
 * The envelope is where a reader finds them and the narrowed message is what
 * they have to satisfy, and nothing connected the two. `StreamData.payload` and
 * `CommandRequest.args` are unconstrained on the base by design, because the
 * type lives on the per-channel message, so a `payload` or `args` example on the
 * base validates against a slot that accepts anything: BOTH examples were wrong
 * against their own contract and neither the parser nor the lint could say so.
 *
 * Each example names its subject, so the message is resolved rather than
 * guessed. A subject that no longer exists is an error, not a skip: an example
 * pinned to a deleted channel silently stops being checked, which is the same
 * failure in a slower form.
 *
 * The instrument is checked against a planted fault before it is trusted. A
 * validator with a bug in its property walk reports zero errors, and zero errors
 * is exactly what a correct document looks like.
 */
function assertExamplesMatchTheirSchemas(document) {
  const schemas = document.components.schemas;
  const pairs = [
    ["StreamData", `streamData.${EXAMPLE_TOPIC}`],
    ["CommandRequest", `commandRequest.${EXAMPLE_COMMAND}`],
    ["CommandResponse", `commandResponse.${EXAMPLE_COMMAND}`],
  ];

  const failures = [];
  let checked = 0;
  for (const [envelope, messageKey] of pairs) {
    const message = document.components.messages[messageKey];
    if (!message) {
      throw new Error(
        `asyncapi: ${envelope}'s example is pinned to ${messageKey}, which this ` +
          "document does not emit. The subject was renamed or removed; repoint the " +
          "example in document.mjs rather than leaving it unchecked.",
      );
    }
    for (const example of schemas[envelope].examples ?? []) {
      checked++;
      assertCatchesAPlantedFault(envelope, example, message.payload, schemas);
      for (const error of validateExample(message.payload, example, schemas)) {
        failures.push(`${envelope} example vs ${messageKey}: ${error}`);
      }
    }
  }

  if (checked !== pairs.length) {
    throw new Error(
      `asyncapi: ${checked} envelope examples were checked and there are ` +
        `${pairs.length} envelopes. An envelope lost its example, so the frame a ` +
        "client has to construct is no longer worked anywhere.",
    );
  }
  if (failures.length > 0) {
    throw new Error(
      `asyncapi: ${failures.length} problem(s) in the worked examples:\n  ` +
        `${failures.join("\n  ")}\n` +
        "These are the only worked examples of the frames a client sends and reads, " +
        "so a reader copies them verbatim and gets a silent failure.",
    );
  }
}

/**
 * The validator, run against an example that is KNOWN to be wrong.
 *
 * Renames the first required leaf of the narrowed slot, which is the exact
 * mistake both shipped examples made: a field name that is not the one the
 * schema declares. If that does not produce an error the walk is not reaching
 * the slot, and a walk that reaches nothing passes everything.
 */
function assertCatchesAPlantedFault(envelope, example, payload, schemas) {
  const slot = { StreamData: "payload", CommandRequest: "args" }[envelope];
  if (!slot) return;
  const inner = example[slot];
  if (inner === null || typeof inner !== "object" || Array.isArray(inner)) {
    return;
  }
  const [first] = Object.keys(inner);
  if (first === undefined) return;
  const { [first]: moved, ...rest } = inner;
  const planted = {
    ...example,
    [slot]: { ...rest, [`${first}_not_a_field`]: moved },
  };
  if (validateExample(payload, planted, schemas).length === 0) {
    throw new Error(
      `asyncapi: the example check cannot see a wrong field name in ` +
        `${envelope}.${slot}. It reported the document clean, and a check that ` +
        "cannot see the fault it exists for reports clean on a broken document too.",
    );
  }
}

/**
 * Every schema that describes one property, across `$ref` and `allOf`.
 *
 * A shape reaches a property through three routes and this follows all three: a
 * plain `properties` map, an `allOf` of a base and its own fields, and a message
 * payload that `$ref`s a named envelope under an `allOf` with the arm pinning
 * its topic. The last of those is why a plain read is not enough: the envelope
 * carries the unit, the narrowing arm carries the `const`, and both describe the
 * same property.
 *
 * Most specific first, so the arm nearest the reader wins where two speak. That
 * is the order the single-arm read this replaced had, via its `pop()`.
 */
function propertySchemas(schema, name, schemas, seen = new Set()) {
  const node = schema?.$ref ? schemas[schema.$ref.split("/").pop()] : schema;
  if (!node || typeof node !== "object" || seen.has(node)) return [];
  seen.add(node);
  const found = [];
  if (node.properties?.[name]) found.push(node.properties[name]);
  for (const arm of [...(node.allOf ?? [])].reverse()) {
    found.push(...propertySchemas(arm, name, schemas, seen));
  }
  return found;
}

/**
 * Every schema describing a field inside `components.schemas`, following the
 * dotted leaf form the unit map uses for a vector's components
 * (`relativePosition.x`).
 */
function propertyAt(schema, path, schemas) {
  let at = [schema];
  for (const step of path) {
    const next = [];
    for (const candidate of at) {
      next.push(...propertySchemas(candidate, step, schemas));
    }
    if (next.length === 0) return undefined;
    at = next;
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
      const at = propertyAt(target, field.split("."), schemas);
      if (!at) continue;
      checked++;
      const carried = at.map(unitAt).find((found) => found !== undefined);
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
   * The same three envelope types again, this time reached the way a READER
   * reaches them: through an emitted message, which `$ref`s the named envelope
   * under an `allOf` with the arm pinning its topic or command. The loop above
   * only proves the component is right, and a component nothing resolves to is
   * a component nobody sees, so this asks whether the path holds. Checked on the
   * first message of each kind: the builder writes all 122 from one code path,
   * so one is representative and 122 would be the same assertion 122 times.
   *
   * Not academic. Every unit these three declare now lives in one place rather
   * than in 122 copies, so a broken `$ref` would drop all of them at once, and
   * a document that had lost them reads exactly like one whose envelopes never
   * declared any.
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
    // The channel's own `payload`, which is the narrowing arm's rather than the
    // envelope's placeholder: `propertySchemas` returns the most specific first.
    const payload = propertySchemas(
      document.components.messages[`streamData.${topic}`]?.payload,
      "payload",
      schemas,
    )[0];
    const target = payload?.$ref
      ? schemas[payload.$ref.split("/").pop()]
      : payload?.items?.$ref
        ? schemas[payload.items.$ref.split("/").pop()]
        : undefined;
    for (const [field, unit] of Object.entries(fields)) {
      const at = target && propertyAt(target, field.split("."), schemas);
      const carried = at && at.map(unitAt).find((found) => found !== undefined);
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

/**
 * Rewrites the `PROSE_DEBT` literal in place from a fresh measurement.
 *
 * Only entries that FELL or vanished are written; a key that grew is left where
 * it was, so this cannot be used to make a red gate green. Growth is a
 * conversion going backwards, and the fix for that is the C#.
 *
 * `--reseed-prose-debt` is the one way to write a HIGHER number, and it exists
 * for exactly one situation: the detector got sharper. Widening a pattern finds
 * offences that were always there and always shipped, and refusing to record
 * them would leave the only options as "revert the improvement" or "convert
 * every newly-visible block in the same commit". Named separately from the
 * ordinary flag so it cannot be reached for absent-mindedly, and it prints what
 * it raised.
 */
function updateProseDebt({ reseed = false } = {}) {
  const contract = readContract(join(ROOT, SOURCES.contract));
  const { counts } = measure(contract);
  const path = join(ROOT, "scripts/asyncapi/prose-hygiene.mjs");
  const source = readFileSync(path, "utf8");

  // The imported object, not a re-parse of the file's text. The module is
  // already loaded, so this IS the committed state, and a second parser for the
  // literal would have to track its quoting: the first version read only quoted
  // keys and would have silently zeroed every allowance the moment the writer
  // stopped quoting identifiers for biome.
  const committed = PROSE_DEBT;
  const merged = {};
  const raised = [];
  for (const [key, count] of Object.entries(counts)) {
    const allowed = committed[key];
    if (allowed === undefined || reseed) {
      if (allowed !== undefined && count > allowed)
        raised.push(`${key} ${allowed}->${count}`);
      merged[key] = count;
      continue;
    }
    merged[key] = Math.min(allowed, count);
  }
  if (raised.length > 0) {
    console.log(
      `asyncapi: reseeded ${raised.length} entry(s) UPWARD: ${raised.join(", ")}`,
    );
  }
  // Quoted only where the key needs it, which is the member form. Biome's
  // formatter unquotes anything that is a valid identifier, so a uniformly
  // quoted list would be a lint failure on every regeneration of this list.
  const body = Object.keys(merged)
    .sort()
    .map((key) => {
      const literal = /^[A-Za-z_$][\w$]*$/.test(key)
        ? key
        : JSON.stringify(key);
      return `  ${literal}: ${merged[key]},`;
    })
    .join("\n");
  // Whether the literal was FOUND is a separate question from whether it
  // changed, and conflating them made an idempotent second run report the
  // pattern as broken. The list not moving is the normal case once a conversion
  // has been recorded.
  const literal =
    /export const PROSE_DEBT = \{[\s\S]*?\n\};|export const PROSE_DEBT = \{\};/;
  if (!literal.test(source)) {
    throw new Error(
      "asyncapi: could not find the PROSE_DEBT literal to rewrite. Its shape " +
        "changed; update the pattern rather than hand-editing the list.",
    );
  }
  const rewritten = source.replace(
    literal,
    `export const PROSE_DEBT = {\n${body}\n};`,
  );
  const total = Object.values(merged).reduce((sum, n) => sum + n, 0);
  if (rewritten === source) {
    console.log(
      `asyncapi: prose debt already current, ${Object.keys(merged).length} declaration(s), ${total} marker(s)`,
    );
    return;
  }
  writeFileSync(path, rewritten);
  console.log(
    `asyncapi: prose debt rewritten, ${Object.keys(merged).length} declaration(s), ${total} marker(s)`,
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes("--check");
  const toStdout = argv.includes("--stdout");

  const reseed = argv.includes("--reseed-prose-debt");
  if (reseed || argv.includes("--update-prose-debt")) {
    updateProseDebt({ reseed });
    return;
  }

  const { document, topics, commandArgs, hygiene } = generate();
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
    `${countUnits(document)} unit annotations, ${warnings} spec warning(s), ` +
    `${hygiene.markers} maintainer marker(s) left in ${hygiene.dirty} declaration(s)`;

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
