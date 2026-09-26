import type { ActionGroupId, ConfigComponentProps } from "@ksp-gonogo/core";
import { actionGroupIdOf, useActionGroups } from "@ksp-gonogo/core";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Input,
  Select,
  useModalSaveBar,
} from "@ksp-gonogo/ui";
import { useMemo, useState } from "react";
import type { ActionGroupConfig } from "./config";

export function ActionGroupConfigForm({
  config,
  onSave,
}: Readonly<ConfigComponentProps<ActionGroupConfig>>) {
  const groups = useActionGroups();
  const [actionGroupId, setActionGroupId] = useState<ActionGroupId>(
    config?.actionGroupId ?? "AG1",
  );
  const [label, setLabel] = useState(config?.label ?? "");

  const candidate = useMemo<ActionGroupConfig>(
    () => ({ actionGroupId, label: label.trim() || undefined }),
    [actionGroupId, label],
  );

  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="ag-select">Action Group</FieldLabel>
        <Select
          id="ag-select"
          value={actionGroupId}
          onChange={(e) => setActionGroupId(e.target.value as ActionGroupId)}
        >
          {/* Labelled by name, VALUED by identity: a custom group a player
              named after a stock singleton would otherwise save the stock
              singleton's id, and resolve to it. */}
          {groups.map((g) => (
            <option key={actionGroupIdOf(g)} value={actionGroupIdOf(g)}>
              {g.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="ag-label">Custom Label</FieldLabel>
        <Input
          id="ag-label"
          type="text"
          placeholder={actionGroupId}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <FieldHint>Leave blank to use the action group name.</FieldHint>
      </Field>
    </ConfigForm>
  );
}
