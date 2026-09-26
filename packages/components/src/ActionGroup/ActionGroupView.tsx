import type { ActionGroup, ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  actionGroupIdOf,
  buildToggleArgs,
  getSizeBucket,
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
  Badge,
  Cluster,
  IconButton,
  Inline,
  NULL_DISPLAY,
  Section,
  Stack,
  Text,
  Truncate,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import { useRef, useState } from "react";
import { useAlarmsLauncher } from "../shared/AlarmsLauncher";
import type { ActionGroupActions, ActionGroupConfig } from "./config";
import type { ActionGroupSlotContext } from "./slots";

export interface ActionGroupViewProps
  extends Readonly<ComponentProps<ActionGroupConfig>> {
  group: ActionGroup | undefined;
  value: unknown;
  /** The state was withheld because it went stale, not because it never came. */
  valueNotCurrent: boolean;
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
  valueNotCurrent,
  stateUnreadable,
}: ActionGroupViewProps) {
  const currentLabel = config?.label ?? group?.name ?? "";

  /**
   * Both are inputs to one computed verdict, "would this fire if you pressed it
   * now", so both are taken from the observation alone. Neither may be answered
   * from a held value: telling the operator the game is paused, or that there is
   * no signal, on the strength of a reading we can no longer vouch for puts a
   * confident reason on the screen for a state that may well have ended. A
   * withheld one lands on the same "nothing to warn about" the never-arrived
   * case produces, which is the honest silence.
   */
  const warpReading = useTelemetry("time.warp");
  const isPaused =
    warpReading.state === "observed" ? warpReading.value.paused : undefined;
  const linkReading = useTelemetry("comms.link");
  const commConnected =
    linkReading.state === "observed" ? linkReading.value.connected : undefined;
  const openAlarms = useAlarmsLauncher();

  // The command name varies with the configured group, which `useCommand` does not mind: hooks do not care about argument identity.
  const toggleCommand = group ? toggleCommandFor(group) : null;
  const toggleCmd = useCommand(toggleCommand ?? "");
  usePanelDelay(toggleCmd);

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

  // A few groups, Stage among them, report a NUMBER rather than a boolean, so coercing every non-true value to OFF would mislabel them.
  const isNumeric = typeof value === "number";
  const isOn = isNumeric ? value > 0 : value === true;
  /**
   * `== null` on purpose. A group's state arrives as `null` when the backend
   * reported the group and could not read it, and as `undefined` when nothing
   * has arrived for it at all. Neither one is OFF.
   */
  const isUnknown = value == null;
  const stateLabel = isUnknown
    ? NULL_DISPLAY
    : isNumeric
      ? String(value)
      : value === true
        ? "ON"
        : "OFF";

  /**
   * Built after the `!group` guard, so it is a plain object rather than a hook:
   * no `useMemo` may run conditionally. A fresh reference per render is fine,
   * since the live `value` changes anyway and `AugmentSlot`'s subscription is
   * store-driven.
   */
  const slotContext: ActionGroupSlotContext = {
    groupId: group.name,
    label: currentLabel,
    value,
    stateLabel,
  };

  /*
   * The most common reasons the action would not fire if pressed now, in
   * precedence order. Staleness is first because it is the reason the pill
   * reads NULL_DISPLAY, and it is the broader answer that already covers an
   * unreadable state. "Paused" and "No signal" are confident sentences about a
   * different screen, so they yield to both. "Not reported" is last because,
   * unlike the three above it, it does not stop the press: the registry keeps a
   * configured group operable on purpose, so it only explains the empty pill
   * when nothing else is claiming the line.
   */
  let unavailableReason: string | null = null;
  if (valueNotCurrent) unavailableReason = "State not current";
  else if (stateUnreadable) unavailableReason = "State unreadable";
  else if (isPaused === true) unavailableReason = "Paused";
  else if (commConnected === false) unavailableReason = "No signal";
  else if (group.provenance === "assumed") unavailableReason = "Not reported";
  // Keyed off the reason actually chosen, not re-derived, so the two cannot drift into a caveat explained by the wrong sentence.
  const unavailableTitle =
    unavailableReason === "State not current"
      ? "The last known state is too old to invert, so the toggle is held"
      : unavailableReason === "State unreadable"
        ? "The backend reported this group but could not read whether it is engaged, so the toggle is held"
        : unavailableReason === "Not reported"
          ? "Configured, but no backend has reported this group, so its state is unknown"
          : "The action group can't fire right now";

  // The state pill is itself the toggle control, so it is present at every size; only the secondary official-name line drops when narrow.
  const cols = w ?? 6;
  const showOfficialName = cols >= 5;
  /**
   * Precision Control has no toggle key, and a withheld or unreadable state
   * leaves nothing to invert, so `buildToggleArgs` would refuse the press. An
   * inert-looking control beside a stated reason is honest where a live-looking
   * one that swallows the click is not. An "assumed" group stays live: the
   * registry keeps a configured group operable on purpose.
   */
  const canToggle =
    Boolean(group.toggle) && !valueNotCurrent && !stateUnreadable;
  // At tiny size the bell crowds the pill and its size-locked button style breaks the layout; it stays reachable from the alarms menu.
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
        /*
         * Renaming changes the LABEL, so the saved identity must survive it
         * untouched: writing `group.name` here would re-point a custom group's
         * config at whatever singleton shares its name.
         */
        actionGroupId: actionGroupIdOf(group),
        label: draft || undefined,
      });
    }
    setEditing(false);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  // Only meaningful while editing. The rename trigger is a real `<button>`, so its own Enter/Space activation is native.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") cancelEdit();
  };

  return (
    /*
     * The panel names the WIDGET; the group's own name is a control, not a
     * heading. `panelTitle` renders its argument inside PanelTitle's h3, so
     * passing this through would nest a button and an input in a heading and
     * uppercase the operator's own label into the bargain.
     */
    <Panel
      panelTitle="ACTION GROUP"
      compactTitle={["ACTIONS", "AG"]}
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
        unavailableReason && getSizeBucket(w, h) !== "tiny" && (
          <Section key="unavailable" full>
            <Badge
              severity="warning"
              size="sm"
              role="status"
              aria-live="polite"
              title={unavailableTitle}
            >
              {unavailableReason}
            </Badge>
          </Section>
        ),
        // `AugmentSlot` renders a fragment, so each bound augment becomes its own item of the section grid.
        <AugmentSlot
          key="subsystem"
          name="action-group.subsystem"
          props={slotContext}
        />,
      ]}
    />
  );
}
