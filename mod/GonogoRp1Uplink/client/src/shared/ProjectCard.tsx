import { Card, Cluster, ProgressBar, Stack, Text } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";

/**
 * One piece of work RP-1 is doing.
 *
 * <para>RP-1 calls a facility upgrade, a new launch complex, a new pad and a
 * rocket under integration all PROJECTS, and to an operator they are the same
 * shape: a named thing with a state, a fraction done, a clock naming its end
 * and a bill. Two widgets draw them, the Space Center's construction section
 * and Vehicle Assembly, and a card that each of them shaped for itself would
 * make one career's work look like two unrelated surfaces.</para>
 *
 * <para>What the card owns is the LAYOUT: the accent rule, the vertical
 * rhythm, the name-and-badge row, the muted detail line, and the bar. What a
 * consumer owns is every word in it, because the words are the whole of what a
 * VAB upgrade and an Atlas do not have in common.</para>
 */
export interface ProjectCardProps {
  /** What the work is called, in the operator's own words. */
  name: ReactNode;
  /** The one word beside the name saying what kind of work, or where it has got to. */
  badge?: ReactNode;
  /** Where the work is and what it is, on one muted line under the name. */
  detail?: ReactNode;
  /**
   * How far along, and what a screen reader calls the bar.
   *
   * <para>A null ratio draws NO bar rather than an empty one: a full-width
   * empty track says "no progress made", which is a different claim from "we
   * cannot see the progress", and RP-1 leaves the fraction absent on a project
   * it has not costed yet.</para>
   */
  progress?: Readonly<{ ratio: number | null; label: string }>;
  /**
   * Amber for work that is going nowhere, green for work that is fine.
   *
   * <para>Read off the same state the badge is read off, so a card's state
   * survives a glance that never reaches the badge and the two cannot
   * disagree.</para>
   */
  tone: "go" | "warning";
  /** The clock, the money, the status lines and the controls, in that order. */
  children?: ReactNode;
}

/** @see ProjectCardProps */
export function ProjectCard({
  name,
  badge,
  detail,
  progress,
  tone,
  children,
}: Readonly<ProjectCardProps>) {
  return (
    <Card as="li" tone={tone}>
      <Stack gap="xs">
        {/* The name WRAPS rather than truncating, which is what separates a
            card's heading from a row's label. `RowName` ellipsises and flexes
            to fill, so at the minimum width a widget promises "Atlas" rendered
            as "Atl…" and a build-list card rendered its badge with no name at
            all beside it. The name is the only part of a card that says WHICH
            piece of work it is, so it is the last thing that may go. The
            cluster wraps for the same reason: a badge that will not fit beside
            a long name drops under it instead of squeezing it. */}
        <Cluster align="start" gap="sm" wrap>
          <Text tone="default">{name}</Text>
          {badge}
        </Cluster>

        {detail !== undefined && (
          <Text size="xs" tone="muted">
            {detail}
          </Text>
        )}

        {progress !== undefined && progress.ratio !== null && (
          <ProgressBar
            ariaLabel={progress.label}
            value={progress.ratio * 100}
          />
        )}

        {children}
      </Stack>
    </Card>
  );
}

/**
 * The list a run of {@link ProjectCard}s sits in.
 *
 * <para>A card renders an `<li>`, so it needs list semantics around it or a
 * screen reader is handed an orphan list item, and the browser's own bullets
 * and indent have to come back off. Every widget that drew these cards carried
 * its own copy of that reset, which is one copy per widget of a rule that
 * belongs to the card.</para>
 *
 * <para>Cards sit a step further apart than the heading above them sits from
 * the first of them, so a group of cards reads as belonging to its heading
 * rather than as one more thing spaced the same as everything else.</para>
 */
export function ProjectCardList({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <Stack as="ul" gap="sm" style={LIST_STYLE}>
      {children}
    </Stack>
  );
}

const LIST_STYLE = { listStyle: "none", margin: 0, padding: 0 } as const;
