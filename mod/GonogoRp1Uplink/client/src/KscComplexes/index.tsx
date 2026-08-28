import {
  registerAugment,
  useCommand,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  magnitudeOf,
  NULL_DISPLAY,
  Row,
  RowName,
  Section,
  SectionTitle,
  Stack,
  Text,
  Unit,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import type { Rp1Personnel, Rp1RushTerms } from "../__generated__/contract";
import { current } from "../shared/current";
import { RP1 } from "../uplink";
// Side-effect import: hydrates these Topics' units at decode time. Here rather
// than left to the entry point's import order, because this file is the
// consumer that would silently receive bare numbers without it.
import "../topics";
import { Centre } from "./Centre";

/** Rush a whole complex. Must match `Rp1VehicleCommands.RushCommand`. */
export const RP1_COMPLEX_RUSH_COMMAND = "rp1.complex.rush";

/** Set a complex's crew. Must match `Rp1PersonnelCommands.AssignCommand`. */
export const RP1_PERSONNEL_ASSIGN_COMMAND = "rp1.personnel.assign";

/**
 * RP-1's space centres, their launch complexes, and the management of both.
 *
 * <para><b>The hierarchy is the subject.</b> RP-1 has three layers where stock
 * has one, and an operator who cannot tell them apart cannot act on any of them:
 *
 * <list type="bullet">
 * <item>the FACILITIES are one set per career, drawn by the host widget above
 * this section: one VAB, one R&amp;D, one Mission Control, whatever the career
 * owns;</item>
 * <item>a SPACE CENTRE is a place, with its own pool of hired engineers. A
 * career has one until KSCSwitcher gives it more;</item>
 * <item>a LAUNCH COMPLEX is one of several AT a centre, with its own crew, its
 * own build envelope, its own efficiency and its own rush mode.</item>
 * </list>
 *
 * So this section is drawn as that nesting rather than as a flat list, and every
 * complex says which centre it belongs to even in the common case of one.</para>
 *
 * <para><b>Staffing is the fact it exists to make visible.</b> RP-1 advances a
 * complex's work at <c>Engineers / MaxEngineers</c>: a complex with nobody
 * assigned builds NOTHING however many engineers the career has hired, and an
 * engineer assigned to nothing draws salary for no work. Neither is visible
 * anywhere else on the dashboard, and both are changed from here.</para>
 *
 * <para><b>The payroll used to be a widget of its own</b> and is a section here
 * now, on the operator's ruling: staffing a complex IS complex management, and a
 * standalone payroll panel left the hiring totals in one place and the
 * assignments that spend them in another. Its scenes came with it.</para>
 *
 * <para>The balance every control here spends against is the host widget's,
 * drawn once in its header. Assignment spends nothing at the moment it lands and
 * rushing spends nothing either; what both change is the rate the payroll runs
 * at, which the cost lines carry.</para>
 */
export function KscComplexes() {
  const available = current(useTelemetry("rp1.available"));
  const centres = current(useTelemetry("rp1.centres"));
  const complexes = current(useTelemetry("rp1.complexes"));
  const pads = current(useTelemetry("rp1.pads"));
  const personnel = current(useTelemetry("rp1.personnel"));
  const terms = current(useTelemetry("rp1.rushTerms"));

  // Unconditional and above the early return on purpose: a hook after it would
  // change count on the first frame RP-1 answers.
  const rush = useCommand(RP1_COMPLEX_RUSH_COMMAND);
  const assign = useCommand(RP1_PERSONNEL_ASSIGN_COMMAND);
  usePanelDelay(rush);
  usePanelDelay(assign);

  // Invisible on every install without RP-1, which is most of them.
  if (available !== true) {
    return null;
  }

  const centreRows = centres ?? [];
  const complexRows = complexes ?? [];
  const padRows = pads ?? [];

  return (
    <Section gap="sm">
      <SectionTitle>SPACE CENTRES</SectionTitle>

      {/* Said once, at the top, because it is the distinction the rest of the
          section depends on and the one an operator loses. */}
      <Text size="xs" tone="muted">
        The facilities above are one set for the whole career. Everything below
        belongs to a centre.
      </Text>

      <Payroll personnel={personnel} />
      <RushTerms terms={terms} />

      {centreRows.length === 0 ? (
        // A real answer rather than an empty stack: RP-1 present and answering
        // with no centre at all is a state, and a blank space is not a way to
        // report it.
        <Text size="sm" tone="muted">
          RP-1 has not reported a space centre.
        </Text>
      ) : (
        <Stack as="ul" gap="md" style={LIST_STYLE}>
          {centreRows.map((centre) => (
            <Centre
              assign={assign}
              centre={centre}
              complexes={complexRows.filter(
                (complex) => complex.kscName === centre.kscName,
              )}
              key={centre.kscName ?? ""}
              pads={padRows}
              rush={rush}
            />
          ))}
        </Stack>
      )}
    </Section>
  );
}

/**
 * The career-wide payroll: who is on the books, and what they draw.
 *
 * <para>The top rung, and the only one of the three that is not per-centre.
 * These are the counts an operator plans HIRING against, which is a different
 * act from assignment and one this widget deliberately does not perform: hiring
 * spends funds up front, and belongs with the other spend controls.</para>
 *
 * <para>Counts and costs go to `Unit` exactly as they are read. A figure RP-1
 * has not answered for prints the null token, which distinguishes a payroll
 * still waiting from a payroll of zero.</para>
 */
function Payroll({
  personnel,
}: Readonly<{ personnel: Rp1Personnel | undefined }>) {
  const idle = magnitudeOf(personnel?.idleSalaryMult);

  return (
    <Stack as="ul" gap="xs" style={LIST_STYLE}>
      <Row>
        <RowName>Engineers</RowName>
        <Text>
          <Unit value={personnel?.totalEngineers} /> ·{" "}
          <Unit value={personnel?.engineerSalaryPerDay} />
        </Text>
      </Row>
      <Row>
        <RowName>Researchers</RowName>
        <Text>
          <Unit value={personnel?.researchers} /> ·{" "}
          <Unit value={personnel?.researcherSalaryPerDay} />
        </Text>
      </Row>
      <Row>
        <RowName>Applicants</RowName>
        <Text>
          <Unit value={personnel?.applicants} />
        </Text>
      </Row>
      {idle !== null && (
        // The term that makes an idle pool a cost rather than a reserve. Beside
        // the totals because it applies to all of them, not to one centre.
        <Stack as="li" gap="xs">
          <Text size="xs" tone="muted">
            An engineer assigned to nothing still draws{" "}
            <Unit value={personnel?.idleSalaryMult} /> of full salary
          </Text>
        </Stack>
      )}
    </Stack>
  );
}

/**
 * What rushing costs, once for the whole section.
 *
 * <para>Career-wide settings rather than a property of any one complex, so a
 * copy per card was the same sentence as many times as the career has complexes.
 * The same correction the funds balance already got in this widget, and for the
 * same reason: repetition inside one panel reads as a defect.</para>
 *
 * <para>Stated whether or not anything is currently rushing, because the moment
 * an operator needs the price is the moment nothing is. Three terms, and the
 * third is the one RP-1's own tooltip does not mention: a rushing complex earns
 * NO efficiency while it runs, and efficiency is what makes a crew cheaper over
 * a career. The multipliers come off the wire rather than being written in,
 * because a career may change them.</para>
 */
function RushTerms({ terms }: Readonly<{ terms: Rp1RushTerms | undefined }>) {
  return (
    <Text size="xs" tone="muted">
      {terms === undefined ? (
        <>{NULL_DISPLAY} RP-1 has not said what rushing costs on this install</>
      ) : (
        <>
          Rushing a complex works at <Unit value={terms.rateMult} />, pays{" "}
          <Unit value={terms.salaryMult} />, and earns no efficiency while it
          runs
        </>
      )}
    </Text>
  );
}

/**
 * A Row renders an `<li>`, so its rows need list semantics around them; see
 * LaunchComplexStatus for the same reset and why it is inline.
 */
const LIST_STYLE = { listStyle: "none", margin: 0, padding: 0 } as const;

registerAugment({
  id: "rp1-ksc-complexes",
  augments: "space-center-status.sections",
  component: KscComplexes,
  /** Under the construction queue; see `KscConstruction` for why it is declared. */
  priority: 1,
  owner: RP1,
});
