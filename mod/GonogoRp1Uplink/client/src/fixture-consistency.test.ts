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
 * A fixture's payload for one facility, in the fields the rules read. Both tier
 * shapes, because the host's parser takes both and fixtures use both.
 */
interface FacilityRow {
  currentTier?: number | null;
  maxTier?: number | null;
  upgradeCost?: number | null;
  level?: number | null;
  max?: number | null;
}

/** A fixture's payload for one construction, in the fields the rules read. */
interface ConstructionRow {
  kind?: string | null;
  facilityType?: string | null;
  currentLevel?: number | null;
  targetLevel?: number | null;
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
function inconsistencies(emits: readonly Emit[], surface = ""): string[] {
  const problems: string[] = [];
  const complexes = payloadRows<ComplexRow>(emits, "rp1.complexes");

  /* Each rule carries its OWN scope. This used to be an early return over the
     complex list, which reads as scoping for the pad rule and silently governed
     every rule written after it: a facility fixture emits no "rp1.complexes",
     so a rule about facilities never ran and reported a clean fixture. */
  if (complexes !== undefined && aboutVehicles(emits)) {
    const pads = payloadRows<PadRow>(emits, "rp1.pads");
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
  }

  // The vehicles surface offers to START a build, and reads the craft listing
  // to know what could be started and where. A fixture that describes a whole
  // space centre and omits it photographs "waiting for the craft listing" over
  // a career that is fully described, which is the same shape as the three
  // defects above: a state the widget is right to draw, about a save the
  // fixture never meant to be in.
  //
  // Scoped to the SURFACE rather than to the topics emitted, unlike the pad
  // rule above. Only one widget reads the craft listing, and the render harness
  // refuses a topic the mounted tree does not read, so asking this of a launch
  // complex's own scene would demand an emit that scene cannot carry.
  if (
    drawsTheCraftListing(surface) &&
    !emits.some((emit) => emit.topic === "rp1.buildable")
  ) {
    problems.push(
      'the fixture emits no "rp1.buildable" at all, so the widget says it is ' +
        "still waiting for the craft listing. An empty array is the right " +
        "answer for a career with no craft saved",
    );
  }

  // A managed career whose HOST is still offering to buy a tier outright.
  //
  // `rp1.available` is not "RP-1 is installed": its channel source is
  // `IsAvailable && IsEnabledForSave()`, so `true` says RP-1 is MANAGING this
  // save. On such a save `Rp1CareerProjectGate.Evaluate` returns Fail for
  // `career.facility.upgrade` every time, because RP-1 does not sell a tier at
  // all. So a fixture that puts a stock Upgrade control on screen without the
  // gate is photographing a space centre RP-1 could never produce, and the
  // picture says two contradictory things at once: the host's grid offers a
  // purchase and colours the ones the balance cannot meet as unaffordable,
  // while the section below it says the same tier is queued and billed as it
  // builds and never refused for money.
  //
  // Scoped to whether the CONTROL is on screen rather than to the host, unlike
  // the craft-listing rule above. Every `space-center-status` scene mounts the
  // facility grid and most emit no facilities at all, so a cell with no tier
  // left draws no control and has nothing to contradict.
  if (offersAStockTierPurchase(emits) && !blocks(emits, FACILITY_COMMAND)) {
    problems.push(
      "the fixture reports RP-1 managing the save and emits no blocked " +
        `"${FACILITY_COMMAND}" verdict on "system.uplink.gates", so the host ` +
        "draws live stock Upgrade controls, and a red price over the ones the " +
        "balance cannot meet, for a purchase RP-1 refuses",
    );
  }

  // A facility under construction that the career says is at a different tier.
  //
  // Game-guaranteed, and the guarantee is in RP-1's own enqueue:
  // `SpaceCenterBuildingPatch.ProcessUpgrade` builds the project as
  // `new FacilityUpgradeProject(type, id, FacilityLevel + 1, FacilityLevel, ...)`,
  // and nothing moves the building until `FacilityUpgradeProject.Apply()` runs
  // at completion. So for the whole life of the project the facility is still at
  // `currentLevel`, and the project is taking it to exactly one tier higher.
  //
  // Worth a rule because both numbers reach one screen. The host's grid draws
  // the career's tier and this Uplink's SITE CONSTRUCTION card draws the
  // project's, so a fixture that disagrees with itself photographs one building
  // at two tiers, and one committed render had a VAB reading "2 / 3" over a card
  // taking it to a fourth tier it does not have.
  for (const problem of tierDisagreements(emits)) {
    problems.push(problem);
  }

  return problems;
}

/**
 * Every FacilityUpgrade row whose tier contradicts the career's, or claims a
 * step that is not the next one.
 *
 * <para>Silent about a row whose facility the career never described: a
 * construction queue read from outside the space centre is a real scene, and
 * every tier is absent there.</para>
 */
function tierDisagreements(emits: readonly Emit[]): string[] {
  const rows = payloadRows<ConstructionRow>(emits, "rp1.constructions");
  if (rows === undefined) return [];
  const facilities = careerFacilities(emits);
  const problems: string[] = [];
  for (const row of rows) {
    if (row.kind !== "FacilityUpgrade") continue;
    const name = row.facilityType;
    if (name === undefined || name === null) continue;
    const from = row.currentLevel;
    if (typeof from !== "number") continue;
    const at = facilityTier(facilities[name]);
    if (at !== undefined && at !== from) {
      problems.push(
        `${name} is being built from level ${from} while "career.status" says ` +
          `it is at level ${at}, so the host's grid and this Uplink's card ` +
          "state two different tiers for one building",
      );
    }
    if (typeof row.targetLevel === "number" && row.targetLevel !== from + 1) {
      problems.push(
        `${name} is being built from level ${from} to level ${row.targetLevel}` +
          ", and RP-1 only ever queues the next one",
      );
    }
  }
  return problems;
}

/**
 * A facility's current tier, from whichever shape the fixture writes. The
 * host's own parser takes both the wire's `currentTier`/`maxTier` and the
 * legacy `level`/`max`, so a rule that read only one would silently pass every
 * fixture written in the other.
 */
function facilityTier(facility: FacilityRow | undefined): number | undefined {
  if (typeof facility?.currentTier === "number") return facility.currentTier;
  if (typeof facility?.level === "number") return facility.level;
  return undefined;
}

/** The stock purchase RP-1 re-models as a construction project. */
const FACILITY_COMMAND = "career.facility.upgrade";

/** GateOutcome.Fail, the only outcome that darkens a control in advance. */
const GATE_FAIL = 1;

/**
 * The fixture describes a save RP-1 manages AND leaves a facility with a tier
 * left to buy, which is what puts the host's own Upgrade control on screen.
 *
 * <para>A PRICED tier, because that is what the host gates its own control on:
 * a facility whose `upgradeCost` did not arrive draws no Upgrade button and has
 * nothing to contradict.</para>
 */
function offersAStockTierPurchase(emits: readonly Emit[]): boolean {
  if (!emits.some((e) => e.topic === "rp1.available" && e.payload === true)) {
    return false;
  }
  const facilities = careerFacilities(emits);
  return Object.values(facilities).some(
    (f) =>
      typeof f?.currentTier === "number" &&
      typeof f?.maxTier === "number" &&
      f.currentTier < f.maxTier &&
      typeof f?.upgradeCost === "number" &&
      f.upgradeCost > 0,
  );
}

/** The facilities map off the last `career.status` the fixture emits. */
function careerFacilities(
  emits: readonly Emit[],
): Record<string, FacilityRow | undefined> {
  let found: Record<string, FacilityRow | undefined> = {};
  for (const emit of emits) {
    if (emit.topic !== "career.status") continue;
    const payload = emit.payload as
      | { facilities?: Record<string, FacilityRow> | null }
      | undefined;
    found = payload?.facilities ?? {};
  }
  return found;
}

/** Whether the fixture publishes a standing FAIL verdict for this command. */
function blocks(emits: readonly Emit[], command: string): boolean {
  for (const emit of emits) {
    if (emit.topic !== "system.uplink.gates") continue;
    const payload = emit.payload as
      | { gates?: Array<{ command?: string; verdict?: { outcome?: number } }> }
      | undefined;
    if (
      (payload?.gates ?? []).some(
        (gate) =>
          gate.command === command && gate.verdict?.outcome === GATE_FAIL,
      )
    ) {
      return true;
    }
  }
  return false;
}

/** The one widget that reads the craft listing, and offers to start a build. */
const VEHICLES_WIDGET = "rp1-vehicle-assembly";

/**
 * Whether this scene puts the craft listing on screen, which is a question
 * about the SLOT and not about the widget.
 *
 * <para>All three of the vehicle sections are bound into
 * `rp1-vehicle-assembly.sections`, and a scene naming any one of them mounts
 * the slot, so every section in it draws. A warehouse scene that omits the
 * craft listing therefore photographs "waiting for the craft listing" under
 * three fully described vehicles, which is the same false sentence over the
 * same fully described career that the widget rule was written for, one slot
 * down. The augment ids are the widget id plus a suffix, which is what lets one
 * prefix answer for the whole slot.</para>
 */
function drawsTheCraftListing(surface: string): boolean {
  return (
    surface === VEHICLES_WIDGET || surface.startsWith(`${VEHICLES_WIDGET}-`)
  );
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
  /** What the scene mounts, widget or augment, which decides which rules apply. */
  surface: string;
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
      ) as {
        _scene?: { augment?: string; widget?: string };
        _stream?: { emits?: Emit[] };
      };
      found.push({
        emits: parsed._stream?.emits ?? [],
        surface: parsed._scene?.widget ?? parsed._scene?.augment ?? "",
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
    expect(inconsistencies(fixture.emits, fixture.surface)).toEqual([]);
  });

