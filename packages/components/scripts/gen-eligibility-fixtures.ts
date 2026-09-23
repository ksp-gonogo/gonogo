#!/usr/bin/env tsx
/**
 * Write the two `Strategies/__render_unknown__` fixtures from the RP-1 one.
 *
 * Generated rather than hand-authored because the case being rendered is a
 * SCALE case: `3e0a841fa` was found on a live RP-1 career where about
 * thirty-five programmes read LOCKED while every card under that heading said
 * the state was unknown, and a hand-typed roster of four cannot show a heading
 * that is wrong about thirty-five rows. `rp1-full-admin-building.json` already
 * carries 91 real RP-1 rows, so the honest fixture is that roster with the one
 * field the defect is about rewritten, and nothing else touched.
 *
 * Run via `pnpm --filter @ksp-gonogo/components gen-eligibility-fixtures`.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(
  HERE,
  "../src/Strategies/__fixtures__/rp1-full-admin-building.json",
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

interface Row {
  id: string;
  isActive: boolean;
  canActivate: boolean | null;
  activateBlockedReason: string;
  activateVerdictSource?: string;
  [key: string]: unknown;
}

interface Fixture {
  _meta?: Record<string, unknown>;
  _stream: {
    carriedChannels: string[];
    emits: { channel: string; value: Record<string, unknown> }[];
  };
}

/** The `career.status` payload of a fixture, as the one emit it carries. */
function careerOf(fixture: Fixture): Record<string, unknown> {
  const emit = fixture._stream.emits.find((e) => e.channel === "career.status");
  if (!emit) throw new Error("source fixture carries no career.status emit");
  return emit.value;
}

function strategiesOf(career: Record<string, unknown>): {
  active: Row[];
  all: Row[];
  activeCount: number;
} {
  return career.strategies as {
    active: Row[];
    all: Row[];
    activeCount: number;
  };
}

