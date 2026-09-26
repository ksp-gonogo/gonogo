import type { ConfigComponentProps } from "@ksp-gonogo/core";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  useModalSaveBar,
} from "@ksp-gonogo/ui-kit";
import { useMemo, useState } from "react";
import type { PowerSystemsConfig } from "./config";

export function PowerSystemsConfigForm({
  config,
  onSave,
}: Readonly<ConfigComponentProps<PowerSystemsConfig>>) {
  const [defaultResource, setDefaultResource] = useState(
    config?.defaultResource ?? "ElectricCharge",
  );

  const candidate = useMemo<PowerSystemsConfig>(
    () => ({ defaultResource: defaultResource.trim() || "ElectricCharge" }),
    [defaultResource],
  );

  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="ps-default-resource">Default resource</FieldLabel>
        <input
          id="ps-default-resource"
          type="text"
          value={defaultResource}
          onChange={(e) => setDefaultResource(e.target.value)}
        />
        <FieldHint>
          Resource the widget focuses on by default. The picker still lets you
          switch at runtime; this just sets the starting point.
        </FieldHint>
      </Field>
    </ConfigForm>
  );
}
