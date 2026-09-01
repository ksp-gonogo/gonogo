// Where the document's facts come from, and the one fact that is only in the C#.
//
// Three of the four inputs are generated TypeScript, committed and already under
// `codegen-check.sh`. The fourth is a SOURCE SCAN, and it is here rather than in
// the generated files because nothing generates it: how a channel is delivered,
// whether its value rides light-time, and how often it is emitted are properties
// of the `ChannelDeclaration` at the declaration site inside the PLUGIN
// assembly, and the codegen reflects over the CONTRACT assembly, which holds the
// payload types and not the channel list. Whether a COMMAND is delayed is the
// same shape of fact on `CommandDeclaration`.
//
// A scan is a fragile instrument. This one is built so its fragility is loud:
// the generated maps already name every static topic and command, so the caller
// cross-checks the scan against them and a channel the maps name and the scan
// did not find FAILS the generator, naming it. A regex that silently matches
// nothing is the exact failure this repo keeps meeting, and the cross-check turns
// it into a build error instead of a document with blank columns.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const GENERATED = "mod/sitrep-sdk/src/__generated__";

export const SOURCES = {
  contract: join(GENERATED, "contract.ts"),
  topicMap: join(GENERATED, "topic-map.ts"),
  commandMap: join(GENERATED, "command-map.ts"),
  compatVersions: "mod/sitrep-sdk/src/compat-versions.ts",
  /**
   * Where core channels and commands are declared.
   *
   * Almost all of them are in the plugin assembly, on an `UplinkManifest`. One
   * command is declared by the engine itself (`vessel.trajectory.forVantage`,
   * registered straight into `ChannelEngine`'s own table), so the host is
   * scanned too. Scanning the plugin alone found 50 of 51 commands, and the
   * cross-check named the missing one.
   */
  declarations: ["mod/Gonogo.KSP", "mod/Sitrep.Host"],
  /** Scanned for const topic/command strings the declarations point at. */
  constants: [
    "mod/Gonogo.KSP",
    "mod/Sitrep.Host",
    "mod/Sitrep.Core",
    "mod/Sitrep.Contract",
  ],
};

function csharpFiles(root, dirs) {
  return execFileSync("git", ["ls-files", ...dirs], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter((path) => path.endsWith(".cs") && !path.includes("Tests"));
}

/** The body of a brace-balanced block whose opening `{` is at `from`. */
function block(source, from) {
  let depth = 0;
  for (let index = from; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}") {
      depth--;
      if (depth === 0) return source.slice(from + 1, index);
    }
  }
  return "";
}

