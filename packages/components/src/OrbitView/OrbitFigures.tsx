import type { OrbitTrajectory } from "@ksp-gonogo/sitrep-client";
import type { ReckoningDecline } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  DeclinedEmptyState,
  ReadoutCaption,
  Stack,
  Tooltip,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { noOrbitSentence } from "./emptyStates";
import { OrbitReadoutGrid, type OrbitReadoutGridProps } from "./OrbitReadouts";
import type { OrbitPill } from "./orbitPill";
import { NoData } from "./styles";

export interface OrbitFiguresProps {
  bodyName: string | null | undefined;
  /** The orbit's regime, which is stable, sub-orbital or escaping, or `null` with no orbit to name one for. */
  pill: OrbitPill | null;
  /** The frame's name when the figures are not read in the game's own view frame. */
  ownFrameLabel: string | undefined;
  /** The state word for a model that cannot carry the figures, with its note on a tooltip. */
  modelState: string | null;
  modelNote: string | undefined;
  /** Why the orbit is missing altogether, or `undefined` when it is there. */
  noOrbit: { declined: ReckoningDecline | undefined } | null;
  /** A refusal of the path, spoken here while the diagram is not there to speak it. */
  withheld: Extract<OrbitTrajectory, { shape: "withheld" }> | null;
  grid: OrbitReadoutGridProps;
}

/** The orbit's numbers and the words that qualify them: the body, the frame they are read in, and why any of them is a dash. */
export function OrbitFigures({
  bodyName,
  pill,
  ownFrameLabel,
  modelState,
  modelNote,
  noOrbit,
  withheld,
  grid,
}: Readonly<OrbitFiguresProps>): ReactNode {
  return (
    <Stack style={COLUMN}>
      <Cluster wrap align="center" gap="related-compact">
        {bodyName != null && (
          <span
            style={{
              fontSize: "var(--font-size-caption)",
              color: "var(--color-text-muted)",
              letterSpacing: "0.03em",
            }}
          >
            {bodyName}
          </span>
        )}
        {pill !== null && <PillBadge pill={pill} />}
      </Cluster>
      {withheld !== null && <DeclinedEmptyState declined={withheld.declined} />}
      {modelState !== null && (
        <Tooltip text={modelNote} focusable>
          <ReadoutCaption>{modelState}</ReadoutCaption>
        </Tooltip>
      )}
      {noOrbit !== null && <NoData>{noOrbitSentence(noOrbit.declined)}</NoData>}
      {/* Named only when the figures are not in the game's own view frame. */}
      {ownFrameLabel !== undefined && (
        <ReadoutCaption>{`Frame: ${ownFrameLabel}`}</ReadoutCaption>
      )}
      <OrbitReadoutGrid {...grid} />
    </Stack>
  );
}

const COLUMN = { gap: "var(--gap-related)", minWidth: 0 } as const;

/** The regime pill, with what it waits for on its tooltip where it has no answer yet. */
function PillBadge({ pill }: Readonly<{ pill: OrbitPill }>) {
  const badge = <Badge tone={pill.tone}>{pill.label}</Badge>;
  return pill.title === undefined ? (
    badge
  ) : (
    <Tooltip text={pill.title} focusable>
      {badge}
    </Tooltip>
  );
}
