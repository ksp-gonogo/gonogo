import type { PartPanelDefinition } from "@ksp-gonogo/sitrep-sdk";
import type { CSSProperties } from "react";
import { isGameWindowPanel } from "../PartPanels/GameWindowPanel";
import type { VesselSchematicPartActionEntry } from "./shipTopology";
import { usePartActions } from "./usePartActions";

const NO_CONTRIBUTED: readonly VesselSchematicPartActionEntry[] = [];

export const NEEDS_THE_GAME_SCREEN = "needs someone at the game's screen";
export const OPENS_ON_GAME_SCREEN = "opens on the game's screen";
const NO_RESOURCES: readonly TransferResourceOption[] = [];

/** A resource this part could move, as a menu offers it. */
export interface TransferResourceOption {
  resource: string;
  label: string;
}

export const GAME_GREYS_THIS = "the game greys this action";

/** The mod command that fires one PAW button. Must match `PartActionCommandProvider.InvokePartActionCommand`, which `partActions.cs-sync.test.ts` reads out of the C# source. */
export const INVOKE_PART_ACTION_COMMAND = "vessel.invokePartAction";

/**
 * How many actions a part offers ("N actions available") on the hover
 * tooltip. Under signal delay the count arrives a signal delay late, so the
 * pending state says so rather than showing "0".
 */
export function PartActionCount({
  flightId,
  contributed = NO_CONTRIBUTED,
}: Readonly<{
  flightId: number;
  /** Buttons contributed to `vessel-schematic.part-actions`, counted with the game's own. */
  contributed?: readonly VesselSchematicPartActionEntry[];
}>) {
  const { actions, pending } = usePartActions(flightId);
  const count = (actions?.length ?? 0) + contributed.length;

  return (
    <div style={ROW}>
      <span>actions</span>
      <span style={ROW_VALUE}>
        {pending && contributed.length === 0
          ? "checking..."
          : count > 0
            ? `${count} available`
            : "none"}
      </span>
    </div>
  );
}

/** A game button is pressed unless a console panel stands in for it; a form read from the window it opens needs the press. */
export function sendsPress(panel: PartPanelDefinition | undefined): boolean {
  return panel === undefined || isGameWindowPanel(panel);
}

/** A button that opens a console panel ends in an ellipsis, as one that opens a dialog does elsewhere. */
export function withPanelMark(label: string, opensPanel: boolean): string {
  return opensPanel ? `${label}...` : label;
}

const ROW: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "var(--gap-section)",
  color: "var(--color-text-muted)",
};

const ROW_VALUE: CSSProperties = { color: "var(--color-text-primary)" };
