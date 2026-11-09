/**
 * `uplink-tools add <kind> <name>`: one more widget, augment, contribution,
 * setting or unit in an Uplink's client, written from the same templates `new`
 * starts an Uplink with and wired into the client's index.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { findUplinkDir } from "./bake";
import { generate } from "./codegen";
import { parseFlags } from "./flags";
import { renderSeed } from "./new";

const KINDS = [
  "widget",
  "augment",
  "contribution",
  "command",
  "processor",
  "setting",
  "unit",
] as const;
type Kind = (typeof KINDS)[number];

export const ADD_USAGE = `uplink-tools add <kind> <name> [options]

  Add one thing to the Uplink's client, from the templates \`new\` writes, and
  import it from client/src/index.ts. It never overwrites a file, and it writes
  the generated page afterwards when the client's dependencies are installed.

  kinds:
    widget         a widget in client/src/<Name>/ with its test and a fixture
                   for the render harness. It reads vessel.identity until you
                   change the Topic
    augment        a piece of another widget's interface, in
                   client/src/augments/<name>.tsx with its test and a fixture,
                   drawn into a slot
    contribution   a computed entry another widget lists, in
                   client/src/contributions/<name>.ts
    command        a command the app can send the plugin: its arguments class
                   in mod-contract/, its declaration and handler in the plugin,
                   a test in mod-tests/, and the client's types regenerated.
                   Needs an Uplink with a contract slice (new --topics own)
    processor      a shared compute step several widgets read as one source,
                   in client/src/processors/<name>.ts with a test
    setting        an operator setting, in client/src/settings/<name>.ts
    unit           a unit of measure and its declaration, in
                   client/src/units/<name>.ts

  <name>  words, kebab-case or PascalCase: "fuel gauge", fuel-gauge and
          FuelGauge are the same name

  --slot <slot>    augment and contribution: the slot it joins (default:
                   crew-status.actions for an augment, crew-status.badges for a
                   contribution)
  --delay <role>   command: true-now (the default: it runs on arrival, for a
                   command about the plugin or the ground) or delayed (it
                   travels with a vessel's delay and needs --subject)
  --subject <topic>
                   command: the Topic describing the vessel a delayed command
                   is about, which the mod refuses a delayed command without
  --no-generate    command: do not regenerate the client's types afterwards
  --uplink <dir>   the Uplink's directory, the one holding uplink.json
                   (default: found by walking up from the current directory)
  --no-page        do not write the generated page afterwards`;

/** Splits a name given as words, kebab-case or PascalCase into lowercase words. */
function wordsOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .map((word) => word.toLowerCase())
    .filter(Boolean);
}

interface Names {
  kebab: string;
  pascal: string;
  title: string;
  camel: string;
}

function namesOf(name: string): Names {
  const words = wordsOf(name);
  const kebab = words.join("-");
  if (!/^[a-z][a-z0-9-]*$/.test(kebab)) {
    throw new Error(
      `"${name}" is not a name this can use. It starts with a letter and holds letters and digits, as words: "fuel gauge", fuel-gauge or FuelGauge.`,
    );
  }
  const cap = (word: string) => word[0].toUpperCase() + word.slice(1);
  const pascal = words.map(cap).join("");
  return {
    kebab,
    pascal,
    title: words.map(cap).join(" "),
    camel: pascal[0].toLowerCase() + pascal.slice(1),
  };
}

type Files = Map<string, string>;

/** The widget, from the files `new --topics core` writes for its one widget, renamed. */
function widgetFiles(id: string, uplinkName: string, n: Names): Files {
  const seed = renderSeed({
    id,
    name: uplinkName,
    author: "",
    repo: "",
    clientUrl: "",
    contractVersion: "0.0.0",
    topics: "core",
    client: true,
    dependencies: {},
    devDependencies: {},
  });
  const rename = (text: string) =>
    text
      .replaceAll("VesselWidget", `${n.pascal}Widget`)
      .replaceAll(`"${id}-vessel"`, `"${id}-${n.kebab}"`)
      .replaceAll('panelTitle="Vessel"', `panelTitle="${n.title}"`)
      .replaceAll('name: "Vessel",', `name: "${n.title}",`);
  const out: Files = new Map();
  for (const [path, text] of seed) {
    if (!path.startsWith("client/src/Vessel/")) continue;
    const renamed = path
      .replace("client/src/Vessel/", `client/src/${n.pascal}/`)
      .replace("__fixtures__/named.json", `__fixtures__/${n.kebab}.json`);
    out.set(renamed, rename(text));
  }
  return out;
}

