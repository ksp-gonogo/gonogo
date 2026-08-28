import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A fixture may not describe a space centre RP-1 could never produce.
 *
 * Three renders of this Uplink have now stated something false because a
 * fixture left a topic out, and each time the picture was plausible enough that
 * it took an operator to notice: "Pad state unknown" from a missing
 * `spaceCenter.launchSites`, a blank personnel section from a missing fixture,
 * and "cannot roll out: this complex has no pads" from a fixture that declared
 * an operational pad complex and emitted no `rp1.pads`. A widget cannot catch
 * any of them, because each is a state the widget is right to render: an
 * operational complex with no pads IS a complex with nowhere to roll out to.
 *
 * So the question is asked of the FIXTURE instead, before anything renders.
 * These are the pairs of topics whose payloads have to agree with each other,
 * and a fixture that emits one and contradicts it with the other is caught
 * here, named, and never photographed.
 *
 * A rule only goes in when the game itself guarantees the pairing. This is not
 * a completeness check: a fixture is free to emit nothing at all, because a
 * scene of an Uplink that has not answered yet is a scene worth having.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** One thing a fixture emits, as the `_stream` block writes it. */
interface Emit {
  topic?: string;
  payload?: unknown;
}

/** A fixture's payload for one complex, in the fields the rules read. */
interface ComplexRow {
  lcId?: string | null;
  name?: string | null;
  lcType?: string | null;
  isOperational?: boolean | null;
}

/** A fixture's payload for one pad, in the fields the rules read. */
interface PadRow {
  lcId?: string | null;
}

/**
 * Every operational pad complex a VEHICLE fixture declares has at least one
 * pad.
 *
 * RP-1 creates a `Pad`-type launch complex WITH its pad and never takes the
 * last one away, so a complex that is operational and has none is not a career
 * state: it is a fixture that forgot `rp1.pads`. The widget renders it as
 * "cannot roll out: this complex has no pads", which is a sentence an operator
 * would go into the game to fix.
 *
 * Scoped to fixtures that put the vehicle lists or the pads themselves on
 * screen, because those are the pictures the contradiction can appear in: a
 * payroll scene shows no rollout and asks no question a pad answers. That
 * scoping is also what keeps the rule compatible with the render harness,
 * which drops, and then refuses, any topic the mounted tree does not read.
 *
 * Hangar complexes are exempt because they genuinely have no pads: an SPH
 * complex rolls its craft to a runway.
 */
function inconsistencies(emits: readonly Emit[]): string[] {
  const complexes = payloadRows<ComplexRow>(emits, "rp1.complexes");
  if (complexes === undefined || !aboutVehicles(emits)) {
    return [];
  }
  const pads = payloadRows<PadRow>(emits, "rp1.pads");
  const problems: string[] = [];
  for (const complex of complexes) {
    if (complex.isOperational !== true || complex.lcType !== "Pad") {
      continue;
    }
    const named = complex.name ?? complex.lcId ?? "an unnamed complex";
    if (pads === undefined) {
      problems.push(
        `${named} is an operational Pad complex and the fixture emits no ` +
          '"rp1.pads" at all, so the widget says it has no pads',
      );
      continue;
    }
    if (!pads.some((pad) => pad.lcId === complex.lcId)) {
      problems.push(
        `${named} is an operational Pad complex and no pad in "rp1.pads" ` +
          `carries its lcId (${complex.lcId ?? "absent"})`,
      );
    }
  }
  return problems;
}

/**
 * Whether this fixture's subject is the vehicles: it emits one of the lists a
 * vehicle appears in, or the pads themselves. An empty list still counts, and
 * has to: a centre with nothing built is a state the vehicles surface draws.
 */
function aboutVehicles(emits: readonly Emit[]): boolean {
  const subjects = ["rp1.warehouse", "rp1.buildQueue", "rp1.pads"];
  return emits.some(
    (emit) => emit.topic !== undefined && subjects.includes(emit.topic),
  );
}

