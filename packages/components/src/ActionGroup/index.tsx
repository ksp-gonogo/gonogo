import type {
  ActionDefinition,
  ActionGroupId,
  ComponentProps,
  ConfigComponentProps,
} from "@ksp-gonogo/core";
import {
  ACTION_GROUPS,
  AugmentSlot,
  getSizeBucket,
  registerComponent,
  useActionInput,
  useDataValue,
  useExecuteAction,
} from "@ksp-gonogo/core";
import {
  BellIcon,
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Input,
  Panel,
  Placeholder,
  Select,
  ToggleButton,
  useModalSaveBar,
} from "@ksp-gonogo/ui";
import { useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { useAlarmsLauncher } from "../shared/AlarmsLauncher";

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
// Augment slots
//
// ActionGroup is a single-group control, so its slot props carry the identity
// and live readout of the *one* group this instance drives. An augment binds a
// Kerbalism/mod-subsystem status describing WHAT that group toggles — e.g.
// "AG3 → radiators" — using the group id/datum to scope itself.
//   • `action-group.badges`   — inline in the header row; per-group indicators.
//   • `action-group.sections` — richer whole-widget status block in the body.
// Both receive the same context; the placement differs.
// ---------------------------------------------------------------------------

/**
 * The context both ActionGroup slots pass to their augments. An
 * augment reads the `groupId` to decide whether/how to describe the toggled
 * subsystem, and can reflect the live `value` / `stateLabel` if it wants to.
 */
export interface ActionGroupSlotContext {
  /** The KSP action group this instance controls (e.g. "AG1", "SAS", "Gear"). */
  groupId: ActionGroupId;
  /** The display label — custom override or the official group name. */
  label: string;
  /** The group's current Value (boolean or numeric readout); `undefined` if unknown. */
  value: unknown;
  /** Rendered state readout — "ON" / "OFF" / a numeric string / "—". */
  stateLabel: string;
}

// Declaration-merge the slot ids → props type into core's `SlotRegistry`.
// Co-located here (not a central file) so
// parallel slot work on other widgets can't collide. This makes
// `registerAugment` and `<AugmentSlot name="action-group.badges" …>` type-check
// against `ActionGroupSlotContext` rather than the loose fallback.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "action-group.badges": ActionGroupSlotContext;
    "action-group.sections": ActionGroupSlotContext;
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function ActionGroupComponent({
  config,
  onConfigChange,
  w,
  h,
}: Readonly<ComponentProps<ActionGroupConfig>>) {
  const group = ACTION_GROUPS.find((g) => g.name === config?.actionGroupId);
  const currentLabel = config?.label ?? group?.name ?? "";

  // `group.value`/`group.toggle` are resolved dynamically off the ACTION_GROUPS
  // registry (`@ksp-gonogo/core/actionGroups.ts`), not literal `useDataValue`
  // string calls — see `mapTopic.coverage.test.ts`'s doc comment for why that
  // makes this widget the scan's own blind spot. Abort and Precision
  // Control's `.value` keys were the last two holdouts and are now
  // un-gapped: `v.abortValue` ->
  // `vessel.control.abort` and `v.precisionControlValue` ->
  // `vessel.control.precisionControl` (`map-topic.ts`'s `TELEMACHUS_CLEAN_HOMES`)
  // — every other group's `.value` was already mapped. The `.toggle` side is
  // `useExecuteAction`, a different dispatch path this comment doesn't cover;
  // `f.abort` -> `vessel.control.setAbort` rides the same toggle -> absolute
  // bridge as `f.sas`/`f.rcs`/etc (`map-command.ts`). Together this closes the
  // widget's last gapped pair with zero code change here — both keys already
  // ride the stream via the mapTopic/mapCommand shim once `vessel.control` is
  // carried; only test coverage needed adding.
  const value = useDataValue("data", group?.value ?? "v.sasValue");
  const isPaused = useDataValue<boolean>("data", "t.isPaused");
  const commConnected = useDataValue<boolean>("data", "comm.connected");
  const execute = useExecuteAction("data");
  const openAlarms = useAlarmsLauncher();

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

  // Most groups are boolean (ON/OFF). A few — e.g. Stage's `v.currentStage` —
  // report a numeric state, so coercing every non-true value to OFF mislabels
  // them. Treat numbers as their own readout and only fall back to ON/OFF for
  // genuine booleans.
  const isNumeric = typeof value === "number";
  const isOn = isNumeric ? value > 0 : value === true;
  const isUnknown = value === undefined;
  const stateLabel = isUnknown
    ? "—"
    : isNumeric
      ? String(value)
      : value === true
        ? "ON"
        : "OFF";

  // Props both augment slots pass down. Built after the `!group`
  // guard, so this is a plain object rather than a hook — no `useMemo` may run
  // conditionally. A fresh reference per render is fine: the live `value`
  // changes anyway, and `AugmentSlot`'s subscription is store-driven.
  const slotContext: ActionGroupSlotContext = {
    groupId: group.name,
    label: currentLabel,
    value,
    stateLabel,
  };

  // Surface the most common reasons the action wouldn't fire if the user
  // pressed it now. Mirrors Telemachus's action-group response codes 1–4
  // (paused / no power / antenna off / antenna missing) — codes 0 and 5 are
  // covered upstream (0 = OK, 5 = handled by `requires: ["flight"]`).
  let unavailableReason: string | null = null;
  if (isPaused === true) unavailableReason = "Paused";
  else if (commConnected === false) unavailableReason = "No signal";

  // Selective rendering — drop the secondary "official name" line when the
  // widget is narrow. The state pill is itself the toggle control, so it is
  // present at every size (no separate vertical-room gate).
  const cols = w ?? 6;
  const showOfficialName = cols >= 5;
  // Precision Control has no toggle key — the pill stays a read-only indicator
  // there (disabled button) rather than a no-op clickable.
  const canToggle = Boolean(group.toggle);
  // Bell is reachable from the alarms menu — at tiny size it just crowds the
  // pill and the size-locked button style breaks the layout.
  const showBell = getSizeBucket(w, h) !== "tiny" && Boolean(openAlarms);

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
          {showOfficialName && config?.label && config.label !== group.name && (
            <OfficialName>{group.name}</OfficialName>
          )}
        </LabelArea>
        <HeaderRight>
          {/* Inline per-group badges — an Uplink can surface a subsystem
              indicator here without a bespoke slot. Renders nothing
              until an augment binds `action-group.badges`. */}
          <AugmentSlot name="action-group.badges" props={slotContext} />
          {showBell && group.toggle && (
            <AlarmIconButton
              type="button"
              aria-label={`Set alarm to fire ${currentLabel}`}
              title={`Set alarm to fire ${currentLabel}`}
              onClick={(e) => {
                e.stopPropagation();
                if (!group.toggle || !openAlarms) return;
                openAlarms({
                  name: `Fire ${currentLabel}`,
                  action: group.toggle,
                });
              }}
            >
              <BellIcon />
            </AlarmIconButton>
          )}
          <ToggleButton
            active={isOn}
            size="sm"
            disabled={!canToggle}
            onClick={handleToggle}
            aria-label={`Toggle ${currentLabel}`}
            title={unavailableReason ?? `Toggle ${currentLabel}`}
          >
            {stateLabel}
          </ToggleButton>
        </HeaderRight>
      </Header>
      {unavailableReason && getSizeBucket(w, h) !== "tiny" && (
        <UnavailableNotice
          role="status"
          aria-live="polite"
          title="The action group can't fire right now"
        >
          {unavailableReason}
        </UnavailableNotice>
      )}
      {/* Richer whole-widget status block — the section-level counterpart to the
          inline badges. An Uplink describing what this group toggles
          (e.g. a Kerbalism subsystem) renders here. Empty until bound. */}
      <AugmentSlot name="action-group.sections" props={slotContext} />
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
  minSize: { w: 3, h: 3 },
  // Compact controls pair nicely two-per-row on mobile.
  mobileWidth: "half",
  component: ActionGroupComponent,
  configComponent: ActionGroupConfigComponent,
  dataRequirements: [],
  defaultConfig: { actionGroupId: "AG1" },
  actions: actionGroupActions,
  augmentSlots: ["action-group.badges", "action-group.sections"],
  requires: ["flight"],
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
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
    border-radius: 2px;
  }
`;

const GroupLabel = styled.span`
  font-size: 13px;
  color: var(--color-text-primary);
  font-weight: 600;
  letter-spacing: 0.05em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const OfficialName = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
  letter-spacing: 0.04em;
`;

const LabelInput = styled.input`
  background: var(--color-surface-raised);
  border: 1px solid var(--color-text-faint);
  border-radius: 2px;
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.05em;
  padding: 1px 4px;
  width: 100%;
  box-sizing: border-box;
  outline: none;

  &:focus {
    border-color: var(--color-accent-fg);
  }
`;

const HeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
`;

const UnavailableNotice = styled.div`
  margin-top: 4px;
  padding: 2px 6px;
  background: var(--color-status-warn-bg, transparent);
  border: 1px solid var(--color-status-warn-fg, var(--color-text-faint));
  border-radius: 2px;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-status-warn-fg, var(--color-text-muted));
  align-self: flex-start;
`;

const AlarmIconButton = styled.button`
  background: transparent;
  border: none;
  padding: 2px;
  color: var(--color-text-faint);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 2px;

  &:hover {
    color: var(--color-accent-fg);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;
