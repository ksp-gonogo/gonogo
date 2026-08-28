import {
  registerAugment,
  useCommand,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  CommandButton,
  Inline,
  NULL_DISPLAY,
  Row,
  RowName,
  Section,
  SectionTitle,
  Stack,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import type { Rp1ComplexEntry } from "../__generated__/contract";
import { current } from "../shared/current";
import { RP1 } from "../uplink";
// Side-effect import: hydrates these Topics' units at decode time. Here rather
// than left to the entry point's import order, because this file is the
// consumer that would silently receive bare numbers without it.
import "../topics";

/** Rush a whole complex. Must match `Rp1VehicleCommands.RushCommand`. */
export const RP1_COMPLEX_RUSH_COMMAND = "rp1.complex.rush";

/**
 * The launch complexes themselves, and the one thing an operator changes about
 * how fast they work.
 *
 * <para>A complex appears in three widgets answering three different questions,
 * and this is the one that ADMINISTERS it: the Space Center is where a career's
 * infrastructure is listed and altered. Vehicle Assembly shows what each
 * complex is building and how fast, and Launch Director shows which of their
 * pads can take a launch; neither of those changes a complex, and this one
 * lists no vehicles.</para>
 *
 * <para>The balance every control here spends against is the host widget's,
 * drawn once in its header. Rushing spends nothing at the moment it lands, but
 * it raises the salary the complex draws for as long as it runs.</para>
 */
export function KscComplexes() {
  const available = current(useTelemetry("rp1.available"));
  const complexes = current(useTelemetry("rp1.complexes"));

  // Unconditional and above the early return on purpose: a hook after it would
  // change count on the first frame RP-1 answers.
  const rush = useCommand(RP1_COMPLEX_RUSH_COMMAND);
  usePanelDelay(rush);

  // Invisible on every install without RP-1, which is most of them.
  if (available !== true) {
    return null;
  }

  const rows = complexes ?? [];
  if (rows.length === 0) {
    return null;
  }

  return (
    <Section>
      <SectionTitle>LAUNCH COMPLEXES</SectionTitle>
      <Stack as="ul" gap="xs" style={LIST_STYLE}>
        {rows.map((complex) => (
          <ComplexRush
            complex={complex}
            handle={rush}
            key={complex.lcId ?? complex.name ?? ""}
          />
        ))}
      </Stack>
    </Section>
  );
}

/**
 * A launch complex's rush mode.
 *
 * <para>Per COMPLEX and not per vehicle, which is a fact about RP-1 rather than
 * a simplification here: <c>IsRushing</c> is a bool on the launch complex, so
 * every project inside it is rushed together, integrations and rollouts and
 * reconditionings alike. A control shaped like "rush this build" would be a lie
 * about what the game does.</para>
 *
 * <para>The row is named for the COMPLEX, because that is what it is: a row
 * called "LC-1 rush" reads as a second thing called LC-1 rush that also happens
 * to have a rush button. What the press does is the button's job to say.</para>
 *
 * <para>One press, unlike the vehicle controls in Vehicle Assembly, and the
 * difference is real: this spends nothing at the moment it lands. It raises the
 * rate by half again and DOUBLES the salary the complex draws, and while it
 * runs the complex earns no efficiency at all, so the cost arrives later as
 * payroll and as work that would have got cheaper and did not. It is reversed
 * by pressing again. The label says what the press will do rather than what the
 * state is, because a button that reads as its own state is one an operator
 * presses to confirm what they are looking at.</para>
 */
function ComplexRush({
  complex,
  handle,
}: Readonly<{
  complex: Rp1ComplexEntry;
  handle: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  const lcId = complex.lcId;
  if (lcId === undefined || lcId === null) {
    return null;
  }
  const name = complex.name ?? "this complex";
  const rushing = complex.isRushing === true;

  return (
    <Row>
      <RowName>{complex.name ?? NULL_DISPLAY}</RowName>
      <Inline gap="xs">
        {rushing ? <Badge severity="caution">RUSHING</Badge> : null}
        <CommandButton
          active={rushing}
          args={{ lcId, rushing: !rushing }}
          aria-label={
            rushing
              ? `Stop rushing work at ${name}`
              : `Rush work at ${name}, at double the salary`
          }
          commandLabel={rushing ? `Stop rushing ${name}` : `Rush ${name}`}
          handle={handle}
          label={rushing ? "Stop rushing" : "Rush"}
          size="sm"
          tone={rushing ? "warn" : "neutral"}
        />
      </Inline>
    </Row>
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