const CONST_STRING = /\bconst\s+string\s+(\w+)\s*=\s*"([^"]*)"/g;
const TYPE_DECL = /\b(?:class|struct)\s+(\w+)/g;
const CHANNEL_INITIALISER = /new\s+ChannelDeclaration\s*\{/g;
const CHANNEL_FACTORY =
  /\bChannelDeclaration\s+(\w+)\s*\([^)]*\)\s*=>\s*new\s+ChannelDeclaration\s*\{/g;
const COMMAND_INITIALISER = /new\s+CommandDeclaration\s*\{/g;
const COMMAND_FACTORY =
  /\bCommandDeclaration\s+(\w+)\s*\([^)]*\)\s*=>\s*\r?\n?\s*new\s+CommandDeclaration\s*\{/g;

/**
 * Every `const string` in the scanned assemblies, resolvable by qualified name
 * and, where it is not ambiguous, by simple name.
 *
 * Qualified is the one that matters. A declaration site writes
 * `Topic = CareerViewProvider.Topic`, and `Topic` on its own is declared in nine
 * different classes: resolving by simple name alone silently returned the LAST
 * one parsed, which is how the first version of this scan gave `career.status`
 * somebody else's disposition. An ambiguous simple name resolves to nothing
 * instead, so the cross-check reports it rather than the scan guessing.
 */
function readConstants(root, dirs) {
  const qualified = new Map();
  const bySimple = new Map();
  const byFile = new Map();
  for (const path of csharpFiles(root, dirs)) {
    const source = readFileSync(join(root, path), "utf8");
    const owners = [...source.matchAll(TYPE_DECL)].map((match) => ({
      at: match.index,
      name: match[1],
    }));
    const local = new Map();
    for (const match of source.matchAll(CONST_STRING)) {
      const owner = owners.filter((o) => o.at < match.index).pop();
      if (owner) qualified.set(`${owner.name}.${match[1]}`, match[2]);
      local.set(match[1], match[2]);
      const seen = bySimple.get(match[1]);
      if (seen === undefined) bySimple.set(match[1], match[2]);
      else if (seen !== match[2]) bySimple.set(match[1], null);
    }
    byFile.set(path, local);
  }
  return { qualified, bySimple, byFile };
}

/**
 * A declaration site's subject expression, as the string it names.
 *
 * The order is the whole of the correctness here. A bare identifier is resolved
 * inside its OWN FILE first, because that is where a declaration site's const
 * almost always lives and because the same simple name is declared in several
 * classes: `SummaryTopic` is `reliability.summary` in one file and `dv.summary`
 * in another, and a global-first lookup gave one of them the other's
 * disposition. A qualified `Class.Member` is next, an unambiguous simple name
 * last, and an ambiguous one resolves to NOTHING so the cross-check reports it.
 */
function makeResolver({ qualified, bySimple, byFile }, path) {
  const local = byFile.get(path) ?? new Map();
  return (raw) => {
    if (!raw) return undefined;
    if (raw.startsWith('"')) return raw.slice(1, -1);
    if (!raw.includes(".")) {
      const own = local.get(raw);
      if (own !== undefined) return own;
    }
    const direct = qualified.get(raw);
    if (direct !== undefined) return direct;
    const simple = bySimple.get(raw.slice(raw.lastIndexOf(".") + 1));
    return simple === null ? undefined : simple;
  };
}

function property(body, name, substitute = (raw) => raw) {
  const raw = new RegExp(`\\b${name}\\s*=\\s*([\\w.]+|"[^"]*")`).exec(
    body,
  )?.[1];
  return raw === undefined ? undefined : substitute(raw);
}

const FACTORY_PARAMETERS = /\(([^)]*)\)\s*=>/;

/** The parameter NAMES of a factory, in order, off its own signature. */
function parametersOf(signature) {
  const inner = FACTORY_PARAMETERS.exec(signature)?.[1] ?? "";
  return inner
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => part.split(/\s+/).pop());
}

/**
 * A call site's arguments, bound to the factory's parameter names.
 *
 * Half the interesting facts are PARAMETERS rather than literals: a factory
 * writes `Delayed = delayed` and the answer is at the call site, as
 * `Command(SetThrottleCommand, delayed: true)`. Reading the body alone reported
 * `Delayed` as the identifier `delayed` for all fifty commands, which is
 * indistinguishable from not declared.
 *
 * Named arguments and positional ones both appear, so both are read.
 */
function bindArguments(parameters, argumentText) {
  const bindings = new Map();
  const parts = argumentText.split(",").map((part) => part.trim());
  parts.forEach((part, index) => {
    const named = /^(\w+)\s*:\s*(.+)$/.exec(part);
    if (named && parameters.includes(named[1])) {
      bindings.set(named[1], named[2].trim());
      return;
    }
    if (parameters[index]) bindings.set(parameters[index], part);
  });
  return (raw) => bindings.get(raw) ?? raw;
}

