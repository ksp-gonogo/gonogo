// @vitest-environment node
//
// The real Node realm rather than the package's jsdom default, for the reason
// `render-fixture-coverage.test.ts` states: esbuild's `transformSync`, used
// below to read the debt list at the base revision, asserts
// `new TextEncoder().encode("") instanceof Uint8Array` and throws "JavaScript
// environment is broken" under jsdom. Nothing here touches the DOM.
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type RatchetBase,
  ratchetBaseRef,
  sourceAtRatchetBase,
} from "./ratchetBaseRef";
import {
  type ContractResolver,
  checkFixturePayloads,
} from "./replay-fixture-conformance";
import {
  buildWireContractResolver,
  type FixtureScan,
  findingKey,
  fixturePayloads,
  scanAllFixtures,
  type WireContractResolver,
} from "./widget-fixture-conformance";
import { FIXTURE_CONTRACT_DRIFT } from "./widget-fixture-conformance.debt";

/**
 * A widget fixture may only send field names the contract declares.
 *
 * <p>Written after the same defect turned up in five widgets in two days.
 * `Strategies` fixtures sent `departmentName` and `effectiveCostReputation`,
 * neither of which `CareerStrategy` declares, and the widget drew a reputation
 * cost of 13.97 where the shape the mod really sends produces 7.3. `Experiments`
 * sent `partTitle` / `expId` / `hasData` for `partName` / `experimentId` /
 * `dataIsCollectable`. `SpaceCenterStatus` fixtures carried a legacy short-code
 * facility shape, so the enum-keyed record the mod actually sends had never once
 * rendered. `ScienceData` sent `part` for `partName`. Kerbalism's `CrewSurvival`
 * sent `deathClockSec`, a C# LOCAL name, where the wire carries `deathClockUt`,
 * so a fatal-countdown badge had never drawn. Every one of them was green in
 * unit tests, in the render harness, and in the visual gate.</p>
 *
 * <p>There was already a gate for exactly this one directory over,
 * `replay-fixture-conformance.test.ts`, and it covers the three e2e Playwright
 * replay servers and nothing else. This is its idea pointed at the ~66
 * `__fixtures__` directories, and it reuses that file's walker unchanged:
 * arrays, unions, nesting and `Dictionary<string, X>` index signatures were all
 * solved there.</p>
 *
 * <h3>What is checked, and where the payloads come from</h3>
 *
 * <p>Per fixture, two sources, both of which reach the same widget through the
 * same hooks:</p>
 *
 * <ul>
 * <li><b>`_stream.emits[]`</b>: the Sitrep stream, `payload` on a Topic and
 *   `value` on a channel, walked against the type the contract declares for
 *   that emit's own topic</li>
 * <li><b>every remaining top-level key</b>: the legacy `DataSource` feed
 *   `packages/ui-kit/src/render/scenes.ts` builds from exactly those keys. One
 *   named after a declared topic is making the same claim about the wire as an
 *   emit and is graded the same way</li>
 * </ul>
 *
 * <p>The harness's own keys are excluded deliberately and by name: `_scene`
 * names the target, `_meta` is prose for a human, `_stream` holds the emits.
 * None of the three describes a payload, so walking them would report the scene
 * language itself as contract violations. The rule is the underscore prefix,
 * which is the convention `scenes.ts` already uses to separate directives from
 * data.</p>
 *
 * <p>The contract is the GENERATED one: `mod/sitrep-sdk/src/topics.ts` plus each
 * Uplink client's `__generated__/topic-map.ts`. Both halves are needed. An
 * Uplink's topics exist only in its own map, so a resolver built from the sdk
 * alone would grade every fixture an Uplink ships against nothing and report a
 * clean run.</p>
 *
 * <h3>It can fail, demonstrated by replanting one of the five</h3>
 *
 * <p>The fifth defect put back where it was: renaming `deathClockUt` to
 * `deathClockSec` on line 51 of
 * `mod/GonogoKerbalismUplink/client/src/CrewSurvival/__fixtures__/radiation-dose-critical.json`,
 * which is the C# local name that spelling came from, makes the gate name it,
 * quote the row it sits on, and print what does belong there:</p>
 *
 * <pre>
 *   Widget fixture(s) sending field names the contract does not declare...
 *     mod/GonogoKerbalismUplink/client/src/CrewSurvival#kerbalism.crew.deathClockSec
 *       mod/.../CrewSurvival/__fixtures__/radiation-dose-critical.json
 *         kerbalism.crew[1].deathClockSec
 *         the contract declares here: name, trait, rules, deathClockUt, asOfUt
 * </pre>
 *
 * <p>Restoring the name returns it to green, 14 passed. The planted-defect
 * cases at the bottom of this file re-run the same rule in memory on every run
 * so the demonstration is not a one-off, and two deliberately blind resolvers
 * are run past the same payload and must catch none of it, because a gate
 * proven to fire only means something once the harness has also been shown to
 * notice a gate that does not.</p>
 *
 * <h3>What it cannot see</h3>
 *
 * <ul>
 * <li><b>A topic the generated maps do not declare is UNGRADED, not a
 *   failure.</b> Whole dynamic namespaces are registered at runtime
 *   (`fleet.<guid>.*`, `silence.*`, `currency.*`, per-vessel part actions) and
 *   no `[SitrepTopic]` type exists for them, and every legacy `DataSource` key
 *   that is not a topic at all (`a.physicsMode`, a centralised-script compute
 *   key, a bare numeric id) lands here too. 543 distinct ids at the seed, against
 *   1016 payloads that were graded. A fixture built entirely from those is
 *   graded against nothing, which is why the number of graded payloads is
 *   asserted below and printed rather than left implicit</li>
 * <li><b>The provider extension bag is opaque by construction.</b>
 *   `ProviderExtensions` is `Record<string, unknown>`, so the walk reaches
 *   `extensions.<provider>` and stops. Grading inside it would need the
 *   runtime's `registerProviderExtensionShape` registry. Those positions are
 *   REPORTED, and the test below pins them to that one shape so a new kind of
 *   hole cannot hide among them</li>
 * <li><b>Names, never values.</b> A fixture sending a correctly spelled field
 *   with a number the game could never produce passes, and a `null` where the
 *   mod always sends a figure passes. The neighbouring
 *   `render-fixture-coverage.test.ts` catches the second of those from the
 *   other side</li>
 * <li><b>Omission is not graded here.</b> A payload missing a field the
 *   contract declares required is a normal, deliberate fixture, driving a
 *   widget into its waiting branch. Same call as the replay gate makes</li>
 * <li><b>It cannot see a widget READING the wrong name.</b> Fixture and widget
 *   drifted together in the `Strategies` case, and only the fixture half is
 *   visible from here</li>
 * </ul>
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");

let resolver: WireContractResolver | undefined;
let scans: FixtureScan[] | undefined;

function contract(): WireContractResolver {
  resolver ??= buildWireContractResolver(ROOT);
  return resolver;
}

/** How many Uplink clients have generated a topic map, counted off disk. */
function uplinkTopicMapCount(): number {
  return readdirSync(join(ROOT, "mod")).filter((entry) =>
    existsSync(
      join(ROOT, "mod", entry, "client/src/__generated__/topic-map.ts"),
    ),
  ).length;
}

