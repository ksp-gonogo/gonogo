#!/usr/bin/env tsx
/**
 * Write the full-roster Strategies fixture and the three
 * `Strategies/__render_unknown__` fixtures derived from it.
 *
 * Generated rather than hand-authored because the case being rendered is a
 * SCALE case: `3e0a841fa` was found on a career whose Administration Building
 * carried about ninety strategies, where the whole roster read LOCKED while
 * every card under that heading said the state was unknown. A hand-typed
 * roster of four cannot show a heading that is wrong about ninety rows, so the
 * roster here is synthesised at that size from invented names, and each
 * derived fixture is that roster with the one field its defect is about
 * rewritten.
 *
 * Run via `pnpm --filter @ksp-gonogo/components gen-eligibility-fixtures`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROSTER_OUT = resolve(
  HERE,
  "../src/Strategies/__fixtures__/full-admin-building.json",
);
const OUT_DIR = resolve(HERE, "../src/Strategies/__render_unknown__");

/**
 * Verbatim what the career model publishes beside a null eligibility, copied
 * from `eligibility-unknown.test.tsx` so the picture and the test are saying
 * the same sentence.
 */
const UNANSWERED_REASON =
  "unknown: this career's strategy limits could not be read";

/**
 * What the model USED to publish on every row whenever that screen was shut,
 * kept so the before-and-after pair can be rendered from one generator. Nothing
 * emits this any more.
 */
const LEGACY_UNANSWERED_REASON =
  "unknown: KSP answers this only while the Administration Building is open";

/** Stock's own wording for the concurrent-strategy cap, arm 1. */
const CAP_REFUSAL_TEXT =
  "The Administration Facility cannot support more than 3 active strategies at this level.";

/** Stock's own wording for a reputation shortfall, one of arms 2-9. */
const REPUTATION_REFUSAL_TEXT =
  "Requires more reputation than the program has earned.";

interface Row {
  id: string;
  title: string;
  description: string;
  department: string;
  isActive: boolean;
  factor: number;
  dateActivated: number;
  requiredReputation: number;
  initialCostFunds: number;
  initialCostScience: number;
  initialCostReputation: number;
  hasFactorSlider: boolean;
  factorSliderDefault: number;
  factorSliderSteps: number;
  canActivate: boolean | null;
  activateBlockedReason: string;
  canDeactivate: boolean;
  deactivateBlockedReason: string;
  effect: string;
  activateVerdictSource?: string;
}

/** What the game said about a row with the Administration Building open. */
type Verdict =
  | { kind: "active"; since: number }
  | { kind: "eligible" }
  | { kind: "capped" }
  | { kind: "refused"; reason: string };

interface Department {
  name: string;
  titleOf: (subject: string) => string;
  /** One row each. A subject named `Locked` is the department's locked row. */
  subjects: readonly string[];
  /** The unlock sentence on the department's locked row. */
  lockedReason?: string;
  /** Indexes into `subjects` holding a verdict other than eligible or locked. */
  verdicts: Readonly<Record<number, Verdict>>;
  /** A programme carries a funding slider and a funds price; a lead carries a reputation price. */
  programme: boolean;
  effect: string;
}

const EFFECT = (line: string) =>
  `<b><color=#feb200>Effects: </color></b>\n<b><color=#BEC2AE>* ${line}</color></b>\n`;

/**
 * The roster, by department. Every subject is a row, so the counts here ARE
 * the fixture: 31 programmes plus 60 leads across six more departments, the
 * size of Administration Building that `3e0a841fa` was found on.
 */
