import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  type CommandButton,
  Grid,
  Inline,
  magnitudeOf,
  NULL_DISPLAY,
  Row,
  RowName,
  Stack,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type {
  Rp1CentreEntry,
  Rp1ComplexEntry,
  Rp1PadEntry,
  Rp1RushTerms,
} from "../__generated__/contract";
import { ComplexCard } from "./ComplexCard";

/**
 * ONE space centre, and the launch complexes at it.
 *
 * <para>The middle rung of RP-1's hierarchy, and the one stock KSP has no
 * counterpart for. Stock has a set of buildings; RP-1 has a set of buildings per
 * CAREER, then a centre, then complexes at that centre, and every staffing
 * question is asked at a different one of those three. This block is what makes
 * the middle one visible: a heading naming the place, the pool of engineers it
 * holds that no complex has claimed, and its complexes nested under it.</para>
 *
 * <para>The idle pool gets a cost of its own beside the centre's total. RP-1
 * pays an unassigned engineer a fraction of full salary for no work, so the pool
 * is a standing charge rather than a reserve, and the figure is the one an
 * operator weighs an assignment against. It is also exactly the number a
 * complex's crew here can grow by.</para>
 */
export function Centre({
  centre,
  complexes,
  complexNames,
  pads,
  terms,
  assign,
  rush,
  dismantle,
  dismantlePad,
  funds,
  newPad,
  renameComplex,
  renamePad,
}: Readonly<{
  centre: Rp1CentreEntry;
  complexes: readonly Rp1ComplexEntry[];
  /** Every complex in the career by id, so a card can name the ones it shares a crew rating with. */
  complexNames: ReadonlyMap<string, string>;
  pads: readonly Rp1PadEntry[];
  terms: Rp1RushTerms | undefined;
  assign: Parameters<typeof CommandButton>[0]["handle"];
  rush: Parameters<typeof CommandButton>[0]["handle"];
  dismantle: Parameters<typeof CommandButton>[0]["handle"];
  dismantlePad: Parameters<typeof CommandButton>[0]["handle"];
  /** The career balance, threaded down so a pad quote can say if it is covered. */
  funds: number | null;
  newPad: Parameters<typeof CommandButton>[0]["handle"];
  renameComplex: Parameters<typeof CommandButton>[0]["handle"];
  renamePad: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  // The display name first, the id behind it. RP-1 keeps only the id on a
  // centre, and on an RSS career that id is us_cape_canaveral, which is not what
  // anyone calls the place.
  const name = centre.kscDisplayName ?? centre.kscName ?? NULL_DISPLAY;
  const hired = magnitudeOf(centre.engineers);
  const unassigned = magnitudeOf(centre.unassignedEngineers);
  const assigned =
    hired === null || unassigned === null ? null : hired - unassigned;

  return (
    <Stack as="li" gap="md">
      <Cluster gap="xs" wrap>
        <Text weight="semibold">{name}</Text>
        <Inline gap="xs">
          {centre.isActive === true && <Badge severity="info">ACTIVE</Badge>}
          {unassigned !== null && unassigned > 0 && (
            <Badge severity="caution">{unassigned} IDLE</Badge>
          )}
        </Inline>
      </Cluster>

      <Stack as="ul" gap="xs" style={LIST_STYLE}>
        <Row>
          <RowName>Engineers</RowName>
          <Text size="xs">
            <Unit value={centre.engineers} /> hired ·{" "}
            <Unit
              value={assigned === null ? undefined : value("count", assigned)}
            />{" "}
            assigned · <Unit value={centre.unassignedEngineers} /> idle
          </Text>
        </Row>
        <Row>
          <RowName>Per day</RowName>
          <Text size="xs">
            crews <Unit value={centre.salaryPerDay} /> · complexes{" "}
            <Unit value={centre.upkeepPerDay} /> · idle{" "}
            <Unit value={centre.idleSalaryPerDay} />
          </Text>
        </Row>
      </Stack>

      {complexes.length === 0 ? (
        // A reading rather than the sentence that was here, matching the "no
        // pads" line a complex draws for its own empty case: RP-1 starts a
        // career with a hangar and no pad complex at all, so the zero is a real
        // early-career state and not a widget that failed to draw.
        <Text size="xs" tone="muted">
          no launch complexes
        </Text>
      ) : (
        /* A grid, not a stack. A complex card is a narrow block of label/value
           rows and the section runs the full width of the space centre panel, so
           stacked cards left most of that width empty however many complexes a
           career has. The tracks collapse to one column below the minimum, which
           is the layout the cards had before. */
        <Grid align="start" gap="lg" minColWidth="17rem">
          {complexes.map((complex) => (
            <ComplexCard
              assign={assign}
              centreName={name}
              complex={complex}
              complexNames={complexNames}
              dismantle={dismantle}
              dismantlePad={dismantlePad}
              funds={funds}
              newPad={newPad}
              renameComplex={renameComplex}
              renamePad={renamePad}
              key={complex.lcId ?? complex.name ?? ""}
              pads={pads.filter((pad) => pad.lcId === complex.lcId)}
              rush={rush}
              terms={terms}
              unassigned={unassigned}
            />
          ))}
        </Grid>
      )}
    </Stack>
  );
}

/**
 * A `Row` renders an `<li>`, so the centre's readings need list semantics
 * around them; see LaunchComplexStatus for the same reset and why it is inline.
 */
const LIST_STYLE = { listStyle: "none", margin: 0, padding: 0 } as const;
