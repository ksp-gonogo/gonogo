import type {
  ActionDefinition,
  ActionGroupId,
  ComponentProps,
  ConfigComponentProps,
} from "@gonogo/core";
import {
  ACTION_GROUPS,
  registerComponent,
  useActionInput,
  useDataValue,
  useExecuteAction,
} from "@gonogo/core";
import {
  Button,
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Input,
  Panel,
  Placeholder,
  PrimaryButton,
  Select,
} from "@gonogo/ui";
import { useRef, useState } from "react";
import styled from "styled-components";

type ActionGroupConfig = {
  actionGroupId: ActionGroupId;
  /** Custom display label. Falls back to the official action group name. */
  label?: string;
};

const actionGroupActions = [
  {
    id: "toggle",
    label: "Toggle",
    accepts: ["button"],
    description: "Toggles this action group on/off.",
  },
] as const satisfies readonly ActionDefinition[];

export type ActionGroupActions = typeof actionGroupActions;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function ActionGroupComponent({
  config,
  onConfigChange,
}: Readonly<ComponentProps<ActionGroupConfig>>) {
  const group = ACTION_GROUPS.find((g) => g.name === config?.actionGroupId);
  const currentLabel = config?.label ?? group?.name ?? "";

  const value = useDataValue("data", group?.value ?? "v.sasValue");
  const execute = useExecuteAction("data");

  // Inline label editing state
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleToggle = () => {
    if (group?.toggle) void execute(group.toggle);
  };

  useActionInput<ActionGroupActions>({
    toggle: (payload) => {
      if (!group) return undefined;
      // Fire on button-press edge only; releases are ignored so one tap = one toggle.
      if (payload.kind === "button" && payload.value !== true) return undefined;
      handleToggle();
      return { [group.name]: value !== true };
    },
  });

  if (!group) {
    return (
      <Panel>
        <Placeholder>No action group configured</Placeholder>
      </Panel>
    );
  }

  const isOn = value === true;
  const isUnknown = value === undefined;

  const startEditing = () => {
    setDraft(currentLabel);
    setEditing(true);
    // Focus runs after render
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const commitEdit = () => {
    if (editing && onConfigChange) {
      onConfigChange({
        ...config,
        actionGroupId: group.name,
        label: draft || undefined,
      });
    }
    setEditing(false);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") cancelEdit();
  };

  return (
    <Panel>
      <Header>
        <LabelArea
          role={editing ? undefined : "button"}
          tabIndex={editing ? undefined : 0}
          onClick={editing ? undefined : startEditing}
          onKeyDown={
            editing
              ? undefined
              : (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    startEditing();
                  }
                }
          }
          aria-label={editing ? undefined : `Rename ${currentLabel}`}
          title="Click to rename"
        >
          {editing ? (
            <LabelInput
              ref={inputRef}
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <GroupLabel>{currentLabel}</GroupLabel>
          )}
          {/* Always show official name as secondary, unless it matches the label */}
          {config?.label && config.label !== group.name && (
            <OfficialName>{group.name}</OfficialName>
          )}
        </LabelArea>
        <StateIndicator $on={isOn} $unknown={isUnknown}>
          {isUnknown ? "—" : isOn ? "ON" : "OFF"}
        </StateIndicator>
      </Header>
      {group.toggle && (
        <Button onClick={handleToggle} aria-label={`Toggle ${currentLabel}`}>
          TOGGLE
        </Button>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Config component (rendered inside modal)
// ---------------------------------------------------------------------------

function ActionGroupConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<ActionGroupConfig>>) {
  const [actionGroupId, setActionGroupId] = useState<ActionGroupId>(
    config?.actionGroupId ?? "AG1",
  );
  const [label, setLabel] = useState(config?.label ?? "");

  const handleSave = () => {
    onSave({ actionGroupId, label: label.trim() || undefined });
  };

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="ag-select">Action Group</FieldLabel>
        <Select
          id="ag-select"
          value={actionGroupId}
          onChange={(e) => setActionGroupId(e.target.value as ActionGroupId)}
        >
          {ACTION_GROUPS.map((g) => (
            <option key={g.name} value={g.name}>
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
      <PrimaryButton onClick={handleSave}>Save</PrimaryButton>
    </ConfigForm>
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerComponent<ActionGroupConfig>({
  id: "action-group",
  name: "Action Group",
  description:
    "Toggle a KSP action group or system (SAS, RCS, gear, brakes, lights, AG1–AG10).",
  tags: ["control", "telemetry"],
  defaultSize: { w: 6, h: 6 },
  // Compact controls pair nicely two-per-row on mobile.
  mobileWidth: "half",
  component: ActionGroupComponent,
  configComponent: ActionGroupConfigComponent,
  dataRequirements: [],
  defaultConfig: { actionGroupId: "AG1" },
  actions: actionGroupActions,
});

export { ActionGroupComponent };

// ---------------------------------------------------------------------------
// Styles — component
// ---------------------------------------------------------------------------

const Header = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
`;

const LabelArea = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
  cursor: text;

  &:focus-visible {
    outline: 2px solid #00ff88;
    outline-offset: 2px;
    border-radius: 2px;
  }
`;

const GroupLabel = styled.span`
  font-size: 13px;
  color: #ccc;
  font-weight: 600;
  letter-spacing: 0.05em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const OfficialName = styled.span`
  font-size: 10px;
  color: #444;
  letter-spacing: 0.04em;
`;

const LabelInput = styled.input`
  background: #1a1a1a;
  border: 1px solid #444;
  border-radius: 2px;
  color: #ccc;
  font-family: monospace;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.05em;
  padding: 1px 4px;
  width: 100%;
  box-sizing: border-box;
  outline: none;

  &:focus {
    border-color: #00ff88;
  }
`;

const StateIndicator = styled.span<{ $on: boolean; $unknown: boolean }>`
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  flex-shrink: 0;
  color: ${({ $on, $unknown }) =>
    $unknown ? "#444" : $on ? "#00ff88" : "#ff4444"};
`;
