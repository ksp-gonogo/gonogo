import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  NONCONFORMING_FIXTURE_TOPICS as BASE_EXEMPT,
  SNAPSHOT,
} from "../../../tests/playwright/sitrep-stream-server.mjs";
import {
  EXTRA_TOPICS,
  NONCONFORMING_FIXTURE_TOPICS as TOPOLOGY_EXEMPT,
} from "../../../tests/playwright/sitrep-stream-server-topology.mjs";
import {
  buildContractResolver,
  type ConformanceReport,
  checkFixturePayloads,
} from "./replay-fixture-conformance";

/**
 * Every e2e replay fixture must publish payloads the Sitrep contract actually
 * declares.
 *
 * Written after `sitrep-stream-server-topology.mjs` spent months sending
 * `dv.stages` rows spelled `deltaVActual`/`TWRActual`/`thrustASL` plus a
 * `stageMass` and `isp*` fields the contract has never declared at all. The mod
 * has never sent those names. It survived because FuelStatus also answered to a
 * dead transport's spellings; the moment that leniency went, eleven readouts
 * turned into em-dashes and the e2e went red on all three engines.
 *
 * The failure was invisible BY CONSTRUCTION. A widget reading a field the
 * fixture never sent gets `NaN`, and `NaN` renders as an em-dash, which is
 * exactly what "no data yet" looks like. The blank absorbed both "correctly
 * withheld" and "your fixture is misspelled", so nothing downstream could tell
 * the two apart. The only place they ARE distinguishable is beside the
 * contract, which is where this check sits.
 *
 * ## Which direction is fatal
 *
 * A field the fixture sends that the contract does not declare is FATAL. There
 * is no legitimate case: the field cannot reach a real client because the mod
 * cannot produce it, so the fixture is describing a wire that does not exist.
 * A topic id the contract does not declare is fatal for the same reason.
 *
 * A field the contract declares but the fixture omits is REPORTED, not fatal.
 * Partial payloads are a real and deliberate scenario here: both fixtures' doc
 * comments lean on absence to drive widgets into their "waiting"/"no target"
 * branches, and `vessel.target` is fed a literal `null`. A check that forbade
 * omission would force every fixture to carry every field of every topic, which
 * would change what several specs assert, and it would be switched off within a
 * week. The count is printed instead, so a sudden jump is still visible.
 *
 * A fixture that genuinely needs to send a non-conforming payload (to exercise
 * a refusal path) declares it in that file's exported
 * `NONCONFORMING_FIXTURE_TOPICS`: greppable by name, with the reason beside the
 * topic. Both are empty today.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

const resolver = buildContractResolver(repoRoot);

/** The three replay servers, and what each of them puts on the wire. */
const FIXTURES = [
  {
    file: "tests/playwright/sitrep-stream-server.mjs",
    // What `startReplayServer()` serves with no `extraTopics`.
    payloads: SNAPSHOT as Record<string, unknown>,
    exempt: new Set(Object.keys(BASE_EXEMPT)),
  },
  {
    file: "tests/playwright/sitrep-stream-server-topology.mjs",
    // The same base snapshot with the topology/ΔV topics merged over it,
    // exactly as `startReplayServer({ extraTopics })` merges them.
    payloads: { ...SNAPSHOT, ...EXTRA_TOPICS } as Record<string, unknown>,
    exempt: new Set(Object.keys(TOPOLOGY_EXEMPT)),
  },
  {
    // The PeerJS signalling broker. It carries no telemetry topics at all, so
    // its expected payload count is ZERO and is asserted as zero below rather
    // than left to a scan that would match nothing and read as a pass.
    file: "tests/playwright/broker.mjs",
    payloads: {} as Record<string, unknown>,
    exempt: new Set<string>(),
  },
] as const;

function describeUndeclared(report: ConformanceReport): string {
  return report.undeclaredFields
    .map(
      (f) =>
        `  ${f.topic}${f.path === "(root)" ? "" : f.path}.${f.field}` +
        ` is not on the contract. Declared there: ${f.declared.join(", ")}`,
    )
    .join("\n");
}