function augmentFiles(
  upper: string,
  id: string,
  n: Names,
  slot: string,
): Files {
  const augmentId = `${id}-${n.kebab}`;
  return new Map([
    [
      `client/src/augments/${n.kebab}.tsx`,
      `import { registerAugment } from "@ksp-gonogo/sitrep-sdk";
import { Text } from "@ksp-gonogo/ui-kit";
import { ${upper} } from "../uplink.js";

/** What ${n.title} adds to \`${slot}\`. Replace it with what the operator should see there. */
function ${n.pascal}() {
  return <Text>${n.title}</Text>;
}

registerAugment({
  id: "${augmentId}",
  augments: "${slot}",
  component: ${n.pascal},
  owner: ${upper},
});

export { ${n.pascal} };
`,
    ],
    [
      `client/src/augments/__fixtures__/${n.kebab}.json`,
      `${JSON.stringify(
        {
          _meta: {
            notes:
              "A scene the render harness mounts the augment in, inside a stand-in panel of this size. Name a registered widget in _scene.hostWidget to mount it in that widget instead, and give the slot its props in _scene.slotProps when it needs them.",
          },
          _scene: {
            augment: augmentId,
            hero: true,
            expectsEmpty:
              "The template draws a fixed label and reads no Topic. Delete this once the augment reads one, and emit it in _stream.",
            caption: `${n.title}, drawn in ${slot}`,
            modes: ["default"],
            size: { w: 12, h: 6 },
          },
          _stream: { pinnedUt: 0, emits: [] },
        },
        null,
        2,
      )}\n`,
    ],
    [
      `client/src/augments/${n.kebab}.test.tsx`,
      `import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { ${n.pascal} } from "./${n.kebab}.js";

describe("${n.pascal}", () => {
  it("draws what it adds to the slot", () => {
    render(<${n.pascal} />);

    expect(screen.getByText("${n.title}")).toBeVisible();
  });
});
`,
    ],
  ]);
}

function contributionFiles(
  upper: string,
  id: string,
  n: Names,
  slot: string,
): Files {
  return new Map([
    [
      `client/src/contributions/${n.kebab}.ts`,
      `import { type BadgeEntry, stillTrue } from "@ksp-gonogo/sitrep-sdk";
import { ${upper} } from "../uplink.js";

/**
 * What ${n.title} contributes to \`${slot}\`: a badge when the vessel has crew
 * aboard. Replace the Topic, the condition and the entry with your own. Return
 * \`null\` for nothing.
 */
${upper}.registerContribution({
  id: "${id}-${n.kebab}",
  contributes: "${slot}",
  deps: ["vessel.crew"],
  compute: (topics): BadgeEntry[] | null => {
    const crew = stillTrue(topics["vessel.crew"], undefined);
    if (!crew?.count) return null;
    return [{ id: "${id}-${n.kebab}", label: "${n.title}", tone: "info" }];
  },
});
`,
    ],
  ]);
}