function scanAll(): FixtureScan[] {
  scans ??= scanAllFixtures(contract(), ROOT);
  return scans;
}

/**
 * What the contract declares at the position a probe payload reaches.
 *
 * Asked through the walker rather than off the type directly, because the
 * position that matters is nested inside an array inside a payload, and a
 * hand-rolled descent here would be a second implementation of the thing under
 * test. The probe carries one field nothing declares, and the walker answers
 * with the names that do belong there.
 */
function declaredFieldsAt(topic: string, probe: unknown): string[] {
  const report = checkFixturePayloads(contract(), { [topic]: probe });
  return report.undeclaredFields[0]?.declared ?? [];
}

describe("widget fixtures conform to the generated contract", () => {
  beforeAll(() => {
    scanAll();
  }, 300_000);

  /**
   * The instrument, before anything it measures.
   *
   * An allowlist-shaped assertion is satisfied by finding nothing, so a
   * resolver that loaded no contract, or a walk that found no fixtures, would
   * report a perfect tree. These ask whether either had any input at all.
   */
  it("resolves both halves of the contract", () => {
    expect(contract().topicIds.length).toBeGreaterThan(100);
    expect(contract().topicIds).toContain("career.status");
    /*
     * Where the topics came from, rather than how many there are: a resolver
     * that loaded the sdk map and none of the Uplink maps still passes a count
     * comfortably, and then grades a third of the tree against nothing. Asked
     * through the provenance the resolver records so this holds no Uplink name
     * of its own.
     */
    const declaringFiles = new Set(
      contract().topicIds.map((id) => contract().sourceOf(id)),
    );
    expect(declaringFiles.size).toBeGreaterThan(5);
    expect(contract().sources.length).toBe(uplinkTopicMapCount() + 1);

    // The canary on the defect that started this, asked at the position it
    // actually lives at. If the resolver stops seeing CareerStrategy's fields
    // the walk goes blind, and blind reads as green.
    const strategy = declaredFieldsAt("career.status", {
      strategies: { active: [{ probeForTheDeclaredNames: 1 }] },
    });
    expect(strategy).toContain("department");
    expect(strategy).not.toContain("departmentName");
    expect(strategy).not.toContain("effectiveCostReputation");
  });

  it("walked a real number of fixtures, payloads and fields", () => {
    const all = scanAll();
    expect(all.length).toBeGreaterThan(40);
    const payloads = all.reduce((n, s) => n + s.payloadsChecked, 0);
    const fields = all.reduce((n, s) => n + s.fieldsChecked, 0);
    // Floors, not equalities: fixtures are added constantly and an equality
    // here would be a chore rather than a check. 1016 payloads and 14896 field
    // names at the seeding scan.
    expect(payloads).toBeGreaterThan(700);
    expect(fields).toBeGreaterThan(10_000);
    expect(all.filter((s) => s.payloadsChecked > 0).length).toBeGreaterThan(30);
  });

  it("sends no field the contract does not declare", () => {
    const found = new Map<string, string[]>();
    for (const scan of scanAll()) {
      for (const finding of scan.findings) {
        const key = findingKey(finding);
        const occurrences = found.get(key) ?? [];
        occurrences.push(
          `    ${finding.fixture}\n` +
            `      ${finding.topic}${finding.path === "(root)" ? "(root)" : finding.path}.${finding.field}\n` +
            `      the contract declares here: ${finding.declared.join(", ")}`,
        );
        found.set(key, occurrences);
      }
    }

    const declared = new Set(FIXTURE_CONTRACT_DRIFT);
    const undeclared = [...found.keys()].filter((k) => !declared.has(k)).sort();
    const stale = [...declared].filter((k) => !found.has(k)).sort();

    if (undeclared.length > 0) {
      throw new Error(
        "Widget fixture(s) sending field names the contract does not " +
          "declare. The mod cannot produce these, so the fixture describes a " +
          "wire that does not exist and the render made from it is a picture " +
          "of nothing the game sends:\n" +
          undeclared
            .map((key) => `  ${key}\n${found.get(key)?.slice(0, 3).join("\n")}`)
            .join("\n") +
          "\n\nFIX THE FIXTURE, then LOOK at what the corrected shape draws. " +
          "The name is rarely the whole defect: Strategies' `departmentName` " +
          "came with an `effectiveCostReputation` that put 13.97 on screen " +
          "where the real wire produces 7.3.\n" +
          "If the field belongs to a DIFFERENT topic or a different row type " +
          "than the one it is attached to, move it rather than deleting it: " +
          "`rolloutRefusals` is a real RP-1 field, on the warehouse entry, not " +
          "on a build-queue row.\n" +
          "FIXTURE_CONTRACT_DRIFT in " +
          "packages/core/src/widget-fixture-conformance.debt.ts is shrink-only " +
          "and is NOT where a new one goes: the last test in this file refuses " +
          "entries added there.",
      );
    }

    if (stale.length > 0) {
      throw new Error(
        "Stale widget-fixture-conformance entries: these no longer describe " +
          "anything the scan finds (the fixture was fixed, or the widget " +
          "moved). Delete the line(s) from " +
          "packages/core/src/widget-fixture-conformance.debt.ts in the same " +
          "commit, which is what ratchets the gate down:\n" +
          stale.map((e) => `  ${e}`).join("\n"),
      );
    }

    expect(undeclared).toEqual([]);
    expect(stale).toEqual([]);
  }, 60_000);

  /**
   * The holes in the walk, pinned to the one shape that has a reason.
   *
   * A position the walker cannot see into is coverage it does not have, and a
   * hole that stays silent is the failure mode this whole family of checks
   * exists to end. Every one of them today is a provider extension bag, which
   * is `Record<string, unknown>` on purpose (see `mod/sitrep-sdk/src/extensions.ts`):
   * core cannot know a provider's shape, so the walk reaches the provider id
   * and stops. Anything of another shape appearing here is a new blind spot and
   * fails.
   */
  it("cannot see inside a provider extension bag, and sees everywhere else", () => {
    const unresolved = scanAll().flatMap((s) => s.unresolvedPositions);
    const unexplained = unresolved.filter(
      (p) => !/\.extensions\.[A-Za-z0-9_.-]+ \(object\)$/.test(p),
    );
    expect(
      unexplained,
      "The walk stopped somewhere that is not an opaque provider extension " +
        "bag, so these payload positions are ungraded and nobody decided that:\n" +
        unexplained.map((p) => `  ${p}`).join("\n"),
    ).toEqual([]);
    // And the pin is not vacuous: the extension bags ARE being reached.
    expect(unresolved.length).toBeGreaterThan(0);
  });

  it("reports how much of the tree it could not grade", () => {
    const ungraded = new Set<string>();
    for (const scan of scanAll()) {
      for (const topic of scan.ungradedTopics) ungraded.add(topic);
    }
    const all = scanAll();
    process.stdout.write(
      `[widget-fixture-conformance] ${all.length} fixture dirs, ` +
        `${all.reduce((n, s) => n + s.payloadsChecked, 0)} payloads, ` +
        `${all.reduce((n, s) => n + s.fieldsChecked, 0)} fields checked; ` +
        `${ungraded.size} distinct topic ids no generated map declares ` +
        "(dynamic namespaces and legacy DataSource keys), so nothing about " +
        "those was graded\n",
    );
  });
});

