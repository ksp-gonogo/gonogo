import type { StageEntry } from "../ShipMap/stageStack";
import { StageList, StageNumber, StageParts, StageRow } from "./styles";

/**
 * The staging order of a saved craft, highest stage first as the in-game stack
 * lists it, each stage with the parts that fire or release in it and how many.
 * Useful for the operator checking what a craft will do on each press of the
 * stage control before launching it. Used beside a picked craft in the pad's
 * launch picker. Draws nothing when the craft has no staged parts.
 */
export function CraftStages({ stages }: { stages: readonly StageEntry[] }) {
  if (stages.length === 0) return null;
  return (
    <StageList aria-label="Stages" tabIndex={0} data-craft-stages>
      {stages.map((s) => (
        <StageRow key={s.stage}>
          <StageNumber>Stage {s.stage}</StageNumber>
          <StageParts>
            {s.parts
              .map((p) => (p.count > 1 ? `${p.title} x${p.count}` : p.title))
              .join(", ")}
          </StageParts>
        </StageRow>
      ))}
    </StageList>
  );
}
