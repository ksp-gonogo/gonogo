// A declared Topic or command with no client consumer is a half-built feature
// that every other gate reports as finished. This one asks the question none of
// them ask: is it REACHED.
//
// Runs in the node environment: the scan reads the repo off disk and builds
// TypeScript source files over `ts.sys`.
// @vitest-environment node
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import {
  collectDeclarations,
  debtKey,
  hasGenericConsumer,
  scanReachability,
  uplinkClientRoots,
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
 * silent half-build into a green tick. These four checks are the instrument, and
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

  it("finds a declaration it is known to reach, so it is not blind in both directions", () => {
    // `rp1.available` is read by four RP-1 widgets through `useTelemetry`.
    const known = scan.declarations.find((d) => d.id === "rp1.available");
    expect(
      known,
      "rp1.available is no longer declared; pick another control",
    ).toBeDefined();
    expect(scan.unreached.map((d) => d.id)).not.toContain("rp1.buildQueue");
  });

  it("actually walked the tree", () => {
    expect(
      scan.corpusSize,
      "consumer corpus collapsed: the walk resolved almost nothing, so every " +
        "declaration would read as unreached or reached by accident",
    ).toBeGreaterThanOrEqual(SCAN_FLOORS.corpusFiles);
    expect(
      scan.filesParsed,
      "no consumer file mentioned any declared id, which cannot be true while " +
        "widgets exist",
    ).toBeGreaterThanOrEqual(SCAN_FLOORS.filesParsed);
    expect(
      scan.declarations.length,
      "the declaration side resolved almost nothing, so the gate would pass by " +
        "having found no work to do",
    ).toBeGreaterThanOrEqual(SCAN_FLOORS.declarations);
  });

  it("a walk that resolves nothing lands UNDER the floors rather than clean", () => {
    // The failure mode the floors exist for, exercised rather than assumed: a
    // root with no `mod/` and no `packages/` is what a moved directory, a
    // renamed client dir or a cwd change looks like from inside the scan. It
    // reports zero unreached, which is indistinguishable from a healthy tree
    // unless the floors refuse it.
    const blind = scanReachability(mkdtempSync(join(tmpdir(), "reach-blind-")));

    expect(blind.unreached).toEqual([]);
    expect(blind.declarations).toEqual([]);
    expect(
      blind.corpusSize < SCAN_FLOORS.corpusFiles &&
        blind.filesParsed < SCAN_FLOORS.filesParsed &&
        blind.declarations.length < SCAN_FLOORS.declarations,
      "a scan that resolved nothing cleared the floors, so the floors cannot " +
        "tell a broken walk from a clean tree",
    ).toBe(true);
  });

  it("read declarations from most Uplink clients, not one", () => {
    const roots = uplinkClientRoots(repoRoot);
    expect(roots.length).toBeGreaterThanOrEqual(
      SCAN_FLOORS.uplinksWithDeclarations,
    );
    const contributing = new Set(
      collectDeclarations(repoRoot).map((d) => d.uplink),
    );
    expect(
      contributing.size,
      "declarations came from too few Uplinks: the per-client walk is failing " +
        "silently for the rest",
    ).toBeGreaterThanOrEqual(SCAN_FLOORS.uplinksWithDeclarations);
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
