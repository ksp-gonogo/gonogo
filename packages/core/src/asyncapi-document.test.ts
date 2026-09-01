// @vitest-environment node
//
// Node realm rather than the package's jsdom default: this walks the tree and runs a generator, and touches no DOM.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * `asyncapi.yaml` is the contract's core wire surface, generated beside the
 * README.
 *
 * ## Why this is here and not beside the generator
 *
 * It reads the whole mod tree: the generated contract slice, the topic and
 * command maps, and the C# declaration sites the channel dispositions are
 * scanned out of. core's scan suite is the one task carrying a cache key over
 * the whole tree (see `scan-tests.mjs`), so it is the only place this can live
 * without replaying a stale pass when the contract changes.
 *
 * ## What it is actually guarding
 *
 * Four things, and only one of them is "the document is valid".
 *
 * The validator can be blind. A parser that silently accepted anything would
 * report zero errors on a broken document and read exactly like a clean pass, so
 * a violation is PLANTED and the parser has to see it before any verdict here
 * counts.
 *
 * The counts must come from the source, not from the generator. Asking the
 * generator how many channels it emitted answers "how many did the walk find",
 * which is the question a walk that quietly stopped early also answers.
 *
 * The prose must actually arrive. The document exists because the contract's C#
 * explanations now reach the generated TypeScript, and a generator that stopped
 * carrying them would still emit a perfectly valid document of named shapes.
 *
 * The bytes must be stable. The file is committed and CI diffs it, so a
 * walk-order dependency would show up as a red build on an unrelated change.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

interface Generator {
  generate: () => {
    document: Record<string, unknown>;
    contract: {
      interfaces: Map<string, { description?: string }>;
      methodLeaks: string[];
    };
  };
  serialise: (document: unknown) => string;
  OUTPUT: string;
}

/**
 * The generator, loaded by URL.
 *
 * A non-literal specifier, so the module needs no declaration file: it is a
 * `.mjs` root script, and the alternative was a `.d.ts` restating its exports,
 * which is a second copy of a signature that would go stale.
 */
async function loadGenerator(): Promise<Generator> {
  const url = pathToFileURL(join(REPO_ROOT, "scripts/asyncapi-doc.mjs")).href;
  return (await import(url)) as Generator;
}

/** Keys of one generated map interface, straight out of the emitted TypeScript. */
function mapKeys(file: string, interfaceName: string): string[] {
  const source = read(file);
  const start = source.indexOf(`export interface ${interfaceName}`);
  expect(start, `${interfaceName} in ${file}`).toBeGreaterThan(-1);
  const body = source.slice(start, source.indexOf("\n}", start));
  return [...body.matchAll(/^ {2}"([^"]+)":/gm)].map((match) => match[1]);
}

const GENERATED = "mod/sitrep-sdk/src/__generated__";

