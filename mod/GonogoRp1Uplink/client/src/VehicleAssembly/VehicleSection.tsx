import { useCommand, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import { Section, SectionTitle, usePanelDelay } from "@ksp-gonogo/ui-kit";
import { current } from "../shared/current";
import { ProjectCardList } from "../shared/ProjectCard";
// Side-effect import: hydrates these Topics' units at decode time. Here rather
// than left to the entry point's import order, because this file is the
// consumer that would silently receive bare numbers without it.
import "../topics";
import { VehicleCard } from "./VehicleCard";
import {
  complexOf,
  operationFor,
  padsAt,
  rowKey,
  type Vehicle,
} from "./vehicles";

/** Move a finished vehicle to a pad. Must match `Rp1VehicleCommands.RolloutCommand`. */
export const RP1_ROLLOUT_COMMAND = "rp1.vehicle.rollout";

/** Bring it back off the pad. Must match `Rp1VehicleCommands.RollbackCommand`. */
export const RP1_ROLLBACK_COMMAND = "rp1.vehicle.rollback";

/** Take a vehicle off the queue, for a refund. Must match `Rp1VehicleCommands.ScrapCommand`. */
export const RP1_SCRAP_COMMAND = "rp1.vehicle.scrap";

/**
 * One of RP-1's two vehicle lists, headed by what it is, as a flat run of cards
 * across every launch complex.
 *
 * <para>Flat rather than grouped by complex, because a complex is not the
 * subject here: it is a tag on work that is happening in several places at
 * once, and an operator scanning for what is nearly finished should not have to
 * open three groups to find it. Every card names its own complex and carries
 * that complex's staffing and rush state, which is the whole of what the
 * grouping would have told them.</para>
 *
 * <para>The complexes, the pads and the operations are read HERE rather than
 * passed in, because each contributed section is an independent consumer of
 * this Uplink's wire. That is what makes the two of them a working example of
 * the contribution API rather than two halves of one widget that happen to be
 * registered separately.</para>
 *
 * <para>An empty list draws nothing at all rather than an empty heading. The
 * host says "none built and none on order" once, for both lists together,
 * because that is one fact about the space centre rather than two.</para>
 */
export function VehicleSection({
  title,
  items,
  waiting,
}: Readonly<{
  title: string;
  items: readonly Vehicle[];
  /** Whether this list's vehicles are still being integrated. */
  waiting: boolean;
}>) {
  const complexes = current(useTelemetry("rp1.complexes"));
  const pads = current(useTelemetry("rp1.pads"));
  const operations = current(useTelemetry("rp1.operations"));

  // Unconditional and above the early return on purpose: a hook after it would
  // change count on the first frame RP-1 answers.
  const rollout = useCommand(RP1_ROLLOUT_COMMAND);
  const rollback = useCommand(RP1_ROLLBACK_COMMAND);
  const scrap = useCommand(RP1_SCRAP_COMMAND);
  usePanelDelay(rollout);
  usePanelDelay(rollback);
  usePanelDelay(scrap);

  if (items.length === 0) {
    return null;
  }

  const handles = { rollback, rollout, scrap };

  return (
    <Section>
      <SectionTitle>{title}</SectionTitle>
      <ProjectCardList>
        {items.map((item) => (
          <VehicleCard
            complex={complexOf(complexes, item.lcId)}
            handles={handles}
            item={item}
            key={rowKey(item)}
            operation={operationFor(operations, item)}
            pads={padsAt(pads, item.lcId)}
            waiting={waiting}
          />
        ))}
      </ProjectCardList>
    </Section>
  );
}