const DEPARTMENTS: readonly Department[] = [
  {
    name: "Surveys",
    titleOf: (s) => `${s} Survey`,
    programme: true,
    effect: EFFECT("Pays 600,000 over 5 years as survey milestones land."),
    subjects: [
      "Upper Atmosphere",
      "High Altitude",
      "Suborbital",
      "Equatorial Orbit",
      "Polar Orbit",
      "Sun-Synchronous",
      "Geostationary Belt",
      "Weather Band",
      "Magnetosphere",
      "Radiation Belt",
      "Relay Network",
      "Navigation Grid",
      "Mapping Constellation",
      "Near Moon Flyby",
      "Near Moon Orbit",
      "Near Moon Surface",
      "Far Moon Flyby",
      "Far Moon Surface",
      "Inner Planet Flyby",
      "Inner Planet Orbit",
      "Inner Planet Surface",
      "Red Planet Flyby",
      "Red Planet Surface",
      "Asteroid Field",
      "Comet Intercept",
      "Gas Giant Flyby",
      "Gas Giant Moons",
      "Ringed Giant",
      "Ice Giant",
      "Outer Dwarf",
      "Deep Space",
    ],
    verdicts: {
      0: { kind: "active", since: 5_600_000 },
      1: { kind: "active", since: 6_500_000 },
      2: { kind: "capped" },
      3: { kind: "capped" },
      4: { kind: "capped" },
      7: { kind: "refused", reason: REPUTATION_REFUSAL_TEXT },
      14: { kind: "refused", reason: REPUTATION_REFUSAL_TEXT },
      21: { kind: "refused", reason: REPUTATION_REFUSAL_TEXT },
      28: { kind: "refused", reason: REPUTATION_REFUSAL_TEXT },
    },
  },
  {
    name: "Administration",
    titleOf: (s) => `Administrator ${s}`,
    programme: false,
    effect: EFFECT("Facility upkeep x0.95."),
    lockedReason: "Administrators will unlock once a survey completes.",
    subjects: ["Ardent", "Brisk", "Canny", "Deft", "Even", "Locked"],
    verdicts: { 0: { kind: "active", since: 6_100_000 } },
  },
  {
    name: "Main Contractor",
    titleOf: (s) => `${s} Works`,
    programme: false,
    effect: EFFECT("Part costs x0.9."),
    lockedReason: "Some contractors will unlock after the next research tier.",
    subjects: [
      "Alder",
      "Birch",
      "Cedar",
      "Dogwood",
      "Elm",
      "Fir",
      "Ginkgo",
      "Hazel",
      "Ironwood",
      "Juniper",
      "Larch",
      "Maple",
      "Locked",
    ],
    verdicts: { 3: { kind: "capped" } },
  },
  {
    name: "Engineering",
    titleOf: (s) => `Chief Designer ${s}`,
    programme: false,
    effect: EFFECT("Build rate x1.1."),
    lockedReason: "Chief Designers will unlock after the first research tier.",
    subjects: [
      "Aster",
      "Bellis",
      "Crocus",
      "Dahlia",
      "Erica",
      "Freesia",
      "Gerbera",
      "Heather",
      "Iris",
      "Locked",
    ],
    verdicts: { 8: { kind: "capped" } },
  },
  {
    name: "Flight Director",
    titleOf: (s) => `Flight Director ${s}`,
    programme: false,
    effect: EFFECT("Crew training time x0.9."),
    lockedReason: "Flight Directors will unlock after the first crewed flight.",
    subjects: [
      "Amber",
      "Beryl",
      "Coral",
      "Dune",
      "Ember",
      "Flint",
      "Garnet",
      "Locked",
    ],
    verdicts: {},
  },
  {
    name: "Science",
    titleOf: (s) => `Lead Scientist ${s}`,
    programme: false,
    effect: EFFECT("Science from surveys x1.1."),
    lockedReason: "Some scientists will unlock after a suborbital return.",
    subjects: [
      "Argon",
      "Boron",
      "Cobalt",
      "Dysprosium",
      "Erbium",
      "Fluorine",
      "Gallium",
      "Helium",
      "Indium",
      "Locked",
    ],
    verdicts: { 8: { kind: "capped" } },
  },
  {
    name: "Subcontractor",
    titleOf: (s) => `${s} Subcontract`,
    programme: false,
    effect: EFFECT("Tooling costs x0.9."),
    lockedReason:
      "Some subcontractors will unlock after the next research tier.",
    subjects: [
      "Anvil",
      "Bellows",
      "Chisel",
      "Drill",
      "Easel",
      "Forge",
      "Gauge",
      "Hammer",
      "Jig",
      "Kiln",
      "Lathe",
      "Mallet",
      "Locked",
    ],
    verdicts: { 7: { kind: "capped" } },
  },
];

