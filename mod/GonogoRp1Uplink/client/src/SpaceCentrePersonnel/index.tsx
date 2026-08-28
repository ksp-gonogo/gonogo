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
import type { Rp1ComplexEntry } from "../__generated__/contract";
import { RP1 } from "../uplink";
import "../topics";

/**
 * RP-1's payroll, which stock has no counterpart for and which is what an
 * operator plans hiring against.
 *
 * <para>Engineers are the build rate: a launch complex with nobody assigned
 * builds nothing however much is queued on it, and an unassigned engineer costs
 * salary while producing nothing. Neither fact is visible anywhere else on the
 * dashboard, which is why the per-complex assignment is here rather than only
 * the totals.</para>
 *
 * <para>Counts go to `Unit` exactly as they are read. A count RP-1 has not
 * answered for prints the null token, which distinguishes a section still
 * waiting from a payroll of zero.</para>
 */
export function SpaceCentrePersonnel() {
  const available = current(useTelemetry("rp1.available"));
  const personnel = current(useTelemetry("rp1.personnel"));
  const centres = current(useTelemetry("rp1.centres"));
  const complexes = current(useTelemetry("rp1.complexes"));

  // Invisible without RP-1, rather than a section of dashes on a stock game.
  if (available !== true) {
    return null;
  }

  return (
    <Section>
      <SectionTitle>PERSONNEL</SectionTitle>
      <Stack as="ul" gap="sm" style={LIST_STYLE}>
        <Row>
          <RowName>Engineers</RowName>
          <Text>
            <Unit value={personnel?.totalEngineers} />
          </Text>
        </Row>
        <Row>
          <RowName>Researchers</RowName>
          <Text>
            <Unit value={personnel?.researchers} />
          </Text>
        </Row>
        <Row>
          <RowName>Applicants</RowName>
          <Text>
            <Unit value={personnel?.applicants} />
          </Text>
        </Row>

        {(centres ?? []).map((centre) => (
          <Stack as="li" gap="xs" key={centre.kscName ?? ""}>
            <RowName>
              {centre.kscName ?? NULL_DISPLAY}
              {centre.isActive === true ? " (active)" : ""}
            </RowName>
            <Stack as="ul" gap="xs" style={LIST_STYLE}>
              <Row>
                <RowName>Unassigned</RowName>
                <Text>
                  <Unit value={centre.unassignedEngineers} />
                  {isIdle(centre.unassignedEngineers) && (
                    <>
                      {" "}
                      <Badge severity="caution">IDLE</Badge>
                    </>
                  )}
                </Text>
              </Row>
              {(complexes ?? [])
                .filter((c) => c.kscName === centre.kscName)
                .map((complex) => (
                  <ComplexCrew complex={complex} key={complex.lcId ?? ""} />
                ))}
            </Stack>
          </Stack>
        ))}
      </Stack>
    </Section>
  );
}

/**
 * One complex's crew, and how good it has got. Efficiency is absent rather than
 * zero when RP-1 has no record for the complex yet, which is a real state on a
 * complex nobody has worked, and rendering it as zero would say the crew is
 * hopeless rather than unrated.
 */
function ComplexCrew({ complex }: Readonly<{ complex: Rp1ComplexEntry }>) {
  return (
    <Row>
      <RowName>{complex.name ?? NULL_DISPLAY}</RowName>
      <Text>
        <Unit value={complex.engineers} /> /{" "}
        <Unit value={complex.maxEngineers} />
        {complex.efficiency !== undefined && complex.efficiency !== null && (
          <>
            {" · "}
            <Unit value={complex.efficiency} /> efficiency
          </>
        )}
        {complex.isRushing === true && (
          <>
            {" "}
            <Badge severity="caution">RUSHING</Badge>
          </>
        )}
      </Text>
    </Row>
  );
}

/**
 * A Row renders an `<li>`, so its rows need list semantics around them; see
 * LaunchComplexStatus for the same reset and why it is inline.
 */
const LIST_STYLE = { listStyle: "none", margin: 0, padding: 0 } as const;

/** Engineers on the payroll and assigned to nothing: salary for no work. */
function isIdle(unassigned: Parameters<typeof magnitudeOf>[0]): boolean {
  const n = magnitudeOf(unassigned);
  return n !== null && n > 0;
}

/** The value where one is current; see LaunchComplexStatus for why reckonable counts. */
function current<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

registerAugment({
  id: "rp1-space-centre-personnel",
  augments: "space-center-status.sections",
  component: SpaceCentrePersonnel,
  owner: RP1,
});
