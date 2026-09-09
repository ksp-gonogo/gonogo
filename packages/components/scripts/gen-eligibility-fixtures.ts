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
  "unknown: KSP answers this only while the Administration Building is open";

interface Row {
  id: string;
  isActive: boolean;
  canActivate: boolean | null;
  activateBlockedReason: string;
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
  const shut = all.map((row) => (row.isActive ? row : unanswered(row)));
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

  console.log(
    `Wrote 1-admin-building-shut.json (${shut.length} rows) and 2-three-buckets.json (${mixed.length} rows) to ${OUT_DIR}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