/** The filler every blurb is built from, taken in a fixed order so a regeneration is byte-identical. */
const SENTENCES = [
  "This effort asks the agency to carry its work somewhere it has not yet been able to reach.",
  "Early flights will be short and cautious, and each one is expected to return more than it cost.",
  "Success is measured against a schedule agreed at the outset, and a missed milestone is reported rather than hidden.",
  "The work draws on the same launch facilities as everything else, so it competes for pad time with the rest of the agency.",
  "Instruments carried on these flights are built to a common standard so that later missions can reuse them.",
  "A lead appointed here brings their own priorities, and the rest of the agency adjusts around them.",
  "Findings are published to every department at once, so no single team owns what is learned.",
  "The first phase is deliberately modest; the later phases assume the first one went well.",
];

/**
 * A blurb for the row at `serial`. The two running programmes and every
 * eleventh row run past a thousand characters, so the list always holds a cut
 * description with a control to expand it.
 */
function blurbFor(subject: string, serial: number): string {
  const long = serial < 2 || serial % 11 === 0;
  const target = long ? 1_100 : 140 + ((serial * 97) % 520);
  const parts = [`${subject}: an effort with a single clear aim.`];
  let i = serial;
  while (parts.join(" ").length < target) {
    parts.push(SENTENCES[i % SENTENCES.length]);
    i += 3;
  }
  return parts.join(" ");
}

function rowFor(
  department: Department,
  subject: string,
  index: number,
  serial: number,
): Row {
  const locked = subject === "Locked" && department.lockedReason !== undefined;
  const verdict: Verdict =
    department.verdicts[index] ??
    (locked
      ? { kind: "refused", reason: department.lockedReason ?? "" }
      : { kind: "eligible" });
  const isActive = verdict.kind === "active";
  const slider = department.programme && verdict.kind === "eligible";
  return {
    id: `${department.name}${subject}`.replace(/[^A-Za-z]/g, ""),
    title: locked ? `Locked ${department.name}` : department.titleOf(subject),
    description: blurbFor(subject, serial),
    department: department.name,
    isActive,
    factor: slider ? 0.5 : 1.0,
    dateActivated: isActive ? verdict.since : 0,
    requiredReputation: 0,
    initialCostFunds: department.programme ? 20_000 + (serial % 7) * 15_000 : 0,
    initialCostScience: 0,
    initialCostReputation:
      department.programme || verdict.kind !== "eligible"
        ? 0
        : 20 + (serial % 11) * 3.5,
    hasFactorSlider: slider,
    factorSliderDefault: slider ? 0.5 : 1.0,
    factorSliderSteps: slider ? 10 : 1,
    canActivate: verdict.kind === "eligible",
    activateBlockedReason:
      verdict.kind === "active"
        ? "Strategy already active."
        : verdict.kind === "capped"
          ? CAP_REFUSAL_TEXT
          : verdict.kind === "refused"
            ? verdict.reason
            : "",
    canDeactivate: isActive,
    deactivateBlockedReason: isActive ? "" : "Strategy is not active",
    effect: locked ? "" : department.effect,
  };
}

function buildRoster(): Row[] {
  const rows: Row[] = [];
  for (const department of DEPARTMENTS) {
    department.subjects.forEach((subject, index) => {
      rows.push(rowFor(department, subject, index, rows.length));
    });
  }
  return rows;
}

