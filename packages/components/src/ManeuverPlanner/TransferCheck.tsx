import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import { ManeuverFrame, value } from "@ksp-gonogo/sitrep-sdk";
import { Button, Unit } from "@ksp-gonogo/ui-kit";
import { checkEncounter, type EncounterCheck } from "./encounterCheck";
import type { NodeEditPatch } from "./NodeRow";
import { Label, PreviewGrid, PreviewValue } from "./styles";

/** The prograde step a nudge applies, in m/s. */
export const NUDGE_STEP = 1;

interface TransferCheckProps {
  /** The planned nodes; the last one's patches are the trajectory after every planned burn. */
  nodes: readonly ParsedManeuverNode[];
  /** The body the transfer is aimed at. */
  target: string;
  onNudge: (nodeId: string, patch: NodeEditPatch) => Promise<void> | void;
}

/** Whether the game's patched conics reach the target body after the planned burns, and a prograde nudge where they do not. */
export function TransferCheck({ nodes, target, onNudge }: TransferCheckProps) {
  const last = nodes.at(-1);
  if (!last) return null;
  const check = checkEncounter(last.orbitPatches, target);
  // A node in a frame this planner cannot name the slots of is not nudged.
  const nudgeable = last.frame === ManeuverFrame.RadialNormalPrograde;
  const nudge = (step: number) =>
    onNudge(last.id, {
      ut: last.UT,
      radial: last.deltaV[0],
      normal: last.deltaV[1],
      prograde: last.deltaV[2] + step,
    });
  // A refused edit is already reported on the planner's error line.
  const nudgeBy = (step: number) => {
    Promise.resolve(nudge(step)).catch(() => {});
  };
  return (
    <div role="status" aria-live="polite">
      <PreviewGrid>
        <Label>{target} encounter</Label>
        <PreviewValue $accent={check.kind === "encounter" ? "pe" : undefined}>
          <CheckReading check={check} />
        </PreviewValue>
      </PreviewGrid>
      {check.kind === "none" && nudgeable && (
        <div style={NUDGE_ROW_STYLE}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => nudgeBy(-NUDGE_STEP)}
          >
            Nudge -<Unit value={value("m/s", NUDGE_STEP)} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => nudgeBy(NUDGE_STEP)}
          >
            Nudge +<Unit value={value("m/s", NUDGE_STEP)} />
          </Button>
        </div>
      )}
    </div>
  );
}

function CheckReading({ check }: Readonly<{ check: EncounterCheck }>) {
  switch (check.kind) {
    case "pending":
      return <>pending</>;
    case "none":
      return <>none</>;
    case "encounter":
      return (
        <>
          encounter, Pe <Unit value={check.periapsisAltitude} />
        </>
      );
  }
}

const NUDGE_ROW_STYLE = {
  display: "flex",
  gap: "var(--gap-related)",
  paddingTop: "var(--gap-related)",
} as const;
