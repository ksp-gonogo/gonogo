import type { Value } from "@ksp-gonogo/sitrep-sdk";
import { registerAugment, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  NULL_DISPLAY,
  Row,
  RowName,
  Section,
  SectionTitle,
  Stack,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type {
  Rp1BuildCost,
  Rp1RequiredTechEntry,
} from "../__generated__/contract";
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

  /* Nothing on the editor's table, so nothing to price. The section does not
     render at all rather than rendering a title over a sentence saying it has
     nothing to say: an operator who is not designing a vehicle is not asking
     what one costs, and a heading that is always present makes the widget
     longer without making it say more.

     This is NOT the same as pricing a vehicle at zero, which would be a lie.
     Absent is absent, and here the honest expression of it is silence. */
  if (cost === undefined) {
    return null;
  }

  return (
    <Section gap="sm" data-build-cost-section="">
      <SectionTitle>LAUNCH COST</SectionTitle>
      <Stack gap="sm">
        <CostRow name="Vehicle" value={cost.vehicleCost} />
        <SurchargeRow cost={cost} />
        <CostRow name="Tooling" value={cost.toolingCost} />
        <CostRow name="Part unlocks" value={cost.unlockCost} />
        <CostRow name="Rollout" value={cost.rolloutCost} />
        <RequiredTechs techs={cost.requiredTechs} />
      </Stack>
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
 * The untooled surcharge, drawn INDENTED under the vehicle cost.
 *
 * <para><b>The indent is the whole statement, and it replaced two sentences.</b> The
 * surcharge is already inside the vehicle cost: RP-1's tooling module is an
 * `IPartCostModifier`, the game folds its contribution into each part's price, and
 * the vehicle figure contains it before it reaches the wire. Drawn level with the
 * other lines it invites an operator to add it, and the total they arrive at is more
 * than the launch costs.</para>
 *
 * <para>That containment used to be said in prose. An of-which relationship is a
 * TREE, so it is drawn as one: the indent says it at every size, on every render,
 * without a word, and it cannot be clipped away the way a label was. A sentence was
 * the wrong instrument for a structural fact.</para>
 *
 * <para>The inset is ui-kit's own <c>Row nested</c> rather than a padded wrapper,
 * and the difference is measurable rather than tidiness: a wrapper pads BOTH sides,
 * only the left communicates anything, and at this widget's minimum size the waste
 * on the right left the label two pixels short of its own name.</para>
 *
 * <para><b>"Untooled" is RP-1's own word, not ours.</b> Its code carries
 * `ProcessUntooledParts`, `GetUntooledPartsAndCost`, `UntooledMultiplier` and a
 * `_untooledTypesScroll` region in its own tooling window, so an operator meets the
 * term in the game before they meet it here. A clearer-sounding synonym would make
 * two concepts out of one; leave it alone.</para>
 */
function SurchargeRow({ cost }: { cost: Rp1BuildCost }) {
  if (cost.untooledSurcharge == null) {
    return null;
  }
  return (
    <Row as="div" nested data-of-which="">
      <RowName>Untooled</RowName>
      <Unit value={cost.untooledSurcharge} decimals={0} />
    </Row>
  );
}

/**
 * Techs the vehicle needs and the career has not researched, each named and each
 * with what on the vehicle is waiting for it.
 *
 * <para>Not a cost, and in the costs section anyway, because it is the reason a
 * vehicle that prices fine still cannot be flown. A breakdown showing only money
 * would let an operator budget for something they cannot build.</para>
 *
 * <para><b>The node is the row and the parts sit under it, rather than the other
 * way round.</b> Both readings were available and they answer different
 * questions: a part per row with its blocking node beside it answers "why is this
 * part unavailable", and a node per row with its parts under it answers "what is
 * this vehicle missing". This surface is about the VEHICLE, has no part list of
 * its own, and sits in a breakdown of what stands between a design and a launch,
 * so the second question is the one being asked here. It is also how the tooling
 * section immediately below reads, for the same underlying shape: one thing to
 * acquire, several parts waiting on it. The first question belongs on a
 * part-level surface, which this is not.</para>
 *
 * <para>A node blocking four parts would otherwise repeat itself down four rows,
 * turning a four-node answer into a twelve-row list on the same facts.</para>
 */
function RequiredTechs({ techs }: { techs?: Rp1RequiredTechEntry[] }) {
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
      {/* ONE badge, and it is the STATE rather than the contents.

          This drew a critical badge per tech id, so a vehicle missing five nodes
          got five red alarms whose redness said nothing the first one did not.
          Severity is a reading about the vehicle and the vehicle has one state
          here: it needs tech the career has not researched. The badge carries
          that; the nodes are content, not severity.

          Its own label went with the change. The badge IS the label now, and
          "Needs tech" over a badge reading NEEDS TECH said it twice. */}
      <Cluster justify="start" gap="sm">
        <Badge severity="critical">Needs tech</Badge>
      </Cluster>
      {/* Plain text, which WRAPS, and that is a better answer to the truncation
          this block was already carrying a fix for than the scroller it replaced.
          A node id is an identifier and a truncated one is a different id, so a
          render at the widget's minimum size cutting `supersonicFlight` by four
          pixels was a real defect; a badge could not wrap out of it because a
          single badge wider than the row has nowhere to wrap to, hence the
          scroller. Text has somewhere to go, so a name is whole at every size and
          nothing has to be scrolled to be read. */}
      {techs.map((tech) => (
        <BlockingNode key={tech.id ?? tech.title} tech={tech} />
      ))}
    </Stack>
  );
}

/**
 * One node the vehicle is waiting on: what it is called, and what on the vehicle
 * is waiting for it.
 *
 * <para><b>The title, falling back to the id.</b> The wire leaves the title ABSENT
 * where the career's tech tree has none rather than substituting the id, which is
 * what lets this decide: a readable name where there is one, and the id, which is
 * at least searchable in a tech tree, where there is not. Had the producer
 * substituted, there would be no way to tell a titled node from an untitled
 * one.</para>
 *
 * <para><b>The parts have THREE states and each says something different.</b>
 * Named parts are the answer. An EMPTY list means the ship was read and nothing on
 * it names this node, which happens because a node can be required by something
 * other than a part, and it is said rather than left blank: an operator staring at
 * a node with nothing under it would otherwise wonder which of the two it was.
 * ABSENT means the editor ship could not be read at all, so nothing is claimed and
 * nothing is drawn.</para>
 */
function BlockingNode({ tech }: { tech: Rp1RequiredTechEntry }) {
  const name = tech.title ?? tech.id;
  if (name == null) {
    return null;
  }
  return (
    <Stack gap="xs" data-blocking-node="">
      {/* `tone="default"` and NOT the default tone, which is `accent`: a bare
          `<Text>` renders in the theme's green. That is the other half of what
          the operator reported, and it was a separate defect from the badges:
          "a needs-tech GREEN heading with a critical badge". Green is the go
          colour, so a blocker drawn in it says the opposite of what it is, and
          under a critical badge the pair contradict each other. The severity is
          said once, by the badge; a node's name is content and is drawn as
          content. */}
      <Text size="xs" tone="default">
        {name}
      </Text>
      {tech.parts != null && (
        /* Nested, because the parts belong to the node above them and a flat run
           of part names under a flat run of node names could not be told apart.
           Same relationship, and the same rendering of it, as the tooling section
           below draws for the parts a purchase covers. */
        <Row as="div" nested wrap>
          <Text size="xs" tone="muted">
            {tech.parts.length === 0
              ? "nothing on this vehicle names it"
              : tech.parts.join(", ")}
          </Text>
        </Row>
      )}
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