function processorFiles(upper: string, n: Names): Files {
  const constant = n.kebab.toUpperCase().replaceAll("-", "_");
  return new Map([
    [
      `client/src/processors/${n.kebab}.ts`,
      `import { value } from "@ksp-gonogo/sitrep-sdk";
import { ${upper} } from "../uplink.js";

/**
 * ${n.title}: a step computed once from its inputs and read by every widget
 * and extension that asks for it, with \`useProcessor(${constant})\`. This one
 * turns the vessel's vertical speed into a descent rate. Replace the inputs in
 * \`deps\` and what \`compute\` makes of them. It returns \`undefined\` until
 * every input has a sample.
 */
export const ${constant} = ${upper}.registerProcessor({
  id: "${n.kebab}",
  deps: ["vessel.flight"],
  compute: ([flight]) =>
    flight
      ? flight.verticalSpeed.isNegative()
        ? flight.verticalSpeed.abs()
        : value("m/s", 0)
      : undefined,
});
`,
    ],
    [
      `client/src/processors/${n.kebab}.test.tsx`,
      `import {
  render,
  screen,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { useProcessor } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { ${constant} } from "./${n.kebab}.js";

/** Reads the processor the way a widget does, and says only whether it has a result. */
function Probe() {
  const result = useProcessor(${constant});
  return <p>{result === undefined ? "no result yet" : "has a result"}</p>;
}

describe("${constant}", () => {
  it("has no result before its inputs have a sample", () => {
    const stream = setupStreamFixture({ pinnedUt: 0 });
    render(
      <stream.Provider>
        <Probe />
      </stream.Provider>,
    );

    expect(screen.getByText("no result yet")).toBeVisible();
  });
});
`,
    ],
  ]);
}

function settingFiles(id: string, n: Names): Files {
  return new Map([
    [
      `client/src/settings/${n.kebab}.ts`,
      `import { registerSetting } from "@ksp-gonogo/sitrep-sdk";

/** The ${n.title} setting: on or off, on by default. Read it in a widget with useSetting("${id}-${n.kebab}"). */
registerSetting({
  id: "${id}-${n.kebab}",
  label: "${n.title}",
  description: "Say here what turning ${n.title} off changes for the operator.",
  category: "${id}",
  defaultValue: true,
});
`,
    ],
  ]);
}

function unitFiles(id: string, n: Names): Files {
  const symbol = `${id}:${n.kebab}`;
  return new Map([
    [
      `client/src/units/${n.kebab}.ts`,
      `import { registerUnit } from "@ksp-gonogo/sitrep-sdk";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface UnitDeclarations {
    "${symbol}": { kind: "${id}"; dim: { readonly ${n.camel}: 1 }; ratio: 1 };
  }
}

/** The ${n.title} unit, the base unit of its own kind. A unit that converts to another gives its ratio and dimension. */
registerUnit({
  symbol: "${symbol}",
  kind: "${id}",
  dimension: { ${n.camel}: 1 },
  ratio: 1,
});
`,
    ],
  ]);
}

/** The lines `index.ts` gains, so the registration runs when the client loads. */
function indexLines(kind: Exclude<Kind, "command">, n: Names): string[] {
  const folder: Record<Exclude<Kind, "command">, string> = {
    widget: `./${n.pascal}/index.js`,
    augment: `./augments/${n.kebab}.js`,
    contribution: `./contributions/${n.kebab}.js`,
    processor: `./processors/${n.kebab}.js`,
    setting: `./settings/${n.kebab}.js`,
    unit: `./units/${n.kebab}.js`,
  };
  return [`import "${folder[kind]}";`];
}

/**
 * Adds one `kind` named `name` to the Uplink holding `uplinkDir`, returning the
 * files it wrote. Refuses a client that is not there and a file that is.
 */