/**
 * The gate on the gate.
 *
 * Everything above passes on the entries it already knows about, and a check
 * that passes is indistinguishable from a check that cannot fail. So a defect
 * of the historical shape is planted in memory on every run and has to be
 * caught, and the same payload is then handed to a deliberately blind resolver
 * that must catch none of it.
 */
describe("the widget-fixture check can fail", () => {
  /**
   * `career.status.strategies` exactly as `one-active-room-for-more.json`
   * carries it: a department named after a field the contract has never
   * declared, and a pre-scaled reputation cost that is not on the wire at all.
   */
  const PLANTED_DEFECT = {
    "career.status": {
      strategies: {
        active: [
          {
            id: "AgressiveNegotiations",
            title: "Aggressive Negotiations",
            departmentName: "Operations",
            isActive: true,
            initialCostReputation: 14.5,
            effectiveCostReputation: 27.65,
          },
        ],
        all: [],
        activeCount: 1,
      },
    },
  };

  it("catches every planted field, names it, and says what belongs there", () => {
    const report = checkFixturePayloads(contract(), PLANTED_DEFECT);
    expect(report.topicsChecked).toBe(1);
    expect(report.undeclaredFields.map((f) => f.field).sort()).toEqual([
      "departmentName",
      "effectiveCostReputation",
    ]);
    const first = report.undeclaredFields[0];
    expect(first.path).toBe(".strategies.active[0]");
    expect(first.declared).toContain("department");
  });

  it("catches it through the fixture reader, from either half of a fixture", () => {
    // The reader is the half the report above does not exercise. A fixture
    // expresses the same payload two ways, and a reader that saw only one of
    // them would report a clean run over half the tree.
    const fromStream = fixturePayloads({
      _scene: { widget: "strategies" },
      _meta: { notes: "departmentName is prose here and must not be graded" },
      _stream: {
        emits: [
          { channel: "career.status", value: PLANTED_DEFECT["career.status"] },
        ],
      },
    });
    const fromLegacy = fixturePayloads({
      _scene: { widget: "strategies" },
      ...PLANTED_DEFECT,
    });
    expect(fromStream.map((p) => p.topic)).toEqual(["career.status"]);
    expect(fromLegacy.map((p) => p.topic)).toEqual(["career.status"]);
    for (const source of [fromStream, fromLegacy]) {
      const report = checkFixturePayloads(contract(), {
        [source[0].topic]: source[0].payload,
      });
      expect(report.undeclaredFields.map((f) => f.field).sort()).toEqual([
        "departmentName",
        "effectiveCostReputation",
      ]);
    }
  });

  it("a resolver that knows no topics catches none of it, and reports zero", () => {
    /*
     * The classic false green: an enumeration that matches nothing and reports
     * the resulting zero findings as a pass. `topicsChecked` is what separates
     * "clean" from "never looked".
     */
    const blind: ContractResolver = {
      ...contract(),
      payloadType: () => undefined,
    };
    const report = checkFixturePayloads(blind, PLANTED_DEFECT);
    expect(report.undeclaredFields).toEqual([]);
    expect(report.topicsChecked).toBe(0);
    expect(report.undeclaredTopics).toHaveLength(1);
  });

  it("an sdk-only resolver is blind to every Uplink fixture", () => {
    /*
     * Not a strawman: it is the resolver this gate would have had if the Uplink
     * topic maps had been left out, and it grades a whole third of the tree
     * against nothing while looking exactly as green. The Uplink topic it
     * plants into is whichever one the resolver reports first from a file other
     * than the sdk's, so this names no mod.
     */
    const sdkFile = contract().sources[0];
    const fromUplinks = contract().topicIds.filter(
      (id) => contract().sourceOf(id) !== sdkFile,
    );
    expect(fromUplinks.length).toBeGreaterThan(10);

    const planted = fromUplinks
      .map((topic) => ({
        topic,
        payload: { thisFieldIsOnNoContractAnywhere: 7 } as unknown,
      }))
      .find(
        ({ topic, payload }) =>
          checkFixturePayloads(contract(), { [topic]: payload })
            .undeclaredFields.length === 1,
      );
    expect(planted, "no Uplink topic took a planted root field").toBeDefined();
    if (!planted) return;

    const sdkOnly = new Set(
      contract().topicIds.filter((id) => contract().sourceOf(id) === sdkFile),
    );
    const blind: ContractResolver = {
      ...contract(),
      topicIds: [...sdkOnly],
      payloadType: (topic) =>
        sdkOnly.has(topic) ? contract().payloadType(topic) : undefined,
    };
    const payloads = { [planted.topic]: planted.payload };
    expect(
      checkFixturePayloads(contract(), payloads).undeclaredFields.map(
        (f) => f.field,
      ),
    ).toEqual(["thisFieldIsOnNoContractAnywhere"]);
    expect(checkFixturePayloads(blind, payloads).undeclaredFields).toEqual([]);
    expect(checkFixturePayloads(blind, payloads).topicsChecked).toBe(0);
  });

  it("does not grade the harness's own directives", () => {
    // `_scene.config` is arbitrary widget config and `_meta.notes` is prose. A
    // reader that took them for payloads would report the scene language as
    // contract violations, which is a gate nobody would keep.
    const payloads = fixturePayloads({
      _scene: { widget: "strategies", config: { showDepartment: true } },
      _meta: { notes: "any words at all", scenario: "x" },
      _stream: { emits: [] },
    });
    expect(payloads).toEqual([]);
  });
});