interface Fixture {
  _meta: Record<string, unknown>;
  _stream: {
    emits: { channel: string; value: Record<string, unknown> }[];
  };
}

/** A `career.status` fixture holding `all`, with the running rows split out the way the wire carries them. */
function withRoster(all: Row[], meta: Record<string, unknown>): Fixture {
  const active = all.filter((s) => s.isActive);
  return {
    _meta: meta,
    _stream: {
      emits: [
        {
          channel: "career.status",
          value: {
            /*
             * The standing rates ride along because this roster is the one
             * Strategies fixture that carries them, and render-fixture
             * coverage asks that every field the widget reads is fed somewhere.
             */
            economy: {
              funds: 1_284_900,
              reputation: 812,
              science: 1_460,
              subsidyPerDay: 3_180,
              upkeepPerDay: 2_940,
            },
            contracts: null,
            strategies: { active, all, activeCount: active.length },
            tech: null,
          },
        },
      ],
    },
  };
}

const unanswered = (row: Row): Row => ({
  ...row,
  canActivate: null,
  activateBlockedReason: UNANSWERED_REASON,
});

/** The whole-roster silence a shut facility used to produce. */
const legacyUnanswered = (row: Row): Row => ({
  ...row,
  canActivate: null,
  activateBlockedReason: LEGACY_UNANSWERED_REASON,
});

/**
 * What the career model can say about a row with the screen shut.
 *
 * The source roster stands for the Administration Building OPEN, so its
 * verdicts are the game's own, which is what makes it the honest basis for
 * this scene. Off-screen the model puts the same arms one at a time and
 * reaches two of the three answers:
 *
 * - a refusal from arms 2-9 survives verbatim, because stock returns on its
 *   FIRST refusal, so an arm that fires off-screen would have fired on it
 * - everything else stops short of a verdict. Arm 1 is the concurrent-strategy
 *   cap, it compares a counter that only exists while that screen is up, and a
 *   pass is owed to every arm, so a row nothing refused is UNANSWERED, not a
 *   yes, and a row the cap itself refused never gets that far
 *
 * The cap refusals are therefore rewritten rather than kept: they are the one
 * kind of no this route cannot reach.
 */
const ARM_ONE_UNREACHED =
  "unknown: KSP counts your running strategies only inside the " +
  "Administration Building, so that check is not made in this list";

const derived = (row: Row): Row =>
  row.canActivate === false && row.activateBlockedReason !== CAP_REFUSAL_TEXT
    ? { ...row, activateVerdictSource: "derived" }
    : {
        ...row,
        canActivate: null,
        activateBlockedReason: ARM_ONE_UNREACHED,
        activateVerdictSource: "none",
      };

