// @vitest-environment node
/*
 * Node realm, matching `declaration-reachability.test.ts`: the scan reads the
 * repo off disk and the shrink-only half transpiles the debt list at a git
 * ref through esbuild, which wants a real TextEncoder/Uint8Array realm.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import {
  CONTRACT_READER_ADDED_WITH_TICKET,
  CONTRACT_READER_DEBT,
} from "./contract-reader-coverage.debt";
import {
  contractCommandIds,
  contractFields,
  contractTopicIds,
  creditElementReaders,
  creditWholeObjectReads,
  ELEMENT_READERS,
  membersReadOff,
  scanContractReaderCoverage,
} from "./contract-reader-coverage.scan";
import { debtListProblems } from "./contract-reader-debt.check";
import {
  ratchetBaseRef,
  ratchetRepoRoot,
  sourceAtRatchetBase,
} from "./ratchetBaseRef";

/**
 * gonogo Saga task 727: does any PRODUCTION client read this published contract field or
 * send this contract command. Core integrated the n-body arc and published it
 * as `vessel.orbit.Arc`, plus a `vessel.trajectory.forVantage` command;
 * neither had a production reader, only tests and an sdk hook, and no
 * existing ratchet asked the question at FIELD granularity: a widely read
 * Topic makes every field on it look consumed. See `contract-reader-coverage.scan.ts`
 * for the two reader signals and their tradeoffs.
 */

const DEBT_PATH = "packages/core/src/contract-reader-coverage.debt.ts";

const repoRoot = ratchetRepoRoot();
const scan = scanContractReaderCoverage(repoRoot);

const debtKeys = new Set(Object.keys(CONTRACT_READER_DEBT));

