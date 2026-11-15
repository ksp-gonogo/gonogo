import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import { ManeuverFrame, value } from "@ksp-gonogo/sitrep-sdk";
import { type BoundControlCommand, Button, Unit } from "@ksp-gonogo/ui-kit";
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
  /** The command that edits node `nodeId` as `patch` says, drawn by the nudge button that sends it. */
  nudgeCommand: (nodeId: string, patch: NodeEditPatch) => BoundControlCommand;
}

/** Whether the game's patched conics reach the target body after the planned burns, and a prograde nudge where they do not. */
export function TransferCheck({
  nodes,
  target,
  nudgeCommand,
}: TransferCheckProps) {
  const last = nodes.at(-1);
  if (!last) return null;
  const check = checkEncounter(last.orbitPatches, target);
  // A node in a frame this planner cannot name the slots of is not nudged.
  const nudgeable = last.frame === ManeuverFrame.RadialNormalPrograde;
  const nudge = (step: number) =>
    nudgeCommand(last.id, {
      ut: last.UT,
      radial: last.deltaV[0],
      normal: last.deltaV[1],
      prograde: last.deltaV[2] + step,
    });
  const unaddressable = last.id ? null : "This node arrived without an id";
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
            variant="ghost"
            size="sm"
            command={nudge(-NUDGE_STEP)}
            unavailable={unaddressable}
            blockedAriaLabel="Nudge down"
          >
            Nudge -<Unit value={value("m/s", NUDGE_STEP)} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            command={nudge(NUDGE_STEP)}
            unavailable={unaddressable}
            blockedAriaLabel="Nudge up"
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
