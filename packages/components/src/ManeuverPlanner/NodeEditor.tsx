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
  saving: boolean;
  onSave: (patch: NodeEditPatch) => Promise<void>;
  onCancel: () => void;
}

export function NodeEditor({
  node,
  currentUT,
  saving,
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
        burn in <Countdown value={timeTo} />
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
        <SecondaryButton type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </SecondaryButton>
        <CompactPrimaryButton
          type="button"
          onClick={() => void onSave({ ut, radial, normal, prograde })}
          disabled={saving || !dirty}
        >
          {saving ? "Saving..." : "Save"}
        </CompactPrimaryButton>
      </EditActions>
    </EditGrid>
  );
}