/** The payload of the LAST emit on a topic, or undefined when none emits it. */
function payloadRows<T>(
  emits: readonly Emit[],
  topic: string,
): readonly T[] | undefined {
  let found: readonly T[] | undefined;
  for (const emit of emits) {
    if (emit.topic === topic && Array.isArray(emit.payload)) {
      found = emit.payload as readonly T[];
    }
  }
  return found;
}

interface Fixture {
  where: string;
  emits: Emit[];
}

function fixtures(): Fixture[] {
  const found: Fixture[] = [];
  for (const dir of readdirSync(HERE)) {
    const fixturesDir = join(HERE, dir, "__fixtures__");
    let entries: string[];
    try {
      if (!statSync(fixturesDir).isDirectory()) continue;
      entries = readdirSync(fixturesDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const parsed = JSON.parse(
        readFileSync(join(fixturesDir, entry), "utf8"),
      ) as { _stream?: { emits?: Emit[] } };
      found.push({
        emits: parsed._stream?.emits ?? [],
        where: `${dir}/__fixtures__/${entry}`,
      });
    }
  }
  return found;
}

describe("RP-1 fixture consistency", () => {
  const all = fixtures();

  it("finds the fixtures at all", () => {
    // A walk that matches nothing reports no inconsistencies, and no
    // inconsistencies reads as every fixture being sound. So the count is
    // asserted before anything is checked, and a fixture directory that moves
    // fails here rather than passing everywhere.
    expect(all.length).toBeGreaterThanOrEqual(10);
  });

  it.each(
    all.map((f) => [f.where, f] as const),
  )("%s describes a space centre RP-1 could produce", (_where, fixture) => {
    expect(inconsistencies(fixture.emits)).toEqual([]);
  });

  it("catches an operational pad complex whose fixture emits no pads", () => {
    // The planted violation. A checker that cannot see this one reports zero
    // for every fixture and reads as a clean sweep, which is the shape all
    // three of these defects shipped in.
    const problems = inconsistencies([
      {
        payload: [
          { isOperational: true, lcId: "lc-1", lcType: "Pad", name: "LC-1" },
        ],
        topic: "rp1.complexes",
      },
      { payload: [], topic: "rp1.warehouse" },
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("LC-1");
    expect(problems[0]).toContain("rp1.pads");
  });

  it("catches pads that all belong to some other complex", () => {
    // The half a "did the fixture emit the topic" check would miss: the topic
    // is there, and the complex an operator is looking at still has no pad.
    const problems = inconsistencies([
      {
        payload: [
          { isOperational: true, lcId: "lc-2", lcType: "Pad", name: "LC-2" },
        ],
        topic: "rp1.complexes",
      },
      { payload: [{ lcId: "lc-1" }], topic: "rp1.pads" },
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("LC-2");
  });

  it("leaves alone the states RP-1 really does produce", () => {
    // A complex still being built has no pad yet, and a hangar never has one.
    // Either flagged would make the rule something authors work around.
    expect(
      inconsistencies([
        {
          payload: [
            { isOperational: false, lcId: "lc-1", lcType: "Pad", name: "LC-1" },
            {
              isOperational: true,
              lcId: "lc-2",
              lcType: "Hangar",
              name: "SPH",
            },
          ],
          topic: "rp1.complexes",
        },
        { payload: [], topic: "rp1.warehouse" },
      ]),
    ).toEqual([]);
  });

  it("asks nothing of a fixture whose picture holds no rollout", () => {
    // The payroll scene names its complexes and shows no vehicle and no pad,
    // so there is no sentence in it a pad could contradict. Demanding pads
    // there would mean emitting a topic the widget never reads, which the
    // render harness rejects outright.
    expect(
      inconsistencies([
        {
          payload: [
            { isOperational: true, lcId: "lc-1", lcType: "Pad", name: "LC-1" },
          ],
          topic: "rp1.complexes",
        },
        { payload: { totalEngineers: 24 }, topic: "rp1.personnel" },
      ]),
    ).toEqual([]);
  });
});