describe("e2e replay fixtures conform to the Sitrep contract", () => {
  it("resolves a contract to check against", () => {
    // The resolver is the instrument. If it silently resolved nothing, every
    // fixture below would pass by matching nothing, which is the exact shape of
    // false green this file exists to end.
    expect(resolver.topicIds.length).toBeGreaterThan(50);

    // A canary on the one topic whose misspelling started this. If the checker
    // stops seeing StageDeltaVEntry's fields, the walk goes blind and says so
    // here rather than in a green run.
    const stages = resolver.payloadType("dv.stages");
    expect(stages).toBeDefined();
    const element = resolver.checker.getIndexTypeOfType(
      // biome-ignore lint/style/noNonNullAssertion: asserted defined above
      stages!,
      1 /* ts.IndexKind.Number */,
    );
    expect(element).toBeDefined();
    const fields = resolver.checker
      // biome-ignore lint/style/noNonNullAssertion: asserted defined above
      .getPropertiesOfType(element!)
      .map((p) => p.getName());
    expect(fields).toContain("dvActual");
    expect(fields).toContain("twrActual");
    expect(fields).toContain("thrustAsl");
    expect(fields).not.toContain("stageMass");
  });

  for (const fixture of FIXTURES) {
    describe(fixture.file, () => {
      const report = checkFixturePayloads(
        resolver,
        fixture.payloads,
        fixture.exempt,
      );

      it("publishes no topic the contract does not declare", () => {
        expect(
          report.undeclaredTopics.map((t) => t.topic),
          `${fixture.file} publishes topics the contract does not declare. ` +
            "The mod cannot send them, so no client will ever see them.",
        ).toEqual([]);
      });

      it("publishes no field the contract does not declare", () => {
        expect(
          report.undeclaredFields,
          `${fixture.file} sends fields the contract does not declare:\n${describeUndeclared(report)}`,
        ).toEqual([]);
      });

      it("reports how much it checked", () => {
        const expectedTopics = fixture.file.endsWith("broker.mjs")
          ? 0
          : Object.keys(fixture.payloads).length - fixture.exempt.size;
        expect(report.topicsChecked).toBe(expectedTopics);

        // A position the walker could not see into is coverage it does not
        // have. Zero of them today; an entry means the walk stopped early.
        expect(report.unresolvedPositions).toEqual([]);

        const omitted = report.omittedFields
          .map(
            (f) => `${f.topic}${f.path === "(root)" ? "" : f.path}.${f.field}`,
          )
          .join(", ");
        process.stdout.write(
          `[fixture-conformance] ${fixture.file}: ` +
            `${report.topicsChecked} topics, ${report.nodesVisited} nodes, ` +
            `${report.fieldsChecked} fields checked; ` +
            `${report.omittedFields.length} declared-but-omitted (reported, not fatal)` +
            `${omitted ? `: ${omitted}` : ""}\n`,
        );
      });
    });
  }

  it("checks every topic the fixture sources actually mention", () => {
    // A SECOND, different instrument. The checks above read each server's
    // EXPORTED payload map; this one reads its SOURCE. A topic added to a
    // server but not reachable through the export would pass the first check by
    // never being seen, and this is what notices.
    const checked = new Set<string>();
    for (const fixture of FIXTURES) {
      for (const topic of Object.keys(fixture.payloads)) checked.add(topic);
      for (const topic of fixture.exempt) checked.add(topic);
    }

    const declared = new Set(resolver.topicIds);
    const missed: string[] = [];
    const foundPerFile = new Map<string, number>();
    for (const fixture of FIXTURES) {
      const source = readFileSync(join(repoRoot, fixture.file), "utf8");
      // Quoted keys of the `"a.b": value` shape, which is how every topic entry
      // in these fixtures is written.
      let found = 0;
      for (const match of source.matchAll(
        /"([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)"\s*:/g,
      )) {
        const key = match[1];
        if (!declared.has(key)) continue;
        found += 1;
        if (checked.has(key)) continue;
        missed.push(`${fixture.file}: ${key}`);
      }
      foundPerFile.set(fixture.file, found);
    }
    expect(missed).toEqual([]);

    // The scan's own catch: `missed` is empty both when every mentioned topic
    // is checked AND when the pattern stopped matching anything, and those are
    // opposite outcomes. So say up front what each file is expected to yield.
    // broker.mjs is a PeerJS signalling broker and mentions no topics: its zero
    // is a real zero, not a broken regex, and only pinning the other two
    // separates the two readings.
    expect(Object.fromEntries(foundPerFile)).toEqual({
      "tests/playwright/sitrep-stream-server.mjs": Object.keys(SNAPSHOT).length,
      "tests/playwright/sitrep-stream-server-topology.mjs":
        Object.keys(EXTRA_TOPICS).length,
      "tests/playwright/broker.mjs": 0,
    });
  });

  it("keeps the deliberate non-conformance lists empty", () => {
    // Not a style preference: an entry here is a fixture claiming to describe a
    // wire the mod cannot produce, and it must be argued for in review rather
    // than added quietly.
    expect(BASE_EXEMPT).toEqual({});
    expect(TOPOLOGY_EXEMPT).toEqual({});
  });
});