/** `Delivery.LossyLatest` -> `lossy-latest`. The member is the fact; this is spelling. */
function kebabMember(raw) {
  if (!raw) return undefined;
  const member = raw.includes(".") ? raw.slice(raw.lastIndexOf(".") + 1) : raw;
  return member
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

function keyframeInterval(body) {
  const match = /keyframeIntervalUt:\s*(-?[\d_]+(?:\.\d+)?)/.exec(body);
  return match ? Number(match[1].replace(/_/g, "")) : undefined;
}

function boolProperty(body, name, substitute) {
  const raw = property(body, name, substitute);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
}

function channelDisposition(body, substitute) {
  return {
    delivery: kebabMember(property(body, "Delivery", substitute)),
    delay: kebabMember(property(body, "Delay", substitute)),
    keyframeIntervalUt: keyframeInterval(body),
    absenceIsData: boolProperty(body, "AbsenceIsData", substitute),
  };
}

/**
 * Scans one declaration form out of every plugin source: the direct initialiser,
 * and the private factory several files use to declare five channels alike.
 *
 * The factory case is not hypothetical. Half the core channels are declared
 * through one, and a scan that only understood initialisers found 42 of 71 and
 * said nothing about the rest.
 */
function scanDeclarations(
  root,
  dirs,
  { initialiser, factory, subjectProperty, read },
) {
  const constants = readConstants(root, SOURCES.constants);
  const found = new Map();
  for (const path of csharpFiles(root, dirs)) {
    const source = readFileSync(join(root, path), "utf8");
    const resolve = makeResolver(constants, path);

    const factories = new Map();
    for (const match of source.matchAll(factory)) {
      factories.set(match[1], {
        body: block(source, match.index + match[0].length - 1),
        parameters: parametersOf(match[0]),
      });
    }

    for (const match of source.matchAll(initialiser)) {
      const body = block(source, match.index + match[0].length - 1);
      const subject = resolve(property(body, subjectProperty));
      if (subject) found.set(subject, read(body));
    }

    // A factory's own body names a parameter where the subject goes, so both the
    // subject and any parameterised property come from the CALL SITE. Arguments
    // are read up to the closing paren rather than the first comma: several
    // factories take a second argument, and requiring exactly one lost every
    // channel and every command they declare.
    for (const [name, { body, parameters }] of factories) {
      const calls = new RegExp(`\\b${name}\\s*\\(([^()]*)\\)`, "g");
      for (const call of source.matchAll(calls)) {
        const substitute = bindArguments(parameters, call[1]);
        const subject = resolve(substitute(parameters[0] ?? ""));
        if (subject) found.set(subject, read(body, substitute));
      }
    }
  }
  return found;
}

/** `Delivery` / `Delay` / `Emission` / `AbsenceIsData` per core topic. */
export function readChannelDispositions(root) {
  return scanDeclarations(root, SOURCES.declarations, {
    initialiser: CHANNEL_INITIALISER,
    factory: CHANNEL_FACTORY,
    subjectProperty: "Topic",
    read: channelDisposition,
  });
}

/**
 * Whether each core command rides light-time, per its `CommandDeclaration`.
 *
 * The single most consequential fact about a write on this wire and it reaches
 * no client today: `Delayed = true` means the command takes effect at UT plus
 * uplink light-time rather than now, so an operator pressing it is committing to
 * something minutes away.
 */
export function readCommandDispositions(root) {
  return scanDeclarations(root, SOURCES.declarations, {
    initialiser: COMMAND_INITIALISER,
    factory: COMMAND_FACTORY,
    subjectProperty: "Command",
    read: (body, substitute) => ({
      delayed: boolProperty(body, "Delayed", substitute),
    }),
  });
}

/**
 * The contract version the document describes, off the SDK's compat constants.
 *
 * Read rather than imported because this is a `.mjs` script and those constants
 * are TypeScript. A missing constant throws: a document stamped with a version
 * it guessed is worse than one that would not build.
 */
export function readContractVersion(root) {
  const source = readFileSync(join(root, SOURCES.compatVersions), "utf8");
  const read = (name) => {
    const match = new RegExp(`export const ${name} = (\\d+);`).exec(source);
    if (!match) {
      throw new Error(
        `asyncapi: ${name} not found in ${SOURCES.compatVersions}`,
      );
    }
    return Number(match[1]);
  };
  return { major: read("CONTRACT_MAJOR"), minor: read("CONTRACT_MINOR") };
}