export function addToUplink(
  uplinkDir: string,
  kind: Exclude<Kind, "command">,
  name: string,
  options: { slot?: string } = {},
): string[] {
  const clientDir = join(uplinkDir, "client");
  if (!existsSync(join(clientDir, "package.json"))) {
    throw new Error(
      `${clientDir} holds no client, and add writes into one. An Uplink with no client gets one with: uplink-tools new --add-client`,
    );
  }
  const declared = JSON.parse(
    readFileSync(join(uplinkDir, "uplink.json"), "utf8"),
  );
  const id = String(declared.id ?? "");
  const uplinkName = String(declared.name ?? id);
  const source = readFileSync(join(clientDir, "src", "uplink.ts"), "utf8");
  const upper = /export const (\w+) = defineUplinkClient\(/.exec(source)?.[1];
  if (!id || !upper) {
    throw new Error(
      `client/src/uplink.ts exports no \`const <NAME> = defineUplinkClient(...)\`, which every registration names as its owner.`,
    );
  }
  const n = namesOf(name);
  const files: Files =
    kind === "widget"
      ? widgetFiles(id, uplinkName, n)
      : kind === "augment"
        ? augmentFiles(upper, id, n, options.slot ?? "crew-status.actions")
        : kind === "contribution"
          ? contributionFiles(
              upper,
              id,
              n,
              options.slot ?? "crew-status.badges",
            )
          : kind === "processor"
            ? processorFiles(upper, n)
            : kind === "setting"
              ? settingFiles(id, n)
              : unitFiles(id, n);

  const clashes = [...files.keys()].filter((path) =>
    existsSync(join(uplinkDir, path)),
  );
  if (clashes.length > 0) {
    throw new Error(
      `add never overwrites, and ${clashes.join(", ")} already exists. Pick another name.`,
    );
  }
  const indexPath = join(clientDir, "src", "index.ts");
  const index = readFileSync(indexPath, "utf8");
  const lines = indexLines(kind, n);
  if (lines.every((line) => index.includes(line))) {
    throw new Error(`client/src/index.ts already imports ${n.kebab}.`);
  }

  for (const [path, text] of files) {
    const out = join(uplinkDir, path);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text);
  }
  const rows = index.split("\n");
  const lastImport = rows.reduce(
    (found, row, at) => (row.startsWith("import ") ? at : found),
    -1,
  );
  rows.splice(lastImport + 1, 0, ...lines);
  const extra =
    kind === "widget"
      ? [`export { ${n.pascal}Widget } from "./${n.pascal}/index.js";`]
      : [];
  writeFileSync(
    indexPath,
    `${rows.join("\n").trimEnd()}\n${extra.join("\n")}${extra.length ? "\n" : ""}`,
  );
  return [...files.keys(), "client/src/index.ts"];
}

/**
 * Adds a command to the plugin of the Uplink holding `uplinkDir`: the arguments
 * class in the contract slice and its line in the codegen config, the
 * declaration, handler and registration in the plugin, and a test. Returns the
 * files it changed. A file whose text no longer matches what `new` writes is
 * named with the lines to add by hand and nothing in it is changed.
 */