  it("catches a vehicles fixture that never emits the craft listing", () => {
    // The second planted violation, and a DIFFERENT shape from the first: the
    // pad rule fails on a contradiction between two topics, this one on a topic
    // that is absent entirely, and a checker that could only see the first
    // would report a clean sweep over every fixture missing the second.
    const problems = inconsistencies(
      [
        { payload: [], topic: "rp1.warehouse" },
        {
          payload: [
            { isOperational: false, lcId: "lc-1", lcType: "Pad", name: "LC-1" },
          ],
          topic: "rp1.complexes",
        },
      ],
      "rp1-vehicle-assembly",
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("rp1.buildable");
  });

  it("catches a vehicle SECTION's scene that never emits the craft listing", () => {
    /* The same violation one slot down, and the one a widget-keyed rule could
       not see: a section scene mounts the slot, so the craft listing is on
       screen saying it is still waiting whether or not the scene meant to draw
       it. */
    const problems = inconsistencies(
      [
        { payload: [], topic: "rp1.warehouse" },
        {
          payload: [
            { isOperational: true, lcId: "lc-1", lcType: "Pad", name: "LC-1" },
          ],
          topic: "rp1.complexes",
        },
        { payload: [{ lcId: "lc-1" }], topic: "rp1.pads" },
      ],
      "rp1-vehicle-assembly-warehouse",
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("rp1.buildable");
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
      { payload: [], topic: "rp1.buildable" },
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
      { payload: [], topic: "rp1.buildable" },
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("LC-2");
  });

  it("catches a construction whose facility says it is at another tier", () => {
    /* The planted violation for the tier rule, and it is planted in the LEGACY
       facility shape on purpose: three of the four fixtures carrying a
       construction row write `level`/`max`, so a rule that only read
       `currentTier` would report a clean sweep over exactly the fixtures that
       were wrong. */
    const problems = inconsistencies([
      {
        payload: {
          facilities: { VehicleAssemblyBuilding: { level: 1, max: 2 } },
        },
        topic: "career.status",
      },
      {
        payload: [
          {
            currentLevel: 2,
            facilityType: "VehicleAssemblyBuilding",
            kind: "FacilityUpgrade",
            targetLevel: 3,
          },
        ],
        topic: "rp1.constructions",
      },
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("VehicleAssemblyBuilding");
    expect(problems[0]).toContain("is at level 1");
  });

  it("catches a construction that skips a tier", () => {
    // A different shape from the one above, and one the career cannot settle:
    // the facility is absent, and RP-1 still only ever queues the next tier.
    const problems = inconsistencies([
      {
        payload: [
          {
            currentLevel: 0,
            facilityType: "Runway",
            kind: "FacilityUpgrade",
            targetLevel: 2,
          },
        ],
        topic: "rp1.constructions",
      },
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("only ever queues the next one");
  });

  it("leaves alone a construction read from outside the space centre", () => {
    // Every tier is absent there, and a queue that keeps building wherever the
    // operator stands is a scene worth having.
    expect(
      inconsistencies([
        { payload: { facilities: {} }, topic: "career.status" },
        {
          payload: [
            {
              currentLevel: 1,
              facilityType: "VehicleAssemblyBuilding",
              kind: "FacilityUpgrade",
              targetLevel: 2,
            },
          ],
          topic: "rp1.constructions",
        },
      ]),
    ).toEqual([]);
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
        { payload: [], topic: "rp1.buildable" },
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
