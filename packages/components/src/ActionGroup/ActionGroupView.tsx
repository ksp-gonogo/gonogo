import type { ActionGroup, ComponentProps } from "@ksp-gonogo/core";
import { AugmentSlot, actionGroupIdOf } from "@ksp-gonogo/core";
import {
  BellIcon,
  Input,
  Panel,
  Placeholder,
  ToggleButton,
} from "@ksp-gonogo/ui";
import {
  Button,
  Cluster,
  getSizeBucket,
  IconButton,
  Inline,
  Section,
  Stack,
  Text,
  Tooltip,
  Truncate,
} from "@ksp-gonogo/ui-kit";
import { useRef, useState } from "react";
import { useAlarmsLauncher } from "../shared/AlarmsLauncher";
import type { ActionGroupConfig } from "./config";
import type { ActionGroupSlotContext } from "./slots";
import { HELD_STATE, UNAVAILABLE_TITLES } from "./toggleAvailability";
import { useGroupToggle } from "./useGroupToggle";

export interface ActionGroupViewProps
  extends Readonly<ComponentProps<ActionGroupConfig>> {
  group: ActionGroup | undefined;
  value: unknown;
  /** The state was withheld because its reading is held, not because it never came. */
  valueHeld: boolean;
  /** A current payload named this group and could not say whether it is engaged. */
  stateUnreadable: boolean;
}

export function ActionGroupView({
  config,
  onConfigChange,
  w,
  h,
  group,
  value,
  valueHeld,
  stateUnreadable,
}: ActionGroupViewProps) {
  const currentLabel = config?.label ?? group?.name ?? "";

  const openAlarms = useAlarmsLauncher();
  const { isOn, stateLabel, canToggle, unavailableReason, press } =
    useGroupToggle({
      group,
      value,
      valueHeld,
      stateUnreadable,
      label: currentLabel,
    });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  if (!group) {
    return (
      <Panel
        panelTitle="ACTION GROUP"
        sections={
          <Section full>
            <Placeholder>No action group configured</Placeholder>
          </Section>
        }
      />
    );
  }

  const slotContext: ActionGroupSlotContext = {
    groupId: group.name,
    label: currentLabel,
    value,
    stateLabel,
  };

  const unavailableTitle = unavailableReason
    ? UNAVAILABLE_TITLES[unavailableReason]
    : undefined;

  const cols = w ?? 6;
  const showOfficialName = cols >= 5;
  // At tiny size the bell crowds the pill; it stays reachable from the alarms menu.
  const showBell = getSizeBucket(w, h) !== "tiny" && Boolean(openAlarms);

  const startEditing = () => {
    setDraft(currentLabel);
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const commitEdit = () => {
    if (editing && onConfigChange) {
      onConfigChange({
        ...config,
        // Not `group.name`, which would re-point a custom group at a singleton sharing its name.
        actionGroupId: actionGroupIdOf(group),
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
    // The group's name is a control, so it cannot go inside the title's heading.
    <Panel
      panelTitle="ACTION GROUP"
      compactTitle={["ACTIONS", "AG"]}
      panelBadges={
        unavailableReason &&
        unavailableReason !== HELD_STATE &&
        getSizeBucket(w, h) !== "tiny"
          ? [
              {
                id: "unavailable",
                label: unavailableReason,
                tone: "warn",
                title: unavailableTitle,
              },
            ]
          : undefined
      }
      sections={[
        <Section key="control" full>
          <Cluster justify="between" align="start" wrap>
            {editing ? (
              <Stack style={{ flex: 1, minWidth: 0 }}>
                <Input
                  ref={inputRef}
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={handleKeyDown}
                  onClick={(e) => e.stopPropagation()}
                />
              </Stack>
            ) : (
              <Tooltip text="Click to rename">
                <Button
                  variant="text"
                  type="button"
                  onClick={startEditing}
                  aria-label={`Rename ${currentLabel}`}
                  style={{ flex: 1, minWidth: 0, cursor: "text" }}
                >
                  <Stack as="span" style={{ minWidth: 0 }}>
                    <Truncate
                      style={{ fontWeight: 600, letterSpacing: "0.05em" }}
                    >
                      {currentLabel}
                    </Truncate>
                    {showOfficialName &&
                      config?.label &&
                      config.label !== group.name && (
                        <Text level="faint" size="xs">
                          {group.name}
                        </Text>
                      )}
                  </Stack>
                </Button>
              </Tooltip>
            )}
            <Inline>
              {showBell && group.toggle && (
                <Tooltip text={`Set alarm to fire ${currentLabel}`}>
                  <IconButton
                    type="button"
                    aria-label={`Set alarm to fire ${currentLabel}`}
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
                  </IconButton>
                </Tooltip>
              )}
              <Tooltip text={unavailableReason ?? `Toggle ${currentLabel}`}>
                <ToggleButton
                  active={isOn}
                  size="sm"
                  disabled={!canToggle}
                  onClick={press}
                  aria-label={`Toggle ${currentLabel}`}
                >
                  {stateLabel}
                </ToggleButton>
              </Tooltip>
            </Inline>
          </Cluster>
        </Section>,
        <AugmentSlot
          key="subsystem"
          name="action-group.subsystem"
          props={slotContext}
        />,
      ]}
    />
  );
}
