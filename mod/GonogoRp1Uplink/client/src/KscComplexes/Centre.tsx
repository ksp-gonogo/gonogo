import {
  Badge,
  Cluster,
  type CommandButton,
  Inline,
  magnitudeOf,
  NULL_DISPLAY,
  Stack,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type {
  Rp1CentreEntry,
  Rp1ComplexEntry,
  Rp1PadEntry,
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
 * <para>The unassigned pool is called out when anybody is in it. RP-1 pays an
 * unassigned engineer a fraction of their salary for no work at all, so an idle
 * pool is a standing cost rather than a reserve, and it is also the exact number
 * a complex's crew can grow by.</para>
 */
export function Centre({
  centre,
  complexes,
  pads,
  assign,
  rush,
}: Readonly<{
  centre: Rp1CentreEntry;
  complexes: readonly Rp1ComplexEntry[];
  pads: readonly Rp1PadEntry[];
  assign: Parameters<typeof CommandButton>[0]["handle"];
  rush: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  const name = centre.kscName ?? NULL_DISPLAY;
  const unassigned = magnitudeOf(centre.unassignedEngineers);

  return (
    <Stack as="li" gap="xs">
      <Cluster gap="xs" wrap>
        <Text weight="semibold">{name}</Text>
        <Inline gap="xs">
          {centre.isActive === true && <Badge severity="info">ACTIVE</Badge>}
          {unassigned !== null && unassigned > 0 && (
            <Badge severity="caution">{unassigned} IDLE</Badge>
          )}
        </Inline>
      </Cluster>

      <Text size="xs" tone="muted">
        space centre · <Unit value={centre.engineers} /> engineers hired here,{" "}
        <Unit value={centre.unassignedEngineers} /> assigned to nothing
      </Text>

      <Text size="xs" tone="muted">
        crews <Unit value={centre.salaryPerDay} /> · complexes{" "}
        <Unit value={centre.upkeepPerDay} />
      </Text>

      {complexes.length === 0 ? (
        // A real state, and one worth a sentence: RP-1 starts a career with a
        // hangar and no pad complex at all, and a heading with nothing under it
        // reads as a widget that failed to draw.
        <Text size="sm" tone="muted">
          No launch complexes at {name} yet.
        </Text>
      ) : (
        <Stack as="ul" gap="xs" style={LIST_STYLE}>
          {complexes.map((complex) => (
            <ComplexCard
              assign={assign}
              centreName={name}
              complex={complex}
              key={complex.lcId ?? complex.name ?? ""}
              pads={pads.filter((pad) => pad.lcId === complex.lcId)}
              rush={rush}
              unassigned={unassigned}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/**
 * A Card renders as an `<li>` here, so its rows need list semantics around
 * them; see LaunchComplexStatus for the same reset and why it is inline.
 */
const LIST_STYLE = { listStyle: "none", margin: 0, padding: 0 } as const;
