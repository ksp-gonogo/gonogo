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
// ## Four things are verified, not three
//
// Emitting a document and calling it done is how a page of named-but-unexplained
// shapes ships looking like an answer. So:
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

  const schemas = new SchemaBuilder(contract);
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

  return { document, contract, topics, commandArgs };
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
    `${warnings} spec warning(s)`;

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
