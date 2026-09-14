// A declared Topic or command with no client consumer is a half-built feature
// that every other gate reports as finished. This one asks the question none of
// them ask: is it REACHED.
//
// Runs in the node environment: the scan reads the repo off disk and builds
// TypeScript source files over `ts.sys`.
// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import {
  debtKey,
  hasGenericConsumer,
  scanReachability,
} from "./declaration-reachability";
import {
  SCAN_FLOORS,
  UNREACHED_DECLARATION_DEBT,
} from "./declaration-reachability.allowlist";
import {
  ratchetBaseRef,
  ratchetRepoRoot,
  sourceAtRatchetBase,
} from "./ratchetBaseRef";

const ALLOWLIST_PATH =
  "packages/core/src/declaration-reachability.allowlist.ts";

const repoRoot = ratchetRepoRoot();
const scan = scanReachability(repoRoot);

const debt = new Set(
  Object.values(UNREACHED_DECLARATION_DEBT).flatMap((entries) => [...entries]),
);
/** Debt entries carry `<kind> <id>`; the scan keys by `<uplink>: <kind> <id>`. */
const debtWithUplink = new Set(
  Object.entries(UNREACHED_DECLARATION_DEBT).flatMap(([uplink, entries]) =>
    entries.map((entry) => `${uplink}: ${entry}`),
  ),
);

