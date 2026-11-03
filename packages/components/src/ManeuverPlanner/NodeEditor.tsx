import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import { maneuverBasisLabels, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { Countdown, UnitInput } from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import type { NodeEditPatch } from "./NodeRow";
import {
  CompactPrimaryButton,
  EditActions,
  EditGrid,
  EditHint,
  SecondaryButton,
} from "./styles";

interface NodeEditorProps {
  node: ParsedManeuverNode;
  currentUT: Value<"ut"> | undefined;
  /** True while the edit is on its way to the game. */
  saving: boolean;
  /** True once the edit was sent and the node still lists its old figures. */
  landing?: boolean;
  onSave: (patch: NodeEditPatch) => Promise<void>;
  onCancel: () => void;
}

export function NodeEditor({
  node,
  currentUT,
  saving,
  landing = false,
  onSave,
  onCancel,
}: NodeEditorProps) {
  const [ut, setUt] = useState(node.UT);
  const [radial, setRadial] = useState(node.deltaV[0]);
  const [normal, setNormal] = useState(node.deltaV[1]);
  const [prograde, setProgade] = useState(node.deltaV[2]);
  const [slot0, slot1, slot2] = maneuverBasisLabels(node.frame);
  const timeTo = currentUT && value("ut", ut).minus(currentUT);
  const dirty =
    ut !== node.UT ||
    radial !== node.deltaV[0] ||
    normal !== node.deltaV[1] ||
    prograde !== node.deltaV[2];
  return (
    <EditGrid>
      <UnitInput
        label="UT"
        unit="ut"
        value={value("ut", ut)}
        onChange={(next) => setUt(next.magnitude)}
      />
      <EditHint>
        {timeTo?.isNegative() ? (
          <>
            burn was <Countdown value={timeTo.abs()} /> ago
          </>
        ) : (
          <>
            burn in <Countdown value={timeTo} />
          </>
        )}
      </EditHint>
      {/* Labelled from the burn's own basis, so an unstated one is not given stock's names. */}
      <UnitInput
        label={slot2}
        unit="m/s"
        value={value("m/s", prograde)}
        onChange={(next) => setProgade(next.magnitude)}
      />
      <UnitInput
        label={slot1}
        unit="m/s"
        value={value("m/s", normal)}
        onChange={(next) => setNormal(next.magnitude)}
      />
      <UnitInput
        label={slot0}
        unit="m/s"
        value={value("m/s", radial)}
        onChange={(next) => setRadial(next.magnitude)}
      />
      <EditActions>
        <SecondaryButton
          type="button"
          onClick={onCancel}
          disabled={saving}
          disabledReason="The node is being saved"
        >
          Cancel
        </SecondaryButton>
        <CompactPrimaryButton
          type="button"
          onClick={() =>
            // The rejection is drawn by the planner's error line and the delay rail.
            onSave({ ut, radial, normal, prograde }).catch(() => undefined)
          }
          disabled={saving || landing || !dirty}
          disabledReason={
            saving || landing
              ? "The node is being saved"
              : "Nothing has changed"
          }
        >
          {saving || landing ? "Saving..." : "Save"}
        </CompactPrimaryButton>
      </EditActions>
    </EditGrid>
  );
}