/**
 * Loads the debt module's exports as they stood at the ratchet base, without
 * touching the working tree. Same mechanism as `render-fixture-coverage.test.ts`:
 * transpile the git blob and import it as a `data:` URL, so there is no temp
 * file to clean up.
 */
async function loadDebtAt(
  base: RatchetBase,
  relPath: string,
): Promise<{ FIXTURE_CONTRACT_DRIFT?: readonly string[] } | null> {
  const source = sourceAtRatchetBase(base, relPath);
  if (source === null) return null;
  const { code } = transformSync(source, { loader: "ts", format: "esm" });
  return await import(`data:text/javascript,${encodeURIComponent(code)}`);
}

/** Which entries `current` has that `previous` did not. */
function findDriftGrowth(
  previous: readonly string[],
  current: readonly string[],
): string[] {
  const known = new Set(previous);
  return current.filter((entry) => !known.has(entry));
}

describe("findDriftGrowth: shrink-only comparison logic (synthetic)", () => {
  it("flags an entry that was not there before", () => {
    expect(findDriftGrowth(["a#t.x"], ["a#t.x", "b#t.y"])).toEqual(["b#t.y"]);
  });

  it("does not flag a removal or an unchanged list", () => {
    expect(findDriftGrowth(["a#t.x", "b#t.y"], ["b#t.y"])).toEqual([]);
    expect(findDriftGrowth(["a#t.x"], ["a#t.x"])).toEqual([]);
  });
});