/** A fixture holding `all`, with everything else off the source untouched. */
function withRoster(
  source: Fixture,
  all: Row[],
  meta: Record<string, unknown>,
): Fixture {
  const career = structuredClone(careerOf(source));
  const strategies = strategiesOf(career);
  strategies.all = all;
  strategies.active = all.filter((s) => s.isActive);
  strategies.activeCount = strategies.active.length;
  return {
    _meta: meta,
    _stream: {
      carriedChannels: source._stream.carriedChannels,
      emits: [{ channel: "career.status", value: career }],
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
 * The source roster was captured with the Administration Building OPEN, so its
 * verdicts are the game's own, which is what makes it the honest basis for this
 * scene. Off-screen the model puts the same arms one at a time and reaches two
 * of the three answers:
 *
 * - a refusal from arms 2-9 survives verbatim, because stock returns on its
 *   FIRST refusal, so an arm that fires off-screen would have fired on it
 * - everything else stops short of a verdict. Arm 1 is the concurrent-strategy
 *   cap, it compares a counter that only exists while that screen is up, and a
 *   pass is owed to every arm -- so a row nothing refused is UNANSWERED, not a
 *   yes, and a row the cap itself refused never gets that far
 *
 * The cap refusals are therefore rewritten rather than kept: they are the one
 * kind of no this route cannot reach.
 */
const CAP_REFUSAL = /active strategies at this level/i;

const ARM_ONE_UNREACHED =
  "unknown: KSP counts your running strategies only inside the " +
  "Administration Building, so that check is not made in this list";

const derived = (row: Row): Row =>
  row.canActivate === false && !CAP_REFUSAL.test(row.activateBlockedReason)
    ? { ...row, activateVerdictSource: "derived" }
    : {
        ...row,
        canActivate: null,
        activateBlockedReason: ARM_ONE_UNREACHED,
        activateVerdictSource: "none",
      };

async function main(): Promise<void> {
  const source = JSON.parse(await readFile(SOURCE, "utf8")) as Fixture;
  const all = strategiesOf(careerOf(source)).all;
  await mkdir(OUT_DIR, { recursive: true });

  /*
   * The whole roster unanswered, which is the shape the facility actually
   * produces: KSP answers eligibility for everything on the screen or for
   * nothing on it, so a real shut Administration Building leaves no row with a
   * real boolean. The two running programmes stay active, because `isActive`
   * is read off the strategy itself and not off the question nobody asked.
   */
  const shut = all.map((row) => (row.isActive ? row : legacyUnanswered(row)));
  await writeFile(
    join(OUT_DIR, "1-admin-building-shut.json"),
    `${JSON.stringify(
      withRoster(source, shut, {
        scenario: "admin-building-shut",
        synthetic: true,
        notes:
          "DERIVED from Strategies/__fixtures__/rp1-full-admin-building.json (91 real RP-1 rows) by setting canActivate to null and activateBlockedReason to the career model's own unanswered sentence on every INACTIVE row, which is the shape a shut Administration Building actually publishes: KSP answers eligibility for the whole screen or for none of it. Nothing else is changed, so every title, cost and effect line is the source fixture's. This is the case 3e0a841fa was found on: before it, all 89 of these sat under a heading reading Locked.",
      }),
      null,
      2,
    )}\n`,
  );

  /*
   * All three buckets on one screen, which the shut-facility case cannot show
   * because it leaves Available empty. Taken off the same roster so the
   * comparison is one career rather than two: the rows KSP said yes to keep
   * their yes, the rows it refused keep their refusal, and a slice of the
   * remainder is rewritten to unanswered.
   */
  const answeredYes = all.filter((s) => !s.isActive && s.canActivate === true);
  const refused = all.filter(
    (s) =>
      !s.isActive &&
      s.canActivate === false &&
      s.activateBlockedReason !== "" &&
      !/active strategies at this level/i.test(s.activateBlockedReason),
  );
  const mixed = [
    ...all.filter((s) => s.isActive).slice(0, 1),
    ...answeredYes.slice(0, 2),
    ...refused.slice(0, 2),
    ...answeredYes.slice(2, 5).map(unanswered),
  ];
  await writeFile(
    join(OUT_DIR, "2-three-buckets.json"),
    `${JSON.stringify(
      withRoster(source, mixed, {
        scenario: "three-buckets",
        synthetic: true,
        notes:
          "DERIVED from the same RP-1 fixture, cut down to one row of each kind so Available, Locked and Eligibility unknown are all on screen at once: 1 active, 2 the game said yes to, 2 it refused (their real RP-1 unlock text), and 3 rewritten to the unanswered state. A real career cannot hold this mixture, since the facility answers for the whole roster or none of it; it exists to put the three headings side by side.",
      }),
      null,
      2,
    )}\n`,
  );

  /*
   * The SAME shut facility, as the career model reports it now that the arms
   * are asked one at a time. This is the after half of the pair: a roster that
   * used to arrive as one undifferentiated silence now carries the game's own
   * refusal on everything the career genuinely refuses, and says plainly which
   * single check it could not make on the rest.
   */
  const shutDerived = all.map((row) => (row.isActive ? row : derived(row)));
  await writeFile(
    join(OUT_DIR, "3-admin-building-shut-derived.json"),
    `${JSON.stringify(
      withRoster(source, shutDerived, {
        scenario: "admin-building-shut-derived",
        synthetic: true,
        notes:
          "DERIVED from the same 91-row RP-1 fixture as 1-admin-building-shut.json, and deliberately its twin: same career, same shut facility, same rows, differing only in what the career model can now say about them. A row the source captured as refused by arms 2-9 keeps that verdict and the game's own wording, marked activateVerdictSource=derived, because stock returns on its first refusal so an arm that fires off-screen would have fired on it. Every other row is unanswered with activateVerdictSource=none, naming arm 1: the concurrent-strategy cap compares a counter that exists only while that screen is up, and a pass is owed to every arm. Rendered beside fixture 1 this is the whole of the change from the operator's side: one silent heap becomes a real Locked list plus a much smaller unknown one, and every Activate button stays dark because KSP's own commitment runs inside that building either way.",
      }),
      null,
      2,
    )}\n`,
  );

  console.log(
    `Wrote 1-admin-building-shut.json (${shut.length} rows), 2-three-buckets.json (${mixed.length} rows) and 3-admin-building-shut-derived.json (${shutDerived.length} rows) to ${OUT_DIR}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
