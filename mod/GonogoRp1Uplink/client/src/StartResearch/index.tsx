import type { CareerTechNode } from "@ksp-gonogo/sitrep-sdk";
import {
  magnitudeOf,
  registerAugment,
  useCommand,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  CommandButton,
  NULL_DISPLAY,
  Readout,
  ReadoutCaption,
  Section,
  SectionTitle,
  Select,
  Stack,
  Text,
  Unit,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import { current } from "../shared/current";
import { RP1 } from "../uplink";
// Side-effect import: hydrates these Topics' units at decode time. Here rather
// than left to the entry point's import order, because this file is the
// consumer that would silently receive bare numbers without it.
import "../topics";

/**
 * Put a tech node on RP-1's research queue. Must match
 * `Rp1ResearchCommands.ResearchCommand`.
 */
export const RP1_TECH_RESEARCH_COMMAND = "rp1.tech.research";

/**
 * Start a node researching, beside the tech tree that can only say which ones
 * are owned and the queue that says which are being worked.
 *
 * <para><b>It spends SCIENCE, and all of it at the press.</b> RP-1 charges
 * `scienceCost` in full at ENQUEUE rather than on completion, so the balance
 * beside this control is the science balance and not the funds one, and the
 * charge is the whole reason a second press on a node already queued is refused
 * rather than treated as satisfied. The figure quoted here is the exact integer
 * that gets charged: RP-1 never re-prices a node and keeps no cost of its own,
 * `ResearchProject.scienceCost` is assigned straight from the tree.</para>
 *
 * <para><b>Why this rather than the tech tree's own Unlock.</b> The host
 * widget's control sends `career.tech.unlock`, which buys a node outright
 * through `ResearchAndDevelopment.UnlockProtoTechNode`. Nothing of RP-1's
 * patches that, so under a managed save the stock write would land a researched
 * node at a stock price beside a research queue that never heard of it, and
 * `Rp1CareerProjectGate` refuses it and names this command instead. Under RP-1 a
 * node is a commitment researchers work through at a rate, which is a different
 * act, so it is a different control.</para>
 *
 * <para><b>The picker enforces the prerequisites, because the command does
 * not.</b> `rp1.tech.research` builds a `ResearchProject` directly and never
 * goes through `RDTech.UnlockTech`, so nothing on its path asks whether the
 * node's parents have been researched: it would happily queue a node the tree
 * cannot reach yet. Only the client can enumerate the tree, so only the client
 * can ask, and it does, from `career.status.tech.nodes[].parents` and each
 * parent's own `unlocked` flag. This is the same derivation the host widget
 * makes for its own researchable set.</para>
 *
 * <para><b>Two of RP-1's refusals arrive at the press rather than before
 * it.</b> The science-cost ceiling the R&amp;D complex imposes
 * (`GameVariables.GetScienceCostLimit` at its normalised level) and RP-1's
 * preset switches for build and tech-unlock times are neither of them on the
 * wire, and both refuse. The press is offered anyway, which is the rule the
 * build controls follow: the command asks RP-1 itself and refuses in RP-1's own
 * words, and a refusal on the ceiling carries both figures back as a
 * LimitBreach.</para>
 */
export function StartResearch() {
  const available = current(useTelemetry("rp1.available"));
  const career = current(useTelemetry("career.status"));
  const research = current(useTelemetry("rp1.research"));

  const [picked, setPicked] = useState<string | null>(null);

  // Unconditional and above the early returns: a hook after one would change
  // count on the first frame RP-1 answers.
  const start = useCommand(RP1_TECH_RESEARCH_COMMAND);
  usePanelDelay(start);

  // Invisible on every install without RP-1, which is most of them.
  if (available !== true) {
    return null;
  }

  /* No tree is not an empty tree. `career.status` without a `tech` group is a
     producer that has not answered, and drawing "nothing left to research" over
     it would state the one thing this channel is silent about. */
  if (career?.tech === undefined) {
    return null;
  }

  const queued = new Set(
    (research ?? []).flatMap((entry) =>
      entry.techId === undefined || entry.techId === null ? [] : [entry.techId],
    ),
  );
  const offered = startable(career.tech.nodes ?? [], queued);

  const science = magnitudeOf(career?.economy?.science);
  const chosen = offered.find((node) => node.id === picked) ?? offered[0];
  const cost = magnitudeOf(chosen?.scienceCost);
  const short = cost !== null && science !== null && science < cost;

  return (
    <Section gap="sm">
      <SectionTitle>START RESEARCH</SectionTitle>

      {/* The balance in this section rather than borrowed from the host: this is
          the only control in the widget that spends science at the press, and
          the host draws its own figure only once the widget is tall enough for
          a subtitle. */}
      <Cluster gap="md" justify="start" wrap>
        <Readout>
          <ReadoutCaption>Science</ReadoutCaption>
          <Unit value={career?.economy?.science} />
        </Readout>
        <Text size="xs" tone="muted">
          Charged in full when the node is queued, not when it finishes.
        </Text>
      </Cluster>

      {chosen === undefined ? (
        /* A real answer worth stating: a tree whose reachable nodes are all
           owned or all already queued reads the same as a section that failed
           to draw if this is left out. */
        <Text size="sm" tone="muted">
          Nothing the tree can reach is left to queue.
        </Text>
      ) : (
        <Stack gap="xs">
          <Cluster gap="sm" justify="start" wrap>
            <Select
              aria-label="Tech node to research"
              onChange={(e) => setPicked(e.target.value)}
              value={chosen.id ?? ""}
            >
              {offered.map((node) => (
                <option key={node.id} value={node.id ?? ""}>
                  {titleOf(node)}
                </option>
              ))}
            </Select>
            <CommandButton
              args={{ techId: chosen.id }}
              aria-label={short ? undefined : `Research ${titleOf(chosen)}`}
              commandLabel={`Research ${titleOf(chosen)}`}
              confirmAriaLabel={`Confirm researching ${titleOf(chosen)}`}
              confirmLabel={<SpendWording cost={chosen.scienceCost} />}
              disabled={short}
              handle={start}
              label="Research"
              size="sm"
              title={
                short
                  ? "RP-1 charges the whole science cost when the node is queued, and the career is short of it"
                  : undefined
              }
            />
          </Cluster>
          <ReadoutCaption>
            {chosen.scienceCost == null ? (
              <>{NULL_DISPLAY} the tree did not price this node</>
            ) : (
              <>
                <Unit decimals={0} value={chosen.scienceCost} /> at the press
              </>
            )}
            {short && (
              <>
                {" "}
                <Badge severity="caution">SHORT</Badge>
              </>
            )}
          </ReadoutCaption>
        </Stack>
      )}
    </Section>
  );
}

/**
 * The nodes a press could actually start, in the order an operator picks from.
 *
 * <para>Three exclusions and each is a different fact. An owned node has nothing
 * to start. A queued one is refused by RP-1's own check, ahead of the charge, so
 * offering it is offering a press that cannot land. A node whose parents are not
 * all researched is the one the COMMAND would accept and the tree cannot reach;
 * see this section's own doc for why the client is the only side that can ask.</para>
 *
 * <para>Ordered by price, so the picker opens on the cheapest thing the career
 * can start. RP-1's tree runs to several hundred nodes and the reachable frontier
 * is what an operator is choosing between; alphabetical order would scatter it.</para>
 */
function startable(
  nodes: readonly CareerTechNode[],
  queued: ReadonlySet<string>,
): CareerTechNode[] {
  const owned = new Set(
    nodes.flatMap((node) =>
      node.unlocked === true && node.id !== undefined && node.id !== null
        ? [node.id]
        : [],
    ),
  );
  return nodes
    .filter(
      (node) =>
        node.id !== undefined &&
        node.id !== null &&
        node.unlocked !== true &&
        !queued.has(node.id) &&
        (node.parents ?? []).every((parent) => owned.has(parent)),
    )
    .sort(
      (a, b) =>
        (magnitudeOf(a.scienceCost) ?? 0) - (magnitudeOf(b.scienceCost) ?? 0) ||
        titleOf(a).localeCompare(titleOf(b)),
    );
}

/**
 * What to call a node.
 *
 * <para>The title an operator reads where the tree sent one, the id otherwise. A
 * node with neither cannot be offered at all and is filtered out upstream, so
 * this never has to draw a dash.</para>
 */
function titleOf(node: CareerTechNode): string {
  return node.title ?? node.id ?? "";
}

/**
 * What the confirm press spends.
 *
 * <para>A price the tree did not send is the null dash rather than a zero, and
 * the press is still offered: the command reads `scienceCost` itself and refuses
 * in RP-1's own words if it really is unreadable.</para>
 */
function SpendWording({
  cost,
}: Readonly<{ cost: CareerTechNode["scienceCost"] }>) {
  if (cost == null) {
    return <>Spend {NULL_DISPLAY}</>;
  }
  return (
    <>
      Spend <Unit decimals={0} value={cost} />
    </>
  );
}

registerAugment({
  id: "rp1-start-research",
  augments: "tech-tree.sections",
  component: StartResearch,
  channels: [
    "rp1.available",
    /* The tree, the prices and the science balance all ride this one, and
       naming it here is what makes the section independent of whatever the host
       happens to subscribe. */
    "career.status",
    /* What is already being worked, so a node on the queue is not offered a
       second press RP-1 would refuse ahead of the charge. */
    "rp1.research",
  ],
  requires: "rp1",
  /** Under the queue: what is being worked now is the context for choosing what
   *  to work next, and an order that depends on import order is one a formatter
   *  can reverse. */
  priority: 1,
  owner: RP1,
});
