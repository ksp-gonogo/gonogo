import type { Value } from "@ksp-gonogo/sitrep-sdk";
import { registerAugment, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  NULL_DISPLAY,
  Row,
  RowName,
  ScrollArea,
  Section,
  SectionTitle,
  Stack,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { Rp1BuildCost } from "../__generated__/contract";
import { current } from "../shared/current";
import { RP1 } from "../uplink";
import { VEHICLE_ASSEMBLY_SECTIONS } from "./slot";

/**
 * What flying the vehicle on the editor's table will actually cost, in funds.
 *
 * <para><b>Every figure here is money, and that is the whole point of the
 * section.</b> RP-1 has a "Cost Breakdown" tab of its own and it shows
 * `effectiveCost`, which is the argument to its build-points formula: a
 * dimensionless number that decides how LONG integration takes and buys nothing.
 * None of it is here. A readout that mixed the two would put a schedule input in
 * a funds column, which is the mistake the producer's own naming invites.</para>
 *
 * <para><b>No balance.</b> The rule is one balance per WIDGET, and Vehicle
 * Assembly draws it in its own body; three sections each printing the same number
 * is what the Space Center did before and the operator read the repetition as the
 * defect it was.</para>
 */
export function BuildCostSection() {
  const available = current(useTelemetry("rp1.available"));
  const cost = current(useTelemetry("rp1.buildCost"));

  // Invisible on every install without RP-1, which is most of them.
  if (available !== true) {
    return null;
  }

  return (
    <Section gap="sm" data-build-cost-section="">
      <SectionTitle>WHAT THIS LAUNCH COSTS</SectionTitle>
      {cost === undefined ? (
        /* Not "this vehicle is free". No reading means no vehicle on the
           editor's table, and a column of zeros would say the opposite. */
        <Text tone="faint" size="sm">
          No vehicle being designed.
        </Text>
      ) : (
        <Stack gap="sm">
          <CostRow name="Vehicle" value={cost.vehicleCost} />
          <SurchargeRow cost={cost} />
          <CostRow name="Tooling" value={cost.toolingCost} />
          <CostRow name="Part unlocks" value={cost.unlockCost} />
          <CostRow name="Rollout" value={cost.rolloutCost} />
          <RequiredTechs techs={cost.requiredTechs} />
        </Stack>
      )}
    </Section>
  );
}

/**
 * One line of the breakdown.
 *
 * <para>An absent figure renders the null dash rather than a zero, and the two
 * mean different things on this surface: RP-1 leaves a rollout at zero for a
 * spaceplane because a hangar vehicle does not roll out, and a vehicle nobody has
 * priced yet carries no cost at all. Neither is free.</para>
 */
function CostRow({ name, value }: { name: string; value?: Value<"funds"> }) {
  return (
    <Row as="div">
      <RowName>{name}</RowName>
      {value == null ? (
        <Text>{NULL_DISPLAY}</Text>
      ) : (
        <Unit value={value} decimals={0} />
      )}
    </Row>
  );
}

/**
 * The untooled surcharge, drawn as an OF WHICH of the vehicle line above it.
 *
 * <para><b>This is the one row whose placement is load-bearing.</b> The surcharge
 * is already inside the vehicle cost: RP-1's tooling module is an
 * `IPartCostModifier`, the game folds its contribution into each part's price, and
 * the vehicle figure contains it before it reaches the wire. Drawn as another line
 * in the column it would invite an operator to add it, and the total they arrived
 * at would be more than the launch costs.</para>
 *
 * <para>It carries the decision as well as the number. The surcharge is paid on
 * EVERY copy of this vehicle ever built and the tooling above it is paid once, so
 * the badge is the thing that turns two figures into a choice.</para>
 */
function SurchargeRow({ cost }: { cost: Rp1BuildCost }) {
  if (cost.untooledSurcharge == null) {
    return null;
  }
  return (
    /* THE MEANING IS IN THE SENTENCE, NOT THE LABEL, and renders at three sizes
       are what settled that. The row's name gets 60px at this widget's minimum and
       "of which untooled" needs 122, so the wording that carries the whole point
       was clipped away exactly where the widget is hardest to read. A short label
       and a full-width line below it cannot clip, and the line can say more than a
       label had room to: that this is part of the figure above rather than extra,
       and that it returns on every build while the tooling does not. */
    <Stack gap="xs" data-of-which="">
      <Row as="div">
        <RowName>untooled</RowName>
        <Unit value={cost.untooledSurcharge} decimals={0} />
      </Row>
      <Text tone="faint" size="sm">
        Part of the vehicle cost above, not on top of it. Charged again on every
        build; the tooling is charged once.
      </Text>
    </Stack>
  );
}

/**
 * Techs the vehicle needs and the career has not researched.
 *
 * <para>Not a cost, and in the costs section anyway, because it is the reason a
 * vehicle that prices fine still cannot be flown. A breakdown showing only money
 * would let an operator budget for something they cannot build.</para>
 */
function RequiredTechs({ techs }: { techs?: string[] }) {
  if (techs == null || techs.length === 0) {
    return null;
  }
  return (
    /* A STACK rather than a name-and-value row, and a render is what settled it.
       As a row the label was crushed to ZERO WIDTH at the widget's minimum size by
       the badges beside it: an operator saw a line of tech names with nothing
       saying what they were. A list of badges is a sub-list rather than a value,
       and it cannot compete with its own label for the same line. */
    <Stack gap="xs" data-required-techs="">
      <Text size="sm">Needs tech</Text>
      {/* A SCROLLER, because a tech id is an identifier and a truncated one is a
          different id rather than a shorter one. A render at the widget's minimum
          size cut `supersonicFlight` by four pixels, which is the failure mode
          that reads as a name and is not one. Wrapping cannot help: a single
          badge wider than the row has nowhere to wrap to. */}
      <ScrollArea>
        <Cluster justify="start" gap="sm">
          {techs.map((tech) => (
            <Badge key={tech} severity="critical">
              {tech}
            </Badge>
          ))}
        </Cluster>
      </ScrollArea>
    </Stack>
  );
}

registerAugment({
  id: "rp1-vehicle-assembly-build-cost",
  augments: VEHICLE_ASSEMBLY_SECTIONS,
  component: BuildCostSection,
  /** Above both vehicle lists: it is about the craft being designed now, and they
   *  are about craft already committed to. */
  priority: -1,
  owner: RP1,
});
