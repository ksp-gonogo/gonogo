// @vitest-environment node
/*
 * Node realm, matching `declaration-reachability.test.ts`: the scan reads the
 * repo off disk and the shrink-only half transpiles the debt list at a git
 * ref through esbuild, which wants a real TextEncoder/Uint8Array realm.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { CONTRACT_READER_DEBT } from "./contract-reader-coverage.debt";
import {
  contractCommandIds,
  contractFields,
  contractTopicIds,
  scanContractReaderCoverage,
} from "./contract-reader-coverage.scan";
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

/**
 * Saga 761 made the scan stricter (a widget with no `fields` stopped counting
 * as a reader), which surfaced fields that were never read. Those entries are
 * admitted once, by this reason prefix, and nothing else may arrive.
 */
const SAGA_761_REASON = "newly visible unread (Saga 761";
const isAdmitted = (key: string): boolean =>
  CONTRACT_READER_DEBT[key]?.startsWith(SAGA_761_REASON) ?? false;

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
    | { ref: string; list: Record<string, string> }
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
    return {
      ref: at.ref,
      list: isReasonMap ? (list as Record<string, string>) : {},
    };
  }

  it("CONTRACT_READER_DEBT", () => {
    const at = baseDebt();
    if (!at) return;

    const before = new Set(Object.keys(at.list));
    const arrived = [...debtKeys].filter(
      (key) => !before.has(key) && !isAdmitted(key),
    );

    expect(
      arrived,
      `New debt entries vs ${at.ref}. The list is shrink-only: a field or ` +
        "command lands with its reader, so there is nothing new to record here.",
    ).toEqual([]);
    expect(
      [...debtKeys].filter((key) => !isAdmitted(key) || before.has(key)).length,
      `Debt total rose vs ${at.ref} (${before.size} -> ${debtKeys.size}).`,
    ).toBeLessThanOrEqual(before.size);
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