describe("every declared Topic and command is read by a client", () => {
  it("names any declaration no consumer reaches", () => {
    const fresh = scan.unreached
      .map(debtKey)
      .filter((key) => !debtWithUplink.has(key));

    expect(
      fresh,
      [
        "These Topics/commands are declared and nothing reads or sends them.",
        "",
        "A declaration lands WITH its consumer. If the widget is genuinely next,",
        "it is next in the same branch, not in the debt list: this list is",
        `seeded and shrink-only (${ALLOWLIST_PATH}).`,
        "",
        "If the consumer exists and the scan cannot see it, the id is computed",
        "at runtime. Say so in `hasGenericConsumer` with the call site, the way",
        "`*.available` is bounded, rather than adding debt.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("lists no declaration that is now reached", () => {
    const unreachedNow = new Set(scan.unreached.map(debtKey));
    const stale = [...debtWithUplink].filter((key) => !unreachedNow.has(key));

    expect(
      stale,
      "Allowlisted as unreached, but a consumer now exists (or the declaration " +
        `was deleted). Delete these lines from ${ALLOWLIST_PATH} to ratchet down.`,
    ).toEqual([]);
  });
});

/**
 * The gate has to be SEEN to fail.
 *
 * A reachability scan that resolves nothing reports every declaration reached
 * and passes, which is strictly worse than having no gate: it converts the
 * silent half-build into a green tick. These checks are the instrument, and
 * they are why a zero here means "nothing is wrong" rather than "nothing was
 * looked at".
 */
describe("the scan can be seen to work", () => {
  it("fails on a planted declaration nothing reads", () => {
    const planted = {
      uplink: "GonogoPlantedUplink",
      kind: "topic" as const,
      id: "planted.topic.no.consumer.exists.anywhere",
      konst: "PLANTED_TOPIC_NO_CONSUMER",
      declaredIn: "mod/GonogoPlantedUplink/client/src/topics.ts",
    };
    // The predicate the gate actually applies, run against a declaration whose
    // id and constant appear nowhere in the tree.
    const reached =
      hasGenericConsumer(planted.id) ||
      scan.declarations.some((d) => d.id === planted.id);

    expect(reached, "a planted unreachable declaration read as reached").toBe(
      false,
    );
    expect(debtKey(planted)).toBe(
      "GonogoPlantedUplink: topic planted.topic.no.consumer.exists.anywhere",
    );
  });

  /**
   * The scan over a planted tree, where every number is known: one Uplink client
   * declaring two Topics and a command, one consumer reading one Topic by its
   * constant and the command by its id, and a test file naming the other Topic,
   * which does not count.
   *
   * This replaced a named control (an RP-1 Topic) and floors on how many files
   * were parsed, how many declarations were found and how many Uplinks
   * contributed them. Every declaration in this repo is an Uplink's, and every
   * mod Uplink is leaving for the gonogo-uplinks repo, so those counts are
   * heading for zero and could not tell that from a walk that stopped resolving.
   */
  it("reads a planted tree exactly, reached and unreached, in both directions", () => {
    const root = mkdtempSync(join(tmpdir(), "reach-plant-"));
    const plant = (rel: string, text: string) => {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    };
    try {
      plant(
        "mod/GonogoPlantedUplink/client/src/topics.ts",
        'export const PLANTED_READ_TOPIC = "planted.read";\n' +
          'export const PLANTED_UNREAD_TOPIC = "planted.unread";\n',
      );
      plant(
        "mod/GonogoPlantedUplink/client/src/__generated__/command-map.ts",
        'export const GENERATED_COMMAND_IDS = [\n  "planted.command",\n] as const;\n',
      );
      plant(
        "packages/consumer/src/widget.ts",
        'import { PLANTED_READ_TOPIC } from "./topics";\n' +
          'export const reads = [PLANTED_READ_TOPIC, "planted.command"];\n',
      );
      plant(
        "packages/consumer/src/widget.test.ts",
        'export const named = "planted.unread";\n',
      );

      const planted = scanReachability(root);
      expect(planted.declarations.map(debtKey).sort()).toEqual([
        "GonogoPlantedUplink: command planted.command",
        "GonogoPlantedUplink: topic planted.read",
        "GonogoPlantedUplink: topic planted.unread",
      ]);
      expect(planted.unreached.map(debtKey)).toEqual([
        "GonogoPlantedUplink: topic planted.unread",
      ]);
      expect(planted.corpusSize).toBe(1);
      expect(planted.filesParsed).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("actually walked the tree", () => {
    expect(
      scan.corpusSize,
      "consumer corpus collapsed: the walk resolved almost nothing, so every " +
        "declaration would read as unreached or reached by accident",
    ).toBeGreaterThanOrEqual(SCAN_FLOORS.corpusFiles);
  });

  it("a walk that resolves nothing lands UNDER the floor rather than clean", () => {
    // The failure mode the floor exists for, exercised rather than assumed: a
    // root with no `mod/` and no `packages/` is what a moved directory or a
    // cwd change looks like from inside the scan. It reports zero unreached,
    // which is indistinguishable from a healthy tree unless the floor refuses it.
    const blind = scanReachability(mkdtempSync(join(tmpdir(), "reach-blind-")));

    expect(blind.unreached).toEqual([]);
    expect(blind.declarations).toEqual([]);
    expect(
      blind.corpusSize < SCAN_FLOORS.corpusFiles,
      "a scan that resolved nothing cleared the floor, so the floor cannot " +
        "tell a broken walk from a clean tree",
    ).toBe(true);
  });

  it("read declarations from every Uplink client that declares any", () => {
    /*
     * Held to git rather than to a floor of Uplinks: every tracked Uplink
     * topics.ts or generated command map that textually declares something must
     * be a file the per-client walk took a declaration from.
     */
    const declaring = execFileSync("git", ["ls-files", "mod"], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\n")
      .filter((rel) =>
        /^mod\/Gonogo[^/]*Uplink\/client\/src\/(topics\.ts|__generated__\/command-map\.ts)$/.test(
          rel,
        ),
      )
      .filter((rel) =>
        /export const [A-Z0-9_]+_TOPIC\s*=\s*"|export const GENERATED_COMMAND_IDS\s*=\s*\[\s*"/.test(
          readFileSync(join(repoRoot, rel), "utf8"),
        ),
      )
      .sort();
    expect(
      [...new Set(scan.declarations.map((d) => d.declaredIn))].sort(),
      "declarations came from a different set of files than git says declare " +
        "any: the per-client walk is failing silently for the rest",
    ).toEqual(declaring);
  });
});

describe("the debt list only ever shrinks", () => {
  /**
   * The list as it stood at the ratchet base.
   *
   * `ratchetBaseRef` THROWS when no base can be reached, deliberately: catching
   * that and returning undefined would make an unreachable base read as
   * "nothing to check", turning the shrink guard into a pass. Undefined here
   * means only that the checkout IS the base, or that the list did not exist
   * there.
   */
  function baseDebt():
    | { ref: string; list: Record<string, readonly string[]> }
    | undefined {
    const at = ratchetBaseRef();
    if (!at) return undefined;
    const source = sourceAtRatchetBase(at, ALLOWLIST_PATH);
    if (source === null) return undefined;
    const js = transformSync(source, { loader: "ts", format: "cjs" }).code;
    const module_ = { exports: {} as Record<string, unknown> };
    new Function("module", "exports", js)(module_, module_.exports);
    return {
      ref: at.ref,
      list: module_.exports.UNREACHED_DECLARATION_DEBT as Record<
        string,
        readonly string[]
      >,
    };
  }

  it("UNREACHED_DECLARATION_DEBT", () => {
    const at = baseDebt();
    if (!at?.list) return;

    const before = new Set(
      Object.entries(at.list).flatMap(([uplink, entries]) =>
        entries.map((entry) => `${uplink}: ${entry}`),
      ),
    );
    const arrived = [...debtWithUplink].filter((key) => !before.has(key));

    expect(
      arrived,
      `New debt entries vs ${at.ref}. The list is shrink-only: a declaration ` +
        "lands with its consumer, so there is nothing new to record here.",
    ).toEqual([]);
    expect(
      debtWithUplink.size,
      `Debt total rose vs ${at.ref} (${before.size} -> ${debtWithUplink.size}).`,
    ).toBeLessThanOrEqual(before.size);
  });

  it("is registered as a shrink-only list", async () => {
    const { RATCHET_ALLOWLIST_PATHS } = await import("./ratchetBaseRef");
    expect(
      RATCHET_ALLOWLIST_PATHS as readonly string[],
      "the base-ref check walks a hand-maintained list; a debt file missing " +
        "from it is shrink-only in its header and nowhere else",
    ).toContain(ALLOWLIST_PATH);
  });

  it("carries no entry the debt map has lost its grouping for", () => {
    expect(debt.size).toBe(debtWithUplink.size);
  });
});
