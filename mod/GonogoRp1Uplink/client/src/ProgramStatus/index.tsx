import type { Reading } from "@ksp-gonogo/sitrep-sdk";
import { registerAugment, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  MissionDate,
  magnitudeOf,
  NULL_DISPLAY,
  ProgressBar,
  Row,
  RowName,
  Section,
  SectionTitle,
  Stack,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type {
  Rp1ProgramEntry,
  Rp1ProgramSlots,
} from "../__generated__/contract";
import { RP1 } from "../uplink";
import "../topics";

/**
 * The Programs a career's funding is committed against, beside the subsidy the
 * Programme Funding widget already shows.
 *
 * <para>The two are different mechanics and the widget it augments only knew
 * about one of them. RP-1's subsidy is a floor that grows with the calendar and
 * is lerped upward by reputation, and it arrives whether or not any Program is
 * running; a Program pays a fixed total over a fixed duration on a curve, and
 * is the larger half of the income. An operator reading only the subsidy sees
 * money arriving with no idea what is paying it or when it stops.</para>
 *
 * <para>What an accepted Program owes the operator back is the deadline. Past
 * it the funding is spent and reputation drains per year overrun, so a running
 * Program with no visible clock is the shape of a career that quietly starts
 * losing.</para>
 */
export function ProgramStatus() {
  const available = current(useTelemetry("rp1.available"));
  const programs = current(useTelemetry("rp1.programs"));
  const slots = current(useTelemetry("rp1.programSlots"));
  // Accepting a Program is the ONLY thing in RP-1 that spends Confidence, so
  // this is the one screen where the balance decides anything. Same rule the
  // repo already applies to funds: a price the operator has to leave the widget
  // to weigh is a price they will weigh wrong.
  const confidence = current(useTelemetry("rp1.confidence"));

  // Invisible without RP-1, rather than an empty section on a stock game.
  if (available !== true) {
    return null;
  }

  const rows = programs ?? [];
  const active = rows.filter((p) => p.state === "active");
  const offerable = rows.filter((p) => p.state === "offerable");

  return (
    <Section>
      <SectionTitle>RP-1 PROGRAMS</SectionTitle>
      <Stack as="ul" gap="sm" style={LIST_STYLE}>
        <Row>
          <RowName>Slots</RowName>
          <Text>
            <Unit value={slots?.usedSlots} /> of{" "}
            <Unit value={slots?.maxSlots} /> used
            {isFull(slots?.freeSlots) && (
              <>
                {" "}
                <Badge severity="caution">FULL</Badge>
              </>
            )}
          </Text>
        </Row>
        <Row>
          <RowName>Confidence</RowName>
          <Text>
            <Unit value={confidence?.confidence} />
          </Text>
        </Row>

        {active.length === 0 ? (
          // A career with no Program running is a real state and an expensive
          // one: it is earning the subsidy alone. Distinct from RP-1 being
          // absent, which returns null above.
          <Row>
            <RowName>Running</RowName>
            <Text>Nothing. Subsidy only.</Text>
          </Row>
        ) : (
          active.map((program) => (
            <ActiveProgram key={program.name ?? ""} program={program} />
          ))
        )}

        {offerable.length > 0 && (
          <Stack as="li" gap="xs">
            <RowName>Acceptable now</RowName>
            <Stack as="ul" gap="xs" style={LIST_STYLE}>
              {offerable.map((program) => (
                <Row key={program.name ?? ""}>
                  <RowName>
                    {program.title ?? program.name ?? NULL_DISPLAY}
                  </RowName>
                  <Text>
                    <Unit value={program.totalFunding} /> ·{" "}
                    <Unit value={program.confidenceCost} />
                    {outOfReach(
                      program.confidenceCost,
                      confidence?.confidence,
                    ) && (
                      <>
                        {" "}
                        <Badge severity="caution">SHORT</Badge>
                      </>
                    )}
                  </Text>
                </Row>
              ))}
            </Stack>
          </Stack>
        )}
      </Stack>
    </Section>
  );
}

/**
 * One running Program: what it has paid, what it still owes, and how long it
 * has left to pay it.
 */
function ActiveProgram({ program }: Readonly<{ program: Rp1ProgramEntry }>) {
  const ratio = magnitudeOf(program.fracElapsed);
  const overrun = ratio !== null && ratio >= 1;
  return (
    <Stack as="li" gap="xs">
      <Stack as="ul" gap="xs" style={LIST_STYLE}>
        <Row>
          <RowName>{program.title ?? program.name ?? NULL_DISPLAY}</RowName>
          <Text>
            {program.canComplete === true ? (
              <Badge severity="info">READY TO COMPLETE</Badge>
            ) : overrun ? (
              <Badge severity="caution">OVERRUN</Badge>
            ) : (
              <>{program.speed ?? NULL_DISPLAY}</>
            )}
          </Text>
        </Row>
        <Row>
          <RowName>Paid</RowName>
          <Text>
            <Unit value={program.fundsPaidOut} /> of{" "}
            <Unit value={program.totalFunding} />
          </Text>
        </Row>
        <Row>
          <RowName>Deadline</RowName>
          <Text>
            {program.deadlineUt !== undefined && program.deadlineUt !== null ? (
              <MissionDate value={program.deadlineUt} />
            ) : (
              // RP-1 recomputes the deadline on its own funding tick, so a
              // Program that has not been funded since it was accepted has none
              // to show. Absent, never a date we made up.
              <>{NULL_DISPLAY} not set yet</>
            )}
          </Text>
        </Row>
        {overrun && (
          <Row>
            {/* Only once it bites. Before the deadline this is a rate nothing
                is charging, and showing it reads as a loss already taken. */}
            <RowName>Overrun cost</RowName>
            <Text>
              <Unit value={program.repPenaltyAssessed} /> lost, at{" "}
              <Unit value={program.repPenaltyPerYearLate} /> per year
            </Text>
          </Row>
        )}
      </Stack>
      {ratio !== null && (
        <ProgressBar
          ariaLabel={`Program funding drawn down, ${program.title ?? program.name ?? "program"}`}
          value={Math.min(ratio, 1) * 100}
        />
      )}
    </Stack>
  );
}

/**
 * A Row renders an `<li>`, so its rows need list semantics around them; see
 * LaunchComplexStatus for the same reset and why it is inline.
 */
const LIST_STYLE = { listStyle: "none", margin: 0, padding: 0 } as const;

/**
 * No capacity left. Absent stays quiet: an unknown ceiling is not a full one,
 * and RP-1 cannot answer the ceiling outside a loaded career.
 */
function isFull(freeSlots: Rp1ProgramSlots["freeSlots"]): boolean {
  const free = magnitudeOf(freeSlots);
  return free !== null && free <= 0;
}

/**
 * The career cannot currently afford this Program at its selected speed. Silent
 * unless BOTH halves are present: an unknown balance is not a short one, and a
 * price we could not read is not free.
 *
 * <para>Deliberately not RP-1's own verdict. RP-1 decides affordability with a
 * currency-modifier query that broadcasts to every modifier in the save, which
 * the Uplink does not run, so a leader who discounts Confidence moves the
 * Administration building's answer and not this one. The comparison is the
 * honest one against the two numbers actually on the wire.</para>
 */
function outOfReach(
  cost: Rp1ProgramEntry["confidenceCost"],
  balance: Rp1ProgramEntry["confidenceCost"],
): boolean {
  const price = magnitudeOf(cost);
  const held = magnitudeOf(balance);
  return price !== null && held !== null && held < price;
}

/** The value where one is current; see LaunchComplexStatus for why reckonable counts. */
function current<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

registerAugment({
  id: "rp1-program-status",
  augments: "career-economy.sections",
  component: ProgramStatus,
  owner: RP1,
});