async function writeFixture(path: string, fixture: Fixture): Promise<void> {
  await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`);
}

async function main(): Promise<void> {
  const all = buildRoster();
  const inactive = all.filter((s) => !s.isActive);
  const capped = inactive.filter(
    (s) => s.activateBlockedReason === CAP_REFUSAL_TEXT,
  );
  const refused = inactive.filter(
    (s) =>
      s.canActivate === false && s.activateBlockedReason !== CAP_REFUSAL_TEXT,
  );

  await writeFixture(
    ROSTER_OUT,
    withRoster(all, {
      scenario: "full-admin-building",
      synthetic: true,
      notes: `SYNTHETIC, written by scripts/gen-eligibility-fixtures.ts: ${all.length} rows on career.status.strategies.all across ${DEPARTMENTS.length} departments, against the two to four every other Strategies fixture carries. Every name is invented. ${all.length - inactive.length} rows are running, ${capped.length} are refused by the concurrent-strategy cap, ${refused.length} by another arm (a reputation shortfall, or a department that is still locked), and the rest are eligible. Several blurbs run past a thousand characters, so this is the fixture where a description is cut and there is something to expand. Not a live capture.`,
    }),
  );

  await mkdir(OUT_DIR, { recursive: true });

  /*
   * The whole roster unanswered, which is the shape the facility actually
   * produces: KSP answers eligibility for everything on the screen or for
   * nothing on it, so a real shut Administration Building leaves no row with a
   * real boolean. The running programmes stay active, because `isActive` is
   * read off the strategy itself and not off the question nobody asked.
   */
  const shut = all.map((row) => (row.isActive ? row : legacyUnanswered(row)));
  await writeFixture(
    join(OUT_DIR, "1-admin-building-shut.json"),
    withRoster(shut, {
      scenario: "admin-building-shut",
      synthetic: true,
      notes: `DERIVED from Strategies/__fixtures__/full-admin-building.json (${all.length} synthetic rows) by setting canActivate to null and activateBlockedReason to the career model's own unanswered sentence on every INACTIVE row, which is the shape a shut Administration Building actually publishes: KSP answers eligibility for the whole screen or for none of it. Nothing else is changed, so every title, cost and effect line is the source fixture's. This is the case 3e0a841fa was found on: before it, all ${inactive.length} of these would sit under a heading reading Locked.`,
    }),
  );

  /*
   * All three buckets on one screen, which the shut-facility case cannot show
   * because it leaves Available empty. Taken off the same roster so the
   * comparison is one career rather than two: the rows KSP said yes to keep
   * their yes, the rows it refused keep their refusal, and a slice of the
   * remainder is rewritten to unanswered.
   */
  const answeredYes = inactive.filter((s) => s.canActivate === true);
  const mixed = [
    ...all.filter((s) => s.isActive).slice(0, 1),
    ...answeredYes.slice(0, 2),
    ...refused.slice(0, 2),
    ...answeredYes.slice(2, 5).map(unanswered),
  ];
  await writeFixture(
    join(OUT_DIR, "2-three-buckets.json"),
    withRoster(mixed, {
      scenario: "three-buckets",
      synthetic: true,
      notes:
        "DERIVED from the same synthetic roster, cut down to one row of each kind so Available, Locked and Eligibility unknown are all on screen at once: 1 active, 2 the game said yes to, 2 it refused, and 3 rewritten to the unanswered state. A real career cannot hold this mixture, since the facility answers for the whole roster or none of it; it exists to put the three headings side by side.",
    }),
  );

  /*
   * The SAME shut facility, as the career model reports it now that the arms
   * are asked one at a time. This is the after half of the pair: a roster that
   * used to arrive as one undifferentiated silence now carries the game's own
   * refusal on everything the career genuinely refuses, and says plainly which
   * single check it could not make on the rest.
   */
  const shutDerived = all.map((row) => (row.isActive ? row : derived(row)));
  await writeFixture(
    join(OUT_DIR, "3-admin-building-shut-derived.json"),
    withRoster(shutDerived, {
      scenario: "admin-building-shut-derived",
      synthetic: true,
      notes: `DERIVED from the same ${all.length}-row synthetic roster as 1-admin-building-shut.json, and deliberately its twin: same career, same shut facility, same rows, differing only in what the career model can now say about them. A row the source holds as refused by arms 2-9 keeps that verdict and its wording, marked activateVerdictSource=derived, because stock returns on its first refusal so an arm that fires off-screen would have fired on it. Every other row is unanswered with activateVerdictSource=none, naming arm 1: the concurrent-strategy cap compares a counter that exists only while that screen is up, and a pass is owed to every arm. Rendered beside fixture 1 this is the whole of the change from the operator's side: one silent heap becomes a real Locked list plus a much smaller unknown one, and every Activate button stays dark because KSP's own commitment runs inside that building either way.`,
    }),
  );

  console.log(
    `Wrote full-admin-building.json (${all.length} rows), 1-admin-building-shut.json (${shut.length} rows), 2-three-buckets.json (${mixed.length} rows) and 3-admin-building-shut-derived.json (${shutDerived.length} rows)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