/**
 * The gate on the gate.
 *
 * Everything above passes today, and a check that passes is indistinguishable
 * from a check that cannot fail. So the historical defect is replanted in
 * memory on every run and the check has to catch it, and the same fixture is
 * then run past a deliberately blind checker that must catch none of it. A gate
 * proven to fire only means something once the harness has also been shown to
 * notice a gate that does not.
 */
describe("the conformance check can fail", () => {
  /**
   * `dv.stages` exactly as `sitrep-stream-server-topology.mjs` carried it
   * before 2026-08-21: three fields misspelled after a dead transport's
   * vocabulary, and three the contract has never declared at all.
   */
  const PLANTED_DEFECT = {
    "dv.stages": [
      {
        stage: 1,
        dvVac: 1450.2,
        dvAsl: 1120.5,
        deltaVActual: 1310.8,
        twrVac: 1.5848,
        twrAsl: 1.2246,
        TWRActual: 1.4321,
        thrustVac: 215,
        thrustASL: 166.2,
        stageMass: 13.8299436569214,
        ispVac: 345,
        ispAsl: 265,
      },
    ],
  };

  const PLANTED_FIELDS = [
    "TWRActual",
    "deltaVActual",
    "ispAsl",
    "ispVac",
    "stageMass",
    "thrustASL",
  ];

  /** The real topology fixture with the historical `dv.stages` put back. */
  const DEFECTIVE_FIXTURE = {
    ...SNAPSHOT,
    ...EXTRA_TOPICS,
    ...PLANTED_DEFECT,
  } as Record<string, unknown>;

  it("catches every planted field, and names it", () => {
    const report = checkFixturePayloads(resolver, DEFECTIVE_FIXTURE);
    expect(report.topicsChecked).toBe(Object.keys(DEFECTIVE_FIXTURE).length);
    expect(report.undeclaredFields.map((f) => f.field).sort()).toEqual(
      PLANTED_FIELDS,
    );
    // The message has to be actionable on its own: which row, and what the
    // contract does declare in its place.
    const first = report.undeclaredFields[0];
    expect(first.topic).toBe("dv.stages");
    expect(first.path).toBe("[0]");
    expect(first.declared).toContain("dvActual");
  });

  it("a checker that does not descend into arrays catches none of them", () => {
    // The NEGATIVE CONTROL, and not a strawman: `dv.stages` is a BARE ARRAY of
    // rows, so a checker that compared only the payload's top level would have
    // sailed past this defect for exactly as long as the real one did, while
    // reporting a clean run over the same fixtures. It is handed the SAME
    // defective fixture the real check just caught six fields in.
    const blind = checkShallowOnly(resolver, DEFECTIVE_FIXTURE);
    // It is not idle: it looked at most of the fixture and simply cannot see
    // the level the defect lives on.
    expect(blind.topicsChecked).toBeGreaterThan(10);
    expect(blind.undeclaredFields).toEqual([]);
  });

  it("a checker whose topic lookup never matches catches none of them", () => {
    // The other classic: an enumeration that silently matches nothing and
    // reports the resulting zero findings as a pass. `topicsChecked` is in the
    // report so this case is visible as 0 rather than as success.
    const nothingResolver = {
      ...resolver,
      payloadType: () => undefined,
    };
    const report = checkFixturePayloads(nothingResolver, PLANTED_DEFECT);
    expect(report.undeclaredFields).toEqual([]);
    expect(report.topicsChecked).toBe(0);
    expect(report.undeclaredTopics).toHaveLength(1);
  });
});

/**
 * A deliberately blind check: top-level object fields only, arrays skipped.
 *
 * Exists to be run past the same fixtures the real check runs past, and to
 * catch nothing.
 */
function checkShallowOnly(
  contract: typeof resolver,
  payloads: Record<string, unknown>,
): { topicsChecked: number; undeclaredFields: string[] } {
  const undeclaredFields: string[] = [];
  let topicsChecked = 0;
  for (const [topic, payload] of Object.entries(payloads)) {
    const type = contract.payloadType(topic);
    if (!type) continue;
    if (typeof payload !== "object" || payload === null) continue;
    if (Array.isArray(payload)) continue;
    topicsChecked += 1;
    const declared = new Set(
      contract.checker.getPropertiesOfType(type).map((p) => p.getName()),
    );
    for (const key of Object.keys(payload)) {
      if (!declared.has(key)) undeclaredFields.push(`${topic}.${key}`);
    }
  }
  return { topicsChecked, undeclaredFields };
}