export function addCommand(
  uplinkDir: string,
  name: string,
  options: { delay?: string; subject?: string } = {},
): { changed: string[]; byHand: string[]; commandId: string } {
  const declared = JSON.parse(
    readFileSync(join(uplinkDir, "uplink.json"), "utf8"),
  );
  const id = String(declared.id ?? "");
  if (!declared.codegen) {
    throw new Error(
      "a command's arguments are a class in the contract slice, and this Uplink has none (its uplink.json declares no codegen). Scaffold it with new --topics own, or write the slice by hand.",
    );
  }
  const delay = options.delay ?? "true-now";
  if (delay !== "delayed" && delay !== "true-now") {
    throw new Error(`--delay is "delayed" or "true-now", not "${delay}".`);
  }
  if (delay === "delayed" && !options.subject) {
    throw new Error(
      "a delayed command is about a vessel, and the mod refuses one that names no Subject Topic. Give it with --subject <topic>, such as --subject vessel.flight, or use --delay true-now.",
    );
  }
  if (delay === "true-now" && options.subject) {
    throw new Error("--subject is for a delayed command.");
  }
  const n = namesOf(name);
  const Id = id[0].toUpperCase() + id.slice(1);
  const commandId = `${id}.${n.camel}`;
  const args = `${Id}${n.pascal}Args`;
  const constant = `${n.pascal}Command`;
  const plugin = `${Id}Uplink`;

  const targets = {
    payloads: `mod-contract/${Id}Payloads.cs`,
    config: `mod-contract/${Id}RtConfig.cs`,
    plugin: `mod/${plugin}.cs`,
    tests: `mod-tests/${plugin}Tests.cs`,
  };
  const texts = new Map<string, string>();
  for (const path of Object.values(targets)) {
    const file = join(uplinkDir, path);
    if (!existsSync(file)) {
      throw new Error(
        `${path} does not exist, and a command is written into it.`,
      );
    }
    texts.set(path, readFileSync(file, "utf8"));
  }
  if ((texts.get(targets.payloads) ?? "").includes(`class ${args}`)) {
    throw new Error(
      `${targets.payloads} already declares ${args}. Pick another name.`,
    );
  }

  const byHand: string[] = [];
  const edits = new Map<string, string>();
  const edit = (
    path: string,
    handText: string,
    change: (before: string) => string | undefined,
  ) => {
    const before = texts.get(path) ?? "";
    const after = change(before);
    if (after === undefined || after === before) {
      byHand.push(`${path}: ${handText}`);
      return;
    }
    edits.set(path, after);
  };

  const argsClass = `
/// <summary>
/// The arguments of <c>${commandId}</c>. It takes none yet: add a property for each argument the app sends, and the client's types follow from <c>uplink-tools codegen</c>.
/// </summary>
[SitrepContract]
[SitrepCommand("${commandId}"${delay === "true-now" ? ", Delay = DelayRole.TrueNow" : ""})]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class ${args}
{
}
`;
  edit(
    targets.payloads,
    `append:\n${argsClass}`,
    (before) => `${before.trimEnd()}\n${argsClass}`,
  );
  edit(
    targets.config,
    `add typeof(${args}) to the wireTypes array`,
    (before) =>
      /var wireTypes = new\[\] \{[^}]*\};/.test(before)
        ? before.replace(
            /(var wireTypes = new\[\] \{[^}]*?)( \};)/,
            `$1, typeof(${args})$2`,
          )
        : undefined,
  );

  const declaration = `new CommandDeclaration { Command = ${constant}${options.subject ? `, Subject = "${options.subject}"` : ""} },`;
  const handler = `
        /// <summary>
        /// Runs on the game's main thread when the app sends <c>${commandId}</c>. Return <c>CommandResult.Fail(code, detail)</c> with the <c>CommandErrorCode</c> that names why it was refused.
        /// </summary>
        internal CommandResult ${n.pascal}(${args} args)
        {
            return CommandResult.Ok();
        }
`;
  edit(
    targets.plugin,
    `add the constant, the declaration \`${declaration}\` to Manifest.Commands, \`host.AddCommandHandler<${args}, CommandResult>(${constant}, ${n.pascal});\` to Register, and the handler:${handler}`,
    (before) => {
      let text = before;
      const constAt = /public const string \w+Topic = "[^"]*";\n/.exec(text);
      const registerAt =
        /public void Register\(IUplinkHost host\)\s*\{[\s\S]*?\n {8}\}/.exec(
          text,
        );
      const healthAt = text.indexOf(
        "        /// <summary>\n        /// Mandatory. An Uplink wrapping",
      );
      if (!constAt || !registerAt || healthAt < 0) return undefined;
      text = text.replace(
        constAt[0],
        `${constAt[0]}\n        /// <summary>The command that ${n.title.toLowerCase()}. Its arguments are <see cref="${args}"/>.</summary>\n        public const string ${constant} = "${commandId}";\n`,
      );
      if (text.includes("Commands = new List<CommandDeclaration>")) {
        text = text.replace(
          /(Commands = new List<CommandDeclaration>\s*\{\n)/,
          `$1                ${declaration}\n`,
        );
      } else {
        const close = text.indexOf(
          "\n        };\n\n        /// <summary>Called once at startup",
        );
        if (close < 0) return undefined;
        text = `${text.slice(0, close)}\n            Commands = new List<CommandDeclaration>\n            {\n                ${declaration}\n            },${text.slice(close)}`;
      }
      text = text.replace(
        /(public void Register\(IUplinkHost host\)\s*\{[\s\S]*?)(\n {8}\})/,
        `$1\n            host.AddCommandHandler<${args}, CommandResult>(${constant}, ${n.pascal});$2`,
      );
      const health = text.indexOf(
        "        /// <summary>\n        /// Mandatory. An Uplink wrapping",
      );
      return `${text.slice(0, health)}${handler.slice(1)}\n${text.slice(health)}`;
    },
  );

  const tests = `
        [Fact]
        public void Declares${n.pascal}Command()
        {
            Assert.Contains(
                new ${plugin}().Manifest.Commands,
                command => command.Command == ${plugin}.${constant});
        }

        [Fact]
        public void ${n.pascal}Succeeds()
        {
            Assert.True(new ${plugin}().${n.pascal}(new ${args}()).Success);
        }
`;
  edit(targets.tests, `add:${tests}`, (before) => {
    const close = before.lastIndexOf("    }\n}");
    if (close < 0) return undefined;
    return `${before.slice(0, close).trimEnd()}\n${tests}${before.slice(close)}`;
  });

  // Nothing is written until every file can take its edit, so a half-written command is never left behind.
  if (byHand.length > 0) {
    return { changed: [], byHand, commandId };
  }
  for (const [path, text] of edits) writeFileSync(join(uplinkDir, path), text);
  return { changed: [...edits.keys()], byHand, commandId };
}

