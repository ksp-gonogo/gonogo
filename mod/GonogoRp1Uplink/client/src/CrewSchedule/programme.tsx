import type { Reading } from "@ksp-gonogo/sitrep-sdk";
import { registerAugment, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  magnitudeOf,
  NULL_DISPLAY,
  Row,
  RowName,
  Section,
  SectionTitle,
  Stack,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { RP1 } from "../uplink";
import "../topics";

/**
 * The RULES this career's personnel schedule runs under, below the roster the
 * Astronaut Complex already shows.
 *
 * <para>Every per-kerbal date is meaningless without them. A retirement date on
 * a save with retirement switched off is a date nothing will act on; a training
 * ETA is a function of a career-wide rate visible here and nowhere else; and the
 * extension cap is what decides whether a date can be pushed at all. An
 * operator reading the dates alone cannot tell which of those they are looking
 * at.</para>
 *
 * <para>Whether crew stand down for rest is here rather than per-kerbal for the
 * same reason: the stock roster carries `inactive` for each kerbal, and the host
 * already badges it, but nothing says whether the mechanic is in force at all.
 * A roster with no RESTING badges is either a crew that is all on duty or a save
 * where R&amp;R is off, and those are different facts.</para>
 */
export function CrewProgramme() {
  const available = current(useTelemetry("rp1.available"));
  const program = current(useTelemetry("rp1.crewProgram"));

  // Invisible without RP-1, rather than a section of dashes on a stock game.
  if (available !== true) {
    return null;
  }

  return (
    <Section>
      <SectionTitle>CREW PROGRAMME</SectionTitle>
      <Stack as="ul" gap="sm" style={LIST_STYLE}>
        <Row wrap>
          <RowName>Retirement</RowName>
          <Text>
            <RuleState on={program?.retirementEnabled} />
            {program?.retirementEnabled === true && (
              <>
                {" · up to "}
                <Unit value={program?.retirementExtensionCapSeconds} /> of
                {" extension"}
              </>
            )}
          </Text>
        </Row>
        <Row wrap>
          <RowName>Post-flight R&amp;R</RowName>
          <Text>
            <RuleState on={program?.crewRnREnabled} />
          </Text>
        </Row>
        <Row wrap>
          <RowName>Mission training</RowName>
          <Text>
            <RuleState on={program?.missionTrainingEnabled} />
            {program?.missionTrainingEnabled === true && (
              <>
                {" · "}
                <Unit value={program?.missionTrainingRate} />× rate
              </>
            )}
          </Text>
        </Row>
        <Row wrap>
          <RowName>Proficiency rate</RowName>
          <Text>
            <Unit value={program?.proficiencyTrainingRate} />×
          </Text>
        </Row>
        <Row wrap>
          <RowName>In training</RowName>
          <Text>
            <Unit value={program?.crewInTraining} /> across{" "}
            <Unit value={program?.courses} /> {courseWord(program?.courses)}
            {waiting(program?.courses, program?.coursesStarted) && (
              <>
                {" "}
                <Badge severity="caution">NOT STARTED</Badge>
              </>
            )}
          </Text>
        </Row>
      </Stack>
    </Section>
  );
}

/**
 * A career-wide rule's state. Absent renders the null display rather than
 * "Off": a switch nobody could read is not a switch that is off, and reading it
 * as off would say retirement is disabled on a career that retires people.
 */
function RuleState({ on }: Readonly<{ on: boolean | undefined | null }>) {
  if (on === true) return <>On</>;
  if (on === false) return <>Off</>;
  return <>{NULL_DISPLAY}</>;
}

/** Whether any course is enrolled but not started, which is progress nobody is making. */
function waiting(
  courses: Parameters<typeof magnitudeOf>[0],
  started: Parameters<typeof magnitudeOf>[0],
): boolean {
  const total = magnitudeOf(courses);
  const begun = magnitudeOf(started);
  return total !== null && begun !== null && total > begun;
}

function courseWord(courses: Parameters<typeof magnitudeOf>[0]): string {
  return magnitudeOf(courses) === 1 ? "course" : "courses";
}

/**
 * A Row renders an `<li>`, so its rows need list semantics around them; see
 * SpaceCentrePersonnel for the same reset and why it is inline.
 */
const LIST_STYLE = { listStyle: "none", margin: 0, padding: 0 } as const;

/** The value where one is current; see LaunchComplexStatus for why reckonable counts. */
function current<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

registerAugment({
  id: "rp1-crew-programme",
  augments: "astronaut-complex.sections",
  component: CrewProgramme,
  owner: RP1,
});
