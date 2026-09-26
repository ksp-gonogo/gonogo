import type { ConfigComponentProps } from "@ksp-gonogo/core";
import { ConfigForm, Field, FieldHint, FieldLabel } from "@ksp-gonogo/ui-kit";
import type { TargetPickerConfig } from "./config";

export function TargetPickerConfigForm(
  _props: Readonly<ConfigComponentProps<TargetPickerConfig>>,
) {
  return (
    <ConfigForm>
      <Field>
        <FieldLabel>Target Picker</FieldLabel>
        <FieldHint>
          No config: every target (bodies, vessels, docking ports) comes from
          the <code>target.available</code> list. Click a row to set the KSP
          target; Clear target on the current target drops it.
        </FieldHint>
      </Field>
    </ConfigForm>
  );
}