export function add(
  argv: readonly string[],
  cwd: string = process.cwd(),
  runPage: (clientDir: string) => void = () => {},
): number {
  const { values, switches, positionals } = parseFlags(argv, {
    verb: "add",
    usage: ADD_USAGE,
    values: ["--slot", "--uplink", "--delay", "--subject"],
    switches: ["--no-page", "--no-generate"],
    positionals: 2,
  });
  const [kind, name] = positionals;
  if (!kind || !name || !(KINDS as readonly string[]).includes(kind)) {
    throw new Error(
      `add needs a kind and a name: uplink-tools add <${KINDS.join("|")}> <name>\n\n${ADD_USAGE}`,
    );
  }
  const named = values.get("--uplink");
  const uplinkDir = named ? resolve(cwd, named) : findUplinkDir(cwd);
  if (!uplinkDir) {
    throw new Error(
      `no uplink.json in ${cwd} or any directory above it. Run add inside an Uplink, or name one with --uplink <dir>.`,
    );
  }
  if (values.get("--slot") && kind !== "augment" && kind !== "contribution") {
    throw new Error("--slot is for an augment or a contribution.");
  }
  if (kind === "command") {
    const { changed, byHand, commandId } = addCommand(uplinkDir, name, {
      delay: values.get("--delay"),
      subject: values.get("--subject"),
    });
    if (byHand.length > 0) {
      console.log(
        `command ${namesOf(name).kebab}: nothing was written, because a file no longer matches what the scaffold writes. Add by hand:\n${byHand.map((line) => `  - ${line}`).join("\n")}`,
      );
      return 1;
    }
    console.log(`command ${commandId}: changed ${changed.join(", ")}`);
    const hasTypes =
      existsSync(join(uplinkDir, "client")) ||
      existsSync(join(uplinkDir, "types", "package.json"));
    if (hasTypes && !switches.has("--no-generate")) {
      generate({ uplinkDir });
    }
    console.log(
      `  send it from a widget with useCommand("${commandId}"), whose arguments and reply are typed by what codegen wrote`,
    );
    return 0;
  }
  if (values.get("--delay") || values.get("--subject")) {
    throw new Error("--delay and --subject are for a command.");
  }
  const written = addToUplink(
    uplinkDir,
    kind as Exclude<Kind, "command">,
    name,
    {
      slot: values.get("--slot"),
    },
  );
  console.log(
    `${kind} ${namesOf(name).kebab}: wrote ${written
      .map((path) => relative(cwd, join(uplinkDir, path)) || path)
      .join(", ")}`,
  );
  if (!switches.has("--no-page")) {
    const clientDir = join(uplinkDir, "client");
    if (existsSync(join(clientDir, "node_modules"))) runPage(clientDir);
    else {
      console.log(
        "  not written: the generated page, since the client's dependencies are not installed. Run: npm install && npm run page",
      );
    }
  }
  return 0;
}
