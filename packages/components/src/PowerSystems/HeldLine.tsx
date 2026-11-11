import type { Value } from "@ksp-gonogo/sitrep-sdk";
import { HeldFigure, MissionDate } from "@ksp-gonogo/ui-kit";
import { CELL_LABEL, HELD_LINE } from "./styles";

/**
 * The instant of the last report received while the vessel's figures are held,
 * as "HELD · last report" and its time, with the held mark. Useful for telling
 * the operator how old the figures on the Power Systems widget are. Used by
 * the Power Systems widget.
 */
export function HeldLine({ sinceUt }: Readonly<{ sinceUt: Value<"ut"> }>) {
  return (
    <div style={HELD_LINE} role="status">
      <HeldFigure
        kind="held"
        caption="the last report received from the vessel"
      >
        <span style={CELL_LABEL}>
          Held · last report <MissionDate value={sinceUt} />
        </span>
      </HeldFigure>
    </div>
  );
}