describe("asyncapi.yaml", () => {
  let generator: Generator;
  let document: Record<string, unknown>;
  let contract: ReturnType<Generator["generate"]>["contract"];
  let yaml: string;

  /**
   * Generated ONCE for the whole file. A full run parses the contract, scans the
   * C# declaration sites and serialises 20,000 lines of YAML, so calling it per
   * test cost four times what it needed to and put the hook over its default
   * 10s timeout whenever the scan suite's other 36 files were competing for the
   * machine. The generous timeout is for the same reason: the work is real, and
   * a hook that fails under load is a red build that says nothing.
   */
  beforeAll(async () => {
    generator = await loadGenerator();
    const built = generator.generate();
    document = built.document;
    contract = built.contract;
    yaml = generator.serialise(document);
  }, 120_000);

  it("validates, and the validator can see a violation", async () => {
    const { Parser } = await import("@asyncapi/parser");
    const parser = new Parser();

    const errorsIn = async (source: string) => {
      const { diagnostics } = await parser.parse(source);
      return diagnostics.filter((entry) => entry.severity === 0);
    };

    /*
     * The blind check first. `action` is spec-constrained to send/receive, so a
     * parser that reports nothing about `broadcast` is reporting nothing at all,
     * and the clean verdict below would mean nothing either.
     */
    const operations = document.operations as Record<
      string,
      { action: string }
    >;
    const planted = structuredClone(document) as typeof document;
    const first = Object.keys(operations)[0];
    (planted.operations as Record<string, { action: string }>)[first].action =
      "broadcast";
    const plantedErrors = await errorsIn(generator.serialise(planted));
    expect(
      plantedErrors.length,
      "the parser did not see a planted invalid `action`, so it cannot be trusted to see a real violation",
    ).toBeGreaterThan(0);

    /*
     * And a dangling `$ref`, because the document is mostly refs and a parser
     * that only schema-checks the surface would pass a file whose 3,000 pointers
     * all went nowhere.
     */
    const dangling = structuredClone(document) as typeof document;
    (dangling.operations as Record<string, { channel: { $ref: string } }>)[
      first
    ].channel.$ref = "#/channels/nothing-of-the-sort";
    expect(
      (await errorsIn(generator.serialise(dangling))).length,
      "the parser did not see a planted dangling $ref",
    ).toBeGreaterThan(0);

    expect(await errorsIn(yaml)).toEqual([]);
  });

  it("carries every statically declared topic and command", () => {
    const topics = mapKeys(
      join(GENERATED, "topic-map.ts"),
      "GeneratedTopicPayloadMap",
    );
    const commands = mapKeys(
      join(GENERATED, "command-map.ts"),
      "GeneratedCommandArgsMap",
    );
    expect(topics.length).toBeGreaterThan(60);
    expect(commands.length).toBeGreaterThan(40);

    const channels = document.channels as Record<string, unknown>;
    const operations = document.operations as Record<string, unknown>;
    for (const topic of topics) {
      expect(channels, `channel for ${topic}`).toHaveProperty([topic]);
      expect(operations, `read operation for ${topic}`).toHaveProperty([
        `read:${topic}`,
      ]);
    }
    for (const command of commands) {
      expect(channels, `channel for ${command}`).toHaveProperty([command]);
      expect(operations, `dispatch operation for ${command}`).toHaveProperty([
        `dispatch:${command}`,
      ]);
    }
  });

  it("gives every channel and command its declared delivery and delay", () => {
    const channels = document.channels as Record<
      string,
      Record<string, unknown>
    >;
    const topics = mapKeys(
      join(GENERATED, "topic-map.ts"),
      "GeneratedTopicPayloadMap",
    );
    for (const topic of topics) {
      expect(channels[topic], topic).toHaveProperty("x-sitrep-delivery");
      expect(channels[topic], topic).toHaveProperty("x-sitrep-delay-role");
    }

    // The two delay classes, spelled out. Crossing them is the failure the
    // per-file const resolution in `sources.mjs` fixed: a bare `Topic =` on one
    // declaration site resolving to another class's const gave `career.status`
    // somebody else's disposition, and both of these are declared with prose
    // saying exactly which class they belong to.
    expect(channels["vessel.orbit"]["x-sitrep-delay-role"]).toBe("delayed");
    expect(channels["career.status"]["x-sitrep-delay-role"]).toBe("true-now");

    const commands = mapKeys(
      join(GENERATED, "command-map.ts"),
      "GeneratedCommandArgsMap",
    );
    for (const command of commands) {
      expect(typeof channels[command]["x-sitrep-delayed"], command).toBe(
        "boolean",
      );
    }
    expect(channels["vessel.control.setThrottle"]["x-sitrep-delayed"]).toBe(
      true,
    );
    expect(channels["career.tech.unlock"]["x-sitrep-delayed"]).toBe(false);
  });

  it("carries the contract's own prose, verbatim", () => {
    const schemas = (
      document.components as { schemas: Record<string, unknown> }
    ).schemas;

    // Every emitted schema whose contract declaration has a doc comment must
    // carry that doc comment's text somewhere in the document. Derived from the
    // contract rather than from a hand-picked list, so a generator that carried
    // three descriptions and dropped the rest cannot pass.
    let checked = 0;
    for (const name of Object.keys(schemas)) {
      const declared = contract.interfaces.get(name);
      if (!declared?.description) continue;
      checked++;
      expect(yaml, `${name}'s doc comment`).toContain(
        declared.description.split("\n")[0].trim(),
      );
    }
    expect(
      checked,
      "no emitted schema had a documented declaration, so this asserted nothing",
    ).toBeGreaterThan(100);
  });

  it("is not carrying the codegen's method leaks as wire fields", () => {
    // Two C# static factory helpers reach the emitted contract as method
    // signatures on a payload type. They are not fields, and a schema listing
    // them would tell a reader the wire carries a `Refused` property.
    expect(contract.methodLeaks.length).toBeGreaterThan(0);
    for (const leak of contract.methodLeaks) {
      const member = leak.split(".")[1];
      expect(yaml).not.toContain(`\n          ${member}:`);
    }
  });

  it("emits the same bytes twice", () => {
    const again = generator.serialise(generator.generate().document);
    expect(again).toBe(yaml);
  });

  it("matches the committed file", () => {
    // The gate CI runs is `pnpm asyncapi:check`. This is the same question asked
    // where a developer sees it before pushing, and it is what makes a hand edit
    // to a derived file fail rather than survive.
    expect(read(generator.OUTPUT)).toBe(yaml);
  });

  it("holds the two enum kinds apart, and refuses when its instruments disagree", async () => {
    const url = pathToFileURL(
      join(REPO_ROOT, "scripts/asyncapi/json-schema.mjs"),
    ).href;
    const { SchemaBuilder } = (await import(url)) as {
      SchemaBuilder: new (
        contract: unknown,
      ) => {
        ref: (name: string) => unknown;
        components: () => Record<string, Record<string, unknown>>;
      };
    };

    const enumeration = (
      name: string,
      description: string,
      members: [string, number][],
    ) => [
      name,
      {
        name,
        description,
        members: members.map(([member, value]) => ({ name: member, value })),
      },
    ];

    // No `[Flags]` enum is REACHABLE from a core channel today, so the bitmask
    // branch has no coverage from the real contract at all. It is still the
    // branch that decides whether a legal wire value is rejected, so it is
    // exercised here instead of being taken on trust.
    const contract = {
      interfaces: new Map(),
      enums: new Map([
        enumeration("Ordinal", "Three states of a thing.", [
          ["First", 0],
          ["Second", 1],
          ["Third", 2],
        ]),
        enumeration("Mask", "A `[Flags]` BITMASK of independent bits.", [
          ["None", 0],
          ["A", 1],
          ["B", 2],
          ["C", 4],
        ]),
      ] as [string, unknown][]),
    };

    const builder = new SchemaBuilder(contract);
    builder.ref("Ordinal");
    builder.ref("Mask");
    const schemas = builder.components();

    expect(schemas.Ordinal["x-sitrep-enum-kind"]).toBe("ordinal");
    expect(schemas.Ordinal.oneOf).toHaveLength(3);
    expect(schemas.Mask["x-sitrep-enum-kind"]).toBe("bitmask");
    expect(
      schemas.Mask.oneOf,
      "a bitmask constrained to its member set rejects `A | B`, which is legal traffic",
    ).toBeUndefined();
    expect(schemas.Mask["x-sitrep-enum"]).toEqual({
      None: 0,
      A: 1,
      B: 2,
      C: 4,
    });

    // Values and prose are two instruments and each is blind where the other
    // sees. A disagreement is a refusal, never a coin toss.
    const disagreeing = {
      interfaces: new Map(),
      enums: new Map([
        enumeration("Confused", "A `[Flags]` BITMASK, allegedly.", [
          ["Zero", 0],
          ["One", 1],
          ["Two", 2],
        ]),
      ] as [string, unknown][]),
    };
    expect(() => new SchemaBuilder(disagreeing).ref("Confused")).toThrow(
      /classified ordinal by its values and bitmask by its prose/,
    );
  });

  it("is tracked, beside the README", () => {
    const tracked = execFileSync("git", ["ls-files", generator.OUTPUT], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
    expect(tracked).toBe(generator.OUTPUT);
    expect(generator.OUTPUT).not.toContain("/");
  });
});