describe("widget fixtures: FIXTURE_CONTRACT_DRIFT only ever shrinks", () => {
  it("gained no entry vs the base ref", async () => {
    const base = ratchetBaseRef();
    if (!base) return; // the checkout IS the base, so there is nothing to diff

    const relPath = relative(
      ROOT,
      join(HERE, "widget-fixture-conformance.debt.ts"),
    );
    const previous = await loadDebtAt(base, relPath);
    if (!previous) {
      /*
       * Genuine on the commit that seeds the list, and a lie afterwards. Which
       * of the two it is gets graded in one place for every list, by
       * `ratchet-base-ref.test.ts`, rather than by a warning here that vitest
       * would suppress on a passing test anyway.
       */
      return;
    }

    const growth = findDriftGrowth(
      previous.FIXTURE_CONTRACT_DRIFT ?? [],
      FIXTURE_CONTRACT_DRIFT,
    );
    if (growth.length > 0) {
      throw new Error(
        `New FIXTURE_CONTRACT_DRIFT entries vs ${base.ref}. This list may only ` +
          "be REMOVED from, as fixtures are corrected to the shape the mod " +
          "actually sends:\n" +
          growth.map((e) => `  ${e}`).join("\n") +
          "\n\nA fixture sending a name the contract does not declare is not a " +
          "gap to record, it is a wire that does not exist. Fix the fixture and " +
          "look at what the corrected shape renders.",
      );
    }
  });

  it("the debt list is a real file the gate is actually reading", () => {
    // The list going missing, or being emptied by accident, would make the
    // check above pass by comparing nothing against nothing.
    expect(
      existsSync(join(HERE, "widget-fixture-conformance.debt.ts")),
      "the debt module is gone",
    ).toBe(true);
    expect(FIXTURE_CONTRACT_DRIFT.length).toBeGreaterThan(0);
    for (const entry of FIXTURE_CONTRACT_DRIFT) {
      // Every entry names a widget directory that still exists: a renamed or
      // deleted widget leaves an entry nothing can ever remove.
      const dir = entry.split("#")[0];
      expect(existsSync(join(ROOT, dir)), `${entry} names no such dir`).toBe(
        true,
      );
    }
  });
});
