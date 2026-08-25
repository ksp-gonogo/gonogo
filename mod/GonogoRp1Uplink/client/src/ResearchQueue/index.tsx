import type { Reading } from "@ksp-gonogo/sitrep-sdk";
import { registerAugment, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Countdown,
  magnitudeOf,
  NULL_DISPLAY,
  ProgressBar,
  Row,
  RowName,
  Section,
  SectionTitle,
  Stack,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { Rp1ResearchEntry } from "../__generated__/contract";
import { RP1 } from "../uplink";
import "../topics";

/**
 * RP-1's research QUEUE, beside a tech tree that can only show which nodes are
 * unlocked.
 *
 * <para>Under RP-1 unlocking a node is not a purchase, it is a commitment:
 * researchers work it over weeks at a rate, in an order, and the era the node
 * belongs to changes how fast. The tech tree renders a node as owned or not
 * owned, so a node being actively researched is invisible there, and so is the
 * queue it is waiting behind.</para>
 *
 * <para>No first-party change was needed for this. `Panel` mounts
 * `${componentId}.sections` for every widget, so the seam already existed; the
 * tech tree declaring no `augmentSlots` of its own turned out not to matter.</para>
 */
export function ResearchQueue() {
  const available = current(useTelemetry("rp1.available"));
  const research = current(useTelemetry("rp1.research"));

  // Invisible without RP-1, rather than an empty section on a stock game.
  if (available !== true) {
    return null;
  }

  const queue = research ?? [];
  if (queue.length === 0) {
    return (
      <Section>
        <SectionTitle>RP-1 RESEARCH QUEUE</SectionTitle>
        {/* An empty queue is a real state and says something: researchers are
            idle. It is not the same as RP-1 being absent, which returns null
            above. */}
        <Text>Nothing queued. Researchers are idle.</Text>
      </Section>
    );
  }

  return (
    <Section>
      <SectionTitle>RP-1 RESEARCH QUEUE</SectionTitle>
      <Stack as="ul" gap="sm" style={LIST_STYLE}>
        {queue.map((node) => (
          <ResearchRow key={node.techId ?? ""} node={node} />
        ))}
      </Stack>
    </Section>
  );
}

/**
 * One queued node. The throttle is shown only when the operator has moved it,
 * because a full-rate node saying "100%" beside every sibling is noise.
 */
function ResearchRow({ node }: Readonly<{ node: Rp1ResearchEntry }>) {
  const ratio = magnitudeOf(node.progressRatio);
  const workRate = magnitudeOf(node.workRate);
  return (
    <Stack as="li" gap="xs">
      <Stack as="ul" gap="xs" style={LIST_STYLE}>
        <Row>
          <RowName>{node.techName ?? node.techId ?? NULL_DISPLAY}</RowName>
          <Text>
            {node.timeLeftSeconds !== undefined &&
            node.timeLeftSeconds !== null ? (
              <Countdown value={node.timeLeftSeconds} />
            ) : node.stalled === true ? (
              <Badge severity="caution">STALLED</Badge>
            ) : (
              <>{NULL_DISPLAY} not costed yet</>
            )}
          </Text>
        </Row>
        <Row>
          <RowName>Progress</RowName>
          <Text>
            <Unit value={node.progress} /> / <Unit value={node.scienceCost} />
            {workRate !== null && workRate < 1 && (
              <>
                {" · throttled to "}
                <Unit value={node.workRate} />
              </>
            )}
          </Text>
        </Row>
        {node.startYear !== undefined && node.startYear !== null && (
          <Row>
            {/* RP-1's era model: a node researched before its time costs more.
                Absent on a node RP-1 records no era for, which is not year
                zero. */}
            <RowName>Era</RowName>
            <Text>
              <Unit value={node.startYear} />
              {node.endYear !== undefined && node.endYear !== null && (
                <>
                  {" to "}
                  <Unit value={node.endYear} />
                </>
              )}
            </Text>
          </Row>
        )}
      </Stack>
      {ratio !== null && (
        <ProgressBar
          ariaLabel={`Research progress, ${node.techName ?? node.techId ?? "node"}`}
          value={ratio * 100}
        />
      )}
    </Stack>
  );
}

/**
 * A Row renders an `<li>`, so its rows need list semantics around them; see
 * LaunchComplexStatus for the same reset and why it is inline.
 */
const LIST_STYLE = { listStyle: "none", margin: 0, padding: 0 } as const;

/** The value where one is current; see LaunchComplexStatus for why reckonable counts. */
function current<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

registerAugment({
  id: "rp1-research-queue",
  augments: "tech-tree.sections",
  component: ResearchQueue,
  owner: RP1,
});