describe("every contract field and command has a production reader", () => {
  it("names any field no production client reads", () => {
    const unread = scan.fields
      .map((f) => `field:${f.key}`)
      .filter((key) => !scan.fieldReaders.has(key.slice("field:".length)))
      .filter((key) => !debtKeys.has(key));

    expect(
      unread,
      [
        "These contract fields are published and nothing in packages/ or",
        "mod/*/client reads them: no registerComponent fields/channels names",
        "them, and no non-widget file both touches the Topic and names the",
        "field. A field lands WITH its reader; if it is genuinely next, land",
        "the reader in the same branch rather than adding debt. If an Uplink",
        `in gonogo-uplinks already reads it, add a line to ${DEBT_PATH} with`,
        "reason `Uplink-read: <name>`; that entry is checked from the other",
        "side by gonogo-uplinks/tooling/verify-contract-reader-debt.mjs.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("names any command no production client sends", () => {
    const unsent = scan.commands
      .map((id) => `command:${id}`)
      .filter((key) => !scan.commandReaders.has(key.slice("command:".length)))
      .filter((key) => !debtKeys.has(key));

    expect(
      unsent,
      "These contract commands are published and no production useCommand(...) " +
        "call names them. Same rule as the field check above.",
    ).toEqual([]);
  });

  it("lists no debt entry that is now read", () => {
    const stale = [...debtKeys].filter((key) => {
      const [kind, ...rest] = key.split(":");
      const id = rest.join(":");
      if (CONTRACT_READER_DEBT[key]?.startsWith("Uplink-read:")) return false;
      if (kind === "field") return scan.fieldReaders.has(id);
      if (kind === "command") return scan.commandReaders.has(id);
      return false;
    });

    expect(
      stale,
      `A production reader now exists for these. Delete them from ${DEBT_PATH} ` +
        "to ratchet down. (Uplink-read entries are excluded here: this repo " +
        "cannot see gonogo-uplinks, so they are graded by the other repo's " +
        "checker, never by this scan finding a reader on its own.)",
    ).toEqual([]);
  });

  it("carries no debt entry for a field or command that no longer exists", () => {
    const knownFields = new Set(scan.fields.map((f) => `field:${f.key}`));
    const knownCommands = new Set(scan.commands.map((id) => `command:${id}`));
    const gone = [...debtKeys].filter(
      (key) => !knownFields.has(key) && !knownCommands.has(key),
    );

    expect(
      gone,
      "These debt entries name a field or command the contract no longer " +
        `declares (removed, renamed, or a stale topic). Delete them from ${DEBT_PATH}.`,
    ).toEqual([]);
  });
});

describe("the scan can be seen to work", () => {
  /**
   * Both halves plant against REAL contract data (`vessel.orbit` and
   * `vessel.control.stage`), not a fabricated Topic: `enumerateTopicFields`
   * reads the sdk's live unit/shape registry regardless of which repo root
   * the scan otherwise walks, so a fake Topic id would enumerate zero fields
   * and prove nothing. The planted repo root instead carries a topic-map and
   * command-map naming only those two ids, and the consumer corpus is built
   * by hand underneath it.
   */
  function plantedRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "reader-coverage-plant-"));
    const plant = (rel: string, text: string): void => {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    };
    plant(
      "mod/sitrep-sdk/src/__generated__/topic-map.ts",
      'export const GENERATED_TOPIC_IDS = ["vessel.orbit"] as const;\n',
    );
    plant(
      "mod/sitrep-sdk/src/__generated__/command-map.ts",
      'export const GENERATED_COMMAND_IDS = ["vessel.control.stage"] as const;\n',
    );
    return root;
  }

  it("fails on a planted field with no reader anywhere in the corpus", () => {
    const root = plantedRoot();
    try {
      mkdirSync(join(root, "packages/app"), { recursive: true });
      writeFileSync(
        join(root, "packages/app/Unrelated.ts"),
        'export const nothing = "no vessel.orbit here";\n',
      );

      const planted = scanContractReaderCoverage(root);
      const scmaKey = planted.fields.find((f) => f.path === "sma")?.key;
      expect(
        scmaKey,
        "vessel.orbit.sma must still be a real contract field",
      ).toBeDefined();
      expect(planted.fieldReaders.has(scmaKey as string)).toBe(false);
      expect(planted.commandReaders.has("vessel.control.stage")).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("gives no credit to a field named only by a story or a test helper", () => {
    const root = plantedRoot();
    try {
      for (const pkg of ["storybook", "test-utils"]) {
        mkdirSync(join(root, `packages/${pkg}/src`), { recursive: true });
        writeFileSync(
          join(root, `packages/${pkg}/src/Scene.tsx`),
          [
            'import { registerComponent } from "@ksp-gonogo/sitrep-sdk";',
            'import { useCommand } from "@ksp-gonogo/sitrep-client";',
            "",
            "function Scene() {",
            '  const stageCmd = useCommand("vessel.control.stage");',
            "  return null;",
            "}",
            "",
            "registerComponent({",
            '  id: "planted-scene",',
            '  channels: ["vessel.orbit"],',
            '  fields: ["vessel.orbit.sma"],',
            "  component: Scene,",
            "});",
            "",
          ].join("\n"),
        );
      }

      const planted = scanContractReaderCoverage(root);
      const scmaKey = planted.fields.find((f) => f.path === "sma")
        ?.key as string;
      expect(planted.fieldReaders.has(scmaKey)).toBe(false);
      expect(planted.commandReaders.has("vessel.control.stage")).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("clears a planted field once a widget declares it drawn, and a command once useCommand names it", () => {
    const root = plantedRoot();
    try {
      mkdirSync(join(root, "packages/app"), { recursive: true });
      writeFileSync(
        join(root, "packages/app/PlantedWidget.tsx"),
        [
          'import { registerComponent } from "@ksp-gonogo/sitrep-sdk";',
          'import { useCommand } from "@ksp-gonogo/sitrep-client";',
          "",
          "function PlantedWidget() {",
          '  const stageCmd = useCommand("vessel.control.stage");',
          "  return null;",
          "}",
          "",
          "registerComponent({",
          '  id: "planted-widget",',
          '  channels: ["vessel.orbit"],',
          '  fields: ["vessel.orbit.sma"],',
          "  component: PlantedWidget,",
          "});",
          "",
        ].join("\n"),
      );

      const planted = scanContractReaderCoverage(root);
      const scmaKey = planted.fields.find((f) => f.path === "sma")
        ?.key as string;
      const eccKey = planted.fields.find((f) => f.path === "ecc")
        ?.key as string;

      expect(planted.fieldReaders.has(scmaKey)).toBe(true);
      /*
       * `fields` is narrow: a sibling field on the same Topic is NOT credited
       * just because the widget mounts on the Topic, proving the gate is
       * field-granular rather than falling back to topic-level coverage.
       */
      expect(planted.fieldReaders.has(eccKey)).toBe(false);
      expect(planted.commandReaders.has("vessel.control.stage")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not credit a widget that declares no fields with every field of its Topic", () => {
    const root = plantedRoot();
    try {
      mkdirSync(join(root, "packages/app"), { recursive: true });
      writeFileSync(
        join(root, "packages/app/MountOnly.tsx"),
        [
          'import { registerComponent } from "@ksp-gonogo/sitrep-sdk";',
          "",
          "registerComponent({",
          '  id: "mount-only",',
          '  channels: ["vessel.orbit"],',
          "  component: () => null,",
          "});",
          "",
        ].join("\n"),
      );

      const planted = scanContractReaderCoverage(root);
      const sma = planted.fields.find((f) => f.path === "sma")?.key as string;
      expect(planted.fieldReaders.has(sma)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("clears a planted field through a C# dictionary-key read chain, and not through a wire write", () => {
    const root = plantedRoot();
    try {
      mkdirSync(join(root, "mod/Sitrep.Host"), { recursive: true });
      writeFileSync(
        join(root, "mod/Sitrep.Host/PlantedReader.cs"),
        [
          "internal static class PlantedReader",
          "{",
          '    internal const string OrbitTopic = "vessel.orbit";',
          "",
          "    internal static string? ReadSource(IDictionary<string, object?> root) =>",
          '        root.TryGetValue("meta", out var raw)',
          "            && raw is IDictionary<string, object?> meta",
          '            && meta.TryGetValue("source", out var source)',
          "                ? source as string",
          "                : null;",
          "",
          "    internal static string? Use(IDictionary<string, object?> root, string topic) =>",
          "        topic == OrbitTopic ? ReadSource(root) : null;",
          "}",
          "",
        ].join("\n"),
      );
      mkdirSync(join(root, "mod/Sitrep.Host/Writers"), { recursive: true });
      writeFileSync(
        join(root, "mod/Sitrep.Host/Writers/PlantedWriter.cs"),
        [
          "internal static class PlantedWriter",
          "{",
          '    internal const string OrbitTopic = "vessel.orbit";',
          "    internal static object Build() => new Dictionary<string, object?>",
          "    {",
          '        ["sma"] = 1.0,',
          '        ["meta"] = new Dictionary<string, object?> { ["quality"] = "x" },',
          "    };",
          "}",
          "",
        ].join("\n"),
      );

      const planted = scanContractReaderCoverage(root);
      const source = planted.fields.find((f) => f.path === "meta.source")
        ?.key as string;
      const sma = planted.fields.find((f) => f.path === "sma")?.key as string;
      expect(planted.fieldReaders.get(source)?.[0]?.via).toBe("csharp-chain");
      expect(planted.fieldReaders.has(sma)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("clears a planted field through the non-widget field-access signal", () => {
    const root = plantedRoot();
    try {
      mkdirSync(join(root, "packages/app"), { recursive: true });
      writeFileSync(
        join(root, "packages/app/TrajectoryBridge.tsx"),
        [
          'import { useTelemetry } from "@ksp-gonogo/sitrep-sdk";',
          "",
          'const orbit = useTelemetry("vessel.orbit");',
          'if (orbit.state === "observed") {',
          "  const semiMajorAxis = orbit.value.sma;",
          "  void semiMajorAxis;",
          "}",
          "",
        ].join("\n"),
      );

      const planted = scanContractReaderCoverage(root);
      const scmaKey = planted.fields.find((f) => f.path === "sma")
        ?.key as string;
      expect(planted.fieldReaders.get(scmaKey)?.[0]?.via).toBe("field-access");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("credits a nested field read through an element or destructured binding, and not a bare identifier", () => {
    const root = plantedRoot();
    try {
      mkdirSync(join(root, "packages/app"), { recursive: true });
      writeFileSync(
        join(root, "packages/app/ElementRead.tsx"),
        [
          'import { useTelemetry } from "@ksp-gonogo/sitrep-sdk";',
          "",
          'const orbit = useTelemetry("vessel.orbit");',
          "const { source } = orbit.value.meta;",
          "void source;",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(root, "packages/app/BareIdentifier.tsx"),
        [
          'const topic = "vessel.orbit";',
          'const source = "somewhere else";',
          "void topic;",
          "void source;",
          "",
        ].join("\n"),
      );
      const planted = scanContractReaderCoverage(root);
      const key = planted.fields.find((f) => f.path === "meta.source")
        ?.key as string;
      const files = (planted.fieldReaders.get(key) ?? []).map((h) => h.file);
      expect(files).toEqual(["packages/app/ElementRead.tsx"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a repo root with no mod/ and no packages/ resolves nothing, not a clean tree", () => {
    const blindRoot = mkdtempSync(join(tmpdir(), "reader-coverage-blind-"));
    mkdirSync(join(blindRoot, "mod/sitrep-sdk/src/__generated__"), {
      recursive: true,
    });
    writeFileSync(
      join(blindRoot, "mod/sitrep-sdk/src/__generated__/topic-map.ts"),
      'export const GENERATED_TOPIC_IDS = ["vessel.orbit"] as const;\n',
    );
    writeFileSync(
      join(blindRoot, "mod/sitrep-sdk/src/__generated__/command-map.ts"),
      'export const GENERATED_COMMAND_IDS = ["vessel.control.stage"] as const;\n',
    );
    try {
      const blind = scanContractReaderCoverage(blindRoot);
      expect(blind.filesParsed).toEqual([]);
      expect(blind.fieldReaders.size).toBe(0);
      expect(blind.commandReaders.size).toBe(0);
      /*
       * The fields themselves still enumerate (real sdk data, independent of
       * the corpus), so a walk that resolved nothing is visible as EVERY
       * field/command being unread, never as a clean tree.
       */
      expect(blind.fields.length).toBeGreaterThan(0);
    } finally {
      rmSync(blindRoot, { recursive: true, force: true });
    }
  });

  it("walked a real number of contract topics, fields and commands", () => {
    /*
     * A walk that resolved the wrong file, or a codegen shape this scan's AST
     * reader no longer matches, reports zero rather than failing loudly.
     */
    expect(contractTopicIds(repoRoot).length).toBeGreaterThan(50);
    expect(contractCommandIds(repoRoot).length).toBeGreaterThan(30);
    expect(contractFields(contractTopicIds(repoRoot)).length).toBeGreaterThan(
      200,
    );
    expect(scan.filesParsed.length).toBeGreaterThan(50);
  });
});

describe("the debt list only ever shrinks", () => {
  function baseDebt():
    | {
        ref: string;
        list: Record<string, string>;
        allowance: ReadonlySet<string> | undefined;
      }
    | undefined {
    const at = ratchetBaseRef();
    if (!at) return undefined;
    const source = sourceAtRatchetBase(at, DEBT_PATH);
    if (source === null) return undefined;
    const js = transformSync(source, { loader: "ts", format: "cjs" }).code;
    const module_ = { exports: {} as Record<string, unknown> };
    new Function("module", "exports", js)(module_, module_.exports);
    const list = module_.exports.CONTRACT_READER_DEBT;
    const isReasonMap =
      typeof list === "object" &&
      list !== null &&
      Object.values(list as Record<string, unknown>).every(
        (v) => typeof v === "string",
      );
    const added = module_.exports.CONTRACT_READER_ADDED_WITH_TICKET;
    return {
      ref: at.ref,
      list: isReasonMap ? (list as Record<string, string>) : {},
      allowance:
        typeof added === "object" && added !== null
          ? new Set(Object.keys(added))
          : undefined,
    };
  }

  it("CONTRACT_READER_DEBT", () => {
    const at = baseDebt();
    if (!at) return;

    const problems = debtListProblems({
      baseDebt: new Set(Object.keys(at.list)),
      debt: debtKeys,
      allowance: CONTRACT_READER_ADDED_WITH_TICKET,
      baseAllowance: at.allowance,
    });

    expect(
      problems,
      `Debt list vs ${at.ref}. The list is shrink-only: a field or command ` +
        "lands with its reader. A key added with the operator's approval goes " +
        "on CONTRACT_READER_ADDED_WITH_TICKET with the Saga ticket that owns " +
        "its reader.",
    ).toEqual([]);
  });

  it("is registered as a shrink-only list", async () => {
    const { RATCHET_ALLOWLIST_PATHS } = await import("./ratchetBaseRef");
    expect(
      RATCHET_ALLOWLIST_PATHS as readonly string[],
      "the base-ref check walks a hand-maintained list; a debt file missing " +
        "from it is shrink-only in its header and nowhere else",
    ).toContain(DEBT_PATH);
  });
});

describe("the debt allowance can be seen to work", () => {
  const base = new Set(["field:a.b"]);

  it("passes a list that only shrinks", () => {
    expect(
      debtListProblems({
        baseDebt: base,
        debt: new Set(),
        allowance: {},
        baseAllowance: undefined,
      }),
    ).toEqual([]);
  });

  it("fails a key added to the debt that is not on the allowance", () => {
    const problems = debtListProblems({
      baseDebt: base,
      debt: new Set(["field:a.b", "field:c.d"]),
      allowance: {},
      baseAllowance: undefined,
    });
    expect(problems.join("\n")).toContain("field:c.d is new debt");
  });

  it("fails an allowed key whose ticket is a placeholder", () => {
    const problems = debtListProblems({
      baseDebt: base,
      debt: new Set(["field:a.b", "field:c.d"]),
      allowance: { "field:c.d": "Saga TBD-1" },
      baseAllowance: undefined,
    });
    expect(problems.join("\n")).toContain("without a ticket");
  });

  it("fails an allowed key that carries no ticket", () => {
    const problems = debtListProblems({
      baseDebt: base,
      debt: new Set(["field:a.b", "field:c.d"]),
      allowance: { "field:c.d": "" },
      baseAllowance: undefined,
    });
    expect(problems.join("\n")).toContain("without a ticket");
  });

  it("fails an allowed key that is not debt any more", () => {
    const problems = debtListProblems({
      baseDebt: base,
      debt: new Set(["field:a.b"]),
      allowance: { "field:c.d": "Saga 1" },
      baseAllowance: undefined,
    });
    expect(problems.join("\n")).toContain("not debt any more");
  });

  it("fails a key added to an allowance the base already carries", () => {
    const problems = debtListProblems({
      baseDebt: base,
      debt: new Set(["field:a.b", "field:c.d"]),
      allowance: { "field:c.d": "Saga 1" },
      baseAllowance: new Set(),
    });
    expect(problems.join("\n")).toContain("only shrinks");
  });

  it("accepts an added key with a ticket", () => {
    for (const ticket of ["Saga 921", "Saga 1"]) {
      expect(
        debtListProblems({
          baseDebt: base,
          debt: new Set(["field:a.b", "field:c.d"]),
          allowance: { "field:c.d": ticket },
          baseAllowance: undefined,
        }),
      ).toEqual([]);
    }
  });
});

describe("the whole-orbit credit stays inside what the solve reads", () => {
  const SOLVE = [
    "function solveOrbitAt(orbit: Orbit) {",
    "  return orbit.sma + orbit.epoch;",
    "}",
    "function other(orbit: Orbit) { return orbit.encounter; }",
  ].join("\n");

  it("takes only the members the named function reads off its parameter", () => {
    expect([...membersReadOff(SOLVE, "solveOrbitAt", "orbit")].sort()).toEqual([
      "epoch",
      "sma",
    ]);
  });

  it("credits a file that fetches and solves, and only for those members", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-credit-"));
    try {
      mkdirSync(join(root, "mod/sitrep-sdk/src/spine"), { recursive: true });
      writeFileSync(
        join(root, "mod/sitrep-sdk/src/spine/orbital-solve.ts"),
        SOLVE,
      );
      const credited: string[] = [];
      const texts = new Map([
        ["packages/app/Hands.ts", "solveOrbit(getVesselTarget()?.orbit)"],
        ["packages/app/Fetches.ts", "getVesselTarget()"],
        ["packages/app/Solves.ts", "solveOrbit(x)"],
      ]);
      creditWholeObjectReads(root, texts, (key, hit) =>
        credited.push(`${key} <- ${hit.file}`),
      );
      expect(credited.sort()).toEqual([
        "vessel.target.orbit.epoch <- packages/app/Hands.ts",
        "vessel.target.orbit.sma <- packages/app/Hands.ts",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never credits a field the real solve does not read", () => {
    const real = scanContractReaderCoverage();
    for (const key of [
      "vessel.target.orbit.encounter.bodyIndex",
      "vessel.target.orbit.horizon.kind",
      "vessel.target.orbit.patches",
    ]) {
      const fromSolve = real.fieldReaders
        .get(key)
        ?.filter((h) => h.file.endsWith("ManeuverTriggerHostService.ts"));
      expect(fromSolve ?? []).toEqual([]);
    }
  });
});

describe("an identifier that only looks like a read is never one", () => {
  const plantedFile = (lines: string[]): { root: string; source: string } => {
    const root = mkdtempSync(join(tmpdir(), "reader-coverage-coincidence-"));
    const plant = (rel: string, text: string): void => {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    };
    plant(
      "mod/sitrep-sdk/src/__generated__/topic-map.ts",
      'export const GENERATED_TOPIC_IDS = ["vessel.orbit"] as const;\n',
    );
    plant(
      "mod/sitrep-sdk/src/__generated__/command-map.ts",
      "export const GENERATED_COMMAND_IDS = [] as const;\n",
    );
    plant("packages/app/Planted.ts", lines.join("\n"));
    const source = scanContractReaderCoverage(root).fields.find(
      (f) => f.path === "meta.source",
    )?.key as string;
    return { root, source };
  };

  it("does not credit a member of an upper-case constant", () => {
    const { root, source } = plantedFile([
      'const topic = "vessel.orbit";',
      'import { HELD } from "./held";',
      "export const read = HELD.meta.source;",
    ]);
    try {
      expect(scanContractReaderCoverage(root).fieldReaders.has(source)).toBe(
        false,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("credits a leaf read off a payload, to prove the two above are not blanket refusals", () => {
    const { root, source } = plantedFile([
      'const topic = "vessel.orbit";',
      "export const read = (o: { meta: { source: string } }) => o.meta.source;",
    ]);
    try {
      expect(scanContractReaderCoverage(root).fieldReaders.has(source)).toBe(
        true,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the element readers are bound by hand and stay true", () => {
  it("names only files that exist and Topics the contract declares", () => {
    const topics = new Set(contractTopicIds(repoRoot));
    for (const { file, topic } of ELEMENT_READERS) {
      expect(existsSync(join(repoRoot, file)), file).toBe(true);
      expect(topics.has(topic), topic).toBe(true);
    }
  });

  it("credits a leaf the bound file reads, and never a leaf it does not", () => {
    const fields = contractFields(["deployed.bases"]);
    const byFieldsOfTopic = new Map([["deployed.bases", fields]]);
    const credited: string[] = [];
    creditElementReaders(
      new Map([
        [
          ELEMENT_READERS.find((r) => r.topic === "deployed.bases")
            ?.file as string,
          "export const f = (e: Record<string, string>) => e.partName;",
        ],
      ]),
      byFieldsOfTopic,
      (key) => credited.push(key),
    );
    expect(credited).toEqual(["deployed.bases.partName"]);
  });
});
