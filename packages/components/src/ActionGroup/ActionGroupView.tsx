import type { ActionGroup, ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  actionGroupIdOf,
  buildToggleArgs,
  TOGGLE_INVALID,
  toggleCommandFor,
  useActionInput,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useCommand } from "@ksp-gonogo/sitrep-client";
import {
  BellIcon,
  Input,
  Panel,
  Placeholder,
  ToggleButton,
} from "@ksp-gonogo/ui";
import {
  Cluster,
  getSizeBucket,
  IconButton,
  Inline,
  Section,
  Stack,
  Text,
  Truncate,
} from "@ksp-gonogo/ui-kit";
import { useRef, useState } from "react";
import { useAlarmsLauncher } from "../shared/AlarmsLauncher";
import type { ActionGroupActions, ActionGroupConfig } from "./config";
import type { ActionGroupSlotContext } from "./slots";
import {
  HELD_STATE,
  stateLabelOf,
  UNAVAILABLE_TITLES,
  unavailableReasonOf,
} from "./toggleAvailability";

export interface ActionGroupViewProps
  extends Readonly<ComponentProps<ActionGroupConfig>> {
  group: ActionGroup | undefined;
  value: unknown;
  /** The state was withheld because it went stale, not because it never came. */
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

  // Paused and no-signal are claims about now, so neither is answered from a held reading.
  const warpReading = useTelemetry("time.warp");
  const isPaused =
    warpReading.state === "observed" ? warpReading.value.paused : undefined;
  const linkReading = useTelemetry("comms.link");
  const commConnected =
    linkReading.state === "observed" ? linkReading.value.connected : undefined;
  const openAlarms = useAlarmsLauncher();

  const toggleCommand = group ? toggleCommandFor(group) : null;
  const toggleCmd = useCommand(toggleCommand ?? "");

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleToggle = () => {
    if (!group?.toggle || !toggleCommand) return;
    const args = buildToggleArgs(group, value);
    if (args === TOGGLE_INVALID) return;
    void toggleCmd.send(args, { label: `Toggle ${currentLabel}` });
  };

  useActionInput<ActionGroupActions>({
    toggle: (payload) => {
      if (!group) return undefined;
      // Press edge only, so one tap is one toggle.
      if (payload.kind === "button" && payload.value !== true) return undefined;
      handleToggle();
      return { [group.name]: value !== true };
    },
  });

  if (!group) {
    return (
      <Panel
        sections={
          <Section full>
            <Placeholder>No action group configured</Placeholder>
          </Section>
        }
      />
    );
  }

  // Some groups, Stage among them, report a number rather than a boolean.
  const isOn = typeof value === "number" ? value > 0 : value === true;
  const stateLabel = stateLabelOf(value);

  const slotContext: ActionGroupSlotContext = {
    groupId: group.name,
    label: currentLabel,
    value,
    stateLabel,
  };

  const unavailableReason = unavailableReasonOf({
    valueHeld,
    stateUnreadable,
    isPaused,
    commConnected,
    provenance: group.provenance,
  });
  const unavailableTitle = unavailableReason
    ? UNAVAILABLE_TITLES[unavailableReason]
    : undefined;

  const cols = w ?? 6;
  const showOfficialName = cols >= 5;
  // Disabled whenever `buildToggleArgs` would refuse the press; an `assumed` group stays live.
  const canToggle = Boolean(group.toggle) && !valueHeld && !stateUnreadable;
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
              <Stack
                as="button"
                onClick={startEditing}
                aria-label={`Rename ${currentLabel}`}
                title="Click to rename"
                style={{
                  flex: 1,
                  minWidth: 0,
                  cursor: "text",
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  padding: 0,
                  font: "inherit",
                }}
              >
                <Truncate style={{ fontWeight: 600, letterSpacing: "0.05em" }}>
                  {currentLabel}
                </Truncate>
                {showOfficialName &&
                  config?.label &&
                  config.label !== group.name && (
                    <Text tone="faint" size="xs">
                      {group.name}
                    </Text>
                  )}
              </Stack>
            )}
            <Inline>
              {showBell && group.toggle && (
                <IconButton
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
                </IconButton>
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
